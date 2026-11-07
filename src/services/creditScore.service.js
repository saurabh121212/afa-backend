// CREDIT SCORE for farmers, traders and logistics providers (rules: config/creditScore.js,
// calculation: services/creditScore/calculator.js). Used in phase 2 for loans, so:
//   - every change is logged (credit_score_changes: old -> new, which parts, what caused it)
//   - the formula has a version number stored with each score
//   - scores come from data only (no manual override)
//
// Kept up to date:
//   - refreshSoon(userId, trigger) after events: account approved / suspended, KYC document uploaded or
//     reviewed, order completed or cancelled, claim refunded, rating changed (several events within
//     3 seconds -> one recalculation). Never throws.
//   - refreshStale(): run by the background jobs; recalculates scores older than 24 hours and users
//     without a score (catches expired insurance and anything an event missed)
//
//   user   GET /me/credit-score, GET /me/credit-score/history
//   admin  /admin/credit-scores: stats, list, export, one user (+ changes), recalculate, recalculate all
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const { calculate } = require('./creditScore/calculator');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { toCsvLine } = require('../utils/csv');
const { displayId } = require('../utils/displayId');
const { USER_TYPE_LABELS, USER_STATUS_LABELS } = require('../utils/constants');
const { getDocumentTypes, isAvailableFor, countsForKyc } = require('../config/documentTypes');
const { todayYmd } = require('../config/bookings');
const C = require('../config/creditScore');

const { sequelize, CreditScore, CreditScoreChange, User, UserDocument, SellerOrder, Claim, Review } = models;

const notAvailable = () =>
  new ApiError(403, 'Credit scores are for farmers, traders and service providers', { code: 'CREDIT_SCORE_NOT_AVAILABLE' });
const isScored = (userType) => C.SCORED_USER_TYPES.includes(userType);

// ======================= INPUTS (from the database) =======================
async function gather(userId, { transaction } = {}) {
  const user = await User.findOne({ where: { id: userId }, attributes: ['id', 'userType', 'status'], transaction });
  if (!user || !isScored(user.userType)) return null;
  const [dir, docs, sos, refundedClaims, reviews] = await Promise.all([
    directory.findOne(userId),
    UserDocument.findAll({ where: { userId }, attributes: ['documentType', 'status', 'expiresAt'], transaction }),
    SellerOrder.findAll({ where: { sellerId: userId, paidAt: { [Op.ne]: null } }, attributes: ['id', 'status', 'cancelledBy'], transaction }),
    // a claim counts as a failed order only when money was actually refunded
    Claim.findAll({ where: { sellerId: userId, status: 'resolved', refundId: { [Op.ne]: null } }, attributes: ['sellerOrderId'], transaction }),
    // exact average of published reviews (users.rating_avg is rounded to 1 decimal for display)
    Review.findAll({ where: { sellerId: userId, status: 'published' }, attributes: ['rating'], transaction }),
  ]);
  const subtype = dir ? dir.subtype : null;
  const byType = new Map(docs.map((d) => [d.documentType, d]));
  const types = getDocumentTypes(user.userType);

  // 1. KYC documents of the account check (not the VAT certificate / farmer & trader insurance)
  const kycDocuments = Object.entries(types)
    .filter(([, rules]) => isAvailableFor(rules, subtype) && countsForKyc(rules))
    .map(([documentType, rules]) => ({ documentType, label: rules.label, status: byType.has(documentType) ? byType.get(documentType).status : 'missing' }));

  // 2. Sales: each paid seller order counted once
  const paidIds = new Set(sos.map((so) => so.id));
  const claimFailed = new Set(refundedClaims.map((c) => c.sellerOrderId).filter((id) => paidIds.has(id)));
  const successful = sos.filter((so) => so.status === 'completed' && !claimFailed.has(so.id)).length;
  const failedCancelled = sos.filter((so) => so.status === 'cancelled' && C.FAILED_CANCELLED_BY.includes(so.cancelledBy) && !claimFailed.has(so.id)).length;

  // 4. Insurance document of this user type
  const insuranceType = C.INSURANCE_DOCUMENT[user.userType];
  const insuranceDoc = insuranceType ? byType.get(insuranceType) : null;
  const insurance = insuranceType
    ? {
        documentType: insuranceType,
        label: (types[insuranceType] || {}).label || 'insurance certificate',
        status: insuranceDoc ? insuranceDoc.status : 'missing',
        expiresAt: insuranceDoc && insuranceDoc.expiresAt ? String(insuranceDoc.expiresAt).slice(0, 10) : null,
      }
    : null;

  return {
    user,
    input: {
      userType: user.userType,
      accountStatus: user.status,
      kycDocuments,
      sales: { successful, failedCancelled, failedClaims: claimFailed.size },
      rating: {
        average: reviews.length ? reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length : null,
        count: reviews.length,
      },
      insurance,
      today: todayYmd(),
    },
  };
}

