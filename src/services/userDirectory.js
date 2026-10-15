// One searchable list of ALL users, whatever their type.
//
// Each user type keeps its name / TIN / region in its own profile table, so this
// builds one SQL sub-query (UNION ALL) that gives every user the same columns:
//   user_id, display_name, sub_name, tin, region_id, subtype
//
// When a new user type is added, add one SELECT here.
const { sequelize } = require('../models');

const DIRECTORY_SQL = `
  SELECT fp.user_id,
         CONCAT_WS(' ', fp.first_name, fp.middle_name, fp.last_name) AS display_name,
         fp.farm_name AS sub_name,
         fp.farmer_id_tin AS tin,
         fp.region_id,
         NULL AS subtype
    FROM farmer_profiles fp
  UNION ALL
  SELECT bp.user_id, bp.name,
         CASE bp.buyer_type WHEN 'business' THEN 'Business / Food Processor' ELSE 'Individual Buyer' END,
         bp.id_number_tin, bp.region_id, bp.buyer_type
    FROM buyer_profiles bp
  UNION ALL
  SELECT tp.user_id, tp.business_name, CONCAT(tp.contact_first_name, ' ', tp.contact_last_name),
         tp.registration_number_tin, tp.region_id, NULL
    FROM trader_profiles tp
  UNION ALL
  SELECT lp.user_id, lp.business_name, CONCAT(lp.contact_first_name, ' ', lp.contact_last_name),
         lp.registration_number_tin, lp.region_id, NULL
    FROM logistics_profiles lp
  UNION ALL
  SELECT fi.user_id, fi.institution_name, CONCAT(fi.contact_first_name, ' ', fi.contact_last_name),
         fi.registration_number_tin, fi.region_id, NULL
    FROM fi_profiles fi
`;

const SORTS = {
  newest: 'u.created_at DESC, u.id DESC',
  oldest: 'u.created_at ASC, u.id ASC',
  name_asc: 'd.display_name ASC, u.id ASC',
  name_desc: 'd.display_name DESC, u.id DESC',
  submitted_oldest: 'u.submitted_at ASC, u.id ASC', // KYC queue: oldest first
  submitted_newest: 'u.submitted_at DESC, u.id DESC',
};

// Builds the WHERE part + replacements from filters.
//   { search, userType, status, regionId, submittedBefore, submittedAfter }
function buildWhere(filters = {}) {
  const where = ['u.deleted_at IS NULL'];
  const params = {};

  if (filters.userType) {
    where.push('u.user_type = :userType');
    params.userType = filters.userType;
  }
  if (filters.status) {
    where.push('u.status = :status');
    params.status = filters.status;
  }
  if (filters.regionId) {
    where.push('d.region_id = :regionId');
    params.regionId = filters.regionId;
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    where.push(
      '(d.display_name LIKE :search OR d.sub_name LIKE :search OR u.email LIKE :search OR u.mobile LIKE :search OR d.tin LIKE :search)'
    );
  }
  if (filters.submittedBefore) {
    where.push('u.submitted_at < :submittedBefore');
    params.submittedBefore = filters.submittedBefore;
  }
  if (filters.submittedAfter) {
    where.push('u.submitted_at >= :submittedAfter');
    params.submittedAfter = filters.submittedAfter;
  }
  return { whereSql: where.join(' AND '), params };
}

const FROM_SQL = `
  FROM users u
  LEFT JOIN (${DIRECTORY_SQL}) d ON d.user_id = u.id
  LEFT JOIN locations r ON r.id = d.region_id
`;

// Page of users + total count.
//   filters  -> see buildWhere
//   sort     -> key of SORTS
//   limit / offset -> paging (leave out for "all", e.g. CSV export)
async function findUsers(filters, { sort = 'newest', limit, offset = 0 } = {}) {
  const { whereSql, params } = buildWhere(filters);
  const orderSql = SORTS[sort] || SORTS.newest;
  const pageSql = limit ? 'LIMIT :limit OFFSET :offset' : '';

  const rows = await sequelize.query(
    `SELECT u.id, u.user_type, u.email, u.mobile, u.status, u.created_at, u.submitted_at,
            u.approved_at, u.status_reason,
            d.display_name, d.sub_name, d.tin, d.subtype, d.region_id, r.name AS region_name
     ${FROM_SQL}
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     ${pageSql}`,
    { replacements: { ...params, limit, offset }, type: sequelize.QueryTypes.SELECT }
  );

  const [{ total }] = await sequelize.query(`SELECT COUNT(*) AS total ${FROM_SQL} WHERE ${whereSql}`, {
    replacements: params,
    type: sequelize.QueryTypes.SELECT,
  });

  return { rows, total: Number(total) };
}

