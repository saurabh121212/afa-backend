// CREDIT SCORE. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/creditScore.service');

const v = (req) => req.validated;
const ok = (res, data, message) => res.json({ success: true, ...(message ? { message } : {}), data });

// ---------- user ----------
const mine = asyncHandler(async (req, res) => ok(res, await service.getMine(req.user)));
const history = asyncHandler(async (req, res) => ok(res, await service.history(req.user)));

// ---------- admin ----------
const admin = {
  stats: asyncHandler(async (req, res) => ok(res, await service.stats())),
  list: asyncHandler(async (req, res) => ok(res, await service.adminList(v(req)))),
  getOne: asyncHandler(async (req, res) => ok(res, await service.adminGet(v(req).userId))),
  recalculate: asyncHandler(async (req, res) => ok(res, await service.adminRecalculate(v(req).userId), 'Credit score recalculated')),
  recalculateAll: asyncHandler(async (req, res) => {
    const data = await service.adminRecalculateAll();
    res.status(202).json({ success: true, message: `Recalculating ${data.queued} credit scores in the background`, data });
  }),
  exportCsv: asyncHandler(async (req, res) => {
    const { filename, content } = await service.exportCsv(v(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`﻿${content}`);
  }),
};

module.exports = { mine, history, admin };
