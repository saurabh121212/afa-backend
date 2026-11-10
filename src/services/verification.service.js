// VERIFICATION ("Verified Farmer / Trader / Service Provider / Buyer" badge).
//
// A user is VERIFIED when:
//   1. the AFA admin approved the account (status "approved"), AND
//   2. EVERY KYC document of their type is approved by the admin
//      (the documents that count for the account check: not the VAT certificate, not the
//       optional farmer / trader insurance)
// This is the same rule as the KYC part of the credit score.
//
// Approved but not verified (the admin can approve with documents still missing / pending):
//   - farmers, traders and logistics providers can have at most N live listings (Pending Review +
//     Active), N = admin setting "unverified_listing_limit" (default 3)
//   - no Verified badge on the marketplace / seller page
//   - GET /me/verification returns the banner "Your account setup is incomplete ..."
//
// users.kyc_verified_at keeps the result for the badge; it is updated with the credit score
// (after every document review / account status change, and by the daily check).
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const { USER_STATUS, USER_TYPE_LABELS } = require('../utils/constants');
const { getDocumentTypes, isAvailableFor, countsForKyc } = require('../config/documentTypes');
const { LISTING_STATUS, LISTING_KIND_BY_USER_TYPE } = require('../config/listingOptions');

const { User, UserDocument, Listing } = models;

