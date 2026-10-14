// Stops a user from uploading a document their sub-type may not have,
// e.g. an INDIVIDUAL buyer uploading "Tax Clearance Certificate" (business only).
// Runs BEFORE uploadKycDocument, so the file is never saved.
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { getDocumentType, isAvailableFor } = require('../config/documentTypes');
const { getHandler, getSubtype } = require('../services/userTypes.registry');

const checkDocumentAllowed = asyncHandler(async (req, res, next) => {
  const rules = getDocumentType(req.user.userType, req.params.documentType);
  if (!rules || !rules.onlyForSubtypes) return next();

  const subtype = await getSubtype(req.user);
  if (!isAvailableFor(rules, subtype)) {
    const handler = getHandler(req.user.userType);
    const label = (s) => (handler && handler.subtypeLabel ? handler.subtypeLabel(s) : s);
    throw new ApiError(
      403,
      `${rules.label} is only for ${rules.onlyForSubtypes.map(label).join(', ')} accounts`,
      { code: 'DOCUMENT_NOT_APPLICABLE' }
    );
  }
  next();
});

module.exports = { checkDocumentAllowed };