// ======================= SAVE =======================
const COLUMN = { kyc: 'kycPoints', sales: 'salesPoints', loans: 'loanPoints', insurance: 'insurancePoints', rating: 'ratingPoints' };
const pointsOf = (row) => Object.fromEntries(C.PART_KEYS.map((k) => [k, Number(row[COLUMN[k]] || 0)]));

// What we keep of a calculation: the parts with their explanation (shown to the user and admin later)
const detailsOf = (result) => ({
  maxPossibleNow: result.maxPossibleNow,
  gradeLabel: result.gradeLabel,
  parts: Object.fromEntries(
    C.PART_KEYS.map((k) => {
      const p = result.parts[k];
      return [k, { points: p.points, status: p.status, summary: p.summary, tip: p.tip, data: p.data }];
    })
  ),
});

// Recalculate and save one user's score. Returns the saved row (or null for users without a score).
// The user's row is locked first, so two recalculations of the same user run one after the other
// and each reads the data inside its own transaction (no older result can overwrite a newer one).
const RETRYABLE = (err) =>
  err && (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === 'ER_LOCK_DEADLOCK')); // a lock wait timeout is not retried (the daily check catches up)

async function refresh(userId, trigger = 'daily', attempt = 0) {
  try {
    return await sequelize.transaction(async (transaction) => {
      const locked = await User.findOne({ where: { id: userId }, attributes: ['id', 'userType'], transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || !isScored(locked.userType)) return null;
      const gathered = await gather(userId, { transaction });
      if (!gathered) return null;
      const result = calculate(gathered.input);
      const values = {
        score: result.score,
        grade: result.grade,
        ...Object.fromEntries(C.PART_KEYS.map((k) => [COLUMN[k], result.parts[k].points])),
        details: detailsOf(result),
        formulaVersion: C.FORMULA_VERSION,
        calculatedAt: new Date(),
      };
      const existing = await CreditScore.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
      // read the old values BEFORE update() (it changes the same object)
      const before = existing ? pointsOf(existing) : null;
      const oldScore = existing ? Number(existing.score) : null;
      const after = Object.fromEntries(C.PART_KEYS.map((k) => [k, result.parts[k].points]));
      const changedParts = C.PART_KEYS.filter((k) => !before || before[k] !== after[k]).map((k) => ({ part: k, from: before ? before[k] : null, to: after[k] }));
      const row = existing ? await existing.update(values, { transaction }) : await CreditScore.create({ userId, ...values }, { transaction });
      if (!existing || changedParts.length || oldScore !== result.score) {
        await CreditScoreChange.create(
          {
            userId,
            oldScore,
            newScore: result.score,
            grade: result.grade,
            parts: after,
            changedParts: existing ? changedParts : null,
            trigger: existing ? String(trigger).slice(0, 255) : 'first',
            formulaVersion: C.FORMULA_VERSION,
          },
          { transaction }
        );
      }
      return row;
    });
  } catch (err) {
    // a first calculation running at the same time, or a deadlock: try once more
    if (RETRYABLE(err) && attempt < 2) return refresh(userId, trigger, attempt + 1);
    throw err;
  }
}

// After an event: recalculate a few seconds later (events close together -> one run, all causes logged).
// Pass the transaction of the change: the recalculation is only scheduled once it is COMMITTED
// (nothing happens if it rolls back). Never throws.
const pendingRefresh = new Map(); // userId -> { timer, triggers: Set }
function schedule(userId, trigger) {
  const existing = pendingRefresh.get(userId);
  if (existing) clearTimeout(existing.timer);
  const triggers = existing ? existing.triggers : new Set();
  triggers.add(trigger);
  const timer = setTimeout(() => {
    pendingRefresh.delete(userId);
    refresh(userId, [...triggers].join(',')).catch((err) => console.error(`[credit score] refresh failed for user ${userId}:`, err.message));
  }, C.RULES.refreshDelayMs);
  if (timer.unref) timer.unref();
  pendingRefresh.set(userId, { timer, triggers });
}
function refreshSoon(userId, trigger, transaction = null) {
  if (!userId) return;
  try {
    if (transaction && typeof transaction.afterCommit === 'function') transaction.afterCommit(() => schedule(Number(userId), trigger));
    else schedule(Number(userId), trigger);
  } catch (err) {
    console.error('[credit score] refreshSoon failed:', err.message);
  }
}

// Background job: users without a score + scores older than 24 hours (a batch per run)
async function refreshStale() {
  const cutoff = new Date(Date.now() - C.RULES.staleHours * 3600 * 1000);
  const today = todayYmd();
  const [users, scored] = await Promise.all([
    User.findAll({ where: { userType: { [Op.in]: C.SCORED_USER_TYPES } }, attributes: ['id'] }),
    CreditScore.findAll({ attributes: ['userId', 'calculatedAt', 'insurancePoints', 'details'] }),
  ]);
  const scoredAt = new Map(scored.map((s) => [s.userId, new Date(s.calculatedAt)]));
  // insurance points given for a cover that has ended since: recalculate today, not in 24 hours
  const insuranceEnded = new Set(
    scored
      .filter((s) => {
        const ins = s.details && s.details.parts && s.details.parts.insurance;
        return Number(s.insurancePoints) > 0 && ins && ins.data && ins.data.expiresAt && ins.data.expiresAt < today;
      })
      .map((s) => s.userId)
  );
  const due = users
    .map((u) => u.id)
    .filter((id) => !scoredAt.has(id) || scoredAt.get(id) < cutoff || insuranceEnded.has(id))
    .sort((a, b) => (scoredAt.get(a) || 0) - (scoredAt.get(b) || 0))
    .slice(0, C.RULES.dailyBatch);
  let done = 0;
  for (const id of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await refresh(id, 'daily');
      done += 1;
    } catch (err) {
      console.error(`[credit score] daily refresh failed for user ${id}:`, err.message);
    }
  }
  return done;
}

