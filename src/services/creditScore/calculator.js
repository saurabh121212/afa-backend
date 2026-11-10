// CREDIT SCORE CALCULATOR: a pure function (no database), so the rules are easy to check and test.
// The rules are described in config/creditScore.js. creditScore.service.js gathers the inputs.
//
// calculate({
//   userType: 'farmer' | 'trader' | 'logistics',
//   accountStatus: 'approved' | ...,
//   kycDocuments: [{ documentType, label, status: 'missing' | 'pending' | 'approved' | 'rejected' }],
//                   (the user's KYC documents that count for the account check)
//   sales: { successful, failedCancelled, failedClaims },     counts of seller orders
//   rating: { average: 4.5 | null, count },                  published reviews
//   insurance: { documentType, label, status, expiresAt: 'YYYY-MM-DD' | null },   status may be 'missing'
//   today: 'YYYY-MM-DD',                                      Eswatini date
// })
//  -> { score, grade, gradeLabel, maxPossibleNow, parts: { kyc, sales, loans, insurance, rating } }
//     each part: { key, label, points, max, status, statusLabel, summary, tip, data }
const { PARTS, PART_MAX, PART_STATUS, gradeOf, round1 } = require('../../config/creditScore');

const status = (points, max) => (points >= max ? 'full' : points > 0 ? 'partial' : 'none');
// extra.status only for "not_available" (loans); otherwise full / partial / none from the points
const part = (key, points, extra) => {
  const p = round1(Math.max(0, Math.min(PART_MAX, points)));
  const st = extra.status || status(p, PART_MAX);
  return { key, label: PARTS[key].label, points: p, max: PART_MAX, ...extra, status: st, statusLabel: PART_STATUS[st] };
};
const fmtDate = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const list = (items) => items.map((i) => i.label).join(', ');

// ---------- 1. KYC: account approved + every KYC document approved (yes / no) ----------
function kycPart({ accountStatus, kycDocuments = [] }) {
  const missing = kycDocuments.filter((d) => d.status === 'missing');
  const pending = kycDocuments.filter((d) => d.status === 'pending');
  const rejected = kycDocuments.filter((d) => d.status === 'rejected');
  const approved = kycDocuments.filter((d) => d.status === 'approved');
  const accountOk = accountStatus === 'approved';
  // A user type with no KYC documents defined can't earn this part from documents alone
  const docsOk = kycDocuments.length > 0 && approved.length === kycDocuments.length;
  const yes = accountOk && docsOk;

  const tips = [];
  if (!accountOk) tips.push('Your account must be approved by AFA.');
  if (missing.length) tips.push(`Upload: ${list(missing)}.`);
  if (rejected.length) tips.push(`Upload again (rejected): ${list(rejected)}.`);
  if (pending.length) tips.push(`Waiting for AFA to approve: ${list(pending)}.`);
  return part('kyc', yes ? PART_MAX : 0, {
    summary: yes
      ? 'Account and all KYC documents approved'
      : `${approved.length} of ${kycDocuments.length} KYC documents approved${accountOk ? '' : ', account not approved yet'}`,
    tip: yes ? null : tips.join(' '),
    data: {
      accountApproved: accountOk,
      documentsTotal: kycDocuments.length,
      documentsApproved: approved.length,
      missing: missing.map((d) => d.documentType),
      pending: pending.map((d) => d.documentType),
      rejected: rejected.map((d) => d.documentType),
    },
  });
}

// ---------- 2. Sales: 20 x successful / (successful + failed) ----------
function salesPart({ sales = {} }) {
  const successful = Number(sales.successful || 0);
  const failedCancelled = Number(sales.failedCancelled || 0);
  const failedClaims = Number(sales.failedClaims || 0);
  const failed = failedCancelled + failedClaims;
  const finished = successful + failed;
  const rate = finished ? successful / finished : 0;
  const points = PART_MAX * rate;
  let tip = null;
  if (!finished) tip = 'Complete your first order to start earning points.';
  else if (failed) tip = 'Confirm orders on time, avoid cancelling and deliver what was ordered to raise this.';
  return part('sales', points, {
    summary: finished ? `${successful} of ${finished} finished orders successful (${Math.round(rate * 100)}%)` : 'No finished orders yet',
    tip,
    data: { successful, failed, failedCancelled, failedClaims, finished, successRate: finished ? round1(rate * 100) : null },
  });
}

// ---------- 3. Loans: not available until the Financial Institution module (phase 2) ----------
function loansPart() {
  return part('loans', 0, {
    status: 'not_available',
    summary: 'Loan history is not recorded on AFA yet',
    tip: 'Loan repayments will count once AFA works with financial institutions.',
    data: { loansRepaid: null, loansFailed: null },
  });
}

// ---------- 4. Insurance: approved + not expired ----------
function insurancePart({ insurance, today }) {
  const ins = insurance || { status: 'missing' };
  const label = ins.label || 'insurance certificate';
  const expired = ins.expiresAt && ins.expiresAt < today;
  const valid = ins.status === 'approved' && ins.expiresAt && !expired;
  let summary;
  let tip = null;
  if (valid) summary = `${label} valid until ${fmtDate(ins.expiresAt)}`;
  else if (ins.status === 'missing') {
    summary = 'No insurance document';
    tip = `Upload a valid ${label} to earn ${PART_MAX} points.`;
  } else if (ins.status === 'pending') {
    summary = 'Insurance document waiting for approval';
    tip = 'AFA will check your insurance document soon.';
  } else if (ins.status === 'rejected') {
    summary = 'Insurance document rejected';
    tip = `Upload your ${label} again.`;
  } else if (expired) {
    summary = `Insurance expired on ${fmtDate(ins.expiresAt)}`;
    tip = `Upload your renewed ${label}.`;
  } else {
    summary = 'Insurance expiry date missing';
    tip = `Upload your ${label} again with its expiry date.`;
  }
  return part('insurance', valid ? PART_MAX : 0, {
    summary,
    tip,
    data: { documentType: ins.documentType || null, documentStatus: ins.status, expiresAt: ins.expiresAt || null, expired: Boolean(expired) },
  });
}

// ---------- 5. Rating: 20 x average / 5 ----------
function ratingPart({ rating = {} }) {
  const count = Number(rating.count || 0);
  const average = count && rating.average !== null && rating.average !== undefined ? Number(rating.average) : null;
  const points = average === null ? 0 : (PART_MAX * average) / 5;
  return part('rating', points, {
    summary: average === null ? 'No reviews yet' : `${average.toFixed(1)} of 5 stars from ${count} review${count === 1 ? '' : 's'}`,
    tip: average === null ? 'Ask buyers to rate your completed orders.' : average < 5 ? 'Good service and on-time delivery bring better ratings.' : null,
    data: { average, count },
  });
}

function calculate(input) {
  const parts = {
    kyc: kycPart(input),
    sales: salesPart(input),
    loans: loansPart(input),
    insurance: insurancePart(input),
    rating: ratingPart(input),
  };
  const total = Object.values(parts).reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const grade = gradeOf(score);
  return {
    score,
    grade: grade.key,
    gradeLabel: grade.label,
    // Loans can't give points yet
    maxPossibleNow: Object.values(parts).reduce((s, p) => s + (p.status === 'not_available' ? 0 : p.max), 0),
    parts,
  };
}

module.exports = { calculate, kycPart, salesPart, loansPart, insurancePart, ratingPart };
