// PUBLIC: payment gateway callbacks (no login; the gateway proves who it is, see payments/gateways).
const asyncHandler = require('../utils/asyncHandler');
const paymentService = require('../services/payment.service');

// GET or POST /payments/webhooks/:provider(/:token)
// When the gateway sends the buyer's browser here (ePayNet), the buyer is sent on to the AFA result page.
const webhook = asyncHandler(async (req, res) => {
  const { redirectTo, ...data } = await paymentService.handleWebhook(req.params.provider, req);
  if (redirectTo && req.method === 'GET') return res.redirect(302, redirectTo);
  return res.json({ success: true, data });
});

module.exports = { webhook };
