// Settings for product / service categories.
//
//   Main category -> parent_id is empty, has "appliesTo"
//   Sub-category  -> parent_id = its main category, uses the main category's "appliesTo"

// Which marketplace tab a main category shows in. "both" shows in both tabs.
const APPLIES_TO = ['product', 'service', 'both'];
const APPLIES_TO_LABELS = { product: 'Products', service: 'Services', both: 'Products & Services' };

// Letters, numbers, spaces and & ' ( ) . , / -     e.g. "Grains & Cereals", "Fruits (Fresh)"
const CATEGORY_NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}\s&'().,/-]*$/u;
const CATEGORY_NAME_MAX = 100;

// Category icon / image: public file, saved in uploads/public/categories/
const CATEGORY_ICON = {
  folder: 'categories',
  formats: ['png', 'jpg'], // SVG is not allowed: it can contain scripts
  maxSizeMB: 2,
};

// Max rows in one CSV import
const CATEGORY_IMPORT_MAX_ROWS = 5000;

module.exports = {
  APPLIES_TO,
  APPLIES_TO_LABELS,
  CATEGORY_NAME_RULE,
  CATEGORY_NAME_MAX,
  CATEGORY_ICON,
  CATEGORY_IMPORT_MAX_ROWS,
};
