// Background jobs for orders, run inside the API every minute:
//   1. cancel orders not paid by their deadline (stock goes back)  -> payment.service.cancelOverdue
//   2. complete delivered / collected orders whose claim window ended
//      (seller payout released)                                    -> sellerOrder.service.completeDue
//
// Turn off with RUN_JOBS=false (e.g. on extra servers if the API ever runs on more than one).
const paymentService = require('../services/payment.service');
const sellerOrderService = require('../services/sellerOrder.service');

const EVERY_MS = 60 * 1000;
let timer = null;
let running = false; // never start a run while the previous one is still busy

async function runOnce() {
  if (running) return null;
  running = true;
  try {
    const cancelled = await paymentService.cancelOverdue();
    const completed = await sellerOrderService.completeDue();
    if (cancelled || completed) {
      console.log(`🕒 Order jobs: ${cancelled} unpaid order(s) cancelled, ${completed} order(s) completed`);
    }
    return { cancelled, completed };
  } catch (err) {
    console.error('Order jobs failed:', err.message);
    return null;
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(runOnce, EVERY_MS);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  setTimeout(runOnce, 5000); // first run shortly after start
  console.log('🕒 Order jobs started (every minute)');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce };
