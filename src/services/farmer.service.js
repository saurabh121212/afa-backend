// FARMER-ONLY logic (Figma "Farmer Registration" Steps 1-2, farmer TIN login).
// Shared steps (OTP, submit, login) are in registration.service.js and auth.service.js.
const { Op } = require('sequelize');
const { sequelize, User, FarmerProfile, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS } = require('../utils/constants');
const locationService = require('./location.service');

const LOCATION_ATTRS = ['id', 'name'];

// Location names to load with a farmer profile.
// Returns a fresh list each time (Sequelize changes include objects while querying).
const profileInclude = () =>
  ['region', 'inkhundla', 'umphakatsi', 'farmRegion', 'farmInkhundla', 'farmUmphakatsi'].map(
    (as) => ({ model: Location, as, attributes: LOCATION_ATTRS })
  );

// ---------- Step 1: Personal Information ----------
async function register(data) {
  // Friendly duplicate check (one message per field).
  // Email and mobile only need to be unique AMONG FARMERS: the same person
  // may also have a Buyer / Trader / ... account with the same email and mobile.
  // paranoid:false -> also counts disabled farmer accounts.
  const [emailTaken, mobileTaken, tinTaken] = await Promise.all([
    User.findOne({ where: { email: data.email, userType: 'farmer' }, paranoid: false, attributes: ['id'] }),
    User.findOne({ where: { mobile: data.mobile, userType: 'farmer' }, paranoid: false, attributes: ['id'] }),
    FarmerProfile.findOne({ where: { farmerIdTin: data.farmerIdTin }, attributes: ['id'] }),
  ]);
  const errors = [];
  if (emailTaken) {
    errors.push({ field: 'email', message: 'This email address is already registered as a farmer' });
  }
  if (mobileTaken) {
    errors.push({ field: 'mobile', message: 'This mobile number is already registered as a farmer' });
  }
  if (tinTaken) errors.push({ field: 'farmerIdTin', message: 'This Farmer ID / TIN is already registered' });
  if (errors.length) {
    throw new ApiError(409, 'Some details are already registered', { code: 'DUPLICATE_VALUE', errors });
  }

  await locationService.assertValidChain(
    { region: data.regionId, inkhundla: data.inkhundlaId, umphakatsi: data.umphakatsiId },
    { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
  );

  // User + profile are saved together, or not at all.
  const user = await sequelize.transaction(async (transaction) => {
    const created = await User.create(
      {
        userType: 'farmer',
        email: data.email,
        mobile: data.mobile,
        password: data.password,
        status: USER_STATUS.PENDING_VERIFICATION,
        registrationStep: 2,
      },
      { transaction }
    );
    await FarmerProfile.create(
      {
        userId: created.id,
        farmerIdTin: data.farmerIdTin,
        firstName: data.firstName,
        middleName: data.middleName || null,
        lastName: data.lastName,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        residentAddress: data.residentAddress,
        regionId: data.regionId,
        inkhundlaId: data.inkhundlaId,
        umphakatsiId: data.umphakatsiId,
      },
      { transaction }
    );
    return created;
  });

  return {
    registrationToken: signRegistrationToken(user),
    userId: user.id,
    userType: user.userType,
    registrationStep: user.registrationStep,
  };
}

// ---------- Step 2: Farm Information (optional) ----------
const FARM_FIELDS = [
  'farmName',
  'farmAddress',
  'farmRegionId',
  'farmInkhundlaId',
  'farmUmphakatsiId',
  'farmSizeHa',
  'landOwnershipType',
  'farmingActivity',
  'mainCrops',
  'otherCrops',
  'productionCapacityKg',
  'farmingSeasons',
];

async function saveFarmInformation(user, data) {
  const profile = await FarmerProfile.findOne({ where: { userId: user.id } });
  if (!profile) throw new ApiError(404, 'Farmer profile not found', { code: 'PROFILE_NOT_FOUND' });

  const updates = {};
  FARM_FIELDS.forEach((f) => {
    if (data[f] !== undefined) updates[f] = data[f];
  });

  // Remove duplicate crops (case-insensitive), keep the first spelling
  if (Array.isArray(updates.mainCrops)) {
    const seen = new Set();
    updates.mainCrops = updates.mainCrops.filter((c) => {
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (Array.isArray(updates.farmingSeasons)) {
    updates.farmingSeasons = [...new Set(updates.farmingSeasons)];
  }

  // Check the farm location using the new values, falling back to saved ones
  const pick = (f) => (updates[f] !== undefined ? updates[f] : profile[f]);
  await locationService.assertValidChain(
    { region: pick('farmRegionId'), inkhundla: pick('farmInkhundlaId'), umphakatsi: pick('farmUmphakatsiId') },
    { region: 'farmRegionId', inkhundla: 'farmInkhundlaId', umphakatsi: 'farmUmphakatsiId' }
  );

  await profile.update(updates);

  // Saving (or skipping with an empty body) moves the farmer past Step 2
  if (user.registrationStep < 3) {
    user.registrationStep = 3;
    await user.save();
  }

  await profile.reload({ include: profileInclude() });
  return { registrationStep: user.registrationStep, farmerProfile: profile.toJSON() };
}

// ---------- Used by shared code (see userTypes.registry.js) ----------

// Login with "Email ID or TIN": farmer TIN -> user id
async function findUserIdByTin(tin) {
  const profile = await FarmerProfile.findOne({
    where: { farmerIdTin: { [Op.eq]: String(tin).trim().toUpperCase() } },
    attributes: ['userId'],
  });
  return profile ? profile.userId : null;
}

// Name used in emails
async function getDisplayName(userId) {
  const p = await FarmerProfile.findOne({
    where: { userId },
    attributes: ['firstName', 'middleName', 'lastName'],
  });
  return p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : '';
}

module.exports = {
  register,
  saveFarmInformation,
  findUserIdByTin,
  getDisplayName,
  profileInclude,
};
