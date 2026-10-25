// Settings for the chat module (Messages / Chat).
//
// Conversations are generic: participants are accounts (participantType + participantId), with ONE
// conversation per pair of accounts (e.g. a buyer and a seller). A message can refer to something
// (its "context", e.g. the listing a buyer asks about), so one conversation covers many products.
// Which roles may START a conversation, and from what, is decided only by START_RULES below, so
// allowing more role-to-role chats later is a settings change, not a schema change. Every
// participant can reply in a conversation.
const { SELLER_USER_TYPES } = require('../listingOptions');

// Who can be in a conversation. Today only marketplace accounts ('user' -> users.id).
const PARTICIPANT_TYPES = { USER: 'user' };

// Who wrote a message ('system' = written by AFA itself, no sender id)
const SENDER_TYPES = { USER: 'user', SYSTEM: 'system' };

// What a conversation is started from / a message refers to. Conversations themselves are 'none'
// (one per pair); the subject columns stay for conversations tied to one thing later, if ever needed.
const SUBJECT_TYPES = { NONE: 'none', LISTING: 'listing' };

// Message types. 'image' = a photo (optional caption in the text); its file details are in
// metadata.attachment. Other kinds (e.g. documents) can be added the same way.
const MESSAGE_TYPES = { TEXT: 'text', IMAGE: 'image' };

// Photos in chat: PRIVATE files (only the two people in the conversation can open them),
// saved in uploads/private/chat/<senderId>/ and served by GET /me/conversations/:id/messages/:messageId/image
const CHAT_IMAGES = { formats: ['jpg', 'png'], maxSizeMB: 5, folder: 'chat' };

// A participant's part in a subject conversation
const PARTICIPANT_ROLES = {
  STARTER: 'starter', // asked about the subject (e.g. the buyer)
  OWNER: 'owner', // owns the subject (e.g. the seller of the listing)
};

// Who may start a conversation from something (e.g. "Message Seller" on a listing):
//   starterTypes -> user types allowed to start it
//   ownerTypes   -> user types of the owner (the account the conversation is with)
// Business rule today: only buyer accounts message sellers (a seller who wants to buy registers a
// separate buyer account). Add user types here to allow more role-to-role conversations.
const START_RULES = [
  { subjectType: SUBJECT_TYPES.LISTING, starterTypes: ['buyer'], ownerTypes: SELLER_USER_TYPES },
];

const MESSAGE_MAX_LENGTH = 2000;

// Page sizes (?limit=)
const CONVERSATIONS_PAGE = { defaultLimit: 30, maxLimit: 100 };
const MESSAGES_PAGE = { defaultLimit: 30, maxLimit: 100 };

// Sending messages: at most `limit` per user per minute
const SEND_RATE_LIMIT = { windowMinutes: 1, limit: 30 };

module.exports = {
  PARTICIPANT_TYPES,
  SENDER_TYPES,
  SUBJECT_TYPES,
  MESSAGE_TYPES,
  CHAT_IMAGES,
  PARTICIPANT_ROLES,
  START_RULES,
  MESSAGE_MAX_LENGTH,
  CONVERSATIONS_PAGE,
  MESSAGES_PAGE,
  SEND_RATE_LIMIT,
};
