// Business logic for admin authentication.
const { Admin } = require('../models');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../utils/jwt');

async function login(email, password) {
  const admin = await Admin.scope('withPassword').findOne({
    where: { email: String(email).trim().toLowerCase() },
  });

  // Same message for "no such email" and "wrong password",
  // so attackers can't find out which email is the admin's.
  if (!admin || !(await admin.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  const token = signToken({ sub: admin.id, type: 'admin' });
  return { token, admin };
}

async function changePassword(adminId, currentPassword, newPassword) {
  const admin = await Admin.scope('withPassword').findByPk(adminId);
  if (!admin) throw new ApiError(404, 'Admin not found');

  if (!(await admin.comparePassword(currentPassword))) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  admin.password = newPassword; // hashed by the beforeSave hook
  await admin.save();
}

module.exports = { login, changePassword };
