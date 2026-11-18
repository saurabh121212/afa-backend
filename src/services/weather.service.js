// WEATHER (OpenWeather free plan), per INKHUNDLA.
//
// How it works
//   - The weather job (jobs/weatherJobs.js) calls OpenWeather on a schedule and stores the results:
//       current weather every hour -> weather_current (+ the day's summary in weather_daily_history)
//       5-day / 3-hour forecast every 3 hours -> weather_forecasts
//     The website / apps only read our own tables: fast, and the API key never leaves the server.
//   - Coordinates: regions get them from the seeder. A inkhundla without coordinates is looked up by
//     name (OpenWeather geocoding, must be in Eswatini and near its region); until found it uses its
//     REGION's weather (approximate: true). The admin can set exact coordinates any time (never overwritten).
//   - Places with the same coordinates are fetched once.
//   - If OpenWeather fails, the last data stays and is marked isStale.
//
// Public:  listLocations, forLocation, forUser
// Admin:   status, listRuns, listCoordinates, setCoordinates, startRefresh
// Job:     runDue
const { Op } = require('sequelize');
const models = require('../models');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const client = require('./weather/openWeather.client');
const {
  WEATHER_RULES: R,
  ESWATINI_BOUNDS: B,
  COORDINATE_SOURCES,
  RUN_KINDS,
  RUN_TRIGGERS,
  RUN_STATUS_LABELS,
  ATTRIBUTION,
  UNITS,
  TZ_OFFSET_MS,
} = require('../config/weather');

const { sequelize, Location, WeatherCurrent, WeatherForecast, WeatherDailyHistory, WeatherFetchRun } = models;

// ======================= small helpers =======================
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const kmh = (ms) => (ms === null || ms === undefined ? null : Math.round(Number(ms) * 36) / 10);
const minutesAgo = (d) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : Infinity);
const inEswatini = (lat, lon) => lat >= B.minLat && lat <= B.maxLat && lon >= B.minLon && lon <= B.maxLon;
const localDate = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const localHour = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MS).getUTCHours();
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => (deg === null || deg === undefined ? null : COMPASS[Math.round(Number(deg) / 45) % 8]);
const iconUrl = (icon) => (icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : null);
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Distance in km between two points (sanity check for coordinates found by name)
function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const MAX_KM_FROM_REGION = 70; // a geocoded inkhundla must be this close to its region's town

const isConfigured = () => config.weather.enabled && Boolean(config.weather.apiKey);
const notConfigured = () =>
  new ApiError(409, 'Weather is not switched on. Set WEATHER_ENABLED=true and OPENWEATHER_API_KEY in .env, then restart.', { code: 'WEATHER_NOT_CONFIGURED' });

// ======================= mapping OpenWeather -> our rows =======================
const conditionOf = (w) => {
  const c = (w && w.weather && w.weather[0]) || {};
  return { conditionId: c.id ?? null, conditionMain: c.main ?? null, description: c.description ?? null, icon: c.icon ?? null };
};

function mapCurrent(d) {
  const main = d.main || {};
  const wind = d.wind || {};
  const sys = d.sys || {};
  return {
    observedAt: d.dt ? new Date(d.dt * 1000) : new Date(),
    temp: main.temp ?? null,
    feelsLike: main.feels_like ?? null,
    tempMin: main.temp_min ?? null,
    tempMax: main.temp_max ?? null,
    humidity: main.humidity ?? null,
    pressure: main.pressure ?? null,
    windSpeed: wind.speed ?? null,
    windDeg: wind.deg ?? null,
    windGust: wind.gust ?? null,
    clouds: d.clouds ? d.clouds.all ?? null : null,
    rain1h: d.rain && d.rain['1h'] !== undefined ? d.rain['1h'] : 0,
    visibility: d.visibility ?? null,
    ...conditionOf(d),
    sunrise: sys.sunrise ? new Date(sys.sunrise * 1000) : null,
    sunset: sys.sunset ? new Date(sys.sunset * 1000) : null,
  };
}