// ======================= SHAPES =======================
function scoreShape(row) {
  const d = row.details || {};
  const parts = C.PART_KEYS.map((k) => {
    const p = (d.parts || {})[k] || {};
    const status = p.status || 'none';
    return {
      key: k,
      label: C.PARTS[k].label,
      points: Number(row[COLUMN[k]] || 0),
      max: C.PARTS[k].max,
      status,
      statusLabel: C.PART_STATUS[status],
      summary: p.summary || null,
      tip: p.tip || null,
      data: p.data || {},
    };
  });
  const grade = C.GRADES.find((g) => g.key === row.grade) || C.gradeOf(row.score);
  return {
    score: row.score,
    maxScore: C.MAX_SCORE,
    maxPossibleNow: d.maxPossibleNow || C.MAX_SCORE,
    grade: grade.key,
    gradeLabel: grade.label,
    grades: C.GRADES.map((g) => ({ key: g.key, label: g.label, min: g.min })),
    parts,
    tips: parts.filter((p) => p.tip).map((p) => ({ part: p.key, label: p.label, tip: p.tip, pointsAvailable: p.status === 'not_available' ? 0 : p.max - p.points })),
    formulaVersion: row.formulaVersion,
    calculatedAt: row.calculatedAt,
  };
}

const changeShape = (c) => ({
  id: c.id,
  at: c.createdAt,
  oldScore: c.oldScore,
  newScore: c.newScore,
  difference: c.oldScore === null || c.oldScore === undefined ? null : c.newScore - c.oldScore,
  grade: c.grade,
  trigger: c.trigger,
  triggers: String(c.trigger || '').split(',').filter(Boolean),
  triggerLabel: String(c.trigger || '')
    .split(',')
    .filter(Boolean)
    .map((t) => C.TRIGGERS[t] || t)
    .join(', '),
  changedParts: (c.changedParts || []).map((p) => ({ ...p, label: C.PARTS[p.part] ? C.PARTS[p.part].label : p.part })),
  parts: c.parts,
  formulaVersion: c.formulaVersion,
});

