// The logged-in user's OWN profile, for every user type:
//   GET   /me/profile   -> everything the profile screen shows
//   PATCH /me/profile   -> edit (send only the fields to change)
//   PATCH /me/password  -> change password
//
// Rules (agreed with the client):
//   - Email, TIN / registration number and buyer type can NEVER be changed.
//     Sending them with the SAME value is fine (forms often send everything); a different value -> 422.
//   - Mobile number can be changed (must stay unique within the user's type).
//   - Every other field can be edited freely. The account does NOT go back to admin approval.
//   - Optional fields are emptied by sending null or "".
const models = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const { signToken, verifyToken } = require('../utils/jwt');
const { displayId } = require('../utils/displayId');
const { USER_STATUS, USER_STATUS_LABELS, USER_TYPE_LABELS } = require('../utils/constants');
const locationService = require('./location.service');
const directory = require('./userDirectory');
const emailService = require('./email.service');
const paymentMethodService = require('./paymentMethod.service');
const { getHandler } = require('./userTypes.registry');
const { loadUserWithProfile } = require('./registration.service');
const { documentSummary } = require('./adminUser.service');
const vatService = require('./vat.service');
const { VAT_CERTIFICATE_TYPE } = require('../config/documentTypes');

const { sequelize, User, UserDocument } = models;

// VAT block (sellers only; null for buyers / FIs). Uses the documents already loaded.
const vatBlock = (user, docs) =>
  vatService.isSellerType(user.userType)
    ? vatService.vatInfo(user, docs.find((d) => d.documentType === VAT_CERTIFICATE_TYPE) || null)
    : null;

const MAIN_LOCATION = ['regionId', 'inkhundlaId', 'umphakatsiId'];

// What each user type may edit.
//   locked     -> { field: label } never changeable ("user" fields live on the users table)
//   fields     -> editable profile columns
//   clearable  -> optional columns that can be emptied (null / "")
//   locations  -> Region -> Inkhundla -> Umphakatsi groups to check
//   coverage   -> "regions served" link table (logistics, FI)
const PROFILE_RULES = {
  farmer: {
    locked: { email: 'Email address', farmerIdTin: 'Farmer ID / TIN' },
    fields: [
      'firstName', 'middleName', 'lastName', 'gender', 'dateOfBirth', 'residentAddress', ...MAIN_LOCATION,
      'farmName', 'farmAddress', 'farmRegionId', 'farmInkhundlaId', 'farmUmphakatsiId', 'farmSizeHa',
      'landOwnershipType', 'farmingActivity', 'mainCrops', 'otherCrops', 'productionCapacityKg', 'farmingSeasons',
    ],
    clearable: [
      'middleName', 'farmName', 'farmAddress', 'farmRegionId', 'farmInkhundlaId', 'farmUmphakatsiId', 'farmSizeHa',
      'landOwnershipType', 'farmingActivity', 'mainCrops', 'otherCrops', 'productionCapacityKg', 'farmingSeasons',
    ],
    locations: [MAIN_LOCATION, ['farmRegionId', 'farmInkhundlaId', 'farmUmphakatsiId']],
  },
  buyer: {
    locked: {
      email: 'Email address',
      idNumberTin: 'ID Number / Business TIN',
      buyerType: 'Buyer type (Individual / Business)',
    },
    fields: ['name', 'deliveryAddress', ...MAIN_LOCATION, 'orderPriceAlerts'],
    clearable: [],
    locations: [MAIN_LOCATION],
  },
  trader: {
    locked: { email: 'Email address', registrationNumberTin: 'Business Registration Number / TIN' },
    fields: [
      'businessName', 'businessType', 'businessCategory', 'contactFirstName', 'contactLastName', 'designation',
      'businessAddress', ...MAIN_LOCATION, 'tradingLicenseNumber', 'licenseIssuingAuthority', 'licenseExpiryDate',
      'yearsInOperation', 'website',
    ],
    clearable: [
      'businessAddress', ...MAIN_LOCATION, 'tradingLicenseNumber', 'licenseIssuingAuthority', 'licenseExpiryDate',
      'yearsInOperation', 'website',
    ],
    locations: [MAIN_LOCATION],
  },
  logistics: {
    locked: { email: 'Email address', registrationNumberTin: 'Business Registration Number / TIN' },
    fields: [
      'businessName', 'businessType', 'serviceType', 'contactFirstName', 'contactLastName', 'designation',
      'businessAddress', ...MAIN_LOCATION,
    ],
    clearable: ['businessAddress', ...MAIN_LOCATION],
    locations: [MAIN_LOCATION],
    coverage: { model: 'LogisticsCoverageRegion', foreignKey: 'logisticsProfileId' },
  },
  financial_institution: {
    locked: { email: 'Email address', registrationNumberTin: 'Institution Registration Number / TIN' },
    fields: [
      'institutionName', 'institutionType', 'productType', 'contactFirstName', 'contactLastName', 'designation',
      'institutionAddress', ...MAIN_LOCATION, 'regulatoryBody', 'regulatoryBodyOther', 'regulatoryLicenseNumber',
      'licenseExpiryDate', 'yearsInOperation',
    ],
    clearable: [
      'institutionAddress', ...MAIN_LOCATION, 'regulatoryBody', 'regulatoryBodyOther', 'regulatoryLicenseNumber',
      'licenseExpiryDate', 'yearsInOperation',
    ],
    locations: [MAIN_LOCATION],
    coverage: { model: 'FiCoverageRegion', foreignKey: 'fiProfileId' },
  },
};

