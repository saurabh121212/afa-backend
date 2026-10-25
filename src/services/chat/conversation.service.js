// Chat conversations of the logged-in account (/me/conversations): the Messages inbox, the chat
// opened from a listing ("Message Seller"), sending messages and read receipts.
//
// Rules
//   - Participants are accounts (participantType + participantId). Today: 'user' -> users.id.
//   - ONE conversation per pair of accounts (buyer <-> seller), whatever they talk about: a buyer
//     asking the same seller about several products keeps one chat with the whole history.
//   - A message can refer to a listing ("context"): a copy of the listing (name, price, photo) is
//     kept on the message, so the history shows what each question was about.
//   - Only START_RULES (config/chat) decide who may START a conversation: today a buyer, from a
//     seller's listing. Once it exists, both can reply, also after the listing stops being live.
//   - A message can carry one photo (JPG/PNG, max 5MB): a PRIVATE file only the participants can
//     open (GET /me/conversations/:id/messages/:messageId/image). The text is then optional.
//   - Not your conversation -> 404 (never reveals that it exists).
//   - Saved first, then pushed to the participants' apps over Socket.IO (services/chat/realtime).
const fs = require('fs');
const path = require('path');
const { Op, UniqueConstraintError } = require('sequelize');
const { sequelize, ChatConversation, ChatParticipant, ChatMessage, User } = require('../../models');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { kindForMimeType, fileMatchesKind, formatLabels } = require('../../utils/fileTypes');
const { getPagination, paginationMeta } = require('../../utils/pagination');
const { displayId } = require('../../utils/displayId');
const { USER_TYPE_LABELS } = require('../../utils/constants');
const {
  PARTICIPANT_TYPES,
  SENDER_TYPES,
  SUBJECT_TYPES,
  MESSAGE_TYPES,
  CHAT_IMAGES,
  PARTICIPANT_ROLES,
  CONVERSATIONS_PAGE,
  MESSAGES_PAGE,
} = require('../../config/chat');
const directory = require('../userDirectory');
const { handlerFor } = require('./subjects');
const { assertCanStart } = require('./access');
const realtime = require('./realtime');

const USER = PARTICIPANT_TYPES.USER;

// ---------- Participants ----------
const asParticipant = (user) => ({ participantType: USER, participantId: user.id });
const sameParticipant = (a, b) =>
  a.participantType === b.participantType && Number(a.participantId) === Number(b.participantId);
const participantFilter = (p) => ({ participantType: p.participantType, participantId: p.participantId });
// "user:4|user:9": the same for the same people, in any order
const participantsKey = (list) =>
  list
    .map((p) => `${p.participantType}:${p.participantId}`)
    .sort()
    .join('|');

const notFound = () => new ApiError(404, 'Conversation not found', { code: 'CONVERSATION_NOT_FOUND' });
const contextNotFound = () => new ApiError(404, 'This listing is not available', { code: 'CONTEXT_NOT_FOUND' });
const contextGone = () =>
  new ApiError(422, 'This listing is no longer available. Remove it from your message to send.', {
    code: 'CONTEXT_NOT_AVAILABLE',
    errors: [{ field: 'attachContext', message: 'This listing is no longer available' }],
  });

function handlerOrFail(contextType) {
  const handler = handlerFor(contextType);
  if (!handler) throw new ApiError(422, 'Unknown context type', { code: 'INVALID_CONTEXT' });
  return handler;
}

// ---------- Shapes sent to the apps ----------
// A message's reference (e.g. the listing asked about): the copy saved with it, plus current
// details and whether it is still available.
const contextShape = (saved, live) => (saved ? { ...saved, ...(live || {}), available: live ? live.available : false, type: saved.type, id: saved.id } : null);

// A photo: where the app loads it (with the login token), never where it is stored
const attachmentShape = (m, a) =>
  a
    ? {
        kind: a.kind,
        url: `/me/conversations/${m.conversationId}/messages/${Number(m.id)}/image`,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        name: a.originalName || null,
      }
    : null;

