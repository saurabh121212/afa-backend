'use strict';

// Weather: coordinates of the 4 regions (their main towns). Tinkhundla without their own
// coordinates use their region's weather until the weather job finds them, or the admin sets them.
//
// Safe to run more than once: only fills regions that have no coordinates yet,
// and never touches coordinates set by the admin.

const REGION_COORDINATES = [
  { name: 'Hhohho', latitude: -26.316667, longitude: 31.133333 }, // Mbabane
  { name: 'Manzini', latitude: -26.483333, longitude: 31.366667 }, // Manzini
  { name: 'Lubombo', latitude: -26.45, longitude: 31.95 }, // Siteki
  { name: 'Shiselweni', latitude: -27.116667, longitude: 31.2 }, // Nhlangano
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    let updated = 0;
    for (const r of REGION_COORDINATES) {
      // eslint-disable-next-line no-await-in-loop
      const [result] = await queryInterface.sequelize.query(
        `UPDATE locations
            SET latitude = ?, longitude = ?, coordinates_source = 'seed', updated_at = NOW()
          WHERE type = 'region' AND LOWER(name) = LOWER(?) AND latitude IS NULL AND deleted_at IS NULL`,
        { replacements: [r.latitude, r.longitude, r.name] }
      );
      updated += result && result.affectedRows ? result.affectedRows : 0;
    }
    console.log(`✅ Region coordinates: ${updated} region(s) updated.`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE locations SET latitude = NULL, longitude = NULL, coordinates_source = NULL WHERE type = 'region' AND coordinates_source = 'seed'"
    );
  },
};