function mapSlot(s) {
  const main = s.main || {};
  const wind = s.wind || {};
  return {
    forecastAt: new Date(s.dt * 1000),
    temp: main.temp ?? null,
    feelsLike: main.feels_like ?? null,
    tempMin: main.temp_min ?? null,
    tempMax: main.temp_max ?? null,
    humidity: main.humidity ?? null,
    windSpeed: wind.speed ?? null,
    windDeg: wind.deg ?? null,
    windGust: wind.gust ?? null,
    clouds: s.clouds ? s.clouds.all ?? null : null,
    pop: s.pop ?? 0,
    rain3h: s.rain && s.rain['3h'] !== undefined ? s.rain['3h'] : 0,
    ...conditionOf(s),
  };
}

// ======================= which places to fetch =======================
// Every active inkhundla with its own coordinates, or its region's (approximate).
// Grouped by coordinates, so each point is fetched once.
async function fetchPoints({ locationId = null } = {}) {
  const rows = await Location.findAll({
    where: { type: ['region', 'inkhundla'], isActive: true },
    attributes: ['id', 'name', 'type', 'parentId', 'latitude', 'longitude'],
  });
  const regions = new Map(rows.filter((r) => r.type === 'region').map((r) => [r.id, r]));
  const groups = new Map();
  rows
    .filter((r) => r.type === 'inkhundla' && (!locationId || r.id === locationId))
    .forEach((r) => {
      let lat = num(r.latitude);
      let lon = num(r.longitude);
      let approximate = false;
      if (lat === null || lon === null) {
        const region = regions.get(r.parentId);
        if (!region || num(region.latitude) === null || num(region.longitude) === null) return; // nothing to use yet
        lat = num(region.latitude);
        lon = num(region.longitude);
        approximate = true;
      }
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, { lat, lon, places: [] });
      groups.get(key).places.push({ locationId: r.id, approximate });
    });
  return [...groups.values()];
}

// ======================= runs (log + lock) =======================
let busy = null; // the kind running in this process, null = free

async function startRun(kind, trigger) {
  return WeatherFetchRun.create({ kind, triggeredBy: trigger, status: 'running', startedAt: new Date() });
}

async function finishRun(run, { points, succeeded, failed, calls, error }) {
  const status = failed === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial';
  await run.update({ status, points, succeeded, failed, calls, error: error ? String(error).slice(0, 1000) : null, finishedAt: new Date() });
  return run;
}

// Calls OpenWeather for every group, with a pause between calls. handle(group, data) saves the result.
async function eachGroup(groups, call, handle) {
  const out = { points: groups.length, succeeded: 0, failed: 0, calls: 0, error: null };
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (i > 0) await client.sleep(R.callGapMs); // eslint-disable-line no-await-in-loop
    try {
      const { data, calls } = await call(g); // eslint-disable-line no-await-in-loop
      out.calls += calls;
      await handle(g, data); // eslint-disable-line no-await-in-loop
      out.succeeded += 1;
    } catch (err) {
      out.calls += err.calls ?? 0;
      out.failed += 1;
      out.error = err.message;
      if (err.fatal) {
        out.failed += groups.length - i - 1; // the rest is not tried (bad key / limit reached)
        break;
      }
      if (!(err instanceof client.WeatherApiError)) console.error('Weather: saving failed:', err.message);
    }
  }
  return out;
}

// ---------- daily history (from the hourly observations) ----------
async function addToHistory(locationId, obs) {
  const date = localDate(obs.observedAt);
  const [row] = await WeatherDailyHistory.findOrCreate({ where: { locationId, date }, defaults: { locationId, date, rainMm: 0, samples: 0 } });
  // the same observation twice (manual refresh soon after the job) is not counted again
  if (row.lastObservedAt && new Date(obs.observedAt) <= new Date(row.lastObservedAt)) return;
  const t = num(obs.temp);
  const samples = Number(row.samples || 0);
  const humidityAvg = obs.humidity === null ? num(row.humidityAvg)
    : row.humidityAvg === null ? obs.humidity : (num(row.humidityAvg) * samples + obs.humidity) / (samples + 1);
  // rain of the last hour; only counted when about an hour passed since the last counted one
  const addRain = !row.lastObservedAt || minutesAgo(row.lastObservedAt) - minutesAgo(obs.observedAt) >= 45;
  await row.update({
    tempMin: t === null ? row.tempMin : row.tempMin === null ? t : Math.min(num(row.tempMin), t),
    tempMax: t === null ? row.tempMax : row.tempMax === null ? t : Math.max(num(row.tempMax), t),
    rainMm: Math.round((num(row.rainMm) + (addRain ? num(obs.rain1h) || 0 : 0)) * 100) / 100,
    humidityAvg: humidityAvg === null ? null : Math.round(humidityAvg * 100) / 100,
    samples: samples + 1,
    lastObservedAt: obs.observedAt,
  });
}

