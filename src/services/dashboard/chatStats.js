// CHAT COUNTS FOR THE DASHBOARDS: the one place to plug in your chat module.
//
// The seller dashboard shows "Customer enquiries" and the buyer dashboard "Messages".
// Chat is your module, so these return 0 until you fill them in, e.g.:
//
//   const { ChatMessage } = require('../../models');
//   async function unreadMessages(userId) {
//     return ChatMessage.count({ where: { recipientId: userId, readAt: null } });
//   }
//
// Keep the return values: numbers. A failure here never breaks a dashboard (it shows 0).

// Unread chat messages for this user (buyer "Messages", seller "Customer enquiries")
async function unreadMessages(userId) { // eslint-disable-line no-unused-vars
  return 0;
}

// Conversations started with this seller in the period ("Customer enquiries")
async function enquiriesInPeriod(userId, from, to) { // eslint-disable-line no-unused-vars
  return 0;
}

// true once the functions above are filled in (the dashboards then hide the "coming soon" note)
const connected = false;

module.exports = { unreadMessages, enquiriesInPeriod, connected };
