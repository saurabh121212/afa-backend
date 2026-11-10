// CREDIT SCORE (scope: "automatic credit creation by system based on registration and transactions").
// Used in phase 2 for loans, so every change is logged (credit_score_changes) and the formula has a version.
//
// Who: farmers, traders and logistics (service) providers.
// Score = 5 parts x 20 points = 100. Each part is worked out from data only (no manual override):
//
//   1. KYC          20 if the account is APPROVED and EVERY KYC document of the user's type is approved
//                   by the admin, else 0 (yes / no). The VAT certificate and insurance don't count here.
//   2. Sales        20 x success rate. Successful = completed seller orders / bookings with no refunded claim.
//                   Failed = paid orders cancelled by the seller or by the system (not confirmed in time),
//                   and orders with a claim refunded to the buyer. Buyer / admin cancellations don't count.
//                   No finished orders yet -> 0.
//   3. Loans        0 until the Financial Institution module records loans (phase 2).
//   4. Insurance    20 if the user has an APPROVED insurance document of their type that has not expired
//                   (farmer: crop insurance, trader: business / stock insurance, logistics: vehicle insurance).
//   5. Rating       20 x (average stars / 5) of published reviews. No reviews -> 0.
//
// Parts are rounded to 1 decimal; the total is the sum rounded to a whole number.
// Grade: 80-100 Excellent, 60-79 Good, 40-59 Fair, 0-39 Building.

const FORMULA_VERSION = 1;
const SCORED_USER_TYPES = ['farmer', 'trader', 'logistics'];
const PART_MAX = 20;
const MAX_SCORE = 100;

const PARTS = {
  kyc: { label: 'KYC Verification', max: PART_MAX },
  sales: { label: 'Successful Sales', max: PART_MAX },
  loans: { label: 'Loan Repayment', max: PART_MAX },
  insurance: { label: 'Insurance', max: PART_MAX },
  rating: { label: 'Buyer Rating', max: PART_MAX },
};
const PART_KEYS = Object.keys(PARTS);

// Part status shown to the user
const PART_STATUS = {
  full: 'Full points',
  partial: 'Partial points',
  none: 'No points yet',
  not_available: 'Not available yet',
};

// Lowest score for each grade (checked from the top)
const GRADES = [
  { key: 'excellent', label: 'Excellent', min: 80 },
  { key: 'good', label: 'Good', min: 60 },
  { key: 'fair', label: 'Fair', min: 40 },
  { key: 'building', label: 'Building', min: 0 },
];
const gradeOf = (score) => GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1];

// The insurance document that counts for each user type (needs an expiry date)
const INSURANCE_DOCUMENT = {
  farmer: 'crop_insurance',
  trader: 'business_insurance',
  logistics: 'vehicle_insurance_roadworthy',
};

// Seller order cancellations that count as the seller's failure
const FAILED_CANCELLED_BY = ['seller', 'system'];

// What caused a recalculation (stored in the change log)
const TRIGGERS = {
  first: 'First calculation',
  account_status: 'Account status changed',
  document_change: 'Document uploaded or removed',
  document_review: 'Document approved or rejected',
  order_completed: 'Order completed',
  order_cancelled: 'Order cancelled',
  claim_refund: 'Claim refunded to the buyer',
  rating: 'Rating changed',
  daily: 'Daily check',
  admin: 'Recalculated by the admin',
};

const RULES = {
  refreshDelayMs: 3000, // several events close together -> one recalculation
  staleHours: 24, // the daily check recalculates scores older than this
  dailyBatch: 200, // users per job run (the job runs every minute)
  historyMonths: 12,
};

const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;

module.exports = {
  FORMULA_VERSION,
  SCORED_USER_TYPES,
  PART_MAX,
  MAX_SCORE,
  PARTS,
  PART_KEYS,
  PART_STATUS,
  GRADES,
  gradeOf,
  INSURANCE_DOCUMENT,
  FAILED_CANCELLED_BY,
  TRIGGERS,
  RULES,
  round1,
};
