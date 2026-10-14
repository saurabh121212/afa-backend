// TRADER-ONLY logic (Figma "Trader Registration" Steps 1-2, trader TIN login, extra consent).
// Shared steps (documents, OTP, submit, login) are in document.service.js,
// registration.service.js and auth.service.js.
const { Op } = require('sequelize');
const { sequelize, User, TraderProfile, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS } = require('../utils/constants');
const locationService = require('./location.service');

const LOCATION_ATTRS = ['id', 'name'];

// Location names to load with a trader profile (fresh list each time)
const profileInclude = () =>
  ['region', 'inkhundla', 'umphakatsi'].map((as) => ({ model: Location, as, attributes: LOCATION_ATTRS }));

// Email, mobile and TIN must be unique AMONG TRADERS (the same person may also be a farmer, buyer, ...).
// excludeUserId -> when editing, ignore the trader's own account.
async function assertNoDuplicates(data, excludeUserId = null) {
  const notMeUser = excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {};
  const notMeProfile = excludeUserId ? { userId: { [Op.ne]: excludeUserId } } : {};
  const [emailTaken, mobileTaken, tinTaken] = await Promise.all([
    User.findOne({ where: { email: data.email, userType: 'trader', ...notMeUser }, paranoid: false, attributes: ['id'] }),
    User.findOne({ where: { mobile: data.mobile, userType: 'trader', ...notMeUser }, paranoid: false, attributes: ['id'] }),
    TraderProfile.findOne({
      where: { registrationNumberTin: data.registrationNumberTin, ...notMeProfile },
      attributes: ['id'],
    }),
  ]);
  const errors = [];
  if (emailTaken) errors.push({ field: 'email', message: 'This email address is already registered as a trader' });
  if (mobileTaken) errors.push({ field: 'mobile', message: 'This mobile number is already registered as a trader' });
  if (tinTaken) {
    errors.push({ field: 'registrationNumberTin', message: 'This Business Registration Number / TIN is already registered' });
  }
  if (errors.length) {
    throw new ApiError(409, 'Some details are already registered', { code: 'DUPLICATE_VALUE', errors });
  }
}

const step1Values = (data) => ({
  businessName: data.businessName,
  registrationNumberTin: data.registrationNumberTin,
  businessType: data.businessType,
  businessCategory: data.businessCategory,
  contactFirstName: data.contactFirstName,
  contactLastName: data.contactLastName,
  designation: data.designation,
});

// ---------- Step 1: Business Information ----------
async function register(data) {
  await assertNoDuplicates(data);

  const user = await sequelize.transaction(async (transaction) => {
    const created = await User.create(
      {
        userType: 'trader',
        email: data.email,
        mobile: data.mobile,
        password: data.password,
        status: USER_STATUS.PENDING_VERIFICATION,
        registrationStep: 2,
      },
      { transaction }
    );
    await TraderProfile.create({ userId: created.id, ...step1Values(data) }, { transaction });
    return created;
  });

  return {
    registrationToken: signRegistrationToken(user),
    userId: user.id,
    userType: user.userType,
    registrationStep: user.registrationStep,
  };
}

// ---------- Step 1 again: "Back" from a later step and change the details ----------
async function updateBusinessInformation(user, data) {
  const profile = await TraderProfile.findOne({ where: { userId: user.id } });
  if (!profile) throw new ApiError(404, 'Trader profile not found', { code: 'PROFILE_NOT_FOUND' });

  await assertNoDuplicates(data, user.id);
  const emailChanged = data.email !== user.email;

  await sequelize.transaction(async (transaction) => {
    await profile.update(step1Values(data), { transaction });
    const userUpdates = { email: data.email, mobile: data.mobile };
    if (emailChanged) userUpdates.emailVerifiedAt = null; // new email must be verified again
    await user.update(userUpdates, { transaction });
  });

  await profile.reload({ include: profileInclude() });
  return {
    registrationStep: user.registrationStep,
    emailVerified: Boolean(user.emailVerifiedAt),
    traderProfile: profile.toJSON(),
  };
}

// ---------- Step 2: Business Address & License (optional) ----------
const STEP2_FIELDS = [
  'businessAddress',
  'regionId',
  'inkhundlaId',
  'umphakatsiId',
  'tradingLicenseNumber',
  'licenseIssuingAuthority',
  'licenseExpiryDate',
  'yearsInOperation',
  'website',
];

async function saveAddressAndLicense(user, data) {
  const profile = await TraderProfile.findOne({ where: { userId: user.id } });
  if (!profile) throw new ApiError(404, 'Trader profile not found', { code: 'PROFILE_NOT_FOUND' });

  const updates = {};
  STEP2_FIELDS.forEach((f) => {
    if (data[f] !== undefined) updates[f] = data[f];
  });

  // Check the location using the new values, falling back to saved ones
  const pick = (f) => (updates[f] !== undefined ? updates[f] : profile[f]);
  await locationService.assertValidChain(
    { region: pick('regionId'), inkhundla: pick('inkhundlaId'), umphakatsi: pick('umphakatsiId') },
    { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
  );

  await profile.update(updates);

  // Saving (or skipping with an empty body) moves the trader past Step 2
  if (user.registrationStep < 3) {
    user.registrationStep = 3;
    await user.save();
  }

  await profile.reload({ include: profileInclude() });
  return { registrationStep: user.registrationStep, traderProfile: profile.toJSON() };
}

// ---------- Used by shared code (see userTypes.registry.js) ----------

// Login with "Email ID or TIN": business registration number / TIN -> user id
async function findUserIdByTin(tin) {
  const profile = await TraderProfile.findOne({
    where: { registrationNumberTin: String(tin).trim().toUpperCase() },
    attributes: ['userId'],
  });
  return profile ? profile.userId : null;
}

// Name used in emails: the contact person
async function getDisplayName(userId) {
  const p = await TraderProfile.findOne({
    where: { userId },
    attributes: ['contactFirstName', 'contactLastName'],
  });
  return p ? `${p.contactFirstName} ${p.contactLastName}` : '';
}

// Step 4 submit: record the "authorized to represent this business" confirmation
async function onSubmit(user) {
  await TraderProfile.update({ authorizationConfirmedAt: new Date() }, { where: { userId: user.id } });
}

module.exports = {
  register,
  updateBusinessInformation,
  saveAddressAndLicense,
  findUserIdByTin,
  getDisplayName,
  onSubmit,
  profileInclude,
};
