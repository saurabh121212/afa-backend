'use strict';

// Creates the ONE system admin from the values in .env.
// If any admin already exists, it does nothing — the system never has more than one.
const bcrypt = require('bcryptjs');
require('dotenv').config();

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const name = process.env.ADMIN_NAME || 'AFA Admin';
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const phone = process.env.ADMIN_PHONE || null;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    }
    if (password.length < 8) {
      throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    }

    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS total FROM admins'
    );
    if (Number(rows[0].total) > 0) {
      console.log('ℹ️  Admin already exists, skipping. The system allows only one admin.');
      return;
    }

    const now = new Date();
    await queryInterface.bulkInsert('admins', [
      {
        name,
        email,
        phone,
        password: await bcrypt.hash(password, 12),
        created_at: now,
        updated_at: now,
      },
    ]);
    console.log(`✅ Admin created: ${email}`);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('admins', null, {});
  },
};
