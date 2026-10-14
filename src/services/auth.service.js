// SHARED login, password reset and "me" for EVERY user type
// (Figma "Login" screen: Account Type + Email ID or TIN + Password + Remember me).
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../utils/jwt');
const { jwt: jwtConfig } = require('../config');
const { USER_STATUS, OTP_PURPOSES } = require('../utils/constants');
const otpService = require('./otp.service');
const { getHandler } = require('./userTypes.registry');
const { loadUserWithProfile } = require('./registration.service');

const INVALID = () =>
  new ApiError(401, 'Invalid email/TIN or password', { code: 'INVALID_CREDENTIALS' });

async function findUserForLogin(accountType, identifier) {
  // Email login works for every user type
  if (identifier.includes('@')) {
    return User.scope('withPassword').findOne({
      where: { email: identifier.toLowerCase(), userType: accountType },
    });
  }
  // TIN login: each user type knows how to look up its own TIN
  const handler = getHandler(accountType);
  if (!handler || !handler.findUserIdByTin) return null;
  const userId = await handler.findUserIdByTin(identifier);
  if (!userId) return null;
  return User.scope('withPassword').findOne({ where: { id: userId, userType: accountType } });
}

// POST /auth/login
async function login({ accountType, identifier, password, rememberMe }) {
  const user = await findUserForLogin(accountType, identifier);

  // Same answer for "unknown user" and "wrong password"
  if (!user || !(await user.comparePassword(password))) throw INVALID();

  // Password is correct -> now explain why they can't log in yet
  const handler = getHandler(user.userType);
  switch (user.status) {
    case USER_STATUS.PENDING_VERIFICATION:
      throw new ApiError(403, 'Your registration is not complete. Please finish and submit it.', {
        code: 'REGISTRATION_INCOMPLETE',
      });
    case USER_STATUS.PENDING_APPROVAL:
      // Some types (e.g. buyers) may log in while waiting; others must wait for approval
      if (handler && handler.canLoginBeforeApproval) break;
      throw new ApiError(403, 'Your account is waiting for approval by the AFA admin.', {
        code: 'ACCOUNT_PENDING_APPROVAL',
      });
    case USER_STATUS.REJECTED:
      throw new ApiError(
        403,
        `Your registration was rejected${user.rejectionReason ? `: ${user.rejectionReason}` : '.'}`,
        { code: 'ACCOUNT_REJECTED' }
      );
    case USER_STATUS.SUSPENDED:
      throw new ApiError(
        403,
        `Your account has been suspended${user.statusReason ? `: ${user.statusReason}` : '.'} Please contact AFA support.`,
        { code: 'ACCOUNT_SUSPENDED' }
      );
    default:
      break;
  }

  user.lastLoginAt = new Date();
  await user.save();

  const expiresIn = rememberMe ? jwtConfig.rememberMeExpiresIn : jwtConfig.expiresIn;
  const token = signToken({ sub: user.id, type: 'user', userType: user.userType }, { expiresIn });

  return {
    token,
    tokenType: 'Bearer',
    expiresIn,
    // false -> show "verification pending" and block actions like placing orders
    accountApproved: user.status === USER_STATUS.APPROVED,
    status: user.status,
    user: await loadUserWithProfile(user.id),
  };
}

// POST /auth/forgot-password
// accountType is needed because the same email may have several accounts (farmer, buyer, ...).
// Always returns the same answer, so nobody can check which emails are registered.
async function forgotPassword({ accountType, email }) {
  const user = await User.findOne({ where: { email, userType: accountType } });
  if (!user) return;
  const handler = getHandler(user.userType);
  await otpService.createAndSendOtp({
    user,
    purpose: OTP_PURPOSES.PASSWORD_RESET,
    name: handler ? await handler.getDisplayName(user.id) : '',
  });
}

// POST /auth/reset-password -> only the password of THIS account type changes
async function resetPassword({ accountType, email, otp, newPassword }) {
  const user = await User.scope('withPassword').findOne({ where: { email, userType: accountType } });
  if (!user) {
    throw new ApiError(400, 'No active code found. Please request a new code.', { code: 'OTP_NOT_FOUND' });
  }
  await otpService.verifyOtp({ userId: user.id, purpose: OTP_PURPOSES.PASSWORD_RESET, otp });

  user.password = newPassword; // hashed by the model hook; old tokens stop working
  await user.save();
}

// GET /auth/me
const getMe = (userId) => loadUserWithProfile(userId);

module.exports = { login, forgotPassword, resetPassword, getMe };
