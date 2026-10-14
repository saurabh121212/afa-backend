// LOGISTICS-PROVIDER-ONLY logic (Figma "Logistics Provider Registration" Steps 1-2,
// TIN login, extra consent). Shared steps (documents, OTP, submit, login) are in
// document.service.js, registration.service.js and auth.service.js.
const { Op } = require('sequelize');
const { sequelize, User, LogisticsProfile, LogisticsCoverageRegion, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS } = require('../utils/constants');
const locationService = require('./location.service');

const LOCATION_ATTRS = ['id', 'name'];

// Location names + regions served, loaded with a logistics profile (fresh list each time)
const profileInclude = () => [
  ...['region', 'inkhundla', 'umphakatsi'].map((as) => ({ model: Location, as, attributes: LOCATION_ATTRS })),
  {
    model: Location,
    as: 'coverageRegions',
    attributes: LOCATION_ATTRS,
    through: { attributes: [] }, // don't return the link-table columns
  },
];

// Email, mobile and TIN must be unique AMONG LOGISTICS PROVIDERS.
// excludeUserId -> when editing, ignore the provider's own account.
async function assertNoDuplicates(data, excludeUserId = null) {
  const notMeUser = excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {};
  const notMeProfile = excludeUserId ? { userId: { [Op.ne]: excludeUserId } } : {};
  const [emailTaken, mobileTaken, tinTaken] = await Promise.all([
    User.findOne({
      where: { email: data.email, userType: 'logistics', ...notMeUser },
      paranoid: false,
      attributes: ['id'],
    }),
    User.findOne({
      where: { mobile: data.mobile, userType: 'logistics', ...notMeUser },
      paranoid: false,
      attributes: ['id'],
    }),
    LogisticsProfile.findOne({
      where: { registrationNumberTin: data.registrationNumberTin, ...notMeProfile },
      attributes: ['id'],
    }),
  ]);
  const errors = [];
  if (emailTaken) {
    errors.push({ field: 'email', message: 'This email address is already registered as a logistics provider' });
  }
  if (mobileTaken) {
    errors.push({ field: 'mobile', message: 'This mobile number is already registered as a logistics provider' });
  }
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
  serviceType: data.serviceType,
  contactFirstName: data.contactFirstName,
  contactLastName: data.contactLastName,
  designation: data.designation,
});

async function loadProfile(userId) {
  const profile = await LogisticsProfile.findOne({ where: { userId } });
  if (!profile) throw new ApiError(404, 'Logistics profile not found', { code: 'PROFILE_NOT_FOUND' });
  return profile;
}

// ---------- Step 1: Business Information ----------
async function register(data) {
  await assertNoDuplicates(data);

  const user = await sequelize.transaction(async (transaction) => {
    const created = await User.create(
      {
        userType: 'logistics',
        email: data.email,
        mobile: data.mobile,
        password: data.password,
        status: USER_STATUS.PENDING_VERIFICATION,
        registrationStep: 2,
      },
      { transaction }
    );
    await LogisticsProfile.create({ userId: created.id, ...step1Values(data) }, { transaction });
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
  const profile = await loadProfile(user.id);
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
    logisticsProfile: profile.toJSON(),
  };
}

// ---------- Step 2: Service Details & Coverage Area (optional) ----------
const LOCATION_FIELDS = ['businessAddress', 'regionId', 'inkhundlaId', 'umphakatsiId'];

async function saveBusinessLocation(user, data) {
  const profile = await loadProfile(user.id);

  const updates = {};
  LOCATION_FIELDS.forEach((f) => {
    if (data[f] !== undefined) updates[f] = data[f];
  });

  // Business location: check using the new values, falling back to saved ones
  const pick = (f) => (updates[f] !== undefined ? updates[f] : profile[f]);
  await locationService.assertValidChain(
    { region: pick('regionId'), inkhundla: pick('inkhundlaId'), umphakatsi: pick('umphakatsiId') },
    { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
  );

  // Regions served: only changed when the field is sent ([] clears the list)
  let coverageRegionIds = null;
  if (Array.isArray(data.coverageRegionIds)) {
    coverageRegionIds = [...new Set(data.coverageRegionIds)];
    await locationService.assertRegions(coverageRegionIds, 'coverageRegionIds');
  }

  await sequelize.transaction(async (transaction) => {
    await profile.update(updates, { transaction });
    if (coverageRegionIds) {
      // Replace the whole list
      await LogisticsCoverageRegion.destroy({ where: { logisticsProfileId: profile.id }, transaction });
      if (coverageRegionIds.length) {
        await LogisticsCoverageRegion.bulkCreate(
          coverageRegionIds.map((regionId) => ({ logisticsProfileId: profile.id, regionId })),
          { transaction }
        );
      }
    }
  });

  // Saving (or skipping with an empty body) moves the provider past Step 2
  if (user.registrationStep < 3) {
    user.registrationStep = 3;
    await user.save();
  }

  await profile.reload({ include: profileInclude() });
  return { registrationStep: user.registrationStep, logisticsProfile: profile.toJSON() };
}

// ---------- Used by shared code (see userTypes.registry.js) ----------

// Login with "Email ID or TIN": business registration number / TIN -> user id
async function findUserIdByTin(tin) {
  const profile = await LogisticsProfile.findOne({
    where: { registrationNumberTin: String(tin).trim().toUpperCase() },
    attributes: ['userId'],
  });
  return profile ? profile.userId : null;
}

// Name used in emails: the contact person
async function getDisplayName(userId) {
  const p = await LogisticsProfile.findOne({
    where: { userId },
    attributes: ['contactFirstName', 'contactLastName'],
  });
  return p ? `${p.contactFirstName} ${p.contactLastName}` : '';
}

// Step 4 submit: record the "authorized to represent this business" confirmation
async function onSubmit(user) {
  await LogisticsProfile.update({ authorizationConfirmedAt: new Date() }, { where: { userId: user.id } });
}

module.exports = {
  register,
  updateBusinessInformation,
  saveBusinessLocation,
  findUserIdByTin,
  getDisplayName,
  onSubmit,
  profileInclude,
};
