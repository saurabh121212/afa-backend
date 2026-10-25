// Who may start which conversation (config/chat START_RULES). Replying is open to participants.
const ApiError = require('../../utils/ApiError');
const { START_RULES } = require('../../config/chat');

const plainName = (userType) => userType.replace(/_/g, ' '); // "financial_institution" -> "financial institution"

const findRule = (subjectType, starterType, ownerType) =>
  START_RULES.find(
    (r) => r.subjectType === subjectType && r.starterTypes.includes(starterType) && r.ownerTypes.includes(ownerType)
  );

// Throws if `user` may not start a conversation about a subject owned by an account of `ownerType`.
function assertCanStart(user, subjectType, ownerType) {
  if (findRule(subjectType, user.userType, ownerType)) return;
  const starters = [...new Set(START_RULES.filter((r) => r.subjectType === subjectType).flatMap((r) => r.starterTypes))];
  const who = starters.map(plainName).join(' / ');
  throw new ApiError(403, who ? `Only ${who} accounts can message sellers about a listing.` : 'You cannot start this conversation.', {
    code: 'CHAT_NOT_ALLOWED',
  });
}

const canStart = (user, subjectType, ownerType) => !!findRule(subjectType, user.userType, ownerType);

module.exports = { assertCanStart, canStart };
