// Cancelling paid orders (buyer, seller, admin) and AFA refunds without cancelling.
// Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/cancellation.service');
const orderService = require('../services/order.service');
const sellerOrderService = require('../services/sellerOrder.service');
const adminOrderService = require('../services/adminOrder.service');

const v = (req) => req.validated;

// ---------- buyer ----------
// POST /me/orders/:id/seller-orders/:sellerOrderId/cancel
const buyerCancel = asyncHandler(async (req, res) => {
  const out = await service.buyerCancel(req.user, v(req).id, v(req).sellerOrderId, v(req));
  res.status(out.result === 'requested' ? 201 : 200).json({
    success: true,
    message:
      out.result === 'cancelled'
        ? 'Order cancelled. Your refund is on the way.'
        : 'Your cancellation request was sent to the seller. We will let you know the answer.',
    data: { result: out.result, refundId: out.refundId || null, requestId: out.requestId || null, order: await orderService.getMine(req.user, v(req).id) },
  });
});

// DELETE /me/orders/:id/seller-orders/:sellerOrderId/cancel-request
const withdrawRequest = asyncHandler(async (req, res) => {
  await service.withdrawRequest(req.user, v(req).id, v(req).sellerOrderId);
  res.json({ success: true, message: 'Cancellation request withdrawn', data: await orderService.getMine(req.user, v(req).id) });
});

// ---------- seller ----------
// POST /me/sales/:id/cancel
const sellerCancel = asyncHandler(async (req, res) => {
  const out = await service.sellerCancel(req.user, v(req).id, v(req));
  res.json({
    success: true,
    message: 'Order cancelled. The buyer will be refunded.',
    data: { refundId: out.refundId, order: await sellerOrderService.getOne(req.user, v(req).id) },
  });
});

// POST /me/sales/:id/cancel-request/accept
const sellerAccept = asyncHandler(async (req, res) => {
  const out = await service.sellerAccept(req.user, v(req).id, v(req));
  res.json({
    success: true,
    message: 'Request accepted. The order is cancelled and the buyer will be refunded.',
    data: { refundId: out.refundId, order: await sellerOrderService.getOne(req.user, v(req).id) },
  });
});

// POST /me/sales/:id/cancel-request/decline
const sellerDecline = asyncHandler(async (req, res) => {
  await service.sellerDecline(req.user, v(req).id, v(req));
  res.json({ success: true, message: 'Request declined. Please continue with the order.', data: await sellerOrderService.getOne(req.user, v(req).id) });
});

// ---------- admin ----------
// POST /admin/orders/:id/seller-orders/:sellerOrderId/cancel
const adminCancel = asyncHandler(async (req, res) => {
  const out = await service.adminCancel(req.admin.id, v(req).id, v(req).sellerOrderId, v(req));
  res.json({
    success: true,
    message: out.refundId ? 'Order cancelled and a refund created' : 'Order cancelled (no refund)',
    data: { refundId: out.refundId, order: await adminOrderService.getById(v(req).id) },
  });
});

// POST /admin/orders/:id/seller-orders/:sellerOrderId/refund
const adminRefund = asyncHandler(async (req, res) => {
  const out = await service.adminRefund(req.admin.id, v(req).id, v(req).sellerOrderId, v(req));
  res.status(201).json({ success: true, message: 'Refund created', data: { refundId: out.refundId, order: await adminOrderService.getById(v(req).id) } });
});

// GET /admin/orders/cancellation-requests
const requestList = asyncHandler(async (req, res) => res.json({ success: true, data: await service.listRequests(v(req)) }));

// POST /admin/orders/cancellation-requests/:requestId/decide
const decideRequest = asyncHandler(async (req, res) => {
  const data = await service.decideRequest(req.admin.id, v(req).requestId, v(req));
  res.json({
    success: true,
    message: v(req).decision === 'approve' ? 'Request approved. The order is cancelled and the buyer will be refunded.' : 'Request rejected. The order goes ahead.',
    data,
  });
});

module.exports = { buyerCancel, withdrawRequest, sellerCancel, sellerAccept, sellerDecline, adminCancel, adminRefund, requestList, decideRequest };
