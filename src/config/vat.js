// VAT registration of sellers (Eswatini).
//
// The seller's VAT reference is the TIN they gave at registration (ERS uses one TIN for
// all taxes). The proof is the ERS "VAT Registration Certificate" (KYC document
// "vat_certificate"). Only an admin-approved seller may list items in a VAT category.
//
// The VAT rate and "VAT on delivery fee" are System Settings (config/settings.js).

const VAT_STATUS = {
  NONE: 'none', // not VAT-registered (default)
  PENDING: 'pending', // seller asked, waiting for the admin
  APPROVED: 'approved', // admin checked the certificate
  REJECTED: 'rejected', // admin rejected / removed it (reason saved)
};

const VAT_STATUS_LABELS = {
  none: 'Not VAT-registered',
  pending: 'Pending Review',
  approved: 'VAT-registered',
  rejected: 'Rejected',
};

// User types that sell, and so can register for VAT
const VAT_SELLER_TYPES = ['farmer', 'trader', 'logistics'];

module.exports = { VAT_STATUS, VAT_STATUS_LABELS, VAT_SELLER_TYPES };
