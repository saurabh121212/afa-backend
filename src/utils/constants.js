// Fixed lists used by migrations, models, validators and services.
// Change a list here and it changes everywhere.

const USER_TYPES = ['farmer', 'buyer', 'trader', 'logistics', 'financial_institution'];

// Friendly names (used in emails and messages)
const USER_TYPE_LABELS = {
  farmer: 'Farmer',
  buyer: 'Buyer / Food Processor',
  trader: 'Trader',
  logistics: 'Logistics Provider',
  financial_institution: 'Financial Institution',
};

const USER_STATUS = {
  PENDING_VERIFICATION: 'pending_verification', // step 1 saved, registration not submitted yet
  PENDING_APPROVAL: 'pending_approval', // submitted, waiting for the admin
  APPROVED: 'approved', // can log in
  REJECTED: 'rejected', // admin rejected the registration (final)
  SUSPENDED: 'suspended', // admin blocked the account
};

// Friendly status names (admin lists, CSV export)
const USER_STATUS_LABELS = {
  pending_verification: 'Registration Incomplete',
  pending_approval: 'Pending Review',
  approved: 'Active',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

// Short code per user type, used in display ids like "AFA-LP-00567"
const USER_TYPE_CODES = {
  farmer: 'FM',
  buyer: 'BY',
  trader: 'TR',
  logistics: 'LP',
  financial_institution: 'FI',
};

// Admin approval
const KYC_URGENT_AFTER_DAYS = 3; // KYC queue: waiting longer than this = "Urgent"
const DOCUMENT_STATUS = ['pending', 'approved', 'rejected'];
// Eswatini time (UTC+2, no daylight saving) - used for "today" counts
const BUSINESS_UTC_OFFSET_MINUTES = 120;

const GENDERS = ['male', 'female'];

// Farmer Registration - Step 2 dropdowns (from Figma)
const LAND_OWNERSHIP_TYPES = ['owned', 'leased', 'community', 'other'];
const FARMING_ACTIVITIES = ['crop', 'livestock', 'mixed', 'other'];
const FARMING_SEASONS = ['summer', 'winter', 'all_year'];

// Buyer Registration - Step 1 "I am registering as" (from Figma)
const BUYER_TYPES = ['individual', 'business'];
const BUYER_TYPE_LABELS = {
  individual: 'Individual Buyer',
  business: 'Business / Food Processor',
};

// Business dropdowns (Trader Registration Steps 1-2 in Figma; reusable for Logistics / FI)
const BUSINESS_TYPES = ['sole_proprietor', 'partnership', 'company', 'cooperative'];
const DESIGNATIONS = ['owner', 'director', 'manager', 'partner', 'authorized_representative', 'other'];
const LICENSE_ISSUING_AUTHORITIES = ['ministry_of_commerce', 'ers', 'local_council'];

// Trader Registration Step 1 "Business Category"
const TRADER_BUSINESS_CATEGORIES = ['produce', 'fertilizers_inputs', 'equipment', 'mixed'];

// Logistics Provider Registration Step 1 "Service Type" and "Designation / Role"
const LOGISTICS_SERVICE_TYPES = ['transport', 'warehousing', 'equipment_rental', 'mixed'];
const LOGISTICS_DESIGNATIONS = [
  'owner',
  'director',
  'fleet_manager',
  'manager',
  'partner',
  'authorized_representative',
  'other',
];

// Financial Institution Registration Steps 1-2 dropdowns
const FI_INSTITUTION_TYPES = ['commercial_bank', 'microfinance', 'insurance', 'sacco'];
const FI_PRODUCT_TYPES = ['loans', 'insurance', 'both'];
const FI_DESIGNATIONS = [
  'branch_manager',
  'credit_officer',
  'director',
  'manager',
  'authorized_representative',
  'other',
];
const FI_REGULATORY_BODIES = ['central_bank_of_eswatini', 'fsra', 'other'];

const LOCATION_TYPES = ['region', 'inkhundla', 'umphakatsi'];

const OTP_PURPOSES = {
  REGISTRATION: 'registration',
  PASSWORD_RESET: 'password_reset',
};

module.exports = {
  USER_TYPES,
  USER_TYPE_LABELS,
  USER_STATUS,
  USER_STATUS_LABELS,
  USER_TYPE_CODES,
  KYC_URGENT_AFTER_DAYS,
  DOCUMENT_STATUS,
  BUSINESS_UTC_OFFSET_MINUTES,
  GENDERS,
  LAND_OWNERSHIP_TYPES,
  FARMING_ACTIVITIES,
  FARMING_SEASONS,
  BUYER_TYPES,
  BUYER_TYPE_LABELS,
  BUSINESS_TYPES,
  DESIGNATIONS,
  LICENSE_ISSUING_AUTHORITIES,
  TRADER_BUSINESS_CATEGORIES,
  LOGISTICS_SERVICE_TYPES,
  LOGISTICS_DESIGNATIONS,
  FI_INSTITUTION_TYPES,
  FI_PRODUCT_TYPES,
  FI_DESIGNATIONS,
  FI_REGULATORY_BODIES,
  LOCATION_TYPES,
  OTP_PURPOSES,
};
