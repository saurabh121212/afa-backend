// KYC documents each user type can upload (from the Figma "KYC / Documents" screens).
//
//   formats          -> allowed file kinds (see utils/fileTypes.js)
//   maxSizeMB        -> largest allowed file
//   required         -> false for all now: only registration Step 1 is mandatory
//   onlyForSubtypes  -> (optional) only these sub-types may upload it,
//                       e.g. buyer documents only for 'business' buyers.
//                       The user's sub-type comes from userTypes.registry.js (getSubtype).
//   countsForKyc     -> (optional) false = NOT part of the account check: it is not counted in
//                       "uploaded X of Y", "missing" or "Ready for approval".
//                       Used for the VAT certificate, which only VAT-registered sellers have.
//   hasExpiry        -> (optional) true = the user must give an expiry date (expiresAt, YYYY-MM-DD) when
//                       uploading; the admin can correct it when approving. Used for insurance.
//   creditScore      -> (optional) 'insurance' = this document gives the Insurance part of the credit score
//                       while it is approved and not expired (see config/creditScore.js)
//
// When Trader / Logistics / FI registration is built, add their list here.

// ERS VAT Registration Certificate: optional, only for VAT-registered sellers.
// The VAT reference is the seller's TIN; the admin checks the TIN on the certificate.
const VAT_CERTIFICATE = {
  label: 'VAT Registration Certificate',
  description:
    'VAT registration certificate issued by the Eswatini Revenue Service (ERS). Only needed if you are VAT-registered and want to sell VAT-applicable items',
  formats: ['jpg', 'png', 'pdf'],
  maxSizeMB: 5,
  required: false,
  countsForKyc: false,
};
const VAT_CERTIFICATE_TYPE = 'vat_certificate';

// Insurance documents: optional, not part of the account check, give 20 credit-score points while valid
const insurance = (label, description) => ({
  label,
  description,
  formats: ['jpg', 'png', 'pdf'],
  maxSizeMB: 5,
  required: false,
  countsForKyc: false,
  hasExpiry: true,
  creditScore: 'insurance',
});

