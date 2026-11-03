// System Settings the admin can change (GET / PUT /admin/settings).
//
// The values below are the DEFAULTS. The "settings" table only holds a row when the
// admin has changed a value, so a fresh database works without a seeder.
//
//   type      -> number | boolean | text   (used for validation)
//   maxLength / pattern -> rules for text (an empty text = not set)
//   min / max -> allowed range for numbers
//   decimals  -> most decimal places allowed (0 = whole numbers only)
//   unit      -> shown next to the field (%, minutes, hours, days)

const SETTINGS = {
  vat_rate: {
    label: 'VAT Rate (%)',
    description: 'Standard VAT rate in Eswatini, added to VAT-applicable items',
    group: 'tax',
    type: 'number',
    default: 15,
    min: 0,
    max: 100,
    decimals: 2,
    unit: '%',
  },
  vat_on_delivery_fee: {
    label: 'Charge VAT on Delivery Fee',
    description: 'Add VAT to the delivery fee when the seller is VAT-registered (confirm with your tax advisor)',
    group: 'tax',
    type: 'boolean',
    default: true,
  },
  payment_time_limit_minutes: {
    label: 'Online Payment Time Limit (minutes)',
    description: 'An order paid online that is not paid within this time is cancelled and the stock goes back',
    group: 'orders',
    type: 'number',
    default: 30,
    min: 5,
    max: 1440,
    decimals: 0,
    unit: 'minutes',
  },
  bank_transfer_time_limit_hours: {
    label: 'Bank Transfer Time Limit (hours)',
    description: 'Time the buyer has to pay by bank transfer and upload the proof of payment. After it the order is cancelled and the stock goes back (never while a proof is being reviewed)',
    group: 'orders',
    type: 'number',
    default: 48,
    min: 1,
    max: 336,
    decimals: 0,
    unit: 'hours',
  },
  seller_confirm_hours: {
    label: 'Seller Response Time (hours)',
    description: 'A paid order not confirmed by the seller within this time is shown as "Late" to the admin',
    group: 'orders',
    type: 'number',
    default: 24,
    min: 1,
    max: 168,
    decimals: 0,
    unit: 'hours',
  },

  // Cancellations, claims and refunds (Phase 4)
  seller_auto_cancel_hours: {
    label: 'Auto-cancel Unconfirmed Orders (hours)',
    description: 'A paid order the seller has not confirmed within this time (from payment) is cancelled automatically and the buyer gets a full refund',
    group: 'refunds',
    type: 'number',
    default: 48,
    min: 2,
    max: 336,
    decimals: 0,
    unit: 'hours',
  },
  cancel_request_response_hours: {
    label: 'Seller Time to Answer a Cancellation Request (hours)',
    description: 'If the seller does not accept or decline a buyer\'s cancellation request in this time, it goes to the AFA team',
    group: 'refunds',
    type: 'number',
    default: 24,
    min: 1,
    max: 168,
    decimals: 0,
    unit: 'hours',
  },
  claim_response_hours: {
    label: 'Seller Time to Reply to a Claim (hours)',
    description: 'If the seller does not reply to a claim (or confirm a returned item) in this time, it goes to the AFA team',
    group: 'refunds',
    type: 'number',
    default: 48,
    min: 1,
    max: 336,
    decimals: 0,
    unit: 'hours',
  },
  claim_escalate_hours: {
    label: 'Buyer Time to Escalate a Rejected Claim (hours)',
    description: 'After the seller rejects a claim, the buyer can send it to the AFA team within this time. After it the claim is closed',
    group: 'refunds',
    type: 'number',
    default: 48,
    min: 1,
    max: 336,
    decimals: 0,
    unit: 'hours',
  },
  refund_processing_days: {
    label: 'Refund Processing Time (days)',
    description: 'Target time for the AFA team to pay a refund. Refunds past it are shown as overdue',
    group: 'refunds',
    type: 'number',
    default: 7,
    min: 1,
    max: 60,
    decimals: 0,
    unit: 'days',
  },

  // AFA bank account shown to buyers who pay by bank transfer. Empty account number = bank transfer is not offered.
  afa_bank_name: {
    label: 'Bank Name',
    description: 'e.g. First National Bank Eswatini',
    group: 'bank',
    type: 'text',
    default: '',
    maxLength: 100,
  },
  afa_bank_account_name: {
    label: 'Account Holder',
    description: 'Name on the AFA bank account',
    group: 'bank',
    type: 'text',
    default: '',
    maxLength: 150,
  },
  afa_bank_account_number: {
    label: 'Account Number',
    description: 'AFA account number buyers pay into (digits only)',
    group: 'bank',
    type: 'text',
    default: '',
    maxLength: 30,
    pattern: '^[0-9]{6,20}$',
    patternMessage: 'Account number must be 6-20 digits',
  },
  afa_bank_branch_code: {
    label: 'Branch Code',
    description: 'Branch / sort code',
    group: 'bank',
    type: 'text',
    default: '',
    maxLength: 20,
    pattern: '^[0-9A-Za-z]{3,20}$',
    patternMessage: 'Branch code must be 3-20 letters or digits',
  },
  afa_bank_swift_code: {
    label: 'SWIFT Code (optional)',
    description: 'Only needed for payments from outside Eswatini',
    group: 'bank',
    type: 'text',
    default: '',
    maxLength: 11,
    pattern: '^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$',
    patternMessage: 'SWIFT code must be 8 or 11 letters / digits',
  },
};

const SETTING_GROUPS = {
  tax: 'Tax / VAT',
  orders: 'Orders & Payments',
  refunds: 'Cancellations, Claims & Refunds',
  bank: 'AFA Bank Account (Bank Transfer)',
};

module.exports = { SETTINGS, SETTING_GROUPS };
