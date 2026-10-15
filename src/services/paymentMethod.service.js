// Bank & payment details of the logged-in user (every user type EXCEPT financial institutions).
//
// Rules
//   - Up to MAX_PAYMENT_METHODS per account; exactly one is "Primary" (the first one added).
//   - The full bank account number is stored ENCRYPTED and never sent back; the API shows "•••• 4821".
//     To change it, the user types the full number again.
//   - The same bank account / mobile money number can't be added twice to one account.
//   - Delete = SOFT delete. Deleting the primary one makes the oldest remaining one primary.
const { Op } = require('sequelize');
const { sequelize, PaymentMethod } = require('../models');
const ApiError = require('../utils/ApiError');
const { encrypt, fingerprint } = require('../utils/encryption');
const {
  PAYMENT_METHOD_USER_TYPES,
  PAYMENT_METHOD_TYPE_LABELS,
  BANK_ACCOUNT_TYPE_LABELS,
  MOBILE_MONEY_PROVIDER_LABELS,
  MAX_PAYMENT_METHODS,
} = require('../config/paymentMethods');

const BANK_FIELDS = ['bankName', 'accountNumber', 'accountType', 'branchCode'];
const MOBILE_FIELDS = ['provider', 'mobileNumber'];
const ORDER = [
  ['isPrimary', 'DESC'],
  ['createdAt', 'ASC'],
  ['id', 'ASC'],
];

const isAllowed = (userType) => PAYMENT_METHOD_USER_TYPES.includes(userType);

function assertAllowed(user) {
  if (!isAllowed(user.userType)) {
    throw new ApiError(403, 'Bank & payment details are not available for this account type', {
      code: 'NOT_AVAILABLE_FOR_USER_TYPE',
    });
  }
}

const notFound = () => new ApiError(404, 'Payment method not found', { code: 'PAYMENT_METHOD_NOT_FOUND' });
const validationError = (errors) => new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors });

// What the API returns (never the full account number)
function toPublic(pm) {
  const isBank = pm.methodType === 'bank_account';
  return {
    id: pm.id,
    methodType: pm.methodType,
    methodTypeLabel: PAYMENT_METHOD_TYPE_LABELS[pm.methodType],
    isPrimary: pm.isPrimary,
    label: pm.isPrimary ? 'Primary' : 'Secondary',
    accountHolderName: pm.accountHolderName,
    bankName: isBank ? pm.bankName : null,
    accountNumberMasked: isBank && pm.accountNumberLast4 ? `•••• ${pm.accountNumberLast4}` : null,
    accountType: isBank ? pm.accountType : null,
    accountTypeLabel: isBank && pm.accountType ? BANK_ACCOUNT_TYPE_LABELS[pm.accountType] : null,
    branchCode: isBank ? pm.branchCode : null,
    provider: isBank ? null : pm.provider,
    providerLabel: isBank ? null : MOBILE_MONEY_PROVIDER_LABELS[pm.provider] || pm.provider,
    mobileNumber: isBank ? null : pm.mobileNumber,
    createdAt: pm.createdAt,
    updatedAt: pm.updatedAt,
  };
}

// Encrypted number + last 4 digits + duplicate-check hash
const accountNumberValues = (accountNumber) => ({
  accountNumberEncrypted: encrypt(accountNumber),
  accountNumberLast4: accountNumber.slice(-4),
  accountNumberHash: fingerprint(accountNumber),
});

async function listFor(userId) {
  const rows = await PaymentMethod.findAll({ where: { userId }, order: ORDER });
  return rows.map(toPublic);
}

async function findOwn(user, id, transaction) {
  const pm = await PaymentMethod.findOne({ where: { id, userId: user.id }, transaction });
  if (!pm) throw notFound();
  return pm;
}

// Same bank account / mobile money number already on this account?
async function assertNotDuplicate(userId, { methodType, accountNumberHash, provider, mobileNumber }, excludeId, transaction) {
  const where = { userId, methodType, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) };
  if (methodType === 'bank_account') where.accountNumberHash = accountNumberHash;
  else Object.assign(where, { provider, mobileNumber });

  const existing = await PaymentMethod.findOne({ where, attributes: ['id'], transaction });
  if (existing) {
    const field = methodType === 'bank_account' ? 'accountNumber' : 'mobileNumber';
    const what = methodType === 'bank_account' ? 'bank account' : 'mobile money number';
    throw new ApiError(409, `This ${what} is already saved`, {
      code: 'DUPLICATE_VALUE',
      errors: [{ field, message: `This ${what} is already saved` }],
    });
  }
}

// Fields of the other payment type are a mistake -> clear message
function assertNoForeignFields(methodType, rawBody) {
  const foreign = methodType === 'bank_account' ? MOBILE_FIELDS : BANK_FIELDS;
  const label = PAYMENT_METHOD_TYPE_LABELS[methodType].toLowerCase();
  const errors = foreign
    .filter((f) => rawBody[f] !== undefined && rawBody[f] !== null && rawBody[f] !== '')
    .map((f) => ({ field: f, message: `${f} does not apply to a ${label}` }));
  if (errors.length) throw validationError(errors);
}

