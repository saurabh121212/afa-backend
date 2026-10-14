// ONE PLACE that tells the shared code (login, documents, Step "Account Security", "me")
// how each user type works.
//
// When a new user type is built (trader, logistics, financial_institution),
// add one entry here pointing to its own service. Shared code needs no other change.
//
//   totalSteps             -> number of registration steps in Figma (last one = Account Security)
//   canLoginBeforeApproval -> true = may log in while waiting for admin approval
//                             (some actions, e.g. placing orders, still need approval)
//   profileAs              -> name of the profile link on the User model (e.g. user.farmerProfile)
//   profileModel           -> Sequelize model name of the profile table
//   profileInclude         -> function returning the extra includes (e.g. location names)
//   findUserIdByTin        -> TIN login for this type (null = email login only)
//   getDisplayName         -> name used in emails
//   getSubtype             -> (optional) sub-type, e.g. buyer 'individual' / 'business'
//   subtypeLabel           -> (optional) friendly name of a sub-type
//   onSubmit               -> (optional) extra work when Account Security is submitted
//   requiredConsents       -> (optional) extra tick boxes this type MUST tick on submit,
//                             as { field: 'error message' }
const farmerService = require('./farmer.service');
const buyerService = require('./buyer.service');
const traderService = require('./trader.service');
const logisticsService = require('./logistics.service');
const fiService = require('./fi.service');

const USER_TYPE_HANDLERS = {
  farmer: {
    totalSteps: 4,
    canLoginBeforeApproval: false,
    profileAs: 'farmerProfile',
    profileModel: 'FarmerProfile',
    profileInclude: farmerService.profileInclude,
    findUserIdByTin: farmerService.findUserIdByTin,
    getDisplayName: farmerService.getDisplayName,
  },
  buyer: {
    totalSteps: 3,
    // Figma: "You can start browsing and messaging sellers immediately -
    // verification is only required before your first order ships."
    canLoginBeforeApproval: true,
    profileAs: 'buyerProfile',
    profileModel: 'BuyerProfile',
    profileInclude: buyerService.profileInclude,
    findUserIdByTin: buyerService.findUserIdByTin,
    getDisplayName: buyerService.getDisplayName,
    getSubtype: buyerService.getSubtype,
    subtypeLabel: buyerService.subtypeLabel,
    onSubmit: buyerService.onSubmit,
  },
  trader: {
    totalSteps: 4,
    canLoginBeforeApproval: false, // "verify and activate your trader account"
    profileAs: 'traderProfile',
    profileModel: 'TraderProfile',
    profileInclude: traderService.profileInclude,
    findUserIdByTin: traderService.findUserIdByTin,
    getDisplayName: traderService.getDisplayName,
    onSubmit: traderService.onSubmit,
    requiredConsents: {
      confirmAuthorized: 'You must confirm that you are authorized to register and represent this business on AFA',
    },
  },
  logistics: {
    totalSteps: 4,
    canLoginBeforeApproval: false, // "verify and activate your logistics provider account"
    profileAs: 'logisticsProfile',
    profileModel: 'LogisticsProfile',
    profileInclude: logisticsService.profileInclude,
    findUserIdByTin: logisticsService.findUserIdByTin,
    getDisplayName: logisticsService.getDisplayName,
    onSubmit: logisticsService.onSubmit,
    requiredConsents: {
      confirmAuthorized: 'You must confirm that you are authorized to register and represent this business on AFA',
    },
  },
  financial_institution: {
    totalSteps: 4,
    canLoginBeforeApproval: false, // "verify and activate your financial institution account"
    profileAs: 'fiProfile',
    profileModel: 'FiProfile',
    profileInclude: fiService.profileInclude,
    findUserIdByTin: fiService.findUserIdByTin,
    getDisplayName: fiService.getDisplayName,
    onSubmit: fiService.onSubmit,
    requiredConsents: {
      confirmAuthorized: 'You must confirm that you are authorized to register and represent this institution on AFA',
    },
  },
};

// Returns the handler for a user type, or null if that type isn't built yet.
const getHandler = (userType) => USER_TYPE_HANDLERS[userType] || null;

// Sub-type of a user (null if the type has none)
async function getSubtype(user) {
  const handler = getHandler(user.userType);
  return handler && handler.getSubtype ? handler.getSubtype(user.id) : null;
}

// Options the document service needs for this user
async function documentOptions(user) {
  const handler = getHandler(user.userType);
  return {
    subtype: await getSubtype(user),
    subtypeLabel: (handler && handler.subtypeLabel) || ((s) => s),
    totalSteps: handler ? handler.totalSteps : 4,
  };
}

module.exports = { getHandler, getSubtype, documentOptions };
