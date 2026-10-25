// Things a chat message can refer to ("context", e.g. the listing a buyer asks about) and that a
// conversation can be started from ("Message Seller"). One handler per type:
//
//   find(id)          -> the item even if it is no longer live (deleted / paused), or null
//   isLive(id)        -> can it be referred to / started from right now?
//   ownerOf(item)     -> the account that owns it { participantType, participantId } (who to chat with)
//   snapshot(item)    -> what is copied onto the message (so it still shows after the item changes)
//   liveMany(ids)     -> Map(id -> current card + available flag), to show references in a history
//
// Add a handler here (and a START_RULES entry in config/chat) to refer to orders, bookings...
const { Listing } = require('../../models');
const { LISTING_STATUS } = require('../../config/listingOptions');
const { SUBJECT_TYPES, PARTICIPANT_TYPES } = require('../../config/chat');
const { baseShape, listingInclude } = require('../listing.service');
const { visibleIncludes } = require('../marketplace.service');

// The listing card shown in the chat ("White Maize — Grade A · E 5.20 / kg")
const listingCard = (l) => {
  const shape = baseShape(l);
  return {
    id: shape.id,
    kind: shape.kind,
    name: shape.name,
    priceLabel: shape.priceLabel,
    coverPhotoUrl: shape.coverPhotoUrl,
    category: shape.category ? shape.category.name : null,
    ownerId: l.userId, // the seller (public: the listing page shows the seller too)
  };
};

// Listings live on the marketplace right now (same rules as the public marketplace)
async function liveListingIds(ids) {
  if (!ids.length) return new Set();
  const rows = await Listing.findAll({
    where: { id: ids, status: LISTING_STATUS.ACTIVE },
    attributes: ['id'],
    include: visibleIncludes().filter((inc) => inc.required), // seller approved + category active
  });
  return new Set(rows.map((r) => r.id));
}

const listing = {
  find: (id) => Listing.findOne({ where: { id }, include: listingInclude(), paranoid: false }),
  isLive: async (id) => (await liveListingIds([id])).has(id),
  ownerOf: (l) => ({ participantType: PARTICIPANT_TYPES.USER, participantId: l.userId }),
  snapshot: (l) => listingCard(l),
  async liveMany(ids) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const [rows, live] = await Promise.all([
      Listing.findAll({ where: { id: unique }, include: listingInclude(), paranoid: false }),
      liveListingIds(unique),
    ]);
    return new Map(rows.map((l) => [l.id, { ...listingCard(l), available: live.has(l.id) }]));
  },
};

const HANDLERS = { [SUBJECT_TYPES.LISTING]: listing };

const handlerFor = (subjectType) => HANDLERS[subjectType] || null;

module.exports = { handlerFor };