// ---------- GET /me/payment-methods ----------
async function list(user) {
  assertAllowed(user);
  return { items: await listFor(user.id), max: MAX_PAYMENT_METHODS };
}

// ---------- POST /me/payment-methods ----------
async function create(user, data, rawBody = {}) {
  assertAllowed(user);
  assertNoForeignFields(data.methodType, rawBody);

  const values = { userId: user.id, methodType: data.methodType, accountHolderName: data.accountHolderName };
  if (data.methodType === 'bank_account') {
    Object.assign(values, {
      bankName: data.bankName,
      accountType: data.accountType,
      branchCode: data.branchCode || null,
      ...accountNumberValues(data.accountNumber),
    });
  } else {
    Object.assign(values, { provider: data.provider, mobileNumber: data.mobileNumber });
  }

  return sequelize.transaction(async (transaction) => {
    const count = await PaymentMethod.count({ where: { userId: user.id }, transaction });
    if (count >= MAX_PAYMENT_METHODS) {
      throw new ApiError(409, `You can save up to ${MAX_PAYMENT_METHODS} payment methods. Remove one first.`, {
        code: 'LIMIT_REACHED',
      });
    }
    await assertNotDuplicate(user.id, values, null, transaction);

    // The first one is always primary; "makePrimary" moves primary to the new one
    const makePrimary = count === 0 || data.makePrimary === true;
    if (makePrimary && count > 0) {
      await PaymentMethod.update({ isPrimary: false }, { where: { userId: user.id }, transaction });
    }
    const pm = await PaymentMethod.create({ ...values, isPrimary: makePrimary }, { transaction });
    return toPublic(pm);
  });
}

// ---------- PUT /me/payment-methods/:id ----------
// The type (bank / mobile money) can't change: remove it and add a new one instead.
async function update(user, id, data, rawBody = {}) {
  assertAllowed(user);
  return sequelize.transaction(async (transaction) => {
    const pm = await findOwn(user, id, transaction);
    if (data.methodType && data.methodType !== pm.methodType) {
      throw validationError([
        { field: 'methodType', message: 'The payment type cannot be changed. Remove this one and add a new one.' },
      ]);
    }
    assertNoForeignFields(pm.methodType, rawBody);

    const updates = {};
    if (data.accountHolderName !== undefined) updates.accountHolderName = data.accountHolderName;
    if (pm.methodType === 'bank_account') {
      ['bankName', 'accountType', 'branchCode'].forEach((f) => {
        if (data[f] !== undefined) updates[f] = data[f];
      });
      if (rawBody.branchCode === null || rawBody.branchCode === '') updates.branchCode = null;
      if (data.accountNumber !== undefined) Object.assign(updates, accountNumberValues(data.accountNumber));
    } else {
      ['provider', 'mobileNumber'].forEach((f) => {
        if (data[f] !== undefined) updates[f] = data[f];
      });
    }

    const final = { methodType: pm.methodType, ...pm.get(), ...updates };
    if (updates.accountNumberHash || updates.provider || updates.mobileNumber) {
      await assertNotDuplicate(user.id, final, pm.id, transaction);
    }

    if (data.makePrimary === true && !pm.isPrimary) {
      await PaymentMethod.update({ isPrimary: false }, { where: { userId: user.id }, transaction });
      updates.isPrimary = true;
    }
    await pm.update(updates, { transaction });
    return toPublic(pm);
  });
}

// ---------- PATCH /me/payment-methods/:id/primary ----------
async function setPrimary(user, id) {
  assertAllowed(user);
  return sequelize.transaction(async (transaction) => {
    const pm = await findOwn(user, id, transaction);
    if (!pm.isPrimary) {
      await PaymentMethod.update({ isPrimary: false }, { where: { userId: user.id }, transaction });
      await pm.update({ isPrimary: true }, { transaction });
    }
    return toPublic(pm);
  });
}

// ---------- DELETE /me/payment-methods/:id   (soft delete) ----------
async function remove(user, id) {
  assertAllowed(user);
  return sequelize.transaction(async (transaction) => {
    const pm = await findOwn(user, id, transaction);
    const wasPrimary = pm.isPrimary;
    await pm.update({ isPrimary: false }, { transaction });
    await pm.destroy({ transaction }); // paranoid -> sets deleted_at

    let newPrimary = null;
    if (wasPrimary) {
      const next = await PaymentMethod.findOne({
        where: { userId: user.id },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        transaction,
      });
      if (next) {
        await next.update({ isPrimary: true }, { transaction });
        newPrimary = toPublic(next);
      }
    }
    return { id: pm.id, newPrimary };
  });
}

module.exports = { isAllowed, listFor, list, create, update, setPrimary, remove, toPublic };