// ---------- current weather ----------
async function saveCurrent(g, data) {
  const obs = mapCurrent(data);
  const fetchedAt = new Date();
  for (const p of g.places) {
    // eslint-disable-next-line no-await-in-loop
    await WeatherCurrent.upsert({ locationId: p.locationId, latitude: g.lat, longitude: g.lon, approximate: p.approximate, ...obs, fetchedAt });
    // eslint-disable-next-line no-await-in-loop
    await addToHistory(p.locationId, obs);
  }
}

async function runCurrent(trigger, { locationId = null } = {}) {
  const run = await startRun(locationId ? 'location' : 'current', trigger);
  const groups = await fetchPoints({ locationId });
  const out = await eachGroup(groups, (g) => client.current(g.lat, g.lon), saveCurrent);
  return finishRun(run, out);
}

// ---------- forecast ----------
async function saveForecast(g, data) {
  const slots = (data.list || []).map(mapSlot);
  if (!slots.length) throw new Error('OpenWeather sent an empty forecast');
  const fetchedAt = new Date();
  await sequelize.transaction(async (transaction) => {
    for (const p of g.places) {
      // eslint-disable-next-line no-await-in-loop
      await WeatherForecast.destroy({ where: { locationId: p.locationId }, transaction });
      // eslint-disable-next-line no-await-in-loop
      await WeatherForecast.bulkCreate(slots.map((s) => ({ ...s, locationId: p.locationId, fetchedAt })), { transaction });
    }
  });
}

async function runForecast(trigger, { locationId = null } = {}) {
  const run = locationId ? null : await startRun('forecast', trigger);
  const groups = await fetchPoints({ locationId });
  const out = await eachGroup(groups, (g) => client.forecast(g.lat, g.lon), saveForecast);
  if (!locationId) await cleanup();
  return run ? finishRun(run, out) : out;
}

// Old run logs; forecasts of places no longer fetched (disabled / deleted tinkhundla) after 2 days
async function cleanup() {
  await WeatherFetchRun.destroy({ where: { startedAt: { [Op.lt]: new Date(Date.now() - R.keepRunsDays * 86400000) } } });
  await WeatherForecast.destroy({ where: { forecastAt: { [Op.lt]: new Date(Date.now() - 2 * 86400000) } } });
}

// ---------- coordinates by name (geocoding) ----------
// Picks a result in Eswatini, near the inkhundla's region town; prefers an exact name match.
function pickResult(results, name, region) {
  const clean = (s) => String(s || '').trim().toLowerCase();
  const ok = (results || []).filter((x) => {
    if (x.country !== 'SZ' || !inEswatini(x.lat, x.lon)) return false;
    if (region && num(region.latitude) !== null) {
      return distanceKm(x.lat, x.lon, num(region.latitude), num(region.longitude)) <= MAX_KM_FROM_REGION;
    }
    return true;
  });
  return ok.find((x) => clean(x.name) === clean(name)) || ok[0] || null;
}

// "Mbabane East" -> also try "Mbabane"; text in brackets and "Sample ..." names are ignored
function namesToTry(name) {
  const base = String(name).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || /^sample\b/i.test(base)) return [];
  const first = base.split(/[\s/-]+/)[0];
  return first && first.length >= 4 && first.toLowerCase() !== base.toLowerCase() ? [base, first] : [base];
}

async function runGeocode(trigger) {
  const retryBefore = new Date(Date.now() - R.geocodeRetryDays * 86400000);
  const todo = await Location.findAll({
    where: {
      type: 'inkhundla',
      isActive: true,
      latitude: null,
      [Op.or]: [{ coordinatesCheckedAt: null }, { coordinatesCheckedAt: { [Op.lt]: retryBefore } }],
    },
    attributes: ['id', 'name', 'parentId'],
    order: [['id', 'ASC']],
    limit: R.geocodePerRun,
  });
  if (!todo.length) return null;
  const regions = new Map(
    (await Location.findAll({ where: { type: 'region' }, attributes: ['id', 'latitude', 'longitude'], paranoid: false })).map((r) => [r.id, r])
  );

  const run = await startRun('geocode', trigger);
  const out = { points: todo.length, succeeded: 0, failed: 0, calls: 0, error: null };
  let first = true;
  for (const loc of todo) {
    let found = null;
    for (const name of namesToTry(loc.name)) {
      if (!first) await client.sleep(R.callGapMs); // eslint-disable-line no-await-in-loop
      first = false;
      try {
        const { data, calls } = await client.geocode(name); // eslint-disable-line no-await-in-loop
        out.calls += calls;
        found = pickResult(data, name, regions.get(loc.parentId));
      } catch (err) {
        out.calls += err.calls ?? 0;
        out.error = err.message;
        if (err.fatal) {
          out.failed += todo.length - out.succeeded - out.failed;
          return finishRun(run, out);
        }
      }
      if (found) break;
    }
    // Only fill it if nobody (the admin) set coordinates in the meantime
    // eslint-disable-next-line no-await-in-loop
    await Location.update(
      found
        ? { latitude: found.lat, longitude: found.lon, coordinatesSource: 'geocoded', coordinatesCheckedAt: new Date() }
        : { coordinatesCheckedAt: new Date() },
      { where: { id: loc.id, latitude: null } }
    );
    if (found) out.succeeded += 1;
    else out.failed += 1;
  }
  if (out.failed && !out.error) out.error = `${out.failed} inkhundla name(s) not found: they use their region's weather until the admin sets coordinates`;
  return finishRun(run, out);
}

// ======================= job entry =======================
// Is a run of this kind due? Failed runs are retried after a short wait, not on every check.
async function isDue(kind) {
  const last = await WeatherFetchRun.findOne({ where: { kind }, order: [['startedAt', 'DESC'], ['id', 'DESC']] });
  if (!last) return true;
  const age = minutesAgo(last.startedAt);
  if (last.status === 'running') return age >= R.runningTimeoutMinutes;
  if (last.status === 'failed') return age >= R.retryFailedAfterMinutes;
  const every = kind === 'current' ? R.currentEveryMinutes : R.forecastEveryMinutes;
  return age >= every - 2; // a little early, so the check every 5 minutes doesn't push it later and later
}

// Runs what is due. Called by the job every few minutes. Returns what ran.
async function runDue() {
  if (!isConfigured() || busy) return null;
  busy = 'schedule';
  try {
    const done = {};
    const geocode = await runGeocode('schedule');
    if (geocode) done.geocode = geocode.status;
    if (await isDue('current')) done.current = (await runCurrent('schedule')).status;
    if (await isDue('forecast')) done.forecast = (await runForecast('schedule')).status;
    return done;
  } finally {
    busy = null;
  }
}

// ======================= PUBLIC: reading =======================
function currentShape(c, { full = false } = {}) {
  if (!c) return null;
  const short = {
    temp: r1(c.temp),
    feelsLike: r1(c.feelsLike),
    description: capitalise(c.description),
    condition: c.conditionMain,
    icon: c.icon,
    iconUrl: iconUrl(c.icon),
    humidity: c.humidity,
    windKmh: kmh(c.windSpeed),
    observedAt: c.observedAt,
  };
  if (!full) return short;
  return {
    ...short,
    tempMin: r1(c.tempMin),
    tempMax: r1(c.tempMax),
    pressure: c.pressure,
    windDirection: compass(c.windDeg),
    windDeg: c.windDeg,
    windGustKmh: kmh(c.windGust),
    clouds: c.clouds,
    rainLastHourMm: r1(c.rain1h),
    visibility: c.visibility,
    sunrise: c.sunrise,
    sunset: c.sunset,
  };
}

function slotShape(s) {
  return {
    at: s.forecastAt,
    date: localDate(s.forecastAt),
    hour: localHour(s.forecastAt),
    temp: r1(s.temp),
    feelsLike: r1(s.feelsLike),
    description: capitalise(s.description),
    condition: s.conditionMain,
    icon: s.icon,
    iconUrl: iconUrl(s.icon),
    chanceOfRain: s.pop === null ? null : Math.round(num(s.pop) * 100),
    rainMm: r1(s.rain3h),
    humidity: s.humidity,
    windKmh: kmh(s.windSpeed),
    windDirection: compass(s.windDeg),
    clouds: s.clouds,
  };
}