function messageShape(m, liveContexts = new Map()) {
  const metadata = m.metadata || {};
  const saved = metadata.context || null;
  const typeLive = saved && liveContexts.get(saved.type);
  return {
    id: Number(m.id),
    conversationId: m.conversationId,
    type: m.type,
    text: m.body,
    context: contextShape(saved, typeLive && typeLive.get(saved.id)),
    attachment: attachmentShape(m, metadata.attachment),
    senderType: m.senderType,
    senderId: m.senderId,
    clientMsgId: m.clientMsgId,
    createdAt: m.createdAt,
  };
}

// Current details of every item the messages refer to, one query per type
async function liveContextsOf(messages) {
  const idsByType = new Map();
  for (const m of messages) {
    const c = m.metadata && m.metadata.context;
    if (c && c.type && c.id) idsByType.set(c.type, [...(idsByType.get(c.type) || []), c.id]);
  }
  const live = new Map();
  for (const [type, ids] of idsByType) {
    const handler = handlerFor(type);
    if (handler) live.set(type, await handler.liveMany(ids));
  }
  return live;
}

async function messageShapes(messages) {
  const live = await liveContextsOf(messages);
  return messages.map((m) => messageShape(m, live));
}

// Name like the public seller card: farmers by their farm name ("Sunrise Farm")
function accountShape(p, dir) {
  if (p.participantType !== USER) return { type: p.participantType, id: p.participantId, name: null, role: p.role || null };
  const userType = (dir && dir.user_type) || p.userType || null;
  const name = dir ? (userType === 'farmer' ? dir.sub_name || dir.display_name : dir.display_name) : null;
  return {
    type: USER,
    id: p.participantId,
    name: name || 'AFA user',
    userType,
    userTypeLabel: USER_TYPE_LABELS[userType] || null,
    displayId: userType ? displayId(userType, p.participantId) : null,
    role: p.role || null,
  };
}

// ---------- Unread counts (messages from others after my last read one) ----------
const UNREAD_FROM = `
    FROM chat_participants p
    JOIN chat_conversations c ON c.id = p.conversation_id AND c.deleted_at IS NULL
    JOIN chat_messages m ON m.conversation_id = p.conversation_id
     AND m.deleted_at IS NULL
     AND m.id > COALESCE(p.last_read_message_id, 0)
     AND NOT (m.sender_type = p.participant_type AND m.sender_id = p.participant_id)
   WHERE p.participant_type = :participantType AND p.participant_id = :participantId`;

async function unreadCounts(viewer, conversationIds) {
  if (!conversationIds.length) return new Map();
  const rows = await sequelize.query(
    `SELECT p.conversation_id AS id, COUNT(m.id) AS unread ${UNREAD_FROM} AND p.conversation_id IN (:ids) GROUP BY p.conversation_id`,
    { replacements: { ...participantFilter(viewer), ids: conversationIds }, type: sequelize.QueryTypes.SELECT }
  );
  return new Map(rows.map((r) => [Number(r.id), Number(r.unread)]));
}

async function totalUnreadOf(viewer) {
  const [row] = await sequelize.query(`SELECT COUNT(m.id) AS total ${UNREAD_FROM}`, {
    replacements: participantFilter(viewer),
    type: sequelize.QueryTypes.SELECT,
  });
  return Number(row ? row.total : 0);
}