const rulesFor = (userType) => {
  const rules = PROFILE_RULES[userType];
  const handler = getHandler(userType);
  if (!rules || !handler) {
    throw new ApiError(400, 'Profile editing is not available for this account', { code: 'NOT_SUPPORTED' });
  }
  return { rules, handler };
};

const validationError = (errors) => new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors });

// Same value? (case / spaces ignored, e.g. "abc-12" == "ABC-12 ")
const sameValue = (a, b) =>
  String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();

async function loadProfileRow(user, handler) {
  const profile = await models[handler.profileModel].findOne({ where: { userId: user.id } });
  if (!profile) throw new ApiError(404, 'Profile not found', { code: 'PROFILE_NOT_FOUND' });
  return profile;
}

// ---------- GET /me/profile ----------
async function getProfile(userId) {
  const user = await loadUserWithProfile(userId);
  const { rules, handler } = rulesFor(user.userType);
  const [dir, docs, paymentMethods] = await Promise.all([
    directory.findOne(user.id),
    UserDocument.findAll({ where: { userId: user.id }, order: [['documentType', 'ASC']] }),
    paymentMethodService.isAllowed(user.userType) ? paymentMethodService.listFor(user.id) : null,
  ]);
  const subtype = dir ? dir.subtype : null;
  const docSummary = documentSummary(user.userType, subtype, docs);
  // Users only see their own document status, not the admin's internal fields
  docSummary.items = docSummary.items.map(({ document, ...item }) => ({
    ...item,
    uploadedAt: document ? document.updatedAt : null,
    rejectionReason: document ? document.rejectionReason : null,
  }));

  return {
    displayId: displayId(user.userType, user.id),
    name: dir ? dir.display_name : null,
    subName: dir ? dir.sub_name : null,
    userType: user.userType,
    userTypeLabel: USER_TYPE_LABELS[user.userType],
    subtype,
    subtypeLabel: subtype && handler.subtypeLabel ? handler.subtypeLabel(subtype) : null,
    status: user.status,
    statusLabel: USER_STATUS_LABELS[user.status],
    verified: user.status === USER_STATUS.APPROVED, // "Verified Farmer" badge
    memberSince: user.approvedAt || user.submittedAt || user.createdAt,
    region: dir && dir.region_id ? { id: dir.region_id, name: dir.region_name } : null,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    mobile: user.mobile,
    passwordChangedAt: user.passwordChangedAt, // null = "Last changed on registration"
    profile: user[handler.profileAs] || null,
    documents: docSummary,
    vat: vatBlock(user, docs), // sellers: VAT registration status; null for buyers / FIs
    paymentMethods, // null for financial institutions (not available)
    editing: {
      lockedFields: Object.keys(rules.locked),
      editableFields: ['mobile', ...rules.fields, ...(rules.coverage ? ['coverageRegionIds'] : [])],
      clearableFields: rules.clearable,
    },
  };
}