// 3-hour steps -> one summary per Eswatini day. The midday step gives the day's icon.
function dailyFrom(slots) {
  const days = new Map();
  slots.forEach((s) => {
    const d = localDate(s.forecastAt);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(s);
  });
  return [...days.entries()].map(([date, list]) => {
    const midday = list.reduce((best, s) => (Math.abs(localHour(s.forecastAt) - 13) < Math.abs(localHour(best.forecastAt) - 13) ? s : best), list[0]);
    const temps = list.flatMap((s) => [num(s.tempMin), num(s.tempMax), num(s.temp)]).filter((t) => t !== null);
    const humid = list.map((s) => s.humidity).filter((h) => h !== null);
    return {
      date,
      label: dayLabel(date),
      tempMin: temps.length ? r1(Math.min(...temps)) : null,
      tempMax: temps.length ? r1(Math.max(...temps)) : null,
      chanceOfRain: Math.round(Math.max(...list.map((s) => num(s.pop) || 0)) * 100),
      rainMm: r1(list.reduce((sum, s) => sum + (num(s.rain3h) || 0), 0)),
      humidity: humid.length ? Math.round(humid.reduce((a, b) => a + b, 0) / humid.length) : null,
      windMaxKmh: kmh(Math.max(...list.map((s) => num(s.windSpeed) || 0))),
      description: capitalise(midday.description),
      condition: midday.conditionMain,
      icon: midday.icon,
      iconUrl: iconUrl(midday.icon),
      steps: list.length, // fewer than 8 = a part day (today / the last day)
    };
  });
}

const meta = () => ({ attribution: ATTRIBUTION, units: UNITS });

// GET /weather/locations?regionId=  -> every active inkhundla with its current weather (list / map)
async function listLocations({ regionId } = {}) {
  const regions = await Location.findAll({ where: { type: 'region', isActive: true }, attributes: ['id', 'name'] });
  const regionById = new Map(regions.map((r) => [r.id, r]));
  if (regionId && !regionById.has(regionId)) throw new ApiError(404, 'Region not found', { code: 'LOCATION_NOT_FOUND' });

  const where = { type: 'inkhundla', isActive: true, parentId: regionId || [...regionById.keys()] };
  const tinkhundla = await Location.findAll({ where, attributes: ['id', 'name', 'parentId', 'latitude', 'longitude'], order: [['name', 'ASC']] });
  const currents = tinkhundla.length ? await WeatherCurrent.findAll({ where: { locationId: tinkhundla.map((t) => t.id) } }) : [];
  const byLocation = new Map(currents.map((c) => [c.locationId, c]));

  const items = tinkhundla.map((t) => {
    const c = byLocation.get(t.id);
    const region = regionById.get(t.parentId);
    return {
      id: t.id,
      name: t.name,
      region: region ? { id: region.id, name: region.name } : null,
      coordinates: c ? { latitude: num(c.latitude), longitude: num(c.longitude) } : null,
      approximate: c ? Boolean(c.approximate) : num(t.latitude) === null,
      current: currentShape(c),
      updatedAt: c ? c.fetchedAt : null,
      isStale: c ? minutesAgo(c.fetchedAt) > R.currentStaleMinutes : true,
    };
  });
  const updated = currents.map((c) => new Date(c.fetchedAt).getTime());
  return { ...meta(), updatedAt: updated.length ? new Date(Math.max(...updated)) : null, count: items.length, items };
}

// Resolves the inkhundla for a location id: an umphakatsi gives its inkhundla; regions are refused
async function inkhundlaFor(id) {
  const loc = await Location.findOne({
    where: { id, isActive: true },
    attributes: ['id', 'name', 'type', 'parentId'],
    include: [{ model: Location, as: 'parent', attributes: ['id', 'name', 'type', 'parentId', 'isActive'] }],
  });
  if (!loc) throw new ApiError(404, 'Location not found', { code: 'LOCATION_NOT_FOUND' });
  if (loc.type === 'region') {
    throw new ApiError(422, 'Weather is shown per Inkhundla. Choose an Inkhundla of this region.', {
      code: 'WEATHER_LEVEL_NOT_SUPPORTED',
      errors: [{ field: 'id', message: 'Choose an Inkhundla (GET /weather/locations?regionId=...)' }],
    });
  }
  if (loc.type === 'inkhundla') return { inkhundla: loc, requested: null };
  if (!loc.parent || !loc.parent.isActive) throw new ApiError(404, 'Location not found', { code: 'LOCATION_NOT_FOUND' });
  return { inkhundla: loc.parent, requested: { id: loc.id, name: loc.name, type: loc.type } };
}

