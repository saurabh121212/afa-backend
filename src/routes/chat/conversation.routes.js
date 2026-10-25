// Chat (Figma "Messages / Chat") for the LOGGED-IN account, mounted at /api/v1/me/conversations.
// One conversation per pair of accounts (buyer <-> seller); a message can refer to a listing.
// Any logged-in account can read its own conversations; who may START one is set in config/chat
// (today: buyers message the seller of a listing). New messages and read receipts are also pushed
// live over Socket.IO (events "chat:message" and "chat:read", see services/chat/realtime.js).
//
//   GET    /me/conversations                          Messages inbox (newest first, ?page=&limit=) + totalUnread
//   GET    /me/conversations/unread-count             { total } for the Messages badge
//   GET    /me/conversations/lookup                   ?contextType=listing&contextId=42 -> the conversation
//                                                     with the listing's seller (or null) + the listing
//   POST   /me/conversations                          { contextType, contextId, text, attachContext?, clientMsgId? }
//                                                     "Message Seller": send to the listing's seller (starts
//                                                     the pair's conversation once); attachContext (default
//                                                     true) keeps the listing as the message's reference
//   GET    /me/conversations/:id                      one conversation
//   GET    /me/conversations/:id/messages             ?before=<message id>&limit= (oldest -> newest)
//   POST   /me/conversations/:id/messages             { text, clientMsgId? } reply
//   GET    /me/conversations/:id/messages/:messageId/image   a message's photo (participants only)
//
// Photos: both POSTs also accept form-data with one "image" file (JPG/PNG, max 5MB) plus the same
// fields; the text is then an optional caption.
//   PATCH  /me/conversations/:id/read                 { lastMessageId? } mark as read
const express = require('express');
const controller = require('../../controllers/chat/conversation.controller');
const rules = require('../../validators/chat/conversation.validator');
const validate = require('../../middlewares/validate');
const { protectUser } = require('../../middlewares/userAuth');
const { sendLimiter } = require('../../middlewares/chat/sendLimiter');
const { uploadChatImage, removeUploadOnError } = require('../../middlewares/chat/uploadChatImage');

const router = express.Router();
router.use(protectUser);

router.get('/', rules.list, validate, controller.list);
router.get('/unread-count', controller.unreadCount);
router.get('/lookup', rules.lookup, validate, controller.lookup);
router.post('/', sendLimiter, uploadChatImage, rules.start, validate, controller.start);
router.get('/:id', rules.byId, validate, controller.getOne);
router.get('/:id/messages', rules.messages, validate, controller.messages);
router.post('/:id/messages', sendLimiter, uploadChatImage, rules.send, validate, controller.send);
router.get('/:id/messages/:messageId/image', rules.image, validate, controller.image);
router.patch('/:id/read', rules.read, validate, controller.markRead);
router.use(removeUploadOnError);

module.exports = router;
