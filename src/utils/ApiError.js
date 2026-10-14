// An error with an HTTP status code, sent to the client as JSON by errorHandler.
//
//   throw new ApiError(401, 'Invalid email or password');
//   throw new ApiError(422, 'Validation failed', { errors: [{ field: 'email', message: '...' }] });
//   throw new ApiError(403, 'Awaiting approval', { code: 'ACCOUNT_PENDING_APPROVAL' });
//
// "code" is a fixed string the website / mobile app can check to decide what screen to show.
class ApiError extends Error {
  constructor(statusCode, message, { errors, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (errors) this.errors = errors;
    if (code) this.code = code;
  }
}

module.exports = ApiError;
