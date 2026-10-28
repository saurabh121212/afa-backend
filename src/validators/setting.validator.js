// Validation for System Settings (admin). Rules are built from config/settings.js,
// so a new setting added there is validated automatically.
const { body, param } = require('express-validator');
const { SETTINGS } = require('../config/settings');

const KEYS = Object.keys(SETTINGS);

function ruleFor(key) {
  const def = SETTINGS[key];
  const chain = body(key).optional();

  if (def.type === 'boolean') {
    return chain
      .isBoolean({ loose: false })
      .withMessage(`${def.label} must be true or false`)
      .bail()
      .toBoolean(true);
  }

  // number
  const decimalsRule = def.decimals > 0 ? new RegExp(`^-?\\d+(\\.\\d{1,${def.decimals}})?$`) : /^-?\d+$/;
  return chain
    .custom((v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && decimalsRule.test(String(v).trim()))
    .withMessage(
      def.decimals > 0
        ? `${def.label} must be a number with up to ${def.decimals} decimal places`
        : `${def.label} must be a whole number`
    )
    .bail()
    .isFloat({ min: def.min, max: def.max })
    .withMessage(`${def.label} must be between ${def.min} and ${def.max}`)
    .bail()
    .toFloat();
}

// PUT /admin/settings   (send only the settings that change)
const update = [
  body()
    .custom((value) => value && typeof value === 'object' && !Array.isArray(value))
    .withMessage('Send the settings as a JSON object, e.g. { "vat_rate": 15 }')
    .bail()
    .custom((value) => {
      const unknown = Object.keys(value).filter((k) => !KEYS.includes(k));
      if (unknown.length) throw new Error(`Unknown setting(s): ${unknown.join(', ')}. Allowed: ${KEYS.join(', ')}`);
      if (!Object.keys(value).length) throw new Error('Send at least one setting to change');
      return true;
    }),
  ...KEYS.map(ruleFor),
];

// POST /admin/settings/:key/reset
const reset = [
  param('key').trim().isIn(KEYS).withMessage(`Setting must be one of: ${KEYS.join(', ')}`),
];

module.exports = { update, reset };