// GET /weather/locations/:id  -> current + 3-hour steps + daily summary of one inkhundla
async function forLocation(id) {
  const { inkhundla, requested } = await inkhundlaFor(id);
  const region = await Location.findByPk(inkhundla.parentId, { attributes: ['id', 'name'] });
  const [c, slots] = await Promise.all([
    WeatherCurrent.findOne({ where: { locationId: inkhundla.id } }),
    WeatherForecast.findAll({
      where: { locationId: inkhundla.id, forecastAt: { [Op.gte]: new Date(Date.now() - R.keepPastForecastHours * 3600000) } },
      order: [['forecastAt', 'ASC']],
    }),
  ]);
  const forecastAt = slots.length ? new Date(Math.max(...slots.map((s) => new Date(s.fetchedAt).getTime()))) : null;
  const available = Boolean(c || slots.length);
  return {
    location: { id: inkhundla.id, name: inkhundla.name, type: 'inkhundla', region: region ? { id: region.id, name: region.name } : null },
    requestedLocation: requested, // set when an umphakatsi was asked for
    available,
    message: available ? null : 'Weather for this area is being collected. Please check again soon.',
    approximate: c ? Boolean(c.approximate) : false,
    coordinates: c ? { latitude: num(c.latitude), longitude: num(c.longitude) } : null,
    current: currentShape(c, { full: true }),
    hourly: slots.map(slotShape),
    daily: dailyFrom(slots),
    updatedAt: { current: c ? c.fetchedAt : null, forecast: forecastAt },
    isStale: {
      current: c ? minutesAgo(c.fetchedAt) > R.currentStaleMinutes : true,
      forecast: forecastAt ? minutesAgo(forecastAt) > R.forecastStaleMinutes : true,
    },
    ...meta(),
  };
}

// The inkhundla saved on the user's profile. Farmers: the FARM's inkhundla first, then the home one.
const PROFILE_MODELS = { farmer: 'FarmerProfile', buyer: 'BuyerProfile', trader: 'TraderProfile', logistics: 'LogisticsProfile', financial_institution: 'FiProfile' };

// GET /me/weather
async function forUser(user) {
  const Model = models[PROFILE_MODELS[user.userType]];
  const profile = Model ? await Model.findOne({ where: { userId: user.id } }) : null;
  const farmId = profile && profile.farmInkhundlaId ? profile.farmInkhundlaId : null;
  const homeId = profile && profile.inkhundlaId ? profile.inkhundlaId : null;
  const noLocation = () =>
    new ApiError(404, 'Add your Inkhundla to your profile to see the weather for your area', { code: 'NO_PROFILE_LOCATION' });
  if (!farmId && !homeId) throw noLocation();
  for (const [id, source] of [[farmId, 'farm'], [homeId, 'profile']]) {
    if (!id) continue; // eslint-disable-line no-continue
    try {
      // eslint-disable-next-line no-await-in-loop
      return { source, ...(await forLocation(id)) };
    } catch (err) {
      if (err.code !== 'LOCATION_NOT_FOUND') throw err; // a disabled / deleted inkhundla: try the next one
    }
  }
  throw noLocation();
}

// ======================= ADMIN =======================
function runShape(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: RUN_KINDS[r.kind],
    trigger: r.triggeredBy,
    triggerLabel: RUN_TRIGGERS[r.triggeredBy],
    status: r.status,
    statusLabel: RUN_STATUS_LABELS[r.status],
    points: r.points,
    succeeded: r.succeeded,
    failed: r.failed,
    calls: r.calls,
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    seconds: r.finishedAt ? Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000) : null,
  };
}

const lastRun = (kind) => WeatherFetchRun.findOne({ where: { kind }, order: [['startedAt', 'DESC'], ['id', 'DESC']] });
const callsSince = async (from) => Number((await WeatherFetchRun.sum('calls', { where: { startedAt: { [Op.gte]: from } } })) || 0);

