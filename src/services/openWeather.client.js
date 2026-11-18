// Talks to OpenWeather (free plan endpoints only). Used by the weather job, never by the website directly.
//
//   current(lat, lon)   -> GET /data/2.5/weather       current weather
//   forecast(lat, lon)  -> GET /data/2.5/forecast      5 days in 3-hour steps
//   geocode(name)       -> GET /geo/1.0/direct         coordinates of a place name in Eswatini (SZ)
//
// Every call returns { data, calls } (calls = attempts made, retries included, for the usage count).
// Errors are WeatherApiError with { status, calls, fatal }: fatal = stop the whole run (bad API key).
const config = require('../../config');
const { WEATHER_RULES } = require('../../config/weather');

class WeatherApiError extends Error {
  constructor(message, { status = 0, calls = 1, fatal = false } = {}) {
    super(message);
    this.name = 'WeatherApiError';
    this.status = status;
    this.calls = calls;
    this.fatal = fatal;
  }
}

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// Wait before try n+1: 2 s, 5 s; a 429 (too many calls) waits a whole minute window
const backoffMs = (attempt, status) => (status === 429 ? 20000 * attempt : [2000, 5000, 10000][attempt - 1] || 10000);

async function request(path, params) {
  if (!config.weather.apiKey) throw new WeatherApiError('OPENWEATHER_API_KEY is not set in .env', { calls: 0, fatal: true });
  const url = new URL(`${config.weather.baseUrl}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set('appid', config.weather.apiKey);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_RULES.timeoutMs), headers: { Accept: 'application/json' } });
    } catch (err) {
      if (attempt <= WEATHER_RULES.retries) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(backoffMs(attempt));
        continue; // eslint-disable-line no-continue
      }
      const why = err.name === 'TimeoutError' ? 'timed out' : err.message;
      throw new WeatherApiError(`Could not reach OpenWeather (${why})`, { calls: attempt });
    }

    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const data = await res.json();
      return { data, calls: attempt };
    }

    let detail = '';
    try {
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json();
      detail = body && body.message ? `: ${body.message}` : '';
    } catch (e) {
      detail = '';
    }

    if (res.status === 401) {
      throw new WeatherApiError(
        `OpenWeather rejected the API key (401${detail}). Check OPENWEATHER_API_KEY; a new key can take up to 2 hours to start working.`,
        { status: 401, calls: attempt, fatal: true }
      );
    }
    if ((res.status === 429 || res.status >= 500) && attempt <= WEATHER_RULES.retries) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs(attempt, res.status));
      continue; // eslint-disable-line no-continue
    }
    throw new WeatherApiError(`OpenWeather error ${res.status}${detail}`, { status: res.status, calls: attempt, fatal: res.status === 429 });
  }
}

const current = (lat, lon) => request('/data/2.5/weather', { lat, lon, units: 'metric' });
const forecast = (lat, lon) => request('/data/2.5/forecast', { lat, lon, units: 'metric' });
const geocode = (name) => request('/geo/1.0/direct', { q: `${name},SZ`, limit: 5 });

module.exports = { current, forecast, geocode, WeatherApiError, sleep };