// ---------- Conversation summaries (as one participant sees them) ----------
async function summarize(conversations, viewer) {
  if (!conversations.length) return [];
  const ids = conversations.map((c) => c.id);
  const lastIds = conversations.map((c) => c.lastMessageId).filter(Boolean);
  const [members, lastMessages, unread] = await Promise.all([
    ChatParticipant.findAll({ where: { conversationId: ids } }),
    lastIds.length ? ChatMessage.findAll({ where: { id: lastIds } }) : [],
    unreadCounts(viewer, ids),
  ]);
  const [dirs, lastShapes] = await Promise.all([
    directory.findMany(members.filter((p) => p.participantType === USER).map((p) => p.participantId)),
    messageShapes(lastMessages),
  ]);
  const lastById = new Map(lastShapes.map((m) => [m.id, m]));

  return conversations.map((c) => {
    const inThis = members.filter((p) => p.conversationId === c.id);
    const mine = inThis.find((p) => sameParticipant(p, viewer));
    const others = inThis.filter((p) => !sameParticipant(p, viewer));
    const counterpart = others[0] || null;
    return {
      id: c.id,
      counterpart: counterpart ? accountShape(counterpart, dirs.get(counterpart.participantId)) : null,
      // Everyone else in the conversation (one person today; more for future group conversations)
      participants: others.map((p) => accountShape(p, dirs.get(p.participantId))),
      myRole: mine ? mine.role : null,
      lastMessage: (c.lastMessageId && lastById.get(Number(c.lastMessageId))) || null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unread.get(c.id) || 0,
      // My messages up to this id have been read by the other person (double tick)
      counterpartLastReadMessageId: counterpart && counterpart.lastReadMessageId ? Number(counterpart.lastReadMessageId) : null,
      createdAt: c.createdAt,
    };
  });
}

const summaryOf = async (conversation, viewer) => (await summarize([conversation], viewer))[0];

// ---------- Lookups ----------
async function findMine(user, id, { transaction } = {}) {
  const conversation = await ChatConversation.findOne({
    where: { id },
    include: [{ model: ChatParticipant, as: 'membership', where: participantFilter(asParticipant(user)), attributes: ['id'], required: true }],
    transaction,
  });
  if (!conversation) throw notFound();
  return conversation;
}

// The one conversation between these accounts
const findPair = (participants, { transaction } = {}) =>
  ChatConversation.findOne({
    where: { subjectType: SUBJECT_TYPES.NONE, subjectId: 0, participantsKey: participantsKey(participants) },
    transaction,
  });

// "Message Seller" on a listing: the listing, its owner (who the chat is with) and checks
async function resolveContext(user, contextType, contextId) {
  const handler = handlerOrFail(contextType);
  const item = await handler.find(contextId);
  if (!item) throw contextNotFound();
  const me = asParticipant(user);
  const owner = handler.ownerOf(item);
  if (sameParticipant(owner, me)) throw new ApiError(422, 'This is your own listing', { code: 'OWN_CONTEXT' });
  return { handler, item, me, owner };
}

// ---------- Push to the participants' apps (after saving; failures only logged) ----------
const push = (job) => {
  job().catch((err) => console.error('⚠️  Chat realtime push failed:', err.message));
};

async function pushMessage(conversationId, message) {
  const [conversation, members, [shape]] = await Promise.all([
    ChatConversation.findByPk(conversationId),
    ChatParticipant.findAll({ where: { conversationId } }),
    messageShapes([message]),
  ]);
  if (!conversation) return;
  await Promise.all(
    members.map(async (p) => {
      const viewer = participantFilter(p);
      const [summary, totalUnread] = await Promise.all([summaryOf(conversation, viewer), totalUnreadOf(viewer)]);
      realtime.emitTo(viewer, realtime.EVENTS.MESSAGE, { message: shape, conversation: summary, totalUnread });
    })
  );
}

async function pushRead(conversationId, reader, lastReadMessageId) {
  const members = await ChatParticipant.findAll({ where: { conversationId } });
  await Promise.all(
    members.map(async (p) => {
      const viewer = participantFilter(p);
      const payload = { conversationId, readerType: reader.participantType, readerId: reader.participantId, lastReadMessageId };
      // The reader's other tabs / devices also update their unread badge
      if (sameParticipant(viewer, reader)) payload.totalUnread = await totalUnreadOf(viewer);
      realtime.emitTo(viewer, realtime.EVENTS.READ, payload);
    })
  );
}

// ---------- Saving a message ----------
// clientMsgId = id the app made for this message: sending it again returns the saved message.
async function findDuplicate(user, clientMsgId, transaction) {
  if (!clientMsgId) return null;
  return ChatMessage.findOne({ where: { senderType: SENDER_TYPES.USER, senderId: user.id, clientMsgId }, transaction, paranoid: false });
}

