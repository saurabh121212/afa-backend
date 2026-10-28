// System Settings the admin can change (GET / PUT /admin/settings).
//
// The values below are the DEFAULTS. The "settings" table only holds a row when the
// admin has changed a value, so a fresh database works without a seeder.
//
//   type      -> number | boolean   (used for validation)
//   min / max -> allowed range for numbers
//   decimals  -> most decimal places allowed (0 = whole numbers only)
//   unit      -> shown next to the field (%, minutes)

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
    label: 'Payment Time Limit (minutes)',
    description: 'An order that is not paid within this time is cancelled and the stock goes back',
    group: 'orders',
    type: 'number',
    default: 30,
    min: 5,
    max: 1440,
    decimals: 0,
    unit: 'minutes',
  },
};

const SETTING_GROUPS = { tax: 'Tax / VAT', orders: 'Orders & Payments' };

module.exports = { SETTINGS, SETTING_GROUPS };
