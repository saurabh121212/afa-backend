// REVIEWS & RATINGS. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const reviews = require('../services/review.service');

const v = (req) => req.validated;
const ok = (res, data, message) => res.json({ success: true, ...(message ? { message } : {}), data });

// ---------- public ----------
const forListing = asyncHandler(async (req, res) => ok(res, await reviews.forListing(v(req).id, v(req))));
const forSeller = asyncHandler(async (req, res) => ok(res, await reviews.forSeller(v(req).id, v(req))));
const report = asyncHandler(async (req, res) =>
  ok(res, await reviews.report(req.user, v(req).id, v(req)), 'Thank you. The AFA team will check this review.')
);

// ---------- buyer ----------
const buyer = {
  pending: asyncHandler(async (req, res) => ok(res, await reviews.pending(req.user, v(req)))),
  list: asyncHandler(async (req, res) => ok(res, await reviews.listMine(req.user, v(req)))),
  getOne: asyncHandler(async (req, res) => ok(res, await reviews.getMine(req.user, v(req).id))),
  create: asyncHandler(async (req, res) => {
    const data = await reviews.create(req.user, v(req));
    res.status(201).json({
      success: true,
      message: data.status === 'published' ? 'Thank you for your review' : 'Thank you. Your review will appear once the AFA team has checked it.',
      data,
    });
  }),
  update: asyncHandler(async (req, res) => ok(res, await reviews.update(req.user, v(req).id, v(req)), 'Review updated')),
};

// ---------- seller ----------
const seller = {
  list: asyncHandler(async (req, res) => ok(res, await reviews.received(req.user, v(req)))),
  reply: asyncHandler(async (req, res) => ok(res, await reviews.reply(req.user, v(req).id, v(req)), 'Reply posted')),
};

// ---------- admin ----------
const actor = (req) => ({ id: req.admin.id });
const admin = {
  stats: asyncHandler(async (req, res) => ok(res, await reviews.stats())),
  list: asyncHandler(async (req, res) => ok(res, await reviews.adminList(v(req)))),
  getOne: asyncHandler(async (req, res) => ok(res, await reviews.adminGet(v(req).id))),
  approve: asyncHandler(async (req, res) => ok(res, await reviews.approve(actor(req), v(req).id), 'Review published')),
  hide: asyncHandler(async (req, res) => ok(res, await reviews.hide(actor(req), v(req).id, v(req)), 'Review hidden')),
  restore: asyncHandler(async (req, res) => ok(res, await reviews.restore(actor(req), v(req).id), 'Review restored')),
  dismissReports: asyncHandler(async (req, res) => ok(res, await reviews.dismissReports(actor(req), v(req).id), 'Reports closed, the review stays')),
};

module.exports = { forListing, forSeller, report, buyer, seller, admin };