// context = { type, id, ...copy of the item } or null; image = checkImage() result or null
async function addMessage(user, conversation, { text, clientMsgId, context = null, image = null }, transaction) {
  const duplicate = await findDuplicate(user, clientMsgId, transaction);
  if (duplicate) {
    if (duplicate.conversationId !== conversation.id) {
      throw new ApiError(409, 'This message id was already used', { code: 'DUPLICATE_MESSAGE' });
    }
    return { message: duplicate, duplicate: true };
  }
  const message = await ChatMessage.create(
    {
      conversationId: conversation.id,
      senderType: SENDER_TYPES.USER,
      senderId: user.id,
      type: image ? MESSAGE_TYPES.IMAGE : MESSAGE_TYPES.TEXT,
      body: text || null,
      metadata: context || image ? { ...(context && { context }), ...(image && { attachment: image }) } : null,
      clientMsgId: clientMsgId || null,
    },
    { transaction }
  );
  await conversation.update({ lastMessageId: message.id, lastMessageAt: message.createdAt }, { transaction });
  // My own message counts as read by me
  await ChatParticipant.update(
    { lastReadMessageId: message.id, lastReadAt: new Date() },
    { where: { conversationId: conversation.id, ...participantFilter(asParticipant(user)) }, transaction }
  );
  return { message, duplicate: false };
}

// A send that raced with the same clientMsgId -> the message saved by the other request
async function recoverDuplicate(err, user, conversationId, clientMsgId) {
  if (!(err instanceof UniqueConstraintError) || !clientMsgId) throw err;
  const duplicate = await findDuplicate(user, clientMsgId);
  if (!duplicate || duplicate.conversationId !== conversationId) throw err;
  return { message: duplicate, duplicate: true };
}

// ---------- Photos ----------
const PRIVATE_DIR = path.resolve(config.upload.dir, 'private');
const removeFile = (file) => file && fs.unlink(file.path, () => {});

// The uploaded file (multer) really is an allowed image? -> what is saved on the message
async function checkImage(file) {
  if (!file) return null;
  const kind = kindForMimeType(file.mimetype, CHAT_IMAGES.formats);
  if (!kind || !(await fileMatchesKind(file.path, kind))) {
    throw new ApiError(415, `Only ${formatLabels(CHAT_IMAGES.formats)} images can be sent`, { code: 'INVALID_FILE_TYPE' });
  }
  return {
    kind: 'image',
    filePath: path.relative(PRIVATE_DIR, file.path).split(path.sep).join('/'), // e.g. chat/4/img-….jpg
    mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
    sizeBytes: file.size,
    originalName: String(file.originalname || '').slice(0, 255) || null,
  };
}

// Runs a send; the uploaded photo is removed again unless it was saved with a new message
async function withImage(file, job) {
  try {
    const result = await job(await checkImage(file));
    if (result.duplicate) removeFile(file);
    return result;
  } catch (err) {
    removeFile(file);
    throw err;
  }
}

// Save a message in an existing conversation, then push it
async function sendIn(user, conversation, input) {
  let result;
  try {
    result = await sequelize.transaction((transaction) => addMessage(user, conversation, input, transaction));
  } catch (err) {
    result = await recoverDuplicate(err, user, conversation.id, input.clientMsgId);
  }
  if (!result.duplicate) push(() => pushMessage(conversation.id, result.message));
  const fresh = result.duplicate ? await ChatConversation.findByPk(conversation.id) : conversation;
  const [summary, [message]] = await Promise.all([summaryOf(fresh, asParticipant(user)), messageShapes([result.message])]);
  return { conversation: summary, message, duplicate: result.duplicate };
}