// ---------- PATCH /me/profile ----------
//   data    -> validated + cleaned fields (req.validated)
//   rawBody -> the request body as sent (to spot locked fields and "clear this field")
async function updateProfile(user, data, rawBody = {}) {
  const { rules, handler } = rulesFor(user.userType);
  const profile = await loadProfileRow(user, handler);

  // 1. Locked fields: a DIFFERENT value is refused
  const lockedErrors = [];
  Object.entries(rules.locked).forEach(([field, label]) => {
    if (rawBody[field] === undefined) return;
    const current = field === 'email' ? user.email : profile[field];
    if (!sameValue(rawBody[field], current)) {
      lockedErrors.push({ field, message: `${label} cannot be changed` });
    }
  });
  if (lockedErrors.length) {
    throw new ApiError(422, 'Some details cannot be changed', { code: 'FIELD_LOCKED', errors: lockedErrors });
  }

  // 2. Profile values to save
  const updates = {};
  rules.fields.forEach((f) => {
    if (data[f] !== undefined) updates[f] = data[f];
  });
  rules.clearable.forEach((f) => {
    if (rawBody[f] === null || rawBody[f] === '') updates[f] = null;
  });

  // Farmer lists: remove duplicates
  if (Array.isArray(updates.mainCrops)) {
    const seen = new Set();
    updates.mainCrops = updates.mainCrops.filter((c) => {
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (Array.isArray(updates.farmingSeasons)) updates.farmingSeasons = [...new Set(updates.farmingSeasons)];

  const pick = (f) => (updates[f] !== undefined ? updates[f] : profile[f]);

  // 3. Locations: only checked when one of the group's fields is sent
  //    (so a location the admin disabled later doesn't block other edits)
  for (const group of rules.locations) {
    if (group.some((f) => updates[f] !== undefined)) {
      const [r, i, u] = group;
      // eslint-disable-next-line no-await-in-loop
      await locationService.assertValidChain(
        { region: pick(r), inkhundla: pick(i), umphakatsi: pick(u) },
        { region: r, inkhundla: i, umphakatsi: u }
      );
    }
  }

  // 4. FI: regulatory body "other" needs a name; any other choice clears the name
  if (user.userType === 'financial_institution' && (updates.regulatoryBody !== undefined || updates.regulatoryBodyOther !== undefined)) {
    const finalBody = pick('regulatoryBody');
    if (finalBody === 'other' && !pick('regulatoryBodyOther')) {
      throw validationError([{ field: 'regulatoryBodyOther', message: 'Please enter the name of the regulatory body' }]);
    }
    if (finalBody !== 'other') updates.regulatoryBodyOther = null;
  }

  // 5. Regions served (logistics, FI): only changed when sent ([] clears the list)
  let coverageRegionIds = null;
  if (rules.coverage && Array.isArray(data.coverageRegionIds)) {
    coverageRegionIds = [...new Set(data.coverageRegionIds)];
    await locationService.assertRegions(coverageRegionIds, 'coverageRegionIds');
  }

  // 6. Mobile: unique within this user type (also counts disabled accounts)
  const newMobile = data.mobile !== undefined && data.mobile !== user.mobile ? data.mobile : null;
  if (newMobile) {
    const taken = await User.findOne({
      where: { mobile: newMobile, userType: user.userType, id: { [Op.ne]: user.id } },
      paranoid: false,
      attributes: ['id'],
    });
    if (taken) {
      throw new ApiError(409, 'This mobile number is already used by another account', {
        code: 'DUPLICATE_VALUE',
        errors: [{ field: 'mobile', message: `This mobile number is already registered as a ${USER_TYPE_LABELS[user.userType]}` }],
      });
    }
  }

  // 7. Save everything together
  await sequelize.transaction(async (transaction) => {
    if (Object.keys(updates).length) await profile.update(updates, { transaction });
    if (newMobile) await user.update({ mobile: newMobile }, { transaction });
    if (coverageRegionIds) {
      const Link = models[rules.coverage.model];
      const fk = rules.coverage.foreignKey;
      await Link.destroy({ where: { [fk]: profile.id }, transaction });
      if (coverageRegionIds.length) {
        await Link.bulkCreate(coverageRegionIds.map((regionId) => ({ [fk]: profile.id, regionId })), { transaction });
      }
    }
  });

  return getProfile(user.id);
}

// ---------- PATCH /me/password ----------
// Old sessions (other phones / browsers) are logged out; this device gets a NEW token
// that expires at the same time as the one it replaces (keeps "Remember me").
async function changePassword(userId, { currentPassword, newPassword }, currentToken) {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new ApiError(404, 'Account not found', { code: 'USER_NOT_FOUND' });

  if (!(await user.comparePassword(currentPassword))) {
    throw validationError([{ field: 'currentPassword', message: 'Current password is not correct' }]);
  }
  if (await user.comparePassword(newPassword)) {
    throw validationError([{ field: 'newPassword', message: 'New password must be different from the current password' }]);
  }

  user.password = newPassword; // hashed by the model hook, sets passwordChangedAt
  await user.save();

  // New token for this device, same expiry as the old one (at least 1 minute)
  let expiresIn = 60;
  try {
    const { exp } = verifyToken(currentToken);
    expiresIn = Math.max(exp - Math.floor(Date.now() / 1000), 60);
  } catch (err) {
    expiresIn = 60;
  }
  // The new token must be issued AFTER passwordChangedAt (checked to the second)
  const changedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const token = signToken(
    { sub: user.id, type: 'user', userType: user.userType, iat: Math.max(nowSec, changedAtSec) },
    { expiresIn }
  );

  // Security email (a failed email never fails the change)
  const handler = getHandler(user.userType);
  Promise.resolve(handler ? handler.getDisplayName(user.id) : '')
    .then((name) => emailService.sendPasswordChangedEmail({ to: user.email, name, userType: user.userType }))
    .catch((err) => console.error(`Password-changed email failed for user ${user.id}:`, err.message));

  return { token, tokenType: 'Bearer', expiresIn, passwordChangedAt: user.passwordChangedAt };
}

module.exports = { getProfile, updateProfile, changePassword, PROFILE_RULES };
