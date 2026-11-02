// FAKE gateway for development and Postman tests (PAYMENT_GATEWAY=test). Never in production
// (config/index.js refuses to start). No money moves.
//
// Flow:
//   1. POST /me/orders/:id/pay/online -> createPayment() gives a reference "TEST-<paymentId>-<random>"
//   2. Instead of a bank page, the tester calls POST /me/orders/:id/pay/test { outcome: "success" | "fail" }
//      (or calls the webhook below like a real gateway would)
//   3. Webhook: POST /payments/webhooks/test   header X-Webhook-Secret: <PAYMENT_WEBHOOK_SECRET>
//               body { reference, status: "succeeded" | "failed", amount }
const crypto = require('crypto');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');

const name = 'test';

async function createPayment({ payment, order, returnUrl }) {
  const providerReference = `TEST-${payment.id}-${crypto.randomBytes(4).toString('hex')}`;
  return {
    providerReference,
    redirectUrl: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}order=${encodeURIComponent(order.orderNumber)}&orderId=${order.id}&test=1`,
    instructions: `Test mode: call POST /me/orders/${order.id}/pay/test with { "outcome": "success" } or { "outcome": "fail" }`,
  };
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function parseWebhook(req) {
  if (!config.payment.webhookSecret || !sameSecret(req.get('x-webhook-secret'), config.payment.webhookSecret)) {
    throw new ApiError(401, 'Invalid webhook signature', { code: 'INVALID_WEBHOOK' });
  }
  const { reference, status, amount } = req.body || {};
  if (!reference || !['succeeded', 'failed'].includes(status)) {
    throw new ApiError(422, 'reference and status (succeeded | failed) are required', { code: 'VALIDATION_ERROR' });
  }
  return { providerReference: String(reference), status, amount: Number(amount), payload: req.body };
}

module.exports = { name, createPayment, parseWebhook };
