// Validation for chat conversations (/me/conversations).
const { body, param, query } = require('express-validator');
const { SUBJECT_TYPES, MESSAGE_MAX_LENGTH, CONVERSATIONS_PAGE, MESSAGES_PAGE } = require('../../config/chat');

// What a message can refer to / a conversation can be started from (e.g. 'listing')
const CONTEXTS = Object.values(SUBJECT_TYPES).filter((t) => t !== SUBJECT_TYPES.NONE);

const idParam = param('id').isInt({ min: 1 }).withMessage('Conversation id must be a positive number').toInt();

const contextType = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('contextType is required')
    .bail()
    .isIn(CONTEXTS)
    .withMessage(`contextType must be one of: ${CONTEXTS.join(', ')}`);

const contextId = (chain) =>
  chain.notEmpty().withMessage('contextId is required').bail().isInt({ min: 1 }).withMessage('contextId must be a positive number').toInt();

// Keep the listing as this message's reference (default) or send a general message
const attachContext = body('attachContext')
  .optional({ values: 'null' })
  .isBoolean({ strict: false })
  .withMessage('attachContext must be true or false')
  .toBoolean(true);

// The message. Line breaks inside are kept; spaces around it are removed.
// Optional when a photo is sent (form-data field "image"): then it is the caption.
// (Its own rule: optional() below would skip it for a missing text.)
const textOrImage = body('text').custom((value, { req }) => {
  if (req.file || (typeof value === 'string' && value.trim())) return true;
  throw new Error('Type a message or add a photo');
});
const text = body('text')
  .optional({ values: 'falsy' })
  .isString()
  .withMessage('Type a message')
  .bail()
  .trim()
  .isLength({ max: MESSAGE_MAX_LENGTH })
  .withMessage(`A message can be at most ${MESSAGE_MAX_LENGTH} characters`);

// Id the app makes for each message it sends, so a retried send is saved only once
const clientMsgId = body('clientMsgId')
  .optional({ values: 'falsy' })
  .isString()
  .bail()
  .trim()
  .matches(/^[A-Za-z0-9_-]{8,64}$/)
  .withMessage('clientMsgId must be 8-64 letters, numbers, - or _');

const limit = (max) => query('limit').optional().isInt({ min: 1, max }).withMessage(`limit must be 1-${max}`).toInt();

// GET /me/conversations
const list = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive number').toInt(),
  limit(CONVERSATIONS_PAGE.maxLimit),
];

// GET /me/conversations/lookup?contextType=listing&contextId=42
const lookup = [contextType(query('contextType')), contextId(query('contextId'))];

// POST /me/conversations
const start = [contextType(body('contextType')), contextId(body('contextId')), textOrImage, text, attachContext, clientMsgId];

// POST /me/conversations/:id/messages
const send = [idParam, textOrImage, text, clientMsgId];

// GET /me/conversations/:id/messages?before=&limit=
const messages = [
  idParam,
  query('before').optional().isInt({ min: 1 }).withMessage('before must be a message id').toInt(),
  limit(MESSAGES_PAGE.maxLimit),
];

// PATCH /me/conversations/:id/read
const read = [idParam, body('lastMessageId').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('lastMessageId must be a message id').toInt()];

// GET /me/conversations/:id/messages/:messageId/image
const image = [idParam, param('messageId').isInt({ min: 1 }).withMessage('Message id must be a positive number').toInt()];

const byId = [idParam];

module.exports = { list, lookup, start, send, messages, image, read, byId };
