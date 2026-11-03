// INVOICES, CREDIT NOTES, RECEIPTS and the PROFORMA invoice (page data + PDF).
//
//   invoice      AFA-INV-000001  one per seller order, issued by AFA on the seller's behalf when the
//                                order is PAID. "Tax Invoice" (seller TIN + VAT) when the seller is
//                                VAT-registered, otherwise "Invoice".
//   credit_note  AFA-CN-000001   one per refund on an invoiced seller order (the invoice is never edited)
//   receipt      AFA-RCT-000001  one per paid checkout: the payment
//   proforma     (no number)     unpaid orders: what to pay, AFA's bank details, pay before. Made on request.
//
// Each stored document keeps a FROZEN copy of what it prints ("data"): later changes to the seller,
// the buyer, prices or the settings never change an issued document.
// Who can see what: the buyer -> all of their order's documents; the seller -> their invoices + credit
// notes; the admin -> everything.
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const { PdfDocument } = require('../utils/pdf');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { round2, num, money } = require('./orderShared');
const { ORDER_STATUS, PAYMENT_METHODS } = require('../config/orders');
const { REFUND_SOURCES } = require('../config/refunds');
const { bankDetails } = require('./checkout.service');

const { sequelize, Invoice, DocumentCounter, Order, SellerOrder, OrderItem, Payment, User, ClaimItem } = models;

const PREFIX = { invoice: 'AFA-INV', credit_note: 'AFA-CN', receipt: 'AFA-RCT' };
const TYPE_LABELS = { invoice: 'Invoice', credit_note: 'Credit Note', receipt: 'Receipt', proforma: 'Proforma Invoice' };
const notFound = () => new ApiError(404, 'Document not found', { code: 'INVOICE_NOT_FOUND' });

