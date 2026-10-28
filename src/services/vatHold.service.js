// VAT hold: listings in a VAT-applicable category whose seller is NOT VAT-approved are hidden
// from the website (vat_hold = true). The listing's own status is not touched, so when the
// problem is fixed the listing simply shows again.
//
// Re-checked when:
//   - a seller's VAT status changes            (vat.service changeStatus)
//   - an admin changes a category's VAT setting (adminCategory.service update)
//   - a seller edits a listing / admin changes a listing's status
//
// recompute() returns which listings were newly hidden / shown, so emails can tell the seller.
const { Op } = require('sequelize');
const { Listing, Category, User } = require('../models');
const { isVatApplicable } = require('./category.service');
const { VAT_STATUS } = require('../config/vat');
const { LISTING_STATUS } = require('../config/listingOptions');

// Final VAT answer for a listing: the sub-category's (it may override) or the main category's.
//   override -> { [categoryId]: vatApplicable } to test a change before saving it (preview)
function listingIsVat(category, subCategory, override = {}) {
  if (!category) return false;
  const withOverride = (c) =>
    c && Object.prototype.hasOwnProperty.call(override, c.id)
      ? { id: c.id, parentId: c.parentId, vatApplicable: override[c.id] }
      : c;
  const main = withOverride(category);
  const sub = withOverride(subCategory);
  return sub ? isVatApplicable(sub, main) : isVatApplicable(main);
}

const needsHold = (listing, override) =>
  listingIsVat(listing.category, listing.subCategory, override) &&
  (!listing.seller || listing.seller.vatStatus !== VAT_STATUS.APPROVED);

const includes = () => [
  { model: Category, as: 'category', attributes: ['id', 'name', 'parentId', 'vatApplicable'] },
  { model: Category, as: 'subCategory', attributes: ['id', 'name', 'parentId', 'vatApplicable'] },
  { model: User, as: 'seller', attributes: ['id', 'userType', 'email', 'vatStatus'] },
];

const summary = (l) => ({ id: l.id, userId: l.userId, name: l.name, status: l.status });

// Listings that point to a category (as main or sub-category)
const categoryScope = (categoryId) => ({ [Op.or]: [{ categoryId }, { subCategoryId: categoryId }] });

// Re-check the hold flag of every listing matching "where" (deleted listings are skipped).
// Returns { hidden: [...], shown: [...] } - only listings whose flag changed.
async function recompute(where, { transaction } = {}) {
  const listings = await Listing.findAll({
    where,
    attributes: ['id', 'userId', 'name', 'status', 'categoryId', 'subCategoryId', 'vatHold'],
    include: includes(),
    transaction,
  });
  const hidden = [];
  const shown = [];
  listings.forEach((l) => {
    const need = needsHold(l);
    if (need && !l.vatHold) hidden.push(l);
    else if (!need && l.vatHold) shown.push(l);
  });
  if (hidden.length) {
    await Listing.update({ vatHold: true, vatHoldAt: new Date() }, { where: { id: hidden.map((l) => l.id) }, transaction });
  }
  if (shown.length) {
    await Listing.update({ vatHold: false, vatHoldAt: null }, { where: { id: shown.map((l) => l.id) }, transaction });
  }
  return { hidden: hidden.map(summary), shown: shown.map(summary) };
}

const forSeller = (userId, options) => recompute({ userId }, options);
const forCategory = (categoryId, options) => recompute(categoryScope(categoryId), options);
const forListing = (id, options) => recompute({ id }, options);

// What WOULD happen if the category's VAT setting changed to "vatApplicable" (nothing is saved).
// Counts live (active) listings only - those are the ones buyers would stop seeing.
async function previewCategory(categoryId, vatApplicable) {
  const listings = await Listing.findAll({
    where: { ...categoryScope(categoryId), status: LISTING_STATUS.ACTIVE },
    attributes: ['id', 'userId', 'name', 'status', 'categoryId', 'subCategoryId', 'vatHold'],
    include: includes(),
  });
  const override = { [categoryId]: vatApplicable };
  const wouldHide = listings.filter((l) => !l.vatHold && needsHold(l, override));
  const wouldShow = listings.filter((l) => l.vatHold && !needsHold(l, override));
  return {
    liveListings: listings.length,
    wouldHide: wouldHide.length,
    wouldShow: wouldShow.length,
    sellersAffected: new Set(wouldHide.map((l) => l.userId)).size,
  };
}

// Group a recompute() result per seller (for emails): Map(userId -> { hidden: [], shown: [] })
function bySeller({ hidden = [], shown = [] }) {
  const map = new Map();
  const add = (key, l) => {
    if (!map.has(l.userId)) map.set(l.userId, { hidden: [], shown: [] });
    map.get(l.userId)[key].push(l);
  };
  hidden.forEach((l) => add('hidden', l));
  shown.forEach((l) => add('shown', l));
  return map;
}

module.exports = { listingIsVat, recompute, forSeller, forCategory, forListing, previewCategory, bySeller };
