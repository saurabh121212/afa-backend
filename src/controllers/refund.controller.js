// Refunds: the buyer's refunds + bank account, and the admin's refund queue.
// Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/refund.service');
const { sendFile } = require('./order.controller');

const v = (req) => req.validated;

// ---------- buyer ----------
const myList = asyncHandler(async (req, res) => res.json({ success: true, data: await service.listMine(req.user, v(req)) }));
const myOne = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getMine(req.user, v(req).id) }));
const myFile = asyncHandler(async (req, res, next) => sendFile(res, next, await service.proofFile(v(req).id, { userId: req.user.id })));

const getAccount = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getAccount(req.user) }));
const saveAccount = asyncHandler(async (req, res) =>
  res.json({ success: true, message: 'Bank account saved for refunds', data: await service.saveAccount(req.user, v(req)) })
);
const deleteAccount = asyncHandler(async (req, res) => {
  await service.deleteAccount(req.user);
  res.json({ success: true, message: 'Saved bank account removed' });
});
const bankDetails = asyncHandler(async (req, res) =>
  res.json({ success: true, message: 'Bank details saved. AFA will pay your refund soon.', data: await service.setBankDetails(req.user, v(req).id, v(req)) })
);

// ---------- admin ----------
const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(v(req)) }));
const getOne = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getById(v(req).id) }));
const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(v(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-refunds-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});
const markPaid = asyncHandler(async (req, res) =>
  res.json({ success: true, message: 'Refund marked as paid. The buyer is notified.', data: await service.markPaid(v(req).id, v(req), req.file || null, req.admin.id) })
);
const markFailed = asyncHandler(async (req, res) =>
  res.json({ success: true, message: 'Refund marked as failed. The buyer is asked to check the bank details.', data: await service.markFailed(v(req).id, v(req), req.admin.id) })
);
const file = asyncHandler(async (req, res, next) => sendFile(res, next, await service.proofFile(v(req).id)));

module.exports = {
  buyer: { list: myList, getOne: myOne, file: myFile, getAccount, saveAccount, deleteAccount, bankDetails },
  admin: { stats, list, getOne, exportCsv, markPaid, markFailed, file },
};
