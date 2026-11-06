// Periods, time buckets and "compared with the previous period" for every dashboard.
//
//   ?period=7d | 30d (default) | 90d | 12m | custom (&from=YYYY-MM-DD&to=YYYY-MM-DD)
//   -> { key, from, to, prevFrom, prevTo, bucket: day | week | month, label }
//
// Dates are cut in Eswatini time (UTC+2, no daylight saving): a "day" is 00:00-23:59 in Mbabane.
const OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const PRESETS = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
const PERIODS = [...Object.keys(PRESETS), 'custom'];
const MAX_CUSTOM_DAYS = 731;

const local = (d) => new Date(new Date(d).getTime() + OFFSET_MS); // read its UTC fields as Mbabane time
const fromLocal = (y, m, day) => new Date(Date.UTC(y, m, day) - OFFSET_MS); // Mbabane midnight -> real time
const startOfDay = (d) => {
  const l = local(d);
  return fromLocal(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
};

function bucketFor(days) {
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

// query: { period, from, to } (from / to are Date objects for custom, already validated)
function resolve(query = {}, now = new Date()) {
  const key = PERIODS.includes(query.period) ? query.period : '30d';
  let from;
  let to;
  if (key === 'custom' && query.from && query.to) {
    from = startOfDay(query.from);
    to = new Date(startOfDay(query.to).getTime() + DAY - 1);
  } else {
    const days = PRESETS[key === 'custom' ? '30d' : key];
    to = now;
    from = key === '12m' ? (() => {
      const l = local(now);
      return fromLocal(l.getUTCFullYear() - 1, l.getUTCMonth() + 1, 1); // the last 12 whole calendar months incl. this one
    })() : new Date(startOfDay(now).getTime() - (days - 1) * DAY);
  }
  const span = to.getTime() - from.getTime() + 1;
  const days = Math.round(span / DAY);
  const bucket = key === '12m' ? 'month' : bucketFor(days);
  return {
    key: key === 'custom' && !(query.from && query.to) ? '30d' : key,
    from,
    to,
    prevFrom: new Date(from.getTime() - span),
    prevTo: new Date(from.getTime() - 1),
    days,
    bucket,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Bucket key + label for a date
function bucketOf(date, bucket) {
  const l = local(date);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth();
  const d = l.getUTCDate();
  if (bucket === 'month') return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
  if (bucket === 'week') {
    const dow = (l.getUTCDay() + 6) % 7; // Monday = 0
    const monday = new Date(Date.UTC(y, m, d - dow));
    return {
      key: monday.toISOString().slice(0, 10),
      label: `Week of ${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]}`,
    };
  }
  return { key: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, label: `${d} ${MONTHS[m]}` };
}

// Every bucket of the period, in order (so charts have no gaps)
function buckets(p) {
  const out = [];
  const seen = new Set();
  for (let t = p.from.getTime(); t <= p.to.getTime(); t += DAY) {
    const b = bucketOf(new Date(t), p.bucket);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
  }
  return out;
}

// rows -> [{ key, label, <field>: sum, ... }] for every bucket of the period
//   fields: { name: (row) => number }
function series(p, rows, dateOf, fields) {
  const list = buckets(p).map((b) => ({ ...b, ...Object.fromEntries(Object.keys(fields).map((f) => [f, 0])) }));
  const byKey = new Map(list.map((b) => [b.key, b]));
  rows.forEach((r) => {
    const d = dateOf(r);
    if (!d) return;
    const b = byKey.get(bucketOf(d, p.bucket).key);
    if (!b) return;
    Object.entries(fields).forEach(([f, fn]) => {
      b[f] = Math.round((b[f] + fn(r)) * 100) / 100;
    });
  });
  return list;
}

const inRange = (d, from, to) => Boolean(d) && new Date(d) >= from && new Date(d) <= to;

// { value, previous, change (%), trend: up | down | flat } — change is null when there was nothing before
function compare(value, previous) {
  const v = Math.round(value * 100) / 100;
  const pr = Math.round(previous * 100) / 100;
  const change = pr === 0 ? null : Math.round(((v - pr) / Math.abs(pr)) * 1000) / 10;
  return { value: v, previous: pr, change, trend: v > pr ? 'up' : v < pr ? 'down' : 'flat' };
}

const periodShape = (p) => ({ key: p.key, from: p.from, to: p.to, previousFrom: p.prevFrom, previousTo: p.prevTo, bucket: p.bucket, days: p.days });

module.exports = { PERIODS, MAX_CUSTOM_DAYS, resolve, series, buckets, bucketOf, inRange, compare, periodShape };
