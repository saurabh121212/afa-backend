// Create and check JWT tokens.
//
// Token types used in AFA:
//   'admin'        -> admin panel
//   'user'         -> approved marketplace users (farmer, buyer, ...)
//   'registration' -> short-lived, lets a new user finish the registration steps
const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config');

function signToken(payload, { expiresIn } = {}) {
  return jwt.sign(payload, jwtConfig.secret, {
    expiresIn: expiresIn || jwtConfig.expiresIn,
    issuer: 'afa-backend',
  });
}

// Token given after registration Step 1 (or /register/resume) to finish the other steps.
function signRegistrationToken(user) {
  return signToken(
    { sub: user.id, type: 'registration', userType: user.userType },
    { expiresIn: jwtConfig.registrationExpiresIn }
  );
}

// Returns the decoded payload, or throws if the token is invalid/expired.
function verifyToken(token) {
  return jwt.verify(token, jwtConfig.secret, { issuer: 'afa-backend' });
}

module.exports = { signToken, signRegistrationToken, verifyToken };
