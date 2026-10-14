// BUYER-ONLY logic (Figma "Buyer Registration" Step 1, buyer TIN login, alerts setting).
// Shared steps (documents, OTP, submit, login) are in document.service.js,
// registration.service.js and auth.service.js.
const { Op } = require('sequelize');
const { sequelize, User, BuyerProfile, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS, BUYER_TYPE_LABELS } = require('../utils/constants');
const { notAvailableFor } = require('../config/documentTypes');
const locationService = require('./location.service');
const documentService = require('./document.service');

const LOCATION_ATTRS = ['id', 'name'];

// Location names to load with a buyer profile (fresh list each time)
const profileInclude = () =>
  ['region', 'inkhundla', 'umphakatsi'].map((as) => ({ model: Location, as, attributes: LOCATION_ATTRS }));

// Email, mobile and TIN must be unique AMONG BUYERS (the same person may also be a farmer, ...).
// excludeUserId -> when editing, ignore the buyer's own account.
async function assertNoDuplicates(data, excludeUserId = null) {
  const notMe = excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {};
  const [emailTaken, mobileTaken, tinTaken] = await Promise.all([
    User.findOne({ where: { email: data.email, userType: 'buyer', ...notMe }, paranoid: false, attributes: ['id'] }),
    User.findOne({ where: { mobile: data.mobile, userType: 'buyer', ...notMe }, paranoid: false, attributes: ['id'] }),
    BuyerProfile.findOne({
      where: { idNumberTin: data.idNumberTin, ...(excludeUserId ? { userId: { [Op.ne]: excludeUserId } } : {}) },
      attributes: ['id'],
    }),
  ]);
  const errors = [];
  if (emailTaken) errors.push({ field: 'email', message: 'This email address is already registered as a buyer' });
  if (mobileTaken) errors.push({ field: 'mobile', message: 'This mobile number is already registered as a buyer' });
  if (tinTaken) errors.push({ field: 'idNumberTin', message: 'This ID Number / Business TIN is already registered' });
  if (errors.length) {
    throw new ApiError(409, 'Some details are already registered', { code: 'DUPLICATE_VALUE', errors });
  }
}

const assertLocation = (data) =>
  locationService.assertValidChain(
    { region: data.regionId, inkhundla: data.inkhundlaId, umphakatsi: data.umphakatsiId },
    { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
  );

const profileValues = (data) => ({
  buyerType: data.buyerType,
  name: data.name,
  idNumberTin: data.idNumberTin,
  deliveryAddress: data.deliveryAddress,
  regionId: data.regionId,
  inkhundlaId: data.inkhundlaId,
  umphakatsiId: data.umphakatsiId,
});

// ---------- Step 1: Buyer Information ----------
async function register(data) {
  await assertNoDuplicates(data);
  await assertLocation(data);

  const user = await sequelize.transaction(async (transaction) => {
    const created = await User.create(
      {
        userType: 'buyer',
        email: data.email,
        mobile: data.mobile,
        password: data.password,
        status: USER_STATUS.PENDING_VERIFICATION,
        registrationStep: 2,
      },
      { transaction }
    );
    await BuyerProfile.create({ userId: created.id, ...profileValues(data) }, { transaction });
    return created;
  });

  return {
    registrationToken: signRegistrationToken(user),
    userId: user.id,
    userType: user.userType,
    buyerType: data.buyerType,
    registrationStep: user.registrationStep,
  };
}

// ---------- Step 1 again: "Back" from a later step and change the details ----------
async function updateBuyerInformation(user, data) {
  const profile = await BuyerProfile.findOne({ where: { userId: user.id } });
  if (!profile) throw new ApiError(404, 'Buyer profile not found', { code: 'PROFILE_NOT_FOUND' });

  await assertNoDuplicates(data, user.id);
  await assertLocation(data);

  const emailChanged = data.email !== user.email;
  const switchedToIndividual = profile.buyerType === 'business' && data.buyerType === 'individual';

  await sequelize.transaction(async (transaction) => {
    await profile.update(profileValues(data), { transaction });
    const userUpdates = { email: data.email, mobile: data.mobile };
    // New email -> it must be verified again in Step 3
    if (emailChanged) userUpdates.emailVerifiedAt = null;
    await user.update(userUpdates, { transaction });
  });

  // Business -> Individual: delete documents only business buyers may have
  let removedDocuments = [];
  if (switchedToIndividual) {
    removedDocuments = await documentService.removeTypes(user.id, notAvailableFor('buyer', 'individual'));
  }

  await profile.reload({ include: profileInclude() });
  return {
    registrationStep: user.registrationStep,
    emailVerified: Boolean(user.emailVerifiedAt),
    removedDocuments,
    buyerProfile: profile.toJSON(),
  };
}

// ---------- Used by shared code (see userTypes.registry.js) ----------

// Login with "Email ID or TIN": buyer ID number / TIN -> user id
async function findUserIdByTin(tin) {
  const profile = await BuyerProfile.findOne({
    where: { idNumberTin: String(tin).trim().toUpperCase() },
    attributes: ['userId'],
  });
  return profile ? profile.userId : null;
}

// Name used in emails
async function getDisplayName(userId) {
  const p = await BuyerProfile.findOne({ where: { userId }, attributes: ['name'] });
  return p ? p.name : '';
}

// 'individual' or 'business' (decides which documents are allowed)
async function getSubtype(userId) {
  const p = await BuyerProfile.findOne({ where: { userId }, attributes: ['buyerType'] });
  return p ? p.buyerType : null;
}

// Step 3 submit: save the "Order & Price Alerts" toggle
async function onSubmit(user, data) {
  if (typeof data.orderPriceAlerts === 'boolean') {
    await BuyerProfile.update({ orderPriceAlerts: data.orderPriceAlerts }, { where: { userId: user.id } });
  }
}

const subtypeLabel = (subtype) => BUYER_TYPE_LABELS[subtype] || subtype;

module.exports = {
  register,
  updateBuyerInformation,
  findUserIdByTin,
  getDisplayName,
  getSubtype,
  onSubmit,
  subtypeLabel,
  profileInclude,
};
