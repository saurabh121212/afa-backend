// FINANCIAL-INSTITUTION-ONLY logic (Figma "Financial Institution Registration" Steps 1-2,
// TIN login, extra consent). Shared steps (documents, OTP, submit, login) are in
// document.service.js, registration.service.js and auth.service.js.
const { Op } = require('sequelize');
const { sequelize, User, FiProfile, FiCoverageRegion, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS } = require('../utils/constants');
const locationService = require('./location.service');

const USER_TYPE = 'financial_institution';
const LOCATION_ATTRS = ['id', 'name'];

// Location names + regions served, loaded with an FI profile (fresh list each time)
const profileInclude = () => [
  ...['region', 'inkhundla', 'umphakatsi'].map((as) => ({ model: Location, as, attributes: LOCATION_ATTRS })),
  {
    model: Location,
    as: 'coverageRegions',
    attributes: LOCATION_ATTRS,
    through: { attributes: [] }, // don't return the link-table columns
  },
];

// Email, mobile and TIN must be unique AMONG FINANCIAL INSTITUTIONS.
// excludeUserId -> when editing, ignore the institution's own account.
async function assertNoDuplicates(data, excludeUserId = null) {
  const notMeUser = excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {};
  const notMeProfile = excludeUserId ? { userId: { [Op.ne]: excludeUserId } } : {};
  const [emailTaken, mobileTaken, tinTaken] = await Promise.all([
    User.findOne({
      where: { email: data.email, userType: USER_TYPE, ...notMeUser },
      paranoid: false,
      attributes: ['id'],
    }),
    User.findOne({
      where: { mobile: data.mobile, userType: USER_TYPE, ...notMeUser },
      paranoid: false,
      attributes: ['id'],
    }),
    FiProfile.findOne({
      where: { registrationNumberTin: data.registrationNumberTin, ...notMeProfile },
      attributes: ['id'],
    }),
  ]);
  const errors = [];
  if (emailTaken) {
    errors.push({ field: 'email', message: 'This email address is already registered as a financial institution' });
  }
  if (mobileTaken) {
    errors.push({ field: 'mobile', message: 'This mobile number is already registered as a financial institution' });
  }
  if (tinTaken) {
    errors.push({
      field: 'registrationNumberTin',
      message: 'This Institution Registration Number / TIN is already registered',
    });
  }
  if (errors.length) {
    throw new ApiError(409, 'Some details are already registered', { code: 'DUPLICATE_VALUE', errors });
  }
}

const step1Values = (data) => ({
  institutionName: data.institutionName,
  registrationNumberTin: data.registrationNumberTin,
  institutionType: data.institutionType,
  productType: data.productType,
  contactFirstName: data.contactFirstName,
  contactLastName: data.contactLastName,
  designation: data.designation,
});

async function loadProfile(userId) {
  const profile = await FiProfile.findOne({ where: { userId } });
  if (!profile) throw new ApiError(404, 'Financial institution profile not found', { code: 'PROFILE_NOT_FOUND' });
  return profile;
}

// ---------- Step 1: Institution Information ----------
async function register(data) {
  await assertNoDuplicates(data);

  const user = await sequelize.transaction(async (transaction) => {
    const created = await User.create(
      {
        userType: USER_TYPE,
        email: data.email,
        mobile: data.mobile,
        password: data.password,
        status: USER_STATUS.PENDING_VERIFICATION,
        registrationStep: 2,
      },
      { transaction }
    );
    await FiProfile.create({ userId: created.id, ...step1Values(data) }, { transaction });
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
async function updateInstitutionInformation(user, data) {
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
    fiProfile: profile.toJSON(),
  };
}

// ---------- Step 2: Regulatory Details & Coverage (optional) ----------
const STEP2_FIELDS = [
  'institutionAddress',
  'regionId',
  'inkhundlaId',
  'umphakatsiId',
  'regulatoryBody',
  'regulatoryBodyOther',
  'regulatoryLicenseNumber',
  'licenseExpiryDate',
  'yearsInOperation',
];

async function saveRegulatoryDetails(user, data) {
  const profile = await loadProfile(user.id);

  const updates = {};
  STEP2_FIELDS.forEach((f) => {
    if (data[f] !== undefined) updates[f] = data[f];
  });
  const pick = (f) => (updates[f] !== undefined ? updates[f] : profile[f]);

  // Regulatory body "other" needs a name; any other choice clears the name
  const finalBody = pick('regulatoryBody');
  if (finalBody === 'other') {
    if (!pick('regulatoryBodyOther')) {
      throw new ApiError(422, 'Validation failed', {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'regulatoryBodyOther', message: 'Please enter the name of the regulatory body' }],
      });
    }
  } else if (finalBody) {
    updates.regulatoryBodyOther = null;
  }

  // Institution location: check using the new values, falling back to saved ones
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
      await FiCoverageRegion.destroy({ where: { fiProfileId: profile.id }, transaction });
      if (coverageRegionIds.length) {
        await FiCoverageRegion.bulkCreate(
          coverageRegionIds.map((regionId) => ({ fiProfileId: profile.id, regionId })),
          { transaction }
        );
      }
    }
  });

  // Saving (or skipping with an empty body) moves the institution past Step 2
  if (user.registrationStep < 3) {
    user.registrationStep = 3;
    await user.save();
  }

  await profile.reload({ include: profileInclude() });
  return { registrationStep: user.registrationStep, fiProfile: profile.toJSON() };
}

// ---------- Used by shared code (see userTypes.registry.js) ----------

// Login with "Email ID or TIN": institution registration number / TIN -> user id
async function findUserIdByTin(tin) {
  const profile = await FiProfile.findOne({
    where: { registrationNumberTin: String(tin).trim().toUpperCase() },
    attributes: ['userId'],
  });
  return profile ? profile.userId : null;
}

// Name used in emails: the contact person
async function getDisplayName(userId) {
  const p = await FiProfile.findOne({
    where: { userId },
    attributes: ['contactFirstName', 'contactLastName'],
  });
  return p ? `${p.contactFirstName} ${p.contactLastName}` : '';
}

// Step 4 submit: record the "authorized to represent this institution" confirmation
async function onSubmit(user) {
  await FiProfile.update({ authorizationConfirmedAt: new Date() }, { where: { userId: user.id } });
}

module.exports = {
  register,
  updateInstitutionInformation,
  saveRegulatoryDetails,
  findUserIdByTin,
  getDisplayName,
  onSubmit,
  profileInclude,
};
