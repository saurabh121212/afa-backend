'use strict';

// Chat: ONE conversation per pair of accounts (buyer <-> seller), no longer one per listing.
// Listings become optional context on single messages (chat_messages.metadata.context).
//
// Existing data is merged, nothing is lost:
//   - All conversations of the same participants are merged into one (the oldest), which becomes
//     a plain conversation (subject_type 'none'). Its messages keep their ids and order.
//   - The listing each old conversation was about is copied onto that conversation's first message
//     as its product reference, so the history still shows what was asked about.
//   - Unread state is kept: each participant's read position becomes just before the first message
//     they hadn't read in any of the merged conversations.
//   - The emptied conversations are soft-deleted (deleted_at), not removed.

const parse = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.transaction(async (transaction) => {
      const run = (sql, replacements = {}) => q.query(sql, { replacements, transaction });
      const [conversations] = await run(
        `SELECT id, subject_type, subject_id, subject_snapshot, participants_key
           FROM chat_conversations WHERE deleted_at IS NULL ORDER BY created_at, id`
      );

      const byPair = new Map();
      conversations.forEach((c) => byPair.set(c.participants_key, [...(byPair.get(c.participants_key) || []), c]));

      for (const group of byPair.values()) {
        const keeper = group.find((c) => c.subject_type === 'none') || group[0];
        const others = group.filter((c) => c.id !== keeper.id);
        const ids = group.map((c) => c.id);

        // 1. The listing of each conversation -> product reference on its first message
        for (const c of group) {
          const snapshot = parse(c.subject_snapshot);
          if (c.subject_type === 'none' || !snapshot) continue;
          const [[first]] = await run(
            'SELECT id, metadata FROM chat_messages WHERE conversation_id = :id ORDER BY id LIMIT 1',
            { id: c.id }
          );
          if (!first) continue;
          const metadata = parse(first.metadata) || {};
          if (metadata.context) continue;
          metadata.context = { ...snapshot, type: c.subject_type, id: c.subject_id };
          await run('UPDATE chat_messages SET metadata = :metadata WHERE id = :id', {
            id: first.id,
            metadata: JSON.stringify(metadata),
          });
        }

        // 2. Read positions over all the merged conversations (before moving the messages)
        const [members] = await run(
          'SELECT conversation_id, participant_type, participant_id, last_read_message_id FROM chat_participants WHERE conversation_id IN (:ids)',
          { ids }
        );
        const pointers = new Map();
        for (const p of members) {
          const key = `${p.participant_type}:${p.participant_id}`;
          const [[row]] = await run(
            `SELECT MIN(id) AS first_unread FROM chat_messages
              WHERE conversation_id = :conversationId AND deleted_at IS NULL
                AND id > COALESCE(:lastRead, 0)
                AND NOT (sender_type = :type AND sender_id = :pid)`,
            { conversationId: p.conversation_id, lastRead: p.last_read_message_id, type: p.participant_type, pid: p.participant_id }
          );
          const current = pointers.get(key) || { maxRead: 0, firstUnread: null };
          current.maxRead = Math.max(current.maxRead, Number(p.last_read_message_id || 0));
          if (row && row.first_unread) {
            const unread = Number(row.first_unread);
            current.firstUnread = current.firstUnread === null ? unread : Math.min(current.firstUnread, unread);
          }
          pointers.set(key, current);
        }

        // 3. Move the messages into the kept conversation
        if (others.length) {
          await run('UPDATE chat_messages SET conversation_id = :keeper WHERE conversation_id IN (:others)', {
            keeper: keeper.id,
            others: others.map((c) => c.id),
          });
        }

        // 4. The kept conversation is now the pair's plain conversation
        const [[last]] = await run(
          'SELECT id, created_at FROM chat_messages WHERE conversation_id = :id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
          { id: keeper.id }
        );
        await run(
          `UPDATE chat_conversations
              SET subject_type = 'none', subject_id = 0, subject_snapshot = NULL,
                  last_message_id = :lastId, last_message_at = :lastAt, updated_at = NOW()
            WHERE id = :id`,
          { id: keeper.id, lastId: last ? last.id : null, lastAt: last ? last.created_at : null }
        );
        for (const [key, p] of pointers) {
          const [type, pid] = key.split(':');
          await run(
            `UPDATE chat_participants SET last_read_message_id = :pointer, updated_at = NOW()
              WHERE conversation_id = :id AND participant_type = :type AND participant_id = :pid`,
            { id: keeper.id, type, pid: Number(pid), pointer: p.firstUnread !== null ? p.firstUnread - 1 || null : p.maxRead || null }
          );
        }

        // 5. Soft-delete the emptied conversations
        if (others.length) {
          await run('UPDATE chat_conversations SET deleted_at = NOW() WHERE id IN (:others)', { others: others.map((c) => c.id) });
        }
      }
    });
  },

  // Merged conversations can't be split again safely (new messages have no listing to go back to).
  async down() {},
};