// Brand colours (AFA brand sheet)
const C = { green: '#2E7D32', dark: '#1B5E20', light: '#E8F5E9', text: '#1F2937', quiet: '#6B7280', rule: '#D1D5DB', gold: '#F4B942' };
const LOGO = path.join(__dirname, '..', 'assets', 'afa-logo.jpg');
let logoCache;
const logo = () => {
  if (logoCache === undefined) {
    try {
      logoCache = fs.readFileSync(LOGO);
    } catch (err) {
      logoCache = null;
    }
  }
  return logoCache;
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Mbabane', day: '2-digit', month: 'short', year: 'numeric' }) : '');

// ---------- numbering (inside the issuing transaction) ----------
async function nextNumber(type, transaction) {
  let counter = await DocumentCounter.findByPk(type, { transaction, lock: transaction.LOCK.UPDATE });
  if (!counter) counter = await DocumentCounter.create({ name: type, lastValue: 0 }, { transaction });
  const value = counter.lastValue + 1;
  await counter.update({ lastValue: value }, { transaction });
  return `${PREFIX[type]}-${String(value).padStart(6, '0')}`;
}

// ---------- parties ----------
async function companyBlock() {
  const s = await settings.getAll();
  return {
    company: {
      name: s.afa_company_name || 'Agricultural e-Marketplace for Eswatini (AFA)',
      address: s.afa_company_address || '',
      tin: s.afa_company_tin || '',
      phone: s.afa_company_phone || '',
      email: s.afa_company_email || '',
    },
    footer: s.invoice_footer || '',
    settings: s,
  };
}

async function parties(ids, transaction) {
  const list = [...new Set(ids.filter(Boolean))];
  const [dirs, users] = await Promise.all([
    directory.findMany(list),
    User.findAll({ where: { id: list }, attributes: ['id', 'email', 'mobile', 'userType', 'vatStatus'], transaction }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return (id) => {
    const d = dirs.get(id) || {};
    const u = byId.get(id) || {};
    return {
      id,
      name: d.display_name || null,
      contactName: d.sub_name || null,
      tin: d.tin || null,
      region: d.region_name || null,
      email: u.email || null,
      mobile: u.mobile || null,
    };
  };
}

const addressText = (a) => (a ? [a.contactName, a.fullAddress, a.landmark, a.region && a.region.name, a.phone].filter(Boolean).join(', ') : null);

// Invoice lines of a seller order (+ the delivery fee as its own line)
function invoiceLines(so, items, vatRate) {
  const lines = items
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((i) => ({
      description: i.name,
      detail: [i.categoryName, i.subCategoryName].filter(Boolean).join(' / ') || null,
      quantity: num(i.quantity),
      unitLabel: i.unitLabel || i.unit || null,
      unitPrice: num(i.unitPrice),
      amount: num(i.lineTotal),
      vatRate: num(i.vatAmount) > 0 ? num(vatRate) : 0,
      vat: num(i.vatAmount),
      total: round2(num(i.lineTotal) + num(i.vatAmount)),
    }));
  if (num(so.deliveryFee) > 0) {
    lines.push({
      description: 'Delivery fee',
      detail: null,
      quantity: 1,
      unitLabel: null,
      unitPrice: num(so.deliveryFee),
      amount: num(so.deliveryFee),
      vatRate: num(so.deliveryVat) > 0 ? num(vatRate) : 0,
      vat: num(so.deliveryVat),
      total: round2(num(so.deliveryFee) + num(so.deliveryVat)),
    });
  }
  return lines;
}

const paymentInfo = (order, payment) =>
  payment
    ? {
        method: PAYMENT_METHODS[payment.method] || payment.method,
        reference: payment.method === 'bank_transfer' ? payment.bankReference || null : payment.providerReference || null,
        amount: num(payment.amountPaid !== null && payment.amountPaid !== undefined ? payment.amountPaid : payment.amount),
        paidAt: payment.completedAt || order.paidAt,
      }
    : { method: PAYMENT_METHODS[order.paymentMethod], reference: null, amount: num(order.total), paidAt: order.paidAt };

// ---------- issuing (inside the caller's transaction) ----------

// Order PAID: one invoice per seller order + one receipt. Safe to call twice.
async function issueForPaidOrder(order, transaction) {
  const [sellerOrders, existing, payment] = await Promise.all([
    SellerOrder.findAll({ where: { orderId: order.id }, transaction }),
    Invoice.findAll({ where: { orderId: order.id, type: { [Op.in]: ['invoice', 'receipt'] } }, attributes: ['id', 'type', 'sellerOrderId', 'number'], transaction }),
    Payment.findOne({ where: { orderId: order.id, status: 'succeeded' }, order: [['id', 'DESC']], transaction }),
  ]);
  const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
  const { company, footer } = await companyBlock();
  const who = await parties([order.userId, ...sellerOrders.map((so) => so.sellerId)], transaction);
  const buyer = { ...who(order.userId), address: addressText(order.deliveryAddress) };
  const pay = paymentInfo(order, payment);
  const issuedAt = order.paidAt || new Date();
  const created = [];

  const invoiceNoBySo = new Map(existing.filter((d) => d.type === 'invoice').map((d) => [d.sellerOrderId, d.number]));
  for (const so of sellerOrders.slice().sort((a, b) => a.id - b.id)) {
    if (invoiceNoBySo.has(so.id)) continue;
    // eslint-disable-next-line no-await-in-loop
    const number = await nextNumber('invoice', transaction);
    const isTax = Boolean(so.sellerVatRegistered);
    const lines = invoiceLines(so, items.filter((i) => i.sellerOrderId === so.id), order.vatRate);
    const data = {
      title: isTax ? 'Tax Invoice' : 'Invoice',
      number,
      date: issuedAt,
      company,
      footer,
      seller: { ...who(so.sellerId), vatRegistered: isTax },
      buyer,
      order: { orderNumber: order.orderNumber, sellerOrderNumber: so.sellerOrderNumber, placedAt: order.createdAt, paidAt: order.paidAt, fulfilment: so.fulfilment },
      lines,
      showVat: isTax,
      totals: { subtotal: num(so.subtotal), delivery: num(so.deliveryFee), vat: num(so.vatTotal), total: num(so.total), vatRate: num(order.vatRate) },
      payment: { ...pay, amount: num(so.total) },
      notes: [
        `Issued by ${company.name} on behalf of the seller named above.`,
        isTax ? null : 'The seller is not registered for VAT: no VAT is charged.',
      ].filter(Boolean),
    };
    // eslint-disable-next-line no-await-in-loop
    const doc = await Invoice.create(
      {
        type: 'invoice',
        number,
        isTaxInvoice: isTax,
        orderId: order.id,
        sellerOrderId: so.id,
        buyerId: order.userId,
        sellerId: so.sellerId,
        issuedAt,
        subtotal: round2(num(so.subtotal) + num(so.deliveryFee)),
        vatTotal: num(so.vatTotal),
        total: num(so.total),
        currency: order.currency || 'SZL',
        data,
      },
      { transaction }
    );
    invoiceNoBySo.set(so.id, number);
    created.push(doc);
  }

  if (!existing.some((d) => d.type === 'receipt')) {
    const number = await nextNumber('receipt', transaction);
    const lines = sellerOrders
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((so) => ({
        description: `${so.sellerOrderNumber} - ${who(so.sellerId).name || 'Seller'}`,
        detail: invoiceNoBySo.get(so.id) ? `Invoice ${invoiceNoBySo.get(so.id)}` : null,
        quantity: null,
        unitLabel: null,
        unitPrice: null,
        amount: round2(num(so.subtotal) + num(so.deliveryFee)),
        vatRate: null,
        vat: num(so.vatTotal),
        total: num(so.total),
      }));
    const data = {
      title: 'Receipt',
      number,
      date: issuedAt,
      company,
      footer,
      buyer,
      order: { orderNumber: order.orderNumber, placedAt: order.createdAt, paidAt: order.paidAt },
      lines,
      showVat: num(order.vatTotal) > 0,
      totals: { subtotal: num(order.subtotal), delivery: num(order.deliveryTotal), vat: num(order.vatTotal), total: num(order.total), vatRate: num(order.vatRate) },
      payment: pay,
      notes: ['Payment received with thanks. AFA holds the payment until each order is delivered and the claim window has ended.'],
    };
    created.push(
      await Invoice.create(
        {
          type: 'receipt',
          number,
          orderId: order.id,
          paymentId: payment ? payment.id : null,
          buyerId: order.userId,
          issuedAt,
          subtotal: round2(num(order.subtotal) + num(order.deliveryTotal)),
          vatTotal: num(order.vatTotal),
          total: num(order.total),
          currency: order.currency || 'SZL',
          data,
        },
        { transaction }
      )
    );
  }
  return created;
}

// A REFUND on an invoiced seller order -> credit note. Returns null when there is no invoice.
async function issueCreditNote(refund, transaction) {
  if (!refund.sellerOrderId) return null;
  const [invoice, existing] = await Promise.all([
    Invoice.findOne({ where: { type: 'invoice', sellerOrderId: refund.sellerOrderId }, transaction }),
    Invoice.findOne({ where: { type: 'credit_note', refundId: refund.id }, transaction }),
  ]);
  if (!invoice || existing) return existing || null;
  const [{ company, footer }, claimItems] = await Promise.all([
    companyBlock(),
    refund.claimId ? ClaimItem.findAll({ where: { claimId: refund.claimId }, transaction }) : [],
  ]);
  const number = await nextNumber('credit_note', transaction);
  const inv = invoice.data;
  const vatRate = inv.totals.vatRate;
  const lines = [];
  if (num(refund.itemsAmount) > 0) {
    lines.push({
      description: refund.claimId ? 'Refund for goods (claim)' : 'Refund for goods',
      detail: claimItems.length ? claimItems.map((c) => `${c.name} x ${num(c.quantity)}${c.unitLabel ? ` ${c.unitLabel}` : ''}`).join('; ') : null,
      quantity: null,
      unitLabel: null,
      unitPrice: null,
      amount: num(refund.itemsAmount),
      vatRate: null,
      vat: null,
      total: num(refund.itemsAmount),
    });
  }
  if (num(refund.deliveryAmount) > 0) {
    lines.push({ description: 'Refund of the delivery fee', detail: null, quantity: null, unitLabel: null, unitPrice: null, amount: num(refund.deliveryAmount), vatRate: null, vat: null, total: num(refund.deliveryAmount) });
  }
  const subtotal = round2(num(refund.itemsAmount) + num(refund.deliveryAmount));
  const data = {
    title: 'Credit Note',
    number,
    date: refund.createdAt || new Date(),
    company,
    footer,
    seller: inv.seller,
    buyer: inv.buyer,
    order: inv.order,
    relatedInvoice: { id: invoice.id, number: invoice.number, date: invoice.issuedAt, title: inv.title },
    refund: { number: refund.refundNumber, source: REFUND_SOURCES[refund.source], reason: refund.reason },
    lines,
    showVat: Boolean(inv.showVat),
    totals: { subtotal, delivery: num(refund.deliveryAmount), vat: num(refund.vatAmount), total: num(refund.amount), vatRate },
    notes: [`This credit note reduces ${inv.title.toLowerCase()} ${invoice.number} by ${money(refund.amount)}. AFA pays the refund to the buyer.`],
  };
  return Invoice.create(
    {
      type: 'credit_note',
      number,
      isTaxInvoice: invoice.isTaxInvoice,
      orderId: refund.orderId,
      sellerOrderId: refund.sellerOrderId,
      refundId: refund.id,
      relatedInvoiceId: invoice.id,
      buyerId: invoice.buyerId,
      sellerId: invoice.sellerId,
      issuedAt: data.date,
      subtotal,
      vatTotal: num(refund.vatAmount),
      total: num(refund.amount),
      currency: invoice.currency,
      data,
    },
    { transaction }
  );
}

// Orders paid BEFORE invoices existed (or a missed issue): issue them now. Cheap when nothing is missing.
async function ensureForOrder(orderId) {
  const order = await Order.findByPk(orderId, { attributes: ['id', 'paidAt'] });
  if (!order || !order.paidAt) return;
  const [soCount, invCount, receipt] = await Promise.all([
    SellerOrder.count({ where: { orderId } }),
    Invoice.count({ where: { orderId, type: 'invoice' } }),
    Invoice.count({ where: { orderId, type: 'receipt' } }),
  ]);
  if (invCount >= soCount && receipt) return;
  await sequelize.transaction(async (transaction) => {
    const locked = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    await issueForPaidOrder(locked, transaction);
  });
}

// ---------- reading ----------
const ownerWhere = (viewer) =>
  viewer.type === 'buyer'
    ? { buyerId: viewer.id }
    : viewer.type === 'seller'
      ? { sellerId: viewer.id, type: { [Op.in]: ['invoice', 'credit_note'] } }
      : {};

const pdfUrl = (viewer, id) => `${viewer.type === 'admin' ? '/admin/invoices' : '/me/invoices'}/${id}/pdf`;

function summaryShape(doc, viewer) {
  const d = doc.data || {};
  return {
    id: doc.id,
    type: doc.type,
    typeLabel: d.title || TYPE_LABELS[doc.type],
    number: doc.number,
    isTaxInvoice: doc.isTaxInvoice,
    issuedAt: doc.issuedAt,
    orderId: doc.orderId,
    orderNumber: d.order ? d.order.orderNumber : null,
    sellerOrderId: doc.sellerOrderId,
    sellerOrderNumber: d.order ? d.order.sellerOrderNumber || null : null,
    relatedInvoice: d.relatedInvoice ? { id: d.relatedInvoice.id, number: d.relatedInvoice.number } : null,
    refundId: doc.refundId,
    seller: d.seller ? { id: d.seller.id, name: d.seller.name } : null,
    buyer: d.buyer ? { id: d.buyer.id, name: d.buyer.name } : null,
    subtotal: num(doc.subtotal),
    vatTotal: num(doc.vatTotal),
    total: num(doc.total),
    totalLabel: money(doc.total),
    currency: doc.currency,
    pdfUrl: pdfUrl(viewer, doc.id),
  };
}

function fullShape(doc, viewer) {
  const d = doc.data || {};
  return {
    ...summaryShape(doc, viewer),
    company: d.company,
    seller: d.seller || null,
    buyer: d.buyer || null,
    order: d.order || null,
    lines: (d.lines || []).map((l) => ({
      ...l,
      unitPriceLabel: l.unitPrice === null || l.unitPrice === undefined ? null : money(l.unitPrice),
      amountLabel: money(l.amount),
      vatLabel: l.vat === null || l.vat === undefined ? null : money(l.vat),
      totalLabel: money(l.total),
    })),
    showVat: Boolean(d.showVat),
    totals: d.totals
      ? {
          ...d.totals,
          labels: {
            subtotal: money(d.totals.subtotal),
            delivery: money(d.totals.delivery),
            vatTitle: `VAT (${d.totals.vatRate}%)`,
            vat: money(d.totals.vat),
            total: money(d.totals.total),
          },
        }
      : null,
    payment: d.payment || null,
    refund: d.refund || null,
    notes: d.notes || [],
    footer: d.footer || '',
  };
}

// GET /me/invoices, /admin/invoices   ?type=&orderId=&search=&from=&to=&page=  (admin also sellerId, buyerId)
async function list(viewer, query = {}) {
  const pg = getPagination(query);
  const where = { ...ownerWhere(viewer) };
  if (query.type) where.type = viewer.type === 'seller' && query.type === 'receipt' ? '__none__' : query.type;
  if (query.orderId) where.orderId = query.orderId;
  if (viewer.type === 'admin' && query.sellerId) where.sellerId = query.sellerId;
  if (viewer.type === 'admin' && query.buyerId) where.buyerId = query.buyerId;
  if (query.from || query.to) {
    where.issuedAt = { ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
  }
  if (query.search) {
    const like = { [Op.like]: `%${query.search}%` };
    const orders = await Order.findAll({ where: { orderNumber: like }, attributes: ['id'] });
    where[Op.or] = [{ number: like }, ...(orders.length ? [{ orderId: orders.map((o) => o.id) }] : [])];
  }
  const { rows, count } = await Invoice.findAndCountAll({
    where,
    order: [['issuedAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map((r) => summaryShape(r, viewer)), pagination: paginationMeta(pg, count) };
}

async function findVisible(viewer, id) {
  const doc = await Invoice.findOne({ where: { id, ...ownerWhere(viewer) } });
  if (!doc) throw notFound();
  return doc;
}

// GET .../invoices/:id
async function getOne(viewer, id) {
  return fullShape(await findVisible(viewer, id), viewer);
}

// Links to an order's documents (order details screens). viewer limits what is listed.
async function documentsFor(viewer, orderId, { sellerOrderIds = null } = {}) {
  await ensureForOrder(orderId);
  const where = { orderId, ...ownerWhere(viewer) };
  if (sellerOrderIds) where.sellerOrderId = sellerOrderIds;
  const docs = await Invoice.findAll({ where, order: [['id', 'ASC']] });
  const link = (d) => ({ id: d.id, type: d.type, number: d.number, typeLabel: (d.data && d.data.title) || TYPE_LABELS[d.type], sellerOrderId: d.sellerOrderId, total: num(d.total), pdfUrl: pdfUrl(viewer, d.id) });
  return {
    receipt: docs.filter((d) => d.type === 'receipt').map(link)[0] || null,
    invoices: docs.filter((d) => d.type === 'invoice').map(link),
    creditNotes: docs.filter((d) => d.type === 'credit_note').map(link),
  };
}

// ---------- PDF ----------
const M = 40; // page margin
const RIGHT = 595.28 - M;
const COLS = [
  { key: 'description', label: 'Description', w: 207 },
  { key: 'quantity', label: 'Qty', w: 58, align: 'right' },
  { key: 'unitPrice', label: 'Unit price', w: 66, align: 'right' },
  { key: 'amount', label: 'Amount', w: 64, align: 'right' },
  { key: 'vat', label: 'VAT', w: 56, align: 'right' },
  { key: 'total', label: 'Total', w: 64, align: 'right' },
];

function cellText(line, key, showVat) {
  const v = line[key];
  if (key === 'description') return v;
  if (key === 'quantity') return v === null || v === undefined ? '' : `${v}${line.unitLabel ? ` ${line.unitLabel.replace(/\s*\(.*\)$/, '')}` : ''}`;
  if (key === 'vat') return !showVat || v === null || v === undefined ? '' : `${money(v)}${line.vatRate ? `\n${line.vatRate}%` : ''}`;
  return v === null || v === undefined ? '' : money(v);
}

function block(doc, x, y, width, title, rows) {
  let h = doc.text(title, x, y, { size: 8, bold: true, color: C.quiet });
  rows.filter(Boolean).forEach((r, i) => {
    h += doc.text(r, x, y + h, { size: 9.5, bold: i === 0, color: C.text, width });
  });
  return h;
}

// Draws any document from its data (stored documents and the proforma)
function renderPdf(data, { type, number }) {
  const doc = new PdfDocument({ title: `${data.title} ${number}` });
  const img = logo();
  let y = M;

  // Header: logo + AFA details left, title right
  let leftH = 0;
  if (img) leftH = doc.image(img, M, y, { width: 112 }) + 8;
  const co = data.company || {};
  leftH += block(doc, M, y + leftH, 250, '', [
    co.name,
    co.address,
    co.tin ? `TIN: ${co.tin}` : null,
    [co.phone, co.email].filter(Boolean).join('  |  ') || null,
  ]);
  doc.text(data.title.toUpperCase(), 300, y, { size: 20, bold: true, color: C.dark, width: RIGHT - 300, align: 'right' });
  const meta = [
    [type === 'proforma' ? 'Reference' : 'Number', number],
    ['Date', fmtDate(data.date)],
    data.order && data.order.orderNumber && data.order.orderNumber !== number ? ['Order', data.order.orderNumber] : null,
    data.order && data.order.sellerOrderNumber ? ['Seller order', data.order.sellerOrderNumber] : null,
    data.relatedInvoice ? ['Credit for', data.relatedInvoice.number] : null,
    data.validUntil ? ['Pay before', fmtDate(data.validUntil)] : null,
  ].filter(Boolean);
  meta.forEach(([k, v], i) => {
    doc.text(k, 330, y + 32 + i * 14, { size: 9, color: C.quiet, width: 90, align: 'right' });
    doc.text(v, 425, y + 32 + i * 14, { size: 9, bold: true, color: C.text, width: RIGHT - 425, align: 'right' });
  });
  y += Math.max(leftH, 32 + meta.length * 14) + 14;
  doc.rect(M, y, RIGHT - M, 3, { fill: C.green });
  y += 16;

  // Parties
  const colW = (RIGHT - M - 20) / 2;
  const b = data.buyer || {};
  const buyerH = block(doc, M, y, colW, type === 'receipt' ? 'RECEIVED FROM' : 'BILL TO', [
    b.name,
    b.contactName && b.contactName !== b.name ? b.contactName : null,
    b.tin ? `TIN: ${b.tin}` : null,
    b.address ? `Deliver to: ${b.address}` : null,
    [b.mobile, b.email].filter(Boolean).join('  |  ') || null,
  ]);
  let sellerH = 0;
  if (data.seller) {
    const s = data.seller;
    sellerH = block(doc, M + colW + 20, y, colW, 'SELLER (SUPPLIER)', [
      s.name,
      s.contactName && s.contactName !== s.name ? s.contactName : null,
      s.tin ? `TIN: ${s.tin}` : null,
      s.vatRegistered ? 'VAT-registered' : 'Not registered for VAT',
      [s.mobile, s.email].filter(Boolean).join('  |  ') || null,
    ]);
  } else if (data.payment) {
    const p = data.payment;
    sellerH = block(doc, M + colW + 20, y, colW, 'PAYMENT', [
      `${money(p.amount)} by ${p.method}`,
      p.reference ? `Reference: ${p.reference}` : null,
      p.paidAt ? `Paid on ${fmtDate(p.paidAt)}` : null,
    ]);
  }
  y += Math.max(buyerH, sellerH) + 16;

  // Lines table
  const showVat = Boolean(data.showVat);
  const cols = showVat ? COLS : COLS.filter((c) => c.key !== 'vat').map((c) => (c.key === 'description' ? { ...c, w: c.w + 56 } : c));
  const header = () => {
    doc.rect(M, y, RIGHT - M, 20, { fill: C.light });
    let x = M;
    cols.forEach((c) => {
      doc.text(c.label, x + 5, y + 6, { size: 8.5, bold: true, color: C.dark, width: c.w - 10, align: c.align || 'left' });
      x += c.w;
    });
    y += 24;
  };
  header();
  (data.lines || []).forEach((line) => {
    const texts = cols.map((c) => cellText(line, c.key, showVat));
    const descH = doc.heightOf(texts[0], cols[0].w - 10, { size: 9.5 }) + (line.detail ? doc.heightOf(line.detail, cols[0].w - 10, { size: 8 }) : 0);
    const rowH = Math.max(descH, ...texts.slice(1).map((t, i) => doc.heightOf(t, cols[i + 1].w - 10, { size: 9.5 }))) + 8;
    if (y + rowH > 760) {
      doc.addPage();
      y = M;
      header();
    }
    let x = M;
    cols.forEach((c, i) => {
      if (i === 0) {
        const h1 = doc.text(texts[0], x + 5, y, { size: 9.5, color: C.text, width: c.w - 10 });
        if (line.detail) doc.text(line.detail, x + 5, y + h1, { size: 8, color: C.quiet, width: c.w - 10 });
      } else {
        doc.text(texts[i], x + 5, y, { size: 9.5, color: C.text, width: c.w - 10, align: c.align || 'left' });
      }
      x += c.w;
    });
    y += rowH;
    doc.line(M, y - 4, RIGHT, y - 4, { color: C.rule, width: 0.5 });
  });

  // Totals
  const t = data.totals || {};
  const rows = [
    ['Subtotal (goods)', money(t.subtotal)],
    t.delivery ? ['Delivery', money(t.delivery)] : null,
    showVat || t.vat ? [`VAT (${t.vatRate}%)`, money(t.vat)] : null,
  ].filter(Boolean);
  if (y + 30 + rows.length * 16 > 780) {
    doc.addPage();
    y = M;
  }
  y += 6;
  const tx = RIGHT - 230;
  rows.forEach(([k, v]) => {
    doc.text(k, tx, y, { size: 9.5, color: C.quiet, width: 130 });
    doc.text(v, tx + 130, y, { size: 9.5, color: C.text, width: 100, align: 'right' });
    y += 16;
  });
  const totalLabel = { credit_note: 'Total credit', receipt: 'Total paid', proforma: 'Amount to pay' }[type] || 'Total';
  doc.rect(tx - 8, y, 238, 26, { fill: C.green });
  doc.text(totalLabel, tx, y + 8, { size: 10.5, bold: true, color: '#FFFFFF', width: 130 });
  doc.text(money(t.total), tx + 120, y + 8, { size: 10.5, bold: true, color: '#FFFFFF', width: 110, align: 'right' });
  // Paid stamp
  if (type === 'invoice' || type === 'receipt') {
    doc.rect(M, y - 4, 78, 30, { stroke: C.green, lineWidth: 1.5 });
    doc.text('PAID', M, y + 4, { size: 14, bold: true, color: C.green, width: 78, align: 'center' });
  }
  y += 44;

  // Bank details (proforma) / payment (invoice) / refund (credit note)
  const extra = [];
  if (data.bank) {
    extra.push([
      'PAY BY BANK TRANSFER',
      [
        `Bank: ${data.bank.bankName}`,
        `Account holder: ${data.bank.accountName}`,
        `Account number: ${data.bank.accountNumber}`,
        data.bank.branchCode ? `Branch code: ${data.bank.branchCode}` : null,
        data.bank.swiftCode ? `SWIFT: ${data.bank.swiftCode}` : null,
        `Payment reference: ${number}`,
      ],
    ]);
  }
  if (data.seller && data.payment && type === 'invoice') {
    extra.push(['PAYMENT', [`Paid to AFA by ${data.payment.method} on ${fmtDate(data.payment.paidAt)}${data.payment.reference ? `, reference ${data.payment.reference}` : ''}.`]]);
  }
  if (data.refund) extra.push(['REFUND', [`${data.refund.number}: ${data.refund.source}`, data.refund.reason ? `Reason: ${data.refund.reason}` : null]]);
  if (data.notes && data.notes.length) extra.push(['NOTES', data.notes]);
  extra.forEach(([title, lines]) => {
    const body = lines.filter(Boolean);
    const need = 14 + body.reduce((s, l) => s + doc.heightOf(l, RIGHT - M, { size: 9 }), 0) + 10;
    if (y + need > 790) {
      doc.addPage();
      y = M;
    }
    y += doc.text(title, M, y, { size: 8, bold: true, color: C.quiet });
    body.forEach((l) => {
      y += doc.text(l, M, y, { size: 9, color: C.text, width: RIGHT - M });
    });
    y += 10;
  });

  // Footer on every page
  doc.pages.forEach((page, i) => {
    doc.page = page;
    doc.line(M, 800, RIGHT, 800, { color: C.rule, width: 0.5 });
    doc.text(data.footer || '', M, 806, { size: 7.5, color: C.quiet, width: 400 });
    doc.text(`${number}  |  Page ${i + 1} of ${doc.pages.length}`, RIGHT - 150, 806, { size: 7.5, color: C.quiet, width: 150, align: 'right' });
  });
  return doc.toBuffer();
}

const fileName = (number) => `${number}.pdf`;

// GET .../invoices/:id/pdf  -> { buffer, filename }
async function pdf(viewer, id) {
  const doc = await findVisible(viewer, id);
  return { buffer: renderPdf(doc.data, { type: doc.type, number: doc.number }), filename: fileName(doc.number) };
}

// For email attachments
async function pdfFor(invoice) {
  return { filename: fileName(invoice.number), content: renderPdf(invoice.data, { type: invoice.type, number: invoice.number }), contentType: 'application/pdf' };
}

// ---------- PROFORMA (unpaid orders, not stored) ----------
// GET /me/orders/:id/proforma
async function proformaPdf(user, orderId) {
  const order = await Order.findOne({ where: { id: orderId, userId: user.id } });
  if (!order) throw new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });
  if (![ORDER_STATUS.AWAITING_PAYMENT, ORDER_STATUS.UNDER_REVIEW].includes(order.status)) {
    throw new ApiError(409, 'A proforma invoice is only available before the order is paid. Paid orders have invoices and a receipt.', {
      code: 'PROFORMA_NOT_AVAILABLE',
    });
  }
  const [sellerOrders, items, { company, footer, settings: s }] = await Promise.all([
    SellerOrder.findAll({ where: { orderId: order.id }, order: [['id', 'ASC']] }),
    OrderItem.findAll({ where: { orderId: order.id } }),
    companyBlock(),
  ]);
  const who = await parties([order.userId, ...sellerOrders.map((so) => so.sellerId)]);
  const lines = sellerOrders.flatMap((so) =>
    invoiceLines(so, items.filter((i) => i.sellerOrderId === so.id), order.vatRate).map((l) => ({
      ...l,
      detail: [`Seller: ${who(so.sellerId).name || ''}`, l.detail].filter(Boolean).join(' | '),
    }))
  );
  const isBank = order.paymentMethod === 'bank_transfer';
  const data = {
    title: 'Proforma Invoice',
    date: order.createdAt,
    validUntil: order.paymentDeadline,
    company,
    footer,
    buyer: { ...who(order.userId), address: addressText(order.deliveryAddress) },
    order: { orderNumber: order.orderNumber, placedAt: order.createdAt },
    lines,
    showVat: num(order.vatTotal) > 0,
    totals: { subtotal: num(order.subtotal), delivery: num(order.deliveryTotal), vat: num(order.vatTotal), total: num(order.total), vatRate: num(order.vatRate) },
    bank: isBank && s.afa_bank_account_number ? bankDetails(s) : null,
    notes: [
      'This is NOT a tax invoice. Invoices are issued by each seller (through AFA) once the payment is received.',
      isBank
        ? `Pay the exact amount using ${order.orderNumber} as the reference, then upload your proof of payment in the app before ${fmtDate(order.paymentDeadline)}.`
        : `Complete the online payment in the app before ${fmtDate(order.paymentDeadline)}.`,
    ],
  };
  return { buffer: renderPdf(data, { type: 'proforma', number: order.orderNumber }), filename: `Proforma-${order.orderNumber}.pdf` };
}

module.exports = {
  issueForPaidOrder,
  issueCreditNote,
  ensureForOrder,
  list,
  getOne,
  documentsFor,
  pdf,
  pdfFor,
  proformaPdf,
  renderPdf,
  TYPE_LABELS,
};
