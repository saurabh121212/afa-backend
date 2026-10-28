// Seller VAT registration (farmer, trader, logistics).
//
// The VAT reference is the seller's TIN (given at registration). The proof is the
// "vat_certificate" KYC document. Flow:
//
//   none ──(seller: "I am VAT-registered", certificate uploaded)──> pending
//   pending ──(admin approves, task 6)──> approved        pending ──(admin rejects)──> rejected
//   approved / rejected ──(seller uploads a NEW certificate)──> pending   (needs a fresh review)
//   any ──(seller: "I am not VAT-registered" or deletes the certificate)──> none
//
// Every status change goes through changeStatus(), so later steps (hiding VAT listings,
// emails) only need to hook in there.
const { sequelize, User, UserDocument } = require('../models');
const ApiError = require('../utils/ApiError');
const { VAT_STATUS, VAT_STATUS_LABELS, VAT_SELLER_TYPES } = require('../config/vat');
const { VAT_CERTIFICATE_TYPE } = require('../config/documentTypes');
const vatHold = require('./vatHold.service');
const vatNotify = require('./vatNotify.service');

const isSellerType = (userType) => VAT_SELLER_TYPES.includes(userType);

function ensureSeller(user) {
  if (!isSellerType(user.userType)) {
    throw new ApiError(403, 'VAT registration is only for farmers, traders and logistics providers', {
      code: 'NOT_A_SELLER',
    });
  }
}

const findCertificate = (userId, transaction) =>
  UserDocument.findOne({ where: { userId, documentType: VAT_CERTIFICATE_TYPE }, transaction });

// What the seller (and the admin) sees about VAT
function vatInfo(user, certificate) {
  const status = user.vatStatus || VAT_STATUS.NONE;
  const cert = certificate
    ? {
        status: certificate.status, // pending | approved | rejected
        uploadedAt: certificate.updatedAt,
        rejectionReason: certificate.rejectionReason || null,
      }
    : null;

  let nextStep = null;
  if (status === VAT_STATUS.NONE || status === VAT_STATUS.REJECTED) {
    if (!cert) nextStep = 'Upload your VAT Registration Certificate, then switch on "I am VAT-registered"';
    else if (cert.status === 'rejected') nextStep = 'Your certificate was rejected. Upload a new one';
    else if (status === VAT_STATUS.NONE) nextStep = 'Switch on "I am VAT-registered" to send it for review';
  } else if (status === VAT_STATUS.PENDING) {
    nextStep = 'Waiting for the AFA team to check your certificate';
  }

  return {
    status,
    statusLabel: VAT_STATUS_LABELS[status],
    isVatRegistered: status === VAT_STATUS.APPROVED, // may list VAT-applicable items
    reason: user.vatStatusReason || null, // admin's reason (rejected / removed)
    requestedAt: user.vatRequestedAt || null,
    reviewedAt: user.vatReviewedAt || null,
    certificate: cert,
    canApply:
      (status === VAT_STATUS.NONE || status === VAT_STATUS.REJECTED) && Boolean(cert) && cert.status !== 'rejected',
    canWithdraw: status !== VAT_STATUS.NONE,
    nextStep,
  };
}

// The ONE place a seller's VAT status changes. Returns { user, from, to, holds }.
//   values -> extra columns (reason, dates, reviewer)
//   holds  -> listings hidden / shown again because of the change (VAT categories only)
async function changeStatus(user, to, values = {}, { transaction } = {}) {
  const from = user.vatStatus || VAT_STATUS.NONE;
  await user.update({ vatStatus: to, ...values }, { transaction });
  // Only "approved" lets a seller sell VAT items: re-check when entering or leaving it
  const holds =
    from !== to && (from === VAT_STATUS.APPROVED || to === VAT_STATUS.APPROVED)
      ? await vatHold.forSeller(user.id, { transaction })
      : { hidden: [], shown: [] };
  return { user, from, to, holds };
}

// Run a VAT change in a transaction, THEN tell the seller about hidden / shown listings
// (only after the change is saved). fn returns { change, ...anything }.
async function runChange(fn) {
  const out = await sequelize.transaction(fn);
  if (out && out.change) vatNotify.afterStatusChange(out.change); // emails, in the background
  return out;
}

const holdCounts = (change) => ({
  listingsHidden: change && change.holds ? change.holds.hidden.length : 0,
  listingsShown: change && change.holds ? change.holds.shown.length : 0,
});

// Reload the user row with a lock, so two requests can't change VAT at the same time
const lockUser = (id, transaction) => User.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });

// ---------- GET /me/vat ----------
async function getMine(user) {
  ensureSeller(user);
  const [fresh, certificate] = await Promise.all([User.findByPk(user.id), findCertificate(user.id)]);
  return vatInfo(fresh, certificate);
}

// For GET /me/profile and the admin user details (null for buyers / FIs)
async function infoFor(user) {
  if (!isSellerType(user.userType)) return null;
  return vatInfo(user, await findCertificate(user.id));
}

// ---------- POST /me/vat ----------  "I am VAT-registered"
async function apply(user) {
  ensureSeller(user);
  const { info } = await runChange(async (transaction) => {
    const fresh = await lockUser(user.id, transaction);
    const status = fresh.vatStatus;
    if (status === VAT_STATUS.PENDING) {
      throw new ApiError(409, 'Your VAT registration is already waiting for review', { code: 'VAT_ALREADY_PENDING' });
    }
    if (status === VAT_STATUS.APPROVED) {
      throw new ApiError(409, 'You are already VAT-registered', { code: 'VAT_ALREADY_APPROVED' });
    }

    const certificate = await findCertificate(user.id, transaction);
    if (!certificate) {
      throw new ApiError(422, 'Upload your VAT Registration Certificate first', {
        code: 'VAT_CERTIFICATE_REQUIRED',
        errors: [{ field: VAT_CERTIFICATE_TYPE, message: 'VAT Registration Certificate is required' }],
      });
    }
    if (certificate.status === 'rejected') {
      throw new ApiError(422, 'Your VAT certificate was rejected. Upload a new one first', {
        code: 'VAT_CERTIFICATE_REJECTED',
        errors: [{ field: VAT_CERTIFICATE_TYPE, message: certificate.rejectionReason || 'Certificate rejected' }],
      });
    }

    const change = await changeStatus(
      fresh,
      VAT_STATUS.PENDING,
      { vatRequestedAt: new Date(), vatStatusReason: null, vatReviewedAt: null, vatReviewedBy: null },
      { transaction }
    );
    return { change, info: vatInfo(fresh, certificate) };
  });
  return info;
}

// ---------- DELETE /me/vat ----------  "I am not VAT-registered (any more)"
async function withdraw(user) {
  ensureSeller(user);
  const { info, change } = await runChange(async (transaction) => {
    const fresh = await lockUser(user.id, transaction);
    if (fresh.vatStatus === VAT_STATUS.NONE) {
      throw new ApiError(409, 'You are not VAT-registered on AFA', { code: 'VAT_NOT_REGISTERED' });
    }
    const c = await changeStatus(
      fresh,
      VAT_STATUS.NONE,
      { vatStatusReason: null, vatRequestedAt: null, vatReviewedAt: null, vatReviewedBy: null },
      { transaction }
    );
    return { change: c, info: vatInfo(fresh, await findCertificate(user.id, transaction)) };
  });
  return { ...info, ...holdCounts(change) }; // listingsHidden = VAT listings now hidden
}

// ---------- hooks from document.service ----------

// A new / replaced certificate: an approved or rejected seller goes back to "pending"
// (the new file needs a fresh review). "none" stays none until the seller switches it on.
// Note: an approved seller's VAT listings are hidden until the new certificate is approved.
async function onCertificateUploaded(userId) {
  const { change } = await runChange(async (transaction) => {
    const user = await lockUser(userId, transaction);
    if (!user || !isSellerType(user.userType)) return { change: null };
    if (user.vatStatus !== VAT_STATUS.APPROVED && user.vatStatus !== VAT_STATUS.REJECTED) return { change: null };
    const c = await changeStatus(
      user,
      VAT_STATUS.PENDING,
      { vatRequestedAt: new Date(), vatStatusReason: null, vatReviewedAt: null, vatReviewedBy: null },
      { transaction }
    );
    return { change: c };
  });
  return change;
}

// Certificate deleted: no proof any more -> not VAT-registered
async function onCertificateRemoved(userId) {
  const { change } = await runChange(async (transaction) => {
    const user = await lockUser(userId, transaction);
    if (!user || !isSellerType(user.userType) || user.vatStatus === VAT_STATUS.NONE) return { change: null };
    const c = await changeStatus(
      user,
      VAT_STATUS.NONE,
      { vatStatusReason: 'VAT certificate was removed', vatReviewedAt: null, vatReviewedBy: null },
      { transaction }
    );
    return { change: c };
  });
  return change;
}

module.exports = {
  runChange,
  holdCounts,
  isSellerType,
  vatInfo,
  changeStatus,
  getMine,
  infoFor,
  apply,
  withdraw,
  onCertificateUploaded,
  onCertificateRemoved,
};
