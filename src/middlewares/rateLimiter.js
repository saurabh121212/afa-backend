// Limits how often the same IP can call sensitive endpoints
// (stops password guessing and email spam).
const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/ApiError');

const make = ({ windowMinutes, limit, message }) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, message, { code: 'TOO_MANY_REQUESTS' })),
  });

// Login (users and admin): 10 tries per 15 minutes
const loginLimiter = make({
  windowMinutes: 15,
  limit: 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

// Anything that sends or checks an OTP email: 10 per hour
const otpLimiter = make({
  windowMinutes: 60,
  limit: 10,
  message: 'Too many verification requests. Please try again later.',
});

// Creating new accounts: 20 per hour per IP
const registerLimiter = make({
  windowMinutes: 60,
  limit: 20,
  message: 'Too many registration attempts. Please try again later.',
});

module.exports = { loginLimiter, otpLimiter, registerLimiter };