const BADGES = {
  farmer: 'Verified Farmer',
  trader: 'Verified Trader',
  logistics: 'Verified Service Provider',
  buyer: 'Verified Buyer',
  financial_institution: 'Verified Institution',
};
// Listings that use a slot of the limit: waiting for review + live
const LIMITED_STATUSES = [LISTING_STATUS.PENDING, LISTING_STATUS.ACTIVE];
const DOC_STATUS_LABELS = { missing: 'Not uploaded', pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' };

// The KYC documents of a user type / subtype and their status (pure: used by the credit score too)
//   docs = UserDocument rows [{ documentType, status, rejectionReason }]
function kycDocumentsFor(userType, subtype, docs = []) {
  const byType = new Map(docs.map((d) => [d.documentType, d]));
  return Object.entries(getDocumentTypes(userType))
    .filter(([, rules]) => isAvailableFor(rules, subtype) && countsForKyc(rules))
    .map(([documentType, rules]) => {
      const d = byType.get(documentType);
      return {
        documentType,
        label: rules.label,
        status: d ? d.status : 'missing',
        rejectionReason: d && d.status === 'rejected' ? d.rejectionReason || null : null,
      };
    });
}

// Verified = account approved + every KYC document approved (a type with no KYC documents is never verified this way)
const isVerifiedFrom = (accountStatus, kycDocuments) =>
  accountStatus === USER_STATUS.APPROVED && kycDocuments.length > 0 && kycDocuments.every((d) => d.status === 'approved');

async function check(userId, { transaction } = {}) {
  const user = await User.findOne({ where: { id: userId }, attributes: ['id', 'userType', 'status'], transaction });
  if (!user) return null;
  const [dir, docs] = await Promise.all([
    directory.findOne(userId),
    UserDocument.findAll({ where: { userId }, attributes: ['documentType', 'status', 'rejectionReason'], transaction }),
  ]);
  const kycDocuments = kycDocumentsFor(user.userType, dir ? dir.subtype : null, docs);
  return { user, kycDocuments, isVerified: isVerifiedFrom(user.status, kycDocuments) };
}

const isSeller = (userType) => Boolean(LISTING_KIND_BY_USER_TYPE[userType]);
const listingLimit = async () => Number(await settings.get('unverified_listing_limit'));

async function listingSlots(userId, verified, { transaction, excludeListingId = null } = {}) {
  const used = await Listing.count({
    where: { userId, status: { [Op.in]: LIMITED_STATUSES }, ...(excludeListingId ? { id: { [Op.ne]: excludeListingId } } : {}) },
    transaction,
  });
  if (verified) return { limited: false, maxListings: null, used, remaining: null };
  const max = await listingLimit();
  return { limited: true, maxListings: max, used, remaining: Math.max(0, max - used) };
}

// ---------- GET /me/verification ----------
async function status(user) {
  const c = await check(user.id);
  const docs = c.kycDocuments;
  const done = docs.filter((d) => d.status === 'approved').length;
  const missing = docs.filter((d) => d.status === 'missing');
  const pending = docs.filter((d) => d.status === 'pending');
  const rejected = docs.filter((d) => d.status === 'rejected');
  const accountApproved = c.user.status === USER_STATUS.APPROVED;
  const seller = isSeller(c.user.userType);
  const limits = seller ? await listingSlots(user.id, c.isVerified) : null;
  const badge = BADGES[c.user.userType] || 'Verified';
  const typeWord = (USER_TYPE_LABELS[c.user.userType] || 'account').toLowerCase();

  // What the banner says (the first problem to fix)
  let message = null;
  if (!c.isVerified) {
    const parts = [];
    if (!accountApproved) parts.push('AFA is reviewing your account.');
    if (rejected.length) parts.push(`Upload again: ${rejected.map((d) => d.label).join(', ')}.`);
    if (missing.length) parts.push(`Upload: ${missing.map((d) => d.label).join(', ')}.`);
    if (pending.length) parts.push(`AFA is checking: ${pending.map((d) => d.label).join(', ')}.`);
    const gain = seller ? 'remove listing limits, ' : '';
    parts.push(`Complete your verification to ${gain}earn the ${badge} badge and build trust.`);
    message = parts.join(' ');
  }

  return {
    isVerified: c.isVerified,
    badge: c.isVerified ? badge : null,
    badgeLabel: badge,
    accountStatus: c.user.status,
    accountApproved,
    progress: { done, total: docs.length, percent: docs.length ? Math.round((done / docs.length) * 100) : 0, label: `${done} of ${docs.length} documents approved` },
    documents: docs.map((d) => ({ ...d, statusLabel: DOC_STATUS_LABELS[d.status] })),
    missing: missing.map((d) => d.documentType),
    pending: pending.map((d) => d.documentType),
    rejected: rejected.map((d) => d.documentType),
    limits,
    banner: c.isVerified
      ? { show: false }
      : {
          show: true,
          severity: rejected.length ? 'error' : 'warning',
          title: seller
            ? 'Your account setup is incomplete — complete your KYC to trade without limits'
            : `Your ${typeWord} account setup is incomplete — complete your KYC`,
          message,
          progressLabel: `${done} of ${docs.length} documents approved`,
          actionLabel: rejected.length || missing.length ? 'Complete Verification' : 'View Documents',
          action: 'documents', // open the documents screen (GET /me/documents)
        },
  };
}

// ---------- listing limit (called before a listing goes to Pending Review / Active) ----------
async function assertListingSlot(user, listing, transaction) {
  if (LIMITED_STATUSES.includes(listing.status)) return; // already uses a slot
  const c = await check(user.id, { transaction });
  if (!c || c.isVerified) return;
  const slots = await listingSlots(user.id, false, { transaction, excludeListingId: listing.id });
  if (slots.used >= slots.maxListings) {
    throw new ApiError(
      409,
      `Until your account is fully verified you can have ${slots.maxListings} listing${slots.maxListings === 1 ? '' : 's'} live or waiting for review. ` +
        'Complete your KYC documents to list without limits, or pause / delete another listing.',
      { code: 'LISTING_LIMIT_REACHED' }
    );
  }
}

// For GET /me/listings: { limited, maxListings, used, remaining }
async function listingLimitFor(user) {
  const c = await check(user.id);
  return listingSlots(user.id, Boolean(c && c.isVerified));
}

// Keep users.kyc_verified_at in step (called by the credit score refresh, inside its transaction)
async function syncFlag(userId, verified, { transaction } = {}) {
  const u = await User.findOne({ where: { id: userId }, attributes: ['id', 'kycVerifiedAt'], transaction });
  if (!u) return;
  if (verified && !u.kycVerifiedAt) await u.update({ kycVerifiedAt: new Date() }, { transaction });
  if (!verified && u.kycVerifiedAt) await u.update({ kycVerifiedAt: null }, { transaction });
}

module.exports = {
  BADGES,
  kycDocumentsFor,
  isVerifiedFrom,
  check,
  status,
  assertListingSlot,
  listingLimitFor,
  syncFlag,
};
