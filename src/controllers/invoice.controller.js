// Invoices / credit notes / receipts (page data + PDF), the proforma invoice, payment status
// and transaction history. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const invoices = require('../services/invoice.service');
const transactions = require('../services/transaction.service');

const v = (req) => req.validated;
// Buyers see their documents as the buyer; farmers / traders as the seller
const me = (req) => ({ type: req.user.userType === 'buyer' ? 'buyer' : 'seller', id: req.user.id });
const admin = () => ({ type: 'admin' });

function sendPdf(req, res, { buffer, filename }) {
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

function sendCsv(res, name, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}

// ---------- documents ----------
const forViewer = (who) => ({
  list: asyncHandler(async (req, res) => res.json({ success: true, data: await invoices.list(who(req), v(req)) })),
  getOne: asyncHandler(async (req, res) => res.json({ success: true, data: await invoices.getOne(who(req), v(req).id) })),
  pdf: asyncHandler(async (req, res) => sendPdf(req, res, await invoices.pdf(who(req), v(req).id))),
});

// GET /me/orders/:id/proforma
const proforma = asyncHandler(async (req, res) => sendPdf(req, res, await invoices.proformaPdf(req.user, v(req).id)));
// GET /me/orders/:id/payment-status
const paymentStatus = asyncHandler(async (req, res) => res.json({ success: true, data: await transactions.paymentStatus(req.user, v(req).id) }));

// ---------- transactions ----------
const myTransactions = asyncHandler(async (req, res) => res.json({ success: true, data: await transactions.mine(req.user, v(req)) }));
const myTransactionsCsv = asyncHandler(async (req, res) => sendCsv(res, 'afa-my-transactions', await transactions.exportMine(req.user, v(req))));
const adminTransactions = asyncHandler(async (req, res) => res.json({ success: true, data: await transactions.adminHistory(v(req)) }));
const adminTransactionStats = asyncHandler(async (req, res) => res.json({ success: true, data: await transactions.adminStats(v(req)) }));
const adminTransactionsCsv = asyncHandler(async (req, res) => sendCsv(res, 'afa-transactions', await transactions.exportAdmin(v(req))));

module.exports = {
  mine: forViewer(me),
  admin: forViewer(admin),
  proforma,
  paymentStatus,
  myTransactions,
  myTransactionsCsv,
  adminTransactions,
  adminTransactionStats,
  adminTransactionsCsv,
};
