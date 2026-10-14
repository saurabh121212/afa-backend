// Protects admin routes with JWT.
//
//   router.get('/something', protectAdmin, handler)
const { Admin } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../utils/jwt');

const protectAdmin = asyncHandler(async (req, res, next) => {
  // 1. Read "Authorization: Bearer <token>"
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication token missing');
  }

  // 2. Check the signature and expiry
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired, please log in again' : 'Invalid token';
    throw new ApiError(401, msg);
  }

  // 3. Must be an ADMIN token (user tokens added later can't open admin routes)
  if (payload.type !== 'admin') {
    throw new ApiError(403, 'Admin access only');
  }

  // 4. The admin must still exist
  const admin = await Admin.findByPk(payload.sub);
  if (!admin) throw new ApiError(401, 'Admin account no longer exists');

  // 5. Make the admin available to the next handlers
  req.admin = admin;
  next();
});

module.exports = { protectAdmin };
