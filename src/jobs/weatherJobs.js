// Weather job (OpenWeather), run inside the API. Every 5 minutes it checks what is due:
//   1. tinkhundla without coordinates -> looked up by name (30 per run, retried after 7 days)
//   2. current weather   -> every hour
//   3. 5-day forecast    -> every 3 hours
// "Due" is worked out from the run log (weather_fetch_runs), so a restart never causes extra calls.
// Does nothing until WEATHER_ENABLED=true and OPENWEATHER_API_KEY are set.
// Turned off with RUN_JOBS=false, like the order jobs.
const weatherService = require('../services/weather.service');
const { WEATHER_RULES } = require('../config/weather');

let timer = null;

async function runOnce() {
  try {
    const done = await weatherService.runDue();
    if (done && Object.keys(done).length) {
      console.log(`🌦️  Weather: ${Object.entries(done).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    return done;
  } catch (err) {
    console.error('Weather job failed:', err.message);
    return null;
  }
}

function start() {
  if (timer) return;
  if (!weatherService.isConfigured()) {
    console.log('🌦️  Weather job off (set WEATHER_ENABLED=true and OPENWEATHER_API_KEY in .env to switch it on)');
    return;
  }
  timer = setInterval(runOnce, WEATHER_RULES.checkEveryMs);
  if (timer.unref) timer.unref();
  setTimeout(runOnce, 15000); // first check shortly after start
  console.log('🌦️  Weather job started (current weather hourly, forecast every 3 hours)');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce };
