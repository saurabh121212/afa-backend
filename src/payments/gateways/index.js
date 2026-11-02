// Online payment gateways. The one in use comes from PAYMENT_GATEWAY in .env.
//
// Every gateway file exports the same 3 things, so the order code never changes
// when the real AFA gateway is plugged in:
//
//   name                                   -> e.g. "test", "epaynet"
//   isReady()                              -> (optional) false = not set up (credentials missing): not offered
//   channels()                             -> (optional) options to choose at checkout (MoMo, card ...)
//   validateOptions(options)               -> (optional) check the buyer's choice BEFORE anything is saved
//   createPayment({ payment, order, returnUrl, options: { channel, cellNumber } })
//        -> { providerReference, redirectUrl, instructions }  (send the buyer to redirectUrl)
//        The gateway must send the buyer back to returnUrl?order=<orderNumber>&orderId=<id>
//   parseWebhook(req)
//        -> { providerReference, status: 'succeeded' | 'failed', amount, payload }
//           (throws ApiError 401 when the callback is not really from the gateway)
//   redirectAfterCallback()                -> (optional) true = the callback comes through the buyer's
//                                             browser: send it on to PAYMENT_RETURN_URL
//
// To add the AFA provider later: create gateways/<name>.gateway.js, add it to GATEWAYS,
// set PAYMENT_GATEWAY=<name>.
const config = require('../../config');

const GATEWAYS = {
  test: () => require('./test.gateway'), // eslint-disable-line global-require
  epaynet: () => require('./epaynet.gateway'), // eslint-disable-line global-require
};

// The active gateway, or null when online payment is switched off (PAYMENT_GATEWAY=none)
function getGateway() {
  const name = config.payment.gateway;
  if (!name || name === 'none') return null;
  const load = GATEWAYS[name];
  if (!load) {
    console.warn(`⚠️  Unknown PAYMENT_GATEWAY "${name}" - online payment is switched off`);
    return null;
  }
  return load();
}

// For the public webhook URL /payments/webhooks/:provider
function getGatewayByName(name) {
  const active = getGateway();
  return active && active.name === name ? active : null;
}

module.exports = { getGateway, getGatewayByName };
