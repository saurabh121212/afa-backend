// Saved delivery addresses of the logged-in user (Figma "Saved Addresses"). Any user type can use them.
//
// Rules
//   - Up to MAX_ADDRESSES per account; exactly one is the Default (the first one added).
//   - "Set as Default" moves the default; deleting the default makes the oldest remaining one default.
//   - Location: Region and Inkhundla are required, Umphakatsi is optional (checked as a chain).
//   - Contact name / phone left out -> taken from the account (name in the profile, account mobile).
//   - Delete = soft delete. Orders made later keep their own copy of the address.
const models = require('../models');
const ApiError = require('../utils/ApiError');
const locationService = require('./location.service');
const directory = require('./userDirectory');

const { sequelize, Address, Location } = models;

const MAX_ADDRESSES = 10;
const ORDER = [
  ['isDefault', 'DESC'],
  ['createdAt', 'ASC'],
  ['id', 'ASC'],
];

const include = () => ['region', 'inkhundla', 'umphakatsi'].map((as) => ({ model: Location, as, attributes: ['id', 'name'] }));
const notFound = () => new ApiError(404, 'Address not found', { code: 'ADDRESS_NOT_FOUND' });
const loc = (l) => (l ? { id: l.id, name: l.name } : null);

function toPublic(a) {
  // "Plot 45, Ngwane Park, Manzini South, Manzini, Eswatini"
  const fullAddress = [a.addressLine, a.umphakatsi && a.umphakatsi.name, a.inkhundla && a.inkhundla.name, a.region && a.region.name, 'Eswatini']
    .filter(Boolean)
    .join(', ');
  return {
    id: a.id,
    label: a.label,
    isDefault: a.isDefault,
    contactName: a.contactName,
    phone: a.phone,
    addressLine: a.addressLine,
    landmark: a.landmark,
    region: loc(a.region),
    inkhundla: loc(a.inkhundla),
    umphakatsi: loc(a.umphakatsi),
    fullAddress,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function findOwn(user, id, transaction) {
  const address = await Address.findOne({ where: { id, userId: user.id }, include: include(), transaction });
  if (!address) throw notFound();
  return address;
}

// Address the user gave at registration (buyer delivery address, farmer home, business address)
// -> offered as a ready-made first address when the list is empty.
async function profileSuggestion(user) {
  const map = await directory.findMany([user.id]);
  const dir = map.get(user.id);
  const byType = {
    buyer: ['BuyerProfile', 'deliveryAddress'],
    farmer: ['FarmerProfile', 'residentAddress'],
    trader: ['TraderProfile', 'businessAddress'],
    logistics: ['LogisticsProfile', 'businessAddress'],
    financial_institution: ['FiProfile', 'institutionAddress'],
  };
  const [modelName, addressField] = byType[user.userType] || [];
  if (!modelName) return null;
  const p = await models[modelName].findOne({ where: { userId: user.id } });
  if (!p || !p.regionId || !p.inkhundlaId || !p[addressField]) return null;
  return {
    label: user.userType === 'buyer' || user.userType === 'farmer' ? 'Home' : 'Office',
    contactName: dir ? dir.display_name : null,
    phone: user.mobile,
    addressLine: p[addressField],
    regionId: p.regionId,
    inkhundlaId: p.inkhundlaId,
    umphakatsiId: p.umphakatsiId || null,
  };
}

// ---------- GET /me/addresses ----------
async function list(user) {
  const rows = await Address.findAll({ where: { userId: user.id }, include: include(), order: ORDER });
  return {
    items: rows.map(toPublic),
    max: MAX_ADDRESSES,
    // Only when nothing is saved yet: the app can offer "Use my registered address"
    suggestion: rows.length ? null : await profileSuggestion(user),
  };
}

// ---------- GET /me/addresses/:id ----------
async function getOne(user, id) {
  return toPublic(await findOwn(user, id));
}

// Location chain: Region -> Inkhundla (-> Umphakatsi)
const checkLocation = (v) =>
  locationService.assertValidChain(
    { region: v.regionId, inkhundla: v.inkhundlaId, umphakatsi: v.umphakatsiId },
    { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
  );

// ---------- POST /me/addresses ----------
async function create(user, data) {
  await checkLocation(data);
  let contactName = data.contactName;
  if (!contactName) {
    const dir = (await directory.findMany([user.id])).get(user.id);
    contactName = (dir && dir.display_name) || 'AFA User';
  }

  return sequelize.transaction(async (transaction) => {
    const count = await Address.count({ where: { userId: user.id }, transaction });
    if (count >= MAX_ADDRESSES) {
      throw new ApiError(409, `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`, { code: 'LIMIT_REACHED' });
    }
    const makeDefault = count === 0 || data.isDefault === true; // the first address is always the default
    if (makeDefault && count > 0) {
      await Address.update({ isDefault: false }, { where: { userId: user.id }, transaction });
    }
    const address = await Address.create(
      {
        userId: user.id,
        label: data.label,
        contactName,
        phone: data.phone || user.mobile,
        addressLine: data.addressLine,
        landmark: data.landmark || null,
        regionId: data.regionId,
        inkhundlaId: data.inkhundlaId,
        umphakatsiId: data.umphakatsiId || null,
        isDefault: makeDefault,
      },
      { transaction }
    );
    return toPublic(await findOwn(user, address.id, transaction));
  });
}

// ---------- PUT /me/addresses/:id   (send only what changes) ----------
async function update(user, id, data, rawBody = {}) {
  return sequelize.transaction(async (transaction) => {
    const address = await findOwn(user, id, transaction);
    const updates = {};
    ['label', 'contactName', 'phone', 'addressLine', 'landmark', 'regionId', 'inkhundlaId', 'umphakatsiId'].forEach((f) => {
      if (data[f] !== undefined) updates[f] = data[f];
    });
    // Optional fields can be emptied
    ['landmark', 'umphakatsiId'].forEach((f) => {
      if (rawBody[f] === null || rawBody[f] === '') updates[f] = null;
    });

    if (['regionId', 'inkhundlaId', 'umphakatsiId'].some((f) => updates[f] !== undefined)) {
      const pick = (f) => (updates[f] !== undefined ? updates[f] : address[f]);
      await checkLocation({ regionId: pick('regionId'), inkhundlaId: pick('inkhundlaId'), umphakatsiId: pick('umphakatsiId') });
    }
    if (data.isDefault === true && !address.isDefault) {
      await Address.update({ isDefault: false }, { where: { userId: user.id }, transaction });
      updates.isDefault = true;
    }
    await address.update(updates, { transaction });
    return toPublic(await findOwn(user, id, transaction));
  });
}

// ---------- PATCH /me/addresses/:id/default ----------
async function setDefault(user, id) {
  return sequelize.transaction(async (transaction) => {
    const address = await findOwn(user, id, transaction);
    if (!address.isDefault) {
      await Address.update({ isDefault: false }, { where: { userId: user.id }, transaction });
      await address.update({ isDefault: true }, { transaction });
    }
    return toPublic(await findOwn(user, id, transaction));
  });
}

// ---------- DELETE /me/addresses/:id   (soft delete) ----------
async function remove(user, id) {
  return sequelize.transaction(async (transaction) => {
    const address = await findOwn(user, id, transaction);
    const wasDefault = address.isDefault;
    await address.update({ isDefault: false }, { transaction });
    await address.destroy({ transaction }); // paranoid -> sets deleted_at

    let newDefault = null;
    if (wasDefault) {
      const next = await Address.findOne({
        where: { userId: user.id },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        transaction,
      });
      if (next) {
        await next.update({ isDefault: true }, { transaction });
        newDefault = toPublic(await findOwn(user, next.id, transaction));
      }
    }
    return { id: address.id, newDefault };
  });
}

module.exports = { list, getOne, create, update, setDefault, remove, toPublic, MAX_ADDRESSES };
