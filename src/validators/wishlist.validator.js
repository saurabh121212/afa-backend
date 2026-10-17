// Validation for the wishlist (/me/wishlist), public seller pages (/sellers) and related listings.
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { publicList } = require('./listing.validator');

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
    .toInt(),
];

// GET /me/wishlist
const list = [...paging];

// POST /me/wishlist   { listingId }
const add = [
  body('listingId')
    .exists({ values: 'falsy' })
    .withMessage('listingId is required')
    .bail()
    .isInt({ min: 1 })
    .withMessage('listingId must be a positive number')
    .toInt(),
];

// DELETE /me/wishlist/:listingId
const remove = [param('listingId').isInt({ min: 1 }).withMessage('listingId must be a positive number').toInt()];

// GET /sellers/:id
const sellerId = [param('id').isInt({ min: 1 }).withMessage('Seller id must be a positive number').toInt()];

// GET /sellers/:id/listings  (same filters as GET /listings; the seller comes from the URL)
const sellerListings = [...sellerId, ...publicList];

// GET /listings/:id/related?limit=
const related = [
  param('id').isInt({ min: 1 }).withMessage('Listing id must be a positive number').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 20 }).withMessage('limit must be between 1 and 20').toInt(),
];

module.exports = { list, add, remove, sellerId, sellerListings, related };
