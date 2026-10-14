// SHARED registration steps, the same for EVERY user type (Figma "Account Security" step):
//   progress, resume, send-otp, verify-otp, submit.
// Type-specific steps live in each type's own service (e.g. farmer.service.js).
const models = require('../models');
const ApiError = require('../utils/ApiError');
const { signRegistrationToken } = require('../utils/jwt');
const { USER_STATUS, OTP_PURPOSES } = require('../utils/constants');
const otpService = require('./otp.service');
const emailService = require('./email.service');
const { getHandler } = require('./userTypes.registry');

const { User } = models;

// Load a user with their own type's profile (farmerProfile, buyerProfile, ...)
async function loadUserWithProfile(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new ApiError(404, 'User not found', { code: 'NOT_FOUND' });

  const handler = getHandler(user.userType);
  if (!handler) return user.toJSON();

  const withProfile = await User.findByPk(userId, {
    include: [
      {
        model: models[handler.profileModel],
        as: handler.profileAs,
        include: handler.profileInclude(),
      },
    ],
  });
  return withProfile.toJSON();
}

async function displayNameOf(user) {
  const handler = getHandler(user.userType);
  return handler ? handler.getDisplayName(user.id) : '';
}

// Last registration step (Account Security): farmer 4, buyer 3, ...
const lastStepOf = (user) => {
  const handler = getHandler(user.userType);
  return handler ? handler.totalSteps : 4;
};

// GET /register/progress -> saved data, to pre-fill the form when going Back
async function getProgress(userId) {
  const user = await loadUserWithProfile(userId);
  return {
    userType: user.userType,
    registrationStep: user.registrationStep,
    totalSteps: lastStepOf(user),
    emailVerified: Boolean(user.emailVerifiedAt),
    status: user.status,
    user,
  };
}

// POST /register/resume -> continue an unfinished registration
// accountType is needed because the same email may have several accounts (farmer, buyer, ...)
async function resume({ accountType, email, password }) {
  const user = await User.scope('withPassword').findOne({ where: { email, userType: accountType } });
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }
  if (user.status !== USER_STATUS.PENDING_VERIFICATION) {
    throw new ApiError(400, 'This registration has already been submitted. Please log in.', {
      code: 'REGISTRATION_ALREADY_SUBMITTED',
    });
  }
  return {
    registrationToken: signRegistrationToken(user),
    userId: user.id,
    userType: user.userType,
    registrationStep: user.registrationStep,
  };
}

// POST /register/send-otp
async function sendOtp(user) {
  if (user.emailVerifiedAt) {
    throw new ApiError(400, 'Your email is already verified', { code: 'EMAIL_ALREADY_VERIFIED' });
  }
  await otpService.createAndSendOtp({
    user,
    purpose: OTP_PURPOSES.REGISTRATION,
    name: await displayNameOf(user),
  });
  return { email: user.email };
}

// POST /register/verify-otp
async function verifyOtp(user, otp) {
  if (user.emailVerifiedAt) {
    throw new ApiError(400, 'Your email is already verified', { code: 'EMAIL_ALREADY_VERIFIED' });
  }
  await otpService.verifyOtp({ userId: user.id, purpose: OTP_PURPOSES.REGISTRATION, otp });
  user.emailVerifiedAt = new Date();
  user.registrationStep = Math.max(user.registrationStep, lastStepOf(user));
  await user.save();
  return { emailVerified: true };
}

// POST /register/submit -> consents accepted, sent to the admin for approval
//   data = validated body (consents + optional type-specific settings, e.g. buyer orderPriceAlerts)
async function submit(user, data = {}) {
  if (!user.emailVerifiedAt) {
    throw new ApiError(400, 'Please verify your email before submitting', { code: 'EMAIL_NOT_VERIFIED' });
  }

  const handler = getHandler(user.userType);

  // Extra tick boxes only some types have (e.g. trader "authorized to represent this business")
  const consentErrors = Object.entries((handler && handler.requiredConsents) || {})
    .filter(([field]) => data[field] !== true)
    .map(([field, message]) => ({ field, message }));
  if (consentErrors.length) {
    throw new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors: consentErrors });
  }

  // Type-specific extras on the Account Security screen (e.g. buyer "Order & Price Alerts")
  if (handler && handler.onSubmit) await handler.onSubmit(user, data);

  const now = new Date();
  await user.update({
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    accuracyConfirmedAt: now,
    submittedAt: now,
    registrationStep: lastStepOf(user),
    status: USER_STATUS.PENDING_APPROVAL,
  });

  // A failed "thank you" email must not fail the registration
  displayNameOf(user)
    .then((name) =>
      emailService.sendRegistrationSubmittedEmail({ to: user.email, name, userType: user.userType })
    )
    .catch((err) => console.error('Registration email failed:', err.message));

  return {
    status: user.status,
    submittedAt: user.submittedAt,
    // e.g. buyers can log in now; farmers must wait for approval
    canLoginNow: Boolean(handler && handler.canLoginBeforeApproval),
  };
}

module.exports = { getProgress, resume, sendOtp, verifyOtp, submit, loadUserWithProfile };
