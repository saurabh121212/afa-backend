// Limits how many chat messages one account can send (stops spam). Use AFTER protectUser:
// counts per logged-in account, not per IP (many users can share one mobile network IP).
const rateLimit = require('express-rate-limit');
const ApiError = require('../../utils/ApiError');
const { SEND_RATE_LIMIT } = require('../../config/chat');

const sendLimiter = rateLimit({
  windowMs: SEND_RATE_LIMIT.windowMinutes * 60 * 1000,
  limit: SEND_RATE_LIMIT.limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `chat-send:${req.user.id}`,
  handler: (req, res, next) =>
    next(new ApiError(429, 'You are sending messages too quickly. Please wait a moment.', { code: 'TOO_MANY_REQUESTS' })),
});

module.exports = { sendLimiter };
