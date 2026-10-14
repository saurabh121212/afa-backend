// Checks the :documentType in the URL against the list for the user's type
// (config/documentTypes.js). Runs after protectRegistration, so req.user is set.
const { param } = require('express-validator');
const { getDocumentTypes } = require('../config/documentTypes');

const documentTypeParam = [
  param('documentType')
    .trim()
    .notEmpty()
    .withMessage('Document type is required')
    .bail()
    .custom((value, { req }) => {
      const allowed = Object.keys(getDocumentTypes(req.user.userType));
      if (!allowed.includes(value)) {
        throw new Error(`Document type must be one of: ${allowed.join(', ')}`);
      }
      return true;
    }),
];

module.exports = { documentTypeParam };
