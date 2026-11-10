// Background jobs for orders, run inside the API every minute:
//   1. cancel orders not paid by their deadline (stock goes back)  -> payment.service.cancelOverdue
//   2. complete delivered / collected orders whose claim window ended
//      (seller payout released; not while a claim is active)      -> sellerOrder.service.completeDue
//   3. cancel paid orders the seller did not confirm in time
//      (full refund)                                               -> cancellation.service.autoCancelUnconfirmed
//   4. cancellation requests not answered in time -> AFA decides   -> cancellation.service.escalateRequests
//   5. claims: no seller reply in time -> AFA; rejected and not
//      escalated / item not returned in time -> closed             -> claim.service.runDue
//   6. send admin advisories / announcements that are due          -> broadcast.service.sendDue
//   7. credit scores older than 24 hours / not calculated yet
//      (200 per run; catches expired insurance)                    -> creditScore.service.refreshStale
//
// Turn off with RUN_JOBS=false (e.g. on extra servers if the API ever runs on more than one).
const paymentService = require('../services/payment.service');
const sellerOrderService = require('../services/sellerOrder.service');
const cancellationService = require('../services/cancellation.service');
const claimService = require('../services/claim.service');
const broadcastService = require('../services/broadcast.service');
const creditScoreService = require('../services/creditScore.service');

const EVERY_MS = 60 * 1000;
let timer = null;
let running = false; // never start a run while the previous one is still busy

// Each job runs on its own: one failing job never stops the others
async function safely(name, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Order job "${name}" failed:`, err.message);
    return fallback;
  }
}

async function runOnce() {
  if (running) return null;
  running = true;
  try {
    const cancelled = await safely('unpaid orders', () => paymentService.cancelOverdue(), 0);
    const autoCancelled = await safely('unconfirmed orders', () => cancellationService.autoCancelUnconfirmed(), 0);
    const requestsEscalated = await safely('cancellation requests', () => cancellationService.escalateRequests(), 0);
    const claimsDue = await safely('claims', () => claimService.runDue(), { escalated: 0, closed: 0 });
    const completed = await safely('completions', () => sellerOrderService.completeDue(), 0);
    const broadcasts = await safely('broadcasts', () => broadcastService.sendDue(), 0);
    const creditScores = await safely('credit scores', () => creditScoreService.refreshStale(), 0);
    const result = { cancelled, autoCancelled, requestsEscalated, claimsEscalated: claimsDue.escalated, claimsClosed: claimsDue.closed, completed, broadcasts, creditScores };
    if (Object.values(result).some(Boolean)) {
      console.log(
        `🕒 Order jobs: ${cancelled} unpaid cancelled, ${autoCancelled} unconfirmed cancelled, ${requestsEscalated} request(s) + ` +
          `${claimsDue.escalated} claim(s) sent to AFA, ${claimsDue.closed} claim(s) closed, ${completed} completed, ${broadcasts} broadcast(s) sent, ${creditScores} credit score(s) updated`
      );
    }
    return result;
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
