// Weather (OpenWeather free plan): schedule, limits and labels.
//
// Free plan: 60 calls / minute, 1,000,000 calls / month. Current weather + 5-day forecast in 3-hour steps.
// The job fetches per INKHUNDLA; tinkhundla sharing the same coordinates (e.g. both using their
// region's coordinates) are fetched once. 59 tinkhundla ≈ 57,000 calls a month.
//
// The API key lives ONLY in .env (OPENWEATHER_API_KEY), never in the website / apps.

const WEATHER_RULES = {
  currentEveryMinutes: 60, // current weather
  forecastEveryMinutes: 180, // forecast (it only changes in 3-hour steps)
  retryFailedAfterMinutes: 15, // a failed run is tried again after this (not every check)
  checkEveryMs: 5 * 60 * 1000, // how often the job looks whether something is due
  callGapMs: 1500, // pause between calls: ~40 a minute, under the free plan's 60
  timeoutMs: 15000, // one OpenWeather request
  retries: 2, // extra tries on network errors, 429 and 5xx
  geocodePerRun: 30, // tinkhundla looked up per run (coordinates found automatically)
  geocodeRetryDays: 7, // a name that was not found is tried again after this
  runningTimeoutMinutes: 30, // a run still "running" after this is treated as dead (server restarted)
  currentStaleMinutes: 180, // current weather older than this: isStale true
  forecastStaleMinutes: 540, // forecast older than this: isStale true
  keepPastForecastHours: 3, // past forecast steps still returned (the step now in progress)
  keepRunsDays: 90, // run log kept this long
  monthlyFreeCalls: 1000000,
};

// Coordinates must be inside Eswatini (with a small margin)
const ESWATINI_BOUNDS = { minLat: -27.4, maxLat: -25.65, minLon: 30.7, maxLon: 32.2 };

const COORDINATE_SOURCES = {
  seed: 'AFA default (region town)',
  geocoded: 'Found automatically',
  manual: 'Set by admin',
};

const RUN_KINDS = { current: 'Current weather', forecast: 'Forecast', geocode: 'Find coordinates', location: 'One location' };
const RUN_TRIGGERS = { schedule: 'Scheduled', admin: 'Admin refresh', coordinates: 'Coordinates changed' };
const RUN_STATUS_LABELS = { running: 'Running', success: 'Success', partial: 'Partly failed', failed: 'Failed' };

// Credit line OpenWeather asks for on screens that show its data
const ATTRIBUTION = { text: 'Weather data by OpenWeather', url: 'https://openweathermap.org' };

const UNITS = { temperature: '°C', wind: 'km/h', rain: 'mm', pressure: 'hPa', visibility: 'm', chanceOfRain: '%' };

const TZ_OFFSET_MS = 2 * 60 * 60 * 1000; // Eswatini time (UTC+2, no daylight saving)

module.exports = {
  WEATHER_RULES,
  ESWATINI_BOUNDS,
  COORDINATE_SOURCES,
  RUN_KINDS,
  RUN_TRIGGERS,
  RUN_STATUS_LABELS,
  ATTRIBUTION,
  UNITS,
  TZ_OFFSET_MS,
};
