// Creates, emails and checks 6-digit one-time codes.
//
// Codes belong to ONE USER ACCOUNT (userId), not to an email address,
// because the same email can be used by a Farmer account AND a Buyer account.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { EmailOtp } = require('../models');
const ApiError = require('../utils/ApiError');
const emailService = require('./email.service');
const { otp: otpConfig } = require('../config');

const generateOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');
const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

// Create a new code for this user account, cancel older unused ones, and email it.
//   user = User instance (needs id, email, userType)
async function createAndSendOtp({ user, purpose, name }) {
  // Cool-down: don't allow a new code every second
  const last = await EmailOtp.findOne({
    where: { userId: user.id, purpose },
    order: [['createdAt', 'DESC']],
  });
  if (last) {
    const waitMs = otpConfig.resendCooldownSeconds * 1000 - (Date.now() - last.createdAt.getTime());
    if (waitMs > 0) {
      throw new ApiError(
        429,
        `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new code`,
        { code: 'OTP_COOLDOWN' }
      );
    }
  }

  // Only the newest code is valid
  await EmailOtp.update(
    { consumedAt: new Date() },
    { where: { userId: user.id, purpose, consumedAt: { [Op.is]: null } } }
  );

  const otp = generateOtp();
  const record = await EmailOtp.create({
    email: user.email,
    userId: user.id,
    purpose,
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + otpConfig.expiresInMinutes * 60 * 1000),
  });

  try {
    await emailService.sendOtpEmail({
      to: user.email,
      name,
      otp,
      purpose,
      userType: user.userType,
      expiresInMinutes: otpConfig.expiresInMinutes,
    });
  } catch (err) {
    // Email failed: remove the unusable code so the user can retry immediately
    await record.destroy();
    console.error('OTP email failed:', err.message);
    throw new ApiError(502, 'Could not send the verification email. Please try again.', {
      code: 'EMAIL_SEND_FAILED',
    });
  }
}

// Check a code for this user account. Throws a clear error if it's wrong, expired or used up.
async function verifyOtp({ userId, purpose, otp }) {
  const record = await EmailOtp.findOne({
    where: { userId, purpose, consumedAt: { [Op.is]: null } },
    order: [['createdAt', 'DESC']],
  });

  if (!record) {
    throw new ApiError(400, 'No active code found. Please request a new code.', {
      code: 'OTP_NOT_FOUND',
    });
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'This code has expired. Please request a new code.', {
      code: 'OTP_EXPIRED',
    });
  }
  if (record.attempts >= otpConfig.maxAttempts) {
    throw new ApiError(429, 'Too many wrong attempts. Please request a new code.', {
      code: 'OTP_TOO_MANY_ATTEMPTS',
    });
  }

  const a = Buffer.from(hashOtp(otp));
  const b = Buffer.from(record.otpHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    record.attempts += 1;
    await record.save();
    const left = otpConfig.maxAttempts - record.attempts;
    throw new ApiError(
      400,
      left > 0
        ? `Invalid code. ${left} attempt(s) left.`
        : 'Invalid code. Please request a new code.',
      { code: 'OTP_INVALID' }
    );
  }

  record.consumedAt = new Date();
  await record.save();
}

module.exports = { createAndSendOtp, verifyOtp };
