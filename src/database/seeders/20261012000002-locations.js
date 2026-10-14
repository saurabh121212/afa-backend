'use strict';

// Seeds the 4 regions of Eswatini, plus ONE SAMPLE Inkhundla and ONE SAMPLE
// Umphakatsi under each region so registration can be tested.
//
// IMPORTANT: the "Sample ..." rows are placeholders. Replace them with the
// official list of Tinkhundla and Imiphakatsi from the client before go-live
// (admin Location Management will be built in the Marketplace module).
//
// Safe to run more than once: skips if regions already exist.

const REGIONS = ['Hhohho', 'Manzini', 'Lubombo', 'Shiselweni'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT COUNT(*) AS total FROM locations WHERE type = 'region'"
    );
    if (Number(rows[0].total) > 0) {
      console.log('ℹ️  Locations already seeded, skipping.');
      return;
    }

    const now = new Date();
    const insert = async (name, type, parentId) => {
      await queryInterface.bulkInsert('locations', [
        { name, type, parent_id: parentId, is_active: true, created_at: now, updated_at: now },
      ]);
      const [found] = await queryInterface.sequelize.query(
        'SELECT id FROM locations WHERE name = ? AND type = ? AND parent_id <=> ? LIMIT 1',
        { replacements: [name, type, parentId] }
      );
      return found[0].id;
    };

    for (const region of REGIONS) {
      const regionId = await insert(region, 'region', null);
      const inkhundlaId = await insert(`Sample Inkhundla - ${region}`, 'inkhundla', regionId);
      await insert(`Sample Umphakatsi - ${region}`, 'umphakatsi', inkhundlaId);
    }
    console.log('✅ Locations seeded (4 regions + sample Tinkhundla/Imiphakatsi).');
  },

  async down(queryInterface) {
    // Children first, then parents.
    await queryInterface.bulkDelete('locations', { type: 'umphakatsi' });
    await queryInterface.bulkDelete('locations', { type: 'inkhundla' });
    await queryInterface.bulkDelete('locations', { type: 'region' });
  },
};
