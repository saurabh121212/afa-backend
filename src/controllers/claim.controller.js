// Claims (problems after delivery) for the buyer, the seller and the admin.
// Input is already validated (req.validated); photos arrive in req.files.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/claim.service');
const { sendFile } = require('./order.controller');

const v = (req) => req.validated;
const buyer = (req) => ({ type: 'buyer', id: req.user.id });
const seller = (req) => ({ type: 'seller', id: req.user.id });
const admin = (req) => ({ type: 'admin', id: req.admin.id });
const photos = (req) => req.files || [];

const ok = (res, message, data, status = 200) => res.status(status).json({ success: true, message, data });

// Endpoints that work the same for all three (viewer decides what can be seen)
const forViewer = (who) => ({
  list: asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(who(req), v(req)) })),
  getOne: asyncHandler(async (req, res) => res.json({ success: true, data: await service.getOne(who(req), v(req).id) })),
  message: asyncHandler(async (req, res) => ok(res, 'Message sent', await service.addMessage(who(req), v(req).id, v(req), photos(req)), 201)),
  photo: asyncHandler(async (req, res, next) => sendFile(res, next, await service.photoFile(who(req), v(req).id, v(req).photoId))),
});

// ---------- buyer ----------
const buyerCommon = forViewer(buyer);
const options = asyncHandler(async (req, res) => res.json({ success: true, data: await service.claimOptions(req.user, v(req).id, v(req).sellerOrderId) }));
const open = asyncHandler(async (req, res) =>
  ok(res, 'Thank you. Your claim was sent to the seller.', await service.openClaim(req.user, v(req), photos(req)), 201)
);
const escalate = asyncHandler(async (req, res) => ok(res, 'Your claim was sent to the AFA team', await service.escalate(req.user, v(req).id, v(req))));
const withdraw = asyncHandler(async (req, res) => ok(res, 'Claim withdrawn', await service.withdraw(req.user, v(req).id, v(req))));
const returned = asyncHandler(async (req, res) => ok(res, 'Thank you. The seller will confirm when the item arrives.', await service.markReturned(req.user, v(req).id, v(req))));

// ---------- seller ----------
const sellerCommon = forViewer(seller);
const accept = asyncHandler(async (req, res) => {
  const data = await service.sellerAccept(req.user, v(req).id, v(req));
  ok(res, data.status === 'awaiting_return' ? 'Claim accepted. The buyer will send the item back.' : 'Claim accepted. The buyer will be refunded.', data);
});
const reject = asyncHandler(async (req, res) => ok(res, 'Claim rejected', await service.sellerReject(req.user, v(req).id, v(req))));
const sellerReturnReceived = asyncHandler(async (req, res) =>
  ok(res, 'Return confirmed. The buyer will be refunded.', await service.confirmReturn(seller(req), v(req).id, v(req)))
);

// ---------- admin ----------
const adminCommon = forViewer(admin);
const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats() }));
const decide = asyncHandler(async (req, res) => {
  const data = await service.decide(req.admin.id, v(req).id, v(req));
  const message = { resolved: 'Decision saved. The buyer will be refunded.', awaiting_return: 'Decision saved. Waiting for the item to be returned.', closed: 'Decision saved. No refund.' }[data.status] || 'Decision saved';
  ok(res, message, data);
});
const adminReturnReceived = asyncHandler(async (req, res) =>
  ok(res, 'Return confirmed. The buyer will be refunded.', await service.confirmReturn(admin(req), v(req).id, v(req)))
);

module.exports = {
  buyer: { ...buyerCommon, options, open, escalate, withdraw, returned },
  seller: { ...sellerCommon, accept, reject, returnReceived: sellerReturnReceived },
  admin: { ...adminCommon, stats, decide, returnReceived: adminReturnReceived },
};
