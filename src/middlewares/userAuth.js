// JWT protection for marketplace users.
//
//   protectRegistration    -> registration steps after Step 1 (token from Step 1 or /register/resume)
//   protectUser            -> logged-in users (token from /auth/login). Approved users, plus
//                             users waiting for approval if their type allows it (e.g. buyers)
//   requireApprovedAccount -> actions that need admin approval (e.g. placing an order)
//   requireUserType        -> limit a route to certain user types (e.g. 'farmer')
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../utils/jwt');
const { USER_STATUS } = require('../utils/constants');
const { getHandler } = require('../services/userTypes.registry');

function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication token missing', { code: 'TOKEN_MISSING' });
  }
  try {
    return verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Your session has expired, please log in again', { code: 'TOKEN_EXPIRED' });
    }
    throw new ApiError(401, 'Invalid token', { code: 'TOKEN_INVALID' });
  }
}

const protectRegistration = asyncHandler(async (req, res, next) => {
  const payload = readToken(req);
  if (payload.type !== 'registration') {
    throw new ApiError(403, 'A registration token is required for this step', { code: 'WRONG_TOKEN_TYPE' });
  }

  const user = await User.findByPk(payload.sub);
  if (!user) throw new ApiError(401, 'Registration not found', { code: 'USER_NOT_FOUND' });
  if (user.status !== USER_STATUS.PENDING_VERIFICATION) {
    throw new ApiError(400, 'This registration has already been submitted. Please log in.', {
      code: 'REGISTRATION_ALREADY_SUBMITTED',
    });
  }

  req.user = user;
  next();
});

const protectUser = asyncHandler(async (req, res, next) => {
  const payload = readToken(req);
  if (payload.type !== 'user') {
    throw new ApiError(403, 'Please log in to continue', { code: 'WRONG_TOKEN_TYPE' });
  }

  const user = await User.findByPk(payload.sub);
  if (!user) throw new ApiError(401, 'Account no longer exists', { code: 'USER_NOT_FOUND' });

  // Password changed after this token was issued -> token no longer valid
  if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > payload.iat) {
    throw new ApiError(401, 'Your password was changed, please log in again', { code: 'TOKEN_REVOKED' });
  }

  // Who may use the app: approved users, and users waiting for approval
  // if their type allows it (e.g. buyers). Rejected / suspended users are blocked.
  const handler = getHandler(user.userType);
  const waitingButAllowed =
    user.status === USER_STATUS.PENDING_APPROVAL && handler && handler.canLoginBeforeApproval;
  if (user.status !== USER_STATUS.APPROVED && !waitingButAllowed) {
    throw new ApiError(403, 'Your account is not active', { code: 'ACCOUNT_NOT_ACTIVE' });
  }

  req.user = user;
  next();
});

// For actions that need admin approval (e.g. placing an order). Use AFTER protectUser.
//   router.post('/orders', protectUser, requireApprovedAccount, ...)
const requireApprovedAccount = (req, res, next) => {
  if (!req.user || req.user.status !== USER_STATUS.APPROVED) {
    return next(
      new ApiError(
        403,
        'Your account is waiting for verification by the AFA admin. You can do this once your account is approved.',
        { code: 'ACCOUNT_NOT_APPROVED' }
      )
    );
  }
  next();
};

// Only lets the listed user types through. Use AFTER protectRegistration or protectUser.
//   router.put('/register/farm-information', protectRegistration, requireUserType('farmer'), ...)
const requireUserType = (...types) => (req, res, next) => {
  if (!req.user || !types.includes(req.user.userType)) {
    return next(
      new ApiError(403, `This action is only for: ${types.join(', ')}`, { code: 'WRONG_USER_TYPE' })
    );
  }
  next();
};

module.exports = { protectRegistration, protectUser, requireApprovedAccount, requireUserType };
