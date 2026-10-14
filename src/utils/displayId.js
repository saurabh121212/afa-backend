// Human-friendly user ids for the admin panel, e.g. "AFA-LP-00567".
const { USER_TYPE_CODES } = require('./constants');

const displayId = (userType, id) => `AFA-${USER_TYPE_CODES[userType] || 'US'}-${String(id).padStart(5, '0')}`;

module.exports = { displayId };
