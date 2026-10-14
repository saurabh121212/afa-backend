// Page / limit helpers for list endpoints.
//   ?page=2&limit=20  ->  { page: 2, limit: 20, offset: 20 }

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getPagination({ page, limit } = {}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page: p, limit: l, offset: (p - 1) * l };
}

// Shape returned to the client
function paginationMeta({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

module.exports = { getPagination, paginationMeta, DEFAULT_LIMIT, MAX_LIMIT };
