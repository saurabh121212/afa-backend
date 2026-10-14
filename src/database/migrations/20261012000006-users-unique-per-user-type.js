'use strict';

// Business rule: the SAME email and mobile number may be used for DIFFERENT user types
// (e.g. a person can be a Farmer AND a Buyer), but only ONCE per user type.
//
// Before: email unique, mobile unique (whole table)
// After:  (user_type, email) unique, (user_type, mobile) unique
//
// Also adds an index so OTP codes are looked up per user account (not per email).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // 1. Remove the old single-column unique indexes on email and mobile.
    //    (MySQL named them automatically, so we look them up instead of guessing.)
    const [rows] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM users WHERE Non_unique = 0 AND Key_name <> 'PRIMARY'"
    );
    const columnsByIndex = {};
    rows.forEach((r) => {
      columnsByIndex[r.Key_name] = columnsByIndex[r.Key_name] || [];
      columnsByIndex[r.Key_name].push(r.Column_name);
    });
    for (const [indexName, columns] of Object.entries(columnsByIndex)) {
      if (columns.length === 1 && ['email', 'mobile'].includes(columns[0])) {
        await queryInterface.removeIndex('users', indexName);
      }
    }

    // 2. Unique per user type
    await queryInterface.addIndex('users', ['user_type', 'email'], {
      unique: true,
      name: 'users_type_email_unique',
    });
    await queryInterface.addIndex('users', ['user_type', 'mobile'], {
      unique: true,
      name: 'users_type_mobile_unique',
    });

    // 3. Fast lookup of OTP codes per user account
    await queryInterface.addIndex('email_otps', ['user_id', 'purpose'], {
      name: 'email_otps_user_purpose_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('email_otps', 'email_otps_user_purpose_idx');
    await queryInterface.removeIndex('users', 'users_type_email_unique');
    await queryInterface.removeIndex('users', 'users_type_mobile_unique');
    // Note: this fails if the same email/mobile is already used by two user types.
    await queryInterface.addIndex('users', ['email'], { unique: true, name: 'email' });
    await queryInterface.addIndex('users', ['mobile'], { unique: true, name: 'mobile' });
  },
};
