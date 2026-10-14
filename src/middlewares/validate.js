// Runs after the express-validator rules of a route.
// If any rule failed, responds 422 with one message per field:
//   { success: false, message: 'Validation failed', code: 'VALIDATION_ERROR',
//     errors: [{ field: 'email', message: 'Enter a valid email address' }] }
const { validationResult, matchedData } = require('express-validator');
const ApiError = require('../utils/ApiError');

function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result
      .array({ onlyFirstError: true })
      .map((e) => ({ field: e.path, message: e.msg }));
    return next(new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors }));
  }

  // Only the fields that have rules (already trimmed/converted) reach the controller.
  // Unknown fields sent by the client are dropped.
  req.validated = matchedData(req, { locations: ['body', 'query', 'params'] });
  next();
}

module.exports = validate;