// GET /admin/weather/status
async function status() {
  const now = new Date();
  const localNow = new Date(now.getTime() + TZ_OFFSET_MS);
  const todayStart = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - TZ_OFFSET_MS);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // OpenWeather counts calendar months (UTC)

  const [current, forecast, geocode, callsToday, callsThisMonth, rows] = await Promise.all([
    lastRun('current'),
    lastRun('forecast'),
    lastRun('geocode'),
    callsSince(todayStart),
    callsSince(monthStart),
    Location.findAll({ where: { type: ['region', 'inkhundla'], isActive: true }, attributes: ['id', 'type', 'parentId', 'latitude', 'coordinatesSource'] }),
  ]);
  const regions = rows.filter((r) => r.type === 'region');
  const regionHas = new Map(regions.map((r) => [r.id, num(r.latitude) !== null]));
  const tinkhundla = rows.filter((r) => r.type === 'inkhundla');
  const own = tinkhundla.filter((t) => num(t.latitude) !== null);
  const bySource = { seed: 0, geocoded: 0, manual: 0 };
  own.forEach((t) => {
    if (bySource[t.coordinatesSource] !== undefined) bySource[t.coordinatesSource] += 1;
  });
  const without = tinkhundla.filter((t) => num(t.latitude) === null);
  const next = (run, every) => (run ? new Date(new Date(run.startedAt).getTime() + every * 60000) : null);

  return {
    enabled: config.weather.enabled,
    apiKeySet: Boolean(config.weather.apiKey),
    running: Boolean(busy),
    schedule: { currentEveryMinutes: R.currentEveryMinutes, forecastEveryMinutes: R.forecastEveryMinutes },
    lastRuns: { current: runShape(current), forecast: runShape(forecast), geocode: runShape(geocode) },
    nextRuns: isConfigured() ? { current: next(current, R.currentEveryMinutes) || now, forecast: next(forecast, R.forecastEveryMinutes) || now } : null,
    usage: {
      callsToday,
      callsThisMonth,
      monthlyFreeLimit: R.monthlyFreeCalls,
      percentOfLimit: Math.round((callsThisMonth / R.monthlyFreeCalls) * 1000) / 10,
    },
    coordinates: {
      regions: { total: regions.length, withCoordinates: regions.filter((r) => num(r.latitude) !== null).length },
      tinkhundla: {
        total: tinkhundla.length,
        withOwnCoordinates: own.length,
        bySource,
        usingRegionWeather: without.filter((t) => regionHas.get(t.parentId)).length, // approximate
        noWeather: without.filter((t) => !regionHas.get(t.parentId)).length, // region has none either
      },
    },
    ...meta(),
  };
}