const DOCUMENT_TYPES = {
  farmer: {
    national_id: {
      label: 'National ID / Passport',
      description: 'Upload a clear copy of your national ID card or passport (front side)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    proof_of_residence: {
      label: 'Proof of Residence',
      description:
        "A recent utility bill, chief's letter or council document confirming your address",
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    land_ownership: {
      label: 'Land Ownership / Lease Document',
      description:
        'Title deed, lease agreement or traditional land allocation letter (kukhonta)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 10,
      required: false,
    },
    passport_photo: {
      label: 'Passport-size Photo',
      description: 'A recent passport-size photo of yourself on a plain background',
      formats: ['jpg', 'png'],
      maxSizeMB: 2,
      required: false,
    },
    crop_insurance: insurance(
      'Crop Insurance Certificate',
      'A valid insurance policy or certificate covering any of your crops (with the expiry date)'
    ),
    [VAT_CERTIFICATE_TYPE]: VAT_CERTIFICATE,
  },

  buyer: {
    national_id: {
      label: 'National ID / Passport',
      description: 'A clear copy of your national ID card or passport',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    proof_of_delivery_address: {
      label: 'Proof of Delivery Address',
      description: 'A recent utility bill or council document confirming your address',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    business_registration: {
      label: 'Business Registration Certificate',
      description: 'Certificate of incorporation or business registration',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
      onlyForSubtypes: ['business'],
    },
    tax_clearance: {
      label: 'Tax Clearance Certificate',
      description: 'Valid tax clearance certificate from the Eswatini Revenue Service',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
      onlyForSubtypes: ['business'],
    },
  },
  trader: {
    business_registration: {
      label: 'Business Registration Certificate',
      description: 'Certificate of incorporation or business registration issued by the Registrar of Companies',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    trading_license: {
      label: 'Trading License Certificate',
      description: 'Valid trading license issued by the Ministry of Commerce or local council',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    tax_clearance: {
      label: 'Tax Clearance Certificate',
      description: 'Valid tax clearance certificate issued by the Eswatini Revenue Service (ERS)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    contact_person_id: {
      label: 'National ID of Contact Person',
      description: 'National ID or passport of the business owner or authorized contact person',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    proof_of_business_address: {
      label: 'Proof of Business Address',
      description: 'A recent utility bill, lease agreement or council document confirming business address',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    business_insurance: insurance(
      'Business / Stock Insurance Certificate',
      'A valid insurance policy or certificate covering your business or stock (with the expiry date)'
    ),
    [VAT_CERTIFICATE_TYPE]: VAT_CERTIFICATE,
  },
  logistics: {
    business_registration: {
      label: 'Business Registration Certificate',
      description: 'Certificate of incorporation or business registration issued by the Registrar of Companies',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    trading_license: {
      label: 'Trading License Certificate',
      description: 'Valid trading license issued by the Ministry of Commerce or local council',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    tax_clearance: {
      label: 'Tax Clearance Certificate',
      description: 'Valid tax clearance certificate issued by the Eswatini Revenue Service (ERS)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    contact_person_id: {
      label: 'National ID of Contact Person',
      description: 'National ID or passport of the business owner or authorized contact person',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    vehicle_insurance_roadworthy: {
      label: 'Vehicle Insurance & Roadworthy Certificate',
      description: 'Valid insurance and roadworthy certificate for vehicles used to provide transport services (with the insurance expiry date)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
      hasExpiry: true, // still part of the account check (unlike the farmer / trader insurance)
      creditScore: 'insurance',
    },
    [VAT_CERTIFICATE_TYPE]: VAT_CERTIFICATE,
  },
  financial_institution: {
    institution_registration: {
      label: 'Institution Registration Certificate',
      description: 'Certificate of incorporation or institution registration issued by the Registrar of Companies',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    regulatory_license: {
      label: 'Regulatory License Certificate',
      description: 'Valid operating license issued by the Central Bank of Eswatini or FSRA',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    tax_clearance: {
      label: 'Tax Clearance Certificate',
      description: 'Valid tax clearance certificate issued by the Eswatini Revenue Service (ERS)',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    contact_person_id: {
      label: 'National ID of Contact Person',
      description: 'National ID or passport of the authorized institutional representative',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
    proof_of_institution_address: {
      label: 'Proof of Institution Address',
      description: 'A recent utility bill, lease agreement or council document confirming institution address',
      formats: ['jpg', 'png', 'pdf'],
      maxSizeMB: 5,
      required: false,
    },
  },
};

// All document types for a user type ({} if none defined yet)
const getDocumentTypes = (userType) => DOCUMENT_TYPES[userType] || {};

// One document type's rules, or null
const getDocumentType = (userType, documentType) =>
  getDocumentTypes(userType)[documentType] || null;

// Can a user with this sub-type (e.g. 'individual') upload this document?
const isAvailableFor = (rules, subtype) =>
  !rules.onlyForSubtypes || rules.onlyForSubtypes.includes(subtype);

// Document types a sub-type is NOT allowed to have (used when a buyer switches to individual)
const notAvailableFor = (userType, subtype) =>
  Object.entries(getDocumentTypes(userType))
    .filter(([, rules]) => !isAvailableFor(rules, subtype))
    .map(([documentType]) => documentType);

// Is this document part of the account (KYC) check? (false for the VAT certificate and farmer / trader insurance)
const countsForKyc = (rules) => rules.countsForKyc !== false;

// Does this document need an expiry date? (insurance)
const hasExpiry = (rules) => Boolean(rules && rules.hasExpiry);

module.exports = {
  getDocumentTypes,
  getDocumentType,
  isAvailableFor,
  notAvailableFor,
  countsForKyc,
  hasExpiry,
  VAT_CERTIFICATE_TYPE,
};