// Count users matching filters (used by the stats cards)
async function countUsers(filters) {
  const { whereSql, params } = buildWhere(filters);
  const [{ total }] = await sequelize.query(`SELECT COUNT(*) AS total ${FROM_SQL} WHERE ${whereSql}`, {
    replacements: params,
    type: sequelize.QueryTypes.SELECT,
  });
  return Number(total);
}

// One user's directory row (name, TIN, region, subtype)
async function findOne(userId) {
  const [row] = await sequelize.query(
    `SELECT d.display_name, d.sub_name, d.tin, d.subtype, d.region_id, r.name AS region_name
       FROM (${DIRECTORY_SQL}) d
       LEFT JOIN locations r ON r.id = d.region_id
      WHERE d.user_id = :userId`,
    { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
  );
  return row || null;
}

// Directory rows of many users at once (e.g. the sellers on one page of listings)
//   -> Map(userId -> { user_id, user_type, status, display_name, sub_name, region_id, region_name })
async function findMany(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await sequelize.query(
    `SELECT u.id AS user_id, u.user_type, u.status, d.display_name, d.sub_name, d.region_id, r.name AS region_name
       FROM users u
       LEFT JOIN (${DIRECTORY_SQL}) d ON d.user_id = u.id
       LEFT JOIN locations r ON r.id = d.region_id
      WHERE u.id IN (:ids)`,
    { replacements: { ids }, type: sequelize.QueryTypes.SELECT }
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

// User ids whose name / business name / email matches a search text (admin listing search)
async function findUserIdsByName(search, limit = 500) {
  const rows = await sequelize.query(
    `SELECT u.id FROM users u
       LEFT JOIN (${DIRECTORY_SQL}) d ON d.user_id = u.id
      WHERE d.display_name LIKE :search OR d.sub_name LIKE :search OR u.email LIKE :search
      LIMIT :limit`,
    { replacements: { search: `%${search}%`, limit }, type: sequelize.QueryTypes.SELECT }
  );
  return rows.map((r) => r.id);
}

// ---------- KYC documents of all users (admin "documents to review" list) ----------
//   filters -> { status, userType, documentType, search }
const DOC_SORTS = {
  oldest: 'ud.updated_at ASC, ud.id ASC',
  newest: 'ud.updated_at DESC, ud.id DESC',
};

async function findDocuments(filters = {}, { sort = 'oldest', limit, offset = 0 } = {}) {
  const where = ['u.deleted_at IS NULL'];
  const params = {};
  if (filters.status) {
    where.push('ud.status = :docStatus');
    params.docStatus = filters.status;
  }
  if (filters.userType) {
    where.push('u.user_type = :userType');
    params.userType = filters.userType;
  }
  if (filters.documentType) {
    where.push('ud.document_type = :documentType');
    params.documentType = filters.documentType;
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    where.push('(d.display_name LIKE :search OR u.email LIKE :search OR d.tin LIKE :search)');
  }
  const whereSql = where.join(' AND ');
  const from = `
    FROM user_documents ud
    JOIN users u ON u.id = ud.user_id
    LEFT JOIN (${DIRECTORY_SQL}) d ON d.user_id = u.id
    LEFT JOIN locations r ON r.id = d.region_id`;

  const rows = await sequelize.query(
    `SELECT ud.id, ud.user_id, ud.document_type, ud.original_name, ud.mime_type, ud.size_bytes,
            ud.status, ud.rejection_reason, ud.reviewed_at, ud.updated_at,
            u.user_type, u.status AS user_status,
            d.display_name, d.sub_name, d.subtype, d.region_id, r.name AS region_name
     ${from}
     WHERE ${whereSql}
     ORDER BY ${DOC_SORTS[sort] || DOC_SORTS.oldest}
     ${limit ? 'LIMIT :limit OFFSET :offset' : ''}`,
    { replacements: { ...params, limit, offset }, type: sequelize.QueryTypes.SELECT }
  );
  const [{ total }] = await sequelize.query(`SELECT COUNT(*) AS total ${from} WHERE ${whereSql}`, {
    replacements: params,
    type: sequelize.QueryTypes.SELECT,
  });
  return { rows, total: Number(total) };
}

module.exports = { findUsers, countUsers, findOne, findMany, findUserIdsByName, findDocuments, SORTS };