// GET /admin/weather/runs?kind=&status=&page=&limit=
async function listRuns(query = {}) {
  const pg = getPagination(query);
  const where = {};
  if (query.kind) where.kind = query.kind;
  if (query.status) where.status = query.status;
  const { rows, count } = await WeatherFetchRun.findAndCountAll({ where, order: [['startedAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset });
  return { items: rows.map(runShape), pagination: paginationMeta(pg, count) };
}

function coordinateShape(l, regionById) {
  const lat = num(l.latitude);
  const region = l.type === 'inkhundla' ? regionById.get(l.parentId) : null;
  return {
    id: l.id,
    name: l.name,
    type: l.type,
    region: region ? { id: region.id, name: region.name } : null,
    isActive: l.isActive,
    latitude: lat,
    longitude: num(l.longitude),
    source: lat === null ? null : l.coordinatesSource,
    sourceLabel: lat === null ? null : COORDINATE_SOURCES[l.coordinatesSource] || null,
    checkedAt: l.coordinatesCheckedAt,
    usesRegionWeather: l.type === 'inkhundla' && lat === null,
  };
}

// GET /admin/weather/locations?type=inkhundla|region&regionId=&missing=true&search=&page=&limit=
async function listCoordinates(query = {}) {
  const pg = getPagination(query);
  const where = { type: query.type || 'inkhundla' };
  if (query.regionId) where.parentId = query.regionId;
  if (query.missing === true) where.latitude = null;
  if (query.missing === false) where.latitude = { [Op.ne]: null };
  if (query.source) where.coordinatesSource = query.source;
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };
  const [{ rows, count }, regions] = await Promise.all([
    Location.findAndCountAll({ where, order: [['name', 'ASC'], ['id', 'ASC']], limit: pg.limit, offset: pg.offset }),
    Location.findAll({ where: { type: 'region' }, attributes: ['id', 'name'], paranoid: false }),
  ]);
  const regionById = new Map(regions.map((r) => [r.id, r]));
  return { items: rows.map((l) => coordinateShape(l, regionById)), pagination: paginationMeta(pg, count), bounds: B };
}

// PATCH /admin/weather/locations/:id/coordinates   { latitude, longitude }  (both null = clear)
async function setCoordinates(id, { latitude, longitude }) {
  const loc = await Location.findByPk(id);
  if (!loc) throw new ApiError(404, 'Location not found', { code: 'LOCATION_NOT_FOUND' });
  if (!['region', 'inkhundla'].includes(loc.type)) {
    throw new ApiError(422, 'Coordinates are only used for regions and tinkhundla', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'id', message: 'Choose a region or an inkhundla' }],
    });
  }
  const clear = (latitude === null || latitude === undefined) && (longitude === null || longitude === undefined);
  if (!clear && !inEswatini(latitude, longitude)) {
    throw new ApiError(422, 'These coordinates are outside Eswatini', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'latitude', message: `Latitude must be ${B.minLat} to ${B.maxLat} and longitude ${B.minLon} to ${B.maxLon}` }],
    });
  }
  await loc.update(
    clear
      ? { latitude: null, longitude: null, coordinatesSource: null, coordinatesCheckedAt: null } // the job may look it up again
      : { latitude, longitude, coordinatesSource: 'manual', coordinatesCheckedAt: new Date() }
  );

  // Fetch the new place's weather now (2 calls), unless a full refresh is running anyway
  let refreshing = false;
  if (isConfigured() && !busy) {
    const ids = loc.type === 'inkhundla'
      ? [loc.id]
      : (await Location.findAll({ where: { parentId: loc.id, type: 'inkhundla', isActive: true, latitude: null }, attributes: ['id'] })).map((t) => t.id);
    if (ids.length && ids.length <= 20) {
      refreshing = true;
      setImmediate(() => refreshLocations(ids).catch((err) => console.error('Weather: refresh after coordinates failed:', err.message)));
    }
  }
  const regions = await Location.findAll({ where: { type: 'region' }, attributes: ['id', 'name'], paranoid: false });
  return { location: coordinateShape(loc, new Map(regions.map((r) => [r.id, r]))), refreshing };
}

// Current + forecast of a few tinkhundla right away (after their coordinates changed)
async function refreshLocations(ids) {
  if (busy) return;
  busy = 'location';
  try {
    for (const locationId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const run = await runCurrent('coordinates', { locationId });
      // eslint-disable-next-line no-await-in-loop
      const f = await runForecast('coordinates', { locationId });
      // eslint-disable-next-line no-await-in-loop
      await run.update({ calls: run.calls + f.calls, failed: run.failed + f.failed, error: run.error || f.error });
    }
  } finally {
    busy = null;
  }
}

// POST /admin/weather/refresh   { type: current | forecast | all }  -> starts in the background
async function startRefresh({ type = 'all' } = {}) {
  if (!isConfigured()) throw notConfigured();
  if (busy) {
    throw new ApiError(409, 'A weather refresh is already running. Please wait a few minutes.', { code: 'WEATHER_REFRESH_RUNNING' });
  }
  const groups = await fetchPoints();
  if (!groups.length) {
    throw new ApiError(409, 'No inkhundla has coordinates (or a region with coordinates) yet. Run the region coordinates seeder or set coordinates first.', {
      code: 'WEATHER_NO_LOCATIONS',
    });
  }
  busy = 'admin';
  setImmediate(async () => {
    try {
      await runGeocode('admin');
      if (type === 'current' || type === 'all') await runCurrent('admin');
      if (type === 'forecast' || type === 'all') await runForecast('admin');
    } catch (err) {
      console.error('Weather: admin refresh failed:', err.message);
    } finally {
      busy = null;
    }
  });
  const perPoint = type === 'all' ? 2 : 1;
  return {
    type,
    points: groups.length,
    estimatedCalls: groups.length * perPoint,
    estimatedSeconds: Math.ceil((groups.length * perPoint * R.callGapMs) / 1000),
  };
}

module.exports = {
  // public
  listLocations,
  forLocation,
  forUser,
  // admin
  status,
  listRuns,
  listCoordinates,
  setCoordinates,
  startRefresh,
  // job
  runDue,
  isConfigured,
  // for tests
  _internal: { mapCurrent, mapSlot, dailyFrom, pickResult, namesToTry, fetchPoints, runCurrent, runForecast, runGeocode, isDue, addToHistory },
};
