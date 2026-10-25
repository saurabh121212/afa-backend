// Realtime connections (Socket.IO) on the same server and port as the REST API.
//
// The app connects with its login token:   io(API_ORIGIN, { auth: { token } })
// The token is checked like every REST request (middlewares/userAuth.js). Each connection joins
// its account's private room ("user:<id>"); modules push events to that room (chat: new
// messages and read receipts, see services/chat/realtime.js). Apps only RECEIVE events here:
// every change still goes through the REST API, which checks and saves it.
const { Server } = require('socket.io');
const config = require('../config');
const { decodeToken, authenticateUser } = require('../middlewares/userAuth');
const chatRealtime = require('../services/chat/realtime');
const { PARTICIPANT_TYPES } = require('../config/chat');

// Re-check open connections this often: a token that expired, a changed password or a
// suspended account ends the connection (the app then signs the user out).
const RECHECK_EVERY_MS = 5 * 60 * 1000;

async function userFromHandshake(socket) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token || typeof token !== 'string') {
    const err = new Error('Authentication token missing');
    err.code = 'TOKEN_MISSING';
    throw err;
  }
  const payload = decodeToken(token);
  return { payload, user: await authenticateUser(payload) };
}

function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins.length ? config.corsOrigins : '*', credentials: true },
  });

  // Every connection must be a logged-in account
  io.use(async (socket, next) => {
    try {
      const { payload, user } = await userFromHandshake(socket);
      socket.data.user = { id: user.id, userType: user.userType };
      socket.data.tokenPayload = payload;
      next();
    } catch (err) {
      const error = new Error(err.message || 'Not authorised');
      error.data = { code: err.code || 'UNAUTHORIZED' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const { id } = socket.data.user;
    socket.join(chatRealtime.roomOf(PARTICIPANT_TYPES.USER, id));

    const recheck = setInterval(async () => {
      try {
        const payload = socket.data.tokenPayload;
        if (payload.exp && payload.exp * 1000 <= Date.now()) {
          const err = new Error('Your session has expired, please log in again');
          err.statusCode = 401;
          err.code = 'TOKEN_EXPIRED';
          throw err;
        }
        await authenticateUser(payload);
      } catch (err) {
        if (!err.statusCode) return; // e.g. the database was briefly unreachable: check again next time
        socket.emit('session:ended', { code: err.code || 'UNAUTHORIZED', message: err.message });
        socket.disconnect(true);
      }
    }, RECHECK_EVERY_MS);
    socket.on('disconnect', () => clearInterval(recheck));
  });

  chatRealtime.attach(io);
  return io;
}

module.exports = { attachSocketServer };