// ---------- GET /me/conversations ----------
async function list(user, query) {
  const viewer = asParticipant(user);
  const pg = getPagination({ page: query.page, limit: query.limit || CONVERSATIONS_PAGE.defaultLimit });
  const { rows, count } = await ChatConversation.findAndCountAll({
    include: [{ model: ChatParticipant, as: 'membership', where: participantFilter(viewer), attributes: [], required: true }],
    order: [
      ['lastMessageAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: pg.limit,
    offset: pg.offset,
    distinct: true,
    subQuery: false,
  });
  const [items, totalUnread] = await Promise.all([summarize(rows, viewer), totalUnreadOf(viewer)]);
  return { items, pagination: paginationMeta(pg, count), totalUnread };
}

// ---------- GET /me/conversations/unread-count ----------
async function unreadTotal(user) {
  return { total: await totalUnreadOf(asParticipant(user)) };
}

// ---------- GET /me/conversations/:id ----------
async function getOne(user, id) {
  return summaryOf(await findMine(user, id), asParticipant(user));
}

// ---------- GET /me/conversations/lookup?contextType=listing&contextId=42 ----------
// The chat behind "Message Seller": the conversation with the listing's owner (if there is one),
// the owner, and the listing as a reference for the message box. Nothing is saved until the first
// message is sent (no empty conversations).
async function lookup(user, { contextType, contextId }) {
  const { handler, me, owner } = await resolveContext(user, contextType, contextId);
  const [existing, liveMap] = await Promise.all([findPair([me, owner]), handler.liveMany([contextId])]);
  const context = contextShape({ type: contextType, id: contextId }, liveMap.get(contextId));

  if (existing) {
    const conversation = await summaryOf(existing, me);
    return { conversation, counterpart: conversation.counterpart, context };
  }

  const ownerUser = await User.findByPk(owner.participantId, { attributes: ['id', 'userType'] });
  if (!ownerUser) throw contextNotFound();
  assertCanStart(user, contextType, ownerUser.userType);
  if (!context.available) throw new ApiError(404, 'This listing is no longer available', { code: 'CONTEXT_NOT_AVAILABLE' });
  const dirs = await directory.findMany([owner.participantId]);
  return {
    conversation: null,
    counterpart: accountShape({ ...owner, userType: ownerUser.userType, role: PARTICIPANT_ROLES.OWNER }, dirs.get(owner.participantId)),
    context,
  };
}

// ---------- POST /me/conversations   { contextType, contextId, text, attachContext?, clientMsgId? } ----------
// "Message Seller": sends to the listing's owner, in the pair's one conversation (started if it
// doesn't exist yet). attachContext (default true) keeps the listing as this message's reference.
async function start(user, { contextType, contextId, text, clientMsgId, attachContext = true }, file = null) {
  return withImage(file, (image) => startWith(user, { contextType, contextId, text, clientMsgId, attachContext, image }));
}

async function startWith(user, { contextType, contextId, text, clientMsgId, attachContext, image }) {
  const { handler, item, me, owner } = await resolveContext(user, contextType, contextId);
  const live = await handler.isLive(contextId);
  if (attachContext && !live) throw contextGone();
  const context = attachContext ? { ...handler.snapshot(item), type: contextType, id: contextId } : null;

  const existing = await findPair([me, owner]);
  if (existing) return { ...(await sendIn(user, existing, { text, clientMsgId, context, image })), created: false };

  const ownerUser = await User.findByPk(owner.participantId, { attributes: ['id', 'userType'] });
  if (!ownerUser) throw contextNotFound();
  assertCanStart(user, contextType, ownerUser.userType);
  if (!live) throw new ApiError(404, 'This listing is no longer available', { code: 'CONTEXT_NOT_AVAILABLE' });

  let conversation;
  let result;
  try {
    // Conversation + both participants + the first message, all or nothing
    ({ conversation, result } = await sequelize.transaction(async (transaction) => {
      const c = await ChatConversation.create(
        {
          subjectType: SUBJECT_TYPES.NONE,
          subjectId: 0,
          participantsKey: participantsKey([me, owner]),
          createdByType: USER,
          createdById: user.id,
        },
        { transaction }
      );
      await ChatParticipant.bulkCreate(
        [
          { conversationId: c.id, ...me, userType: user.userType, role: PARTICIPANT_ROLES.STARTER },
          { conversationId: c.id, ...owner, userType: ownerUser.userType, role: PARTICIPANT_ROLES.OWNER },
        ],
        { transaction }
      );
      return { conversation: c, result: await addMessage(user, c, { text, clientMsgId, context, image }, transaction) };
    }));
  } catch (err) {
    // Started at the same moment by another request (e.g. a second tab) -> use that conversation
    if (!(err instanceof UniqueConstraintError)) throw err;
    const raced = await findPair([me, owner]);
    if (!raced) throw err;
    return { ...(await sendIn(user, raced, { text, clientMsgId, context, image })), created: false };
  }

  push(() => pushMessage(conversation.id, result.message));
  const [summary, [message]] = await Promise.all([summaryOf(conversation, me), messageShapes([result.message])]);
  return { conversation: summary, message, created: true };
}

// ---------- POST /me/conversations/:id/messages   { text?, clientMsgId? } (+ optional "image" file) ----------
async function send(user, id, { text, clientMsgId }, file = null) {
  return withImage(file, async (image) => sendIn(user, await findMine(user, id), { text, clientMsgId, image }));
}

// ---------- GET /me/conversations/:id/messages/:messageId/image ----------
// The photo of a message, for the conversation's participants only -> { fullPath, mimeType }
async function image(user, id, messageId) {
  await findMine(user, id);
  const message = await ChatMessage.findOne({ where: { id: messageId, conversationId: id } });
  const attachment = message && message.metadata && message.metadata.attachment;
  const missing = () => new ApiError(404, 'Image not found', { code: 'FILE_NOT_FOUND' });
  if (!attachment || attachment.kind !== 'image') throw missing();
  const fullPath = path.resolve(PRIVATE_DIR, attachment.filePath);
  if (!fullPath.startsWith(PRIVATE_DIR + path.sep) || !fs.existsSync(fullPath)) throw missing();
  return { fullPath, mimeType: attachment.mimeType };
}

// ---------- GET /me/conversations/:id/messages?before=&limit= ----------
// Newest page first; returned oldest -> newest (chat order). ?before=<message id> loads older ones.
async function messages(user, id, { before, limit }) {
  await findMine(user, id);
  const size = Math.min(Math.max(limit || MESSAGES_PAGE.defaultLimit, 1), MESSAGES_PAGE.maxLimit);
  const rows = await ChatMessage.findAll({
    where: { conversationId: id, ...(before ? { id: { [Op.lt]: before } } : {}) },
    order: [['id', 'DESC']],
    limit: size + 1,
  });
  return { items: await messageShapes(rows.slice(0, size).reverse()), hasMore: rows.length > size };
}

// ---------- PATCH /me/conversations/:id/read   { lastMessageId? } ----------
// Marks the conversation read up to lastMessageId (default: its newest message).
async function markRead(user, id, { lastMessageId } = {}) {
  const conversation = await findMine(user, id);
  const me = asParticipant(user);
  const newest = Number(conversation.lastMessageId || 0);
  const target = lastMessageId ? Math.min(lastMessageId, newest) : newest;

  const participant = await ChatParticipant.findOne({ where: { conversationId: id, ...me } });
  if (target && target > Number(participant.lastReadMessageId || 0)) {
    await participant.update({ lastReadMessageId: target, lastReadAt: new Date() });
    push(() => pushRead(conversation.id, me, target));
  }
  const [unread, totalUnread] = await Promise.all([unreadCounts(me, [conversation.id]), totalUnreadOf(me)]);
  return {
    conversationId: conversation.id,
    lastReadMessageId: participant.lastReadMessageId ? Number(participant.lastReadMessageId) : null,
    unreadCount: unread.get(conversation.id) || 0,
    totalUnread,
  };
}

module.exports = { list, unreadTotal, getOne, lookup, start, send, image, messages, markRead };
