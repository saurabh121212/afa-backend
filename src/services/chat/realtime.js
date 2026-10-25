// Pushes chat events to connected apps over Socket.IO.
//
// Every connection joins one private room per account, e.g. "user:42" (see src/socket/index.js).
// The services save first and push afterwards; pushing is best-effort: an app that is offline or
// misses an event reloads the data over the API when it reconnects.
let io = null;

const roomOf = (participantType, participantId) => `${participantType}:${participantId}`;

// Called once by the Socket.IO server at start-up
function attach(server) {
  io = server;
}

function emitTo(participant, event, payload) {
  if (!io) return;
  io.to(roomOf(participant.participantType, participant.participantId)).emit(event, payload);
}

// Events the apps listen to
const EVENTS = {
  MESSAGE: 'chat:message', // { message, conversation, totalUnread } (conversation as the receiver sees it)
  READ: 'chat:read', // { conversationId, readerType, readerId, lastReadMessageId, totalUnread? }
};

module.exports = { attach, emitTo, roomOf, EVENTS };