// Score at the end of each of the last 12 months (null before the first calculation)
function monthlySeries(changes) {
  const ym = (date) => new Date(new Date(date).getTime() + 2 * 3600 * 1000).toISOString().slice(0, 7);
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  const months = [];
  for (let i = C.RULES.historyMonths - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const sorted = [...changes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id); // same second: by id
  return months.map((m) => {
    const upTo = sorted.filter((c) => ym(c.createdAt) <= m);
    const last = upTo[upTo.length - 1];
    const d = new Date(`${m}-01T00:00:00Z`);
    return { month: m, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), score: last ? last.newScore : null };
  });
}

async function currentRow(userId) {
  const row = await CreditScore.findOne({ where: { userId } });
  return row || refresh(userId, 'first');
}

// ======================= USER =======================

// GET /me/credit-score
async function getMine(user) {
  if (!isScored(user.userType)) throw notAvailable();
  const row = await currentRow(user.id);
  return {
    ...scoreShape(row),
    note: 'Your credit score is private. It will help you apply for loans with financial institutions on AFA in the future.',
  };
}

// GET /me/credit-score/history   monthly score + latest changes
async function history(user) {
  if (!isScored(user.userType)) throw notAvailable();
  await currentRow(user.id);
  const changes = await CreditScoreChange.findAll({ where: { userId: user.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
  return { months: monthlySeries(changes), changes: changes.slice(0, 20).map(changeShape) };
}

// ======================= ADMIN =======================
async function userInfo(ids) {
  const dirs = await directory.findMany(ids);
  return (id) => {
    const d = dirs.get(id) || {};
    return {
      userId: id,
      displayId: d.user_type ? displayId(d.user_type, id) : null,
      name: d.user_type === 'farmer' ? d.display_name : d.display_name || null,
      subName: d.sub_name || null,
      userType: d.user_type || null,
      userTypeLabel: USER_TYPE_LABELS[d.user_type] || null,
      region: d.region_name || null,
      accountStatus: d.status || null,
      accountStatusLabel: USER_STATUS_LABELS[d.status] || null,
    };
  };
}

const ADMIN_SORTS = {
  score_desc: [['score', 'DESC'], ['userId', 'ASC']],
  score_asc: [['score', 'ASC'], ['userId', 'ASC']],
  recent: [['calculatedAt', 'DESC'], ['userId', 'ASC']],
};

// Filters -> where on credit_scores (name / region / type go through the user directory)
async function adminWhere(query) {
  const where = {};
  if (query.grade) where.grade = query.grade;
  if (query.minScore !== undefined || query.maxScore !== undefined) {
    where.score = { ...(query.minScore !== undefined ? { [Op.gte]: query.minScore } : {}), ...(query.maxScore !== undefined ? { [Op.lte]: query.maxScore } : {}) };
  }
  let ids = null;
  const intersect = (list) => {
    ids = ids === null ? new Set(list) : new Set(list.filter((x) => ids.has(x)));
  };
  if (query.userType || query.regionId) {
    intersect(
      await directory.findUserIdsForAudience({
        userTypes: query.userType ? [query.userType] : C.SCORED_USER_TYPES,
        regionIds: query.regionId ? [query.regionId] : [],
      })
    );
  }
  if (query.search) intersect(await directory.findUserIdsByName(query.search));
  if (ids !== null) where.userId = [...ids];
  return where;
}

const adminRow = (row, info) => ({
  ...info(row.userId),
  score: row.score,
  grade: row.grade,
  gradeLabel: (C.GRADES.find((g) => g.key === row.grade) || {}).label || row.grade,
  parts: pointsOf(row),
  calculatedAt: row.calculatedAt,
});

// GET /admin/credit-scores   (?userType=&grade=&regionId=&minScore=&maxScore=&search=&sort=score_desc|score_asc|recent&page=)
async function adminList(query = {}) {
  const pg = getPagination(query);
  const where = await adminWhere(query);
  const { rows, count } = await CreditScore.findAndCountAll({ where, order: ADMIN_SORTS[query.sort] || ADMIN_SORTS.score_desc, limit: pg.limit, offset: pg.offset });
  const info = await userInfo(rows.map((r) => r.userId));
  return { items: rows.map((r) => adminRow(r, info)), pagination: paginationMeta(pg, count) };
}

// GET /admin/credit-scores/stats
async function stats() {
  const [rows, eligible] = await Promise.all([
    CreditScore.findAll({ attributes: ['userId', 'score', 'grade', ...Object.values(COLUMN)] }),
    User.findAll({ where: { userType: { [Op.in]: C.SCORED_USER_TYPES } }, attributes: ['id', 'userType'] }),
  ]);
  const typeOf = new Map(eligible.map((u) => [u.id, u.userType]));
  const avg = (list) => (list.length ? Math.round((list.reduce((s, r) => s + r.score, 0) / list.length) * 10) / 10 : null);
  const partAvg = (list, k) => (list.length ? C.round1(list.reduce((s, r) => s + Number(r[COLUMN[k]] || 0), 0) / list.length) : null);
  const live = rows.filter((r) => typeOf.has(r.userId));
  const scoredIds = new Set(rows.map((r) => r.userId));
  return {
    scored: live.length,
    notScoredYet: eligible.filter((u) => !scoredIds.has(u.id)).length,
    averageScore: avg(live),
    byGrade: C.GRADES.map((g) => ({ grade: g.key, label: g.label, min: g.min, count: live.filter((r) => r.grade === g.key).length })),
    byUserType: C.SCORED_USER_TYPES.map((t) => {
      const list = live.filter((r) => typeOf.get(r.userId) === t);
      return { userType: t, label: USER_TYPE_LABELS[t], count: list.length, averageScore: avg(list) };
    }),
    // average points of each part: shows where users lose points
    partAverages: C.PART_KEYS.map((k) => ({ part: k, label: C.PARTS[k].label, max: C.PARTS[k].max, average: partAvg(live, k) })),
    formulaVersion: C.FORMULA_VERSION,
  };
}

// GET /admin/credit-scores/:userId   score + all changes
async function adminGet(userId) {
  const user = await User.findOne({ where: { id: userId }, attributes: ['id', 'userType'] });
  if (!user) throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  if (!isScored(user.userType)) throw notAvailable();
  const row = await currentRow(userId);
  const [info, changes] = await Promise.all([
    userInfo([userId]),
    CreditScoreChange.findAll({ where: { userId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 100 }),
  ]);
  return { user: info(userId), ...scoreShape(row), months: monthlySeries(changes), changes: changes.map(changeShape) };
}

// POST /admin/credit-scores/:userId/recalculate
async function adminRecalculate(userId) {
  const user = await User.findOne({ where: { id: userId }, attributes: ['id', 'userType'] });
  if (!user) throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  if (!isScored(user.userType)) throw notAvailable();
  await refresh(userId, 'admin');
  return adminGet(userId);
}

// POST /admin/credit-scores/recalculate-all   runs in the background
let recalcAllRunning = false;
async function adminRecalculateAll() {
  if (recalcAllRunning) throw new ApiError(409, 'A full recalculation is already running', { code: 'RECALCULATION_RUNNING' });
  const users = await User.findAll({ where: { userType: { [Op.in]: C.SCORED_USER_TYPES } }, attributes: ['id'] });
  recalcAllRunning = true;
  setImmediate(async () => {
    let done = 0;
    try {
      for (const u of users) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await refresh(u.id, 'admin');
          done += 1;
        } catch (err) {
          console.error(`[credit score] recalculation failed for user ${u.id}:`, err.message);
        }
      }
      console.log(`[credit score] recalculated ${done} of ${users.length} users`);
    } finally {
      recalcAllRunning = false;
    }
  });
  return { queued: users.length };
}

// GET /admin/credit-scores/export   CSV with the same filters
async function exportCsv(query = {}) {
  const where = await adminWhere(query);
  const rows = await CreditScore.findAll({ where, order: ADMIN_SORTS[query.sort] || ADMIN_SORTS.score_desc });
  const info = await userInfo(rows.map((r) => r.userId));
  const head = [
    'User ID', 'Name', 'Type', 'Region', 'Account Status', 'Score', 'Grade',
    'KYC', 'Sales', 'Loans', 'Insurance', 'Rating',
    'Successful Orders', 'Failed Orders', 'Reviews', 'Average Stars', 'Insurance Expires', 'Calculated At', 'Formula Version',
  ];
  const lines = rows.map((r) => {
    const u = info(r.userId);
    const p = pointsOf(r);
    const d = (r.details && r.details.parts) || {};
    const sales = (d.sales && d.sales.data) || {};
    const rating = (d.rating && d.rating.data) || {};
    const ins = (d.insurance && d.insurance.data) || {};
    return [
      u.displayId || r.userId, u.name, u.userTypeLabel, u.region, u.accountStatusLabel, r.score, adminRow(r, info).gradeLabel,
      p.kyc, p.sales, p.loans, p.insurance, p.rating,
      sales.successful ?? '', sales.failed ?? '', rating.count ?? '', rating.average ?? '', ins.expiresAt || '',
      new Date(r.calculatedAt).toISOString(), r.formulaVersion,
    ];
  });
  return {
    filename: `afa-credit-scores-${todayYmd()}.csv`,
    content: `${[toCsvLine(head), ...lines.map(toCsvLine)].join('\r\n')}\r\n`,
  };
}

// For the admin user details page: { score, grade, gradeLabel, calculatedAt } or null
async function summaryFor(userId, userType) {
  if (!isScored(userType)) return null;
  const row = await CreditScore.findOne({ where: { userId } });
  if (!row) return null;
  return { score: row.score, maxScore: C.MAX_SCORE, grade: row.grade, gradeLabel: (C.GRADES.find((g) => g.key === row.grade) || {}).label, calculatedAt: row.calculatedAt };
}

// For admin user lists: Map userId -> score
async function scoresFor(userIds) {
  const ids = [...new Set(userIds.map(Number))];
  if (!ids.length) return new Map();
  const rows = await CreditScore.findAll({ where: { userId: ids }, attributes: ['userId', 'score'] });
  return new Map(rows.map((r) => [Number(r.userId), r.score]));
}

module.exports = {
  scoresFor,
  gather,
  refresh,
  refreshSoon,
  refreshStale,
  getMine,
  history,
  adminList,
  stats,
  adminGet,
  adminRecalculate,
  adminRecalculateAll,
  exportCsv,
  summaryFor,
  scoreShape,
  monthlySeries,
};
