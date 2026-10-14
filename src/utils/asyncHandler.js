// Wraps an async controller so any error goes to the errorHandler
// instead of crashing the request. Saves writing try/catch everywhere.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
