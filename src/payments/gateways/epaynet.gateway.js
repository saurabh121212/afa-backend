// ePayNet (Eswatini) payment gateway. Switched on with PAYMENT_GATEWAY=epaynet.
// Based on the "ePayNet Integration User Guide" (4 pages, received 2 Nov 2026).
//
// Flow
//   1. createPayment(): POST our transaction to ePayNet -> { success, message, paymentUrl }
//      -> the buyer is sent to paymentUrl (MoMo / eMali / card ... authentication page)
//   2. ePayNet calls OUR callback URL (registered at onboarding) with a GET:
//        ?transactionNumber=<ours>&success=1|0&theirTransactionNumber=<ePayNet ref>
//      -> parseWebhook() -> the order becomes Paid (or the attempt Failed)
//
// OPEN POINTS (asked to ePayNet, see the questions sent to the client):
//   - The callback has NO signature and NO amount, and there is no status API yet.
//     Until ePayNet answers, it is protected by:
//       a) a secret token in the callback URL:  /payments/webhooks/epaynet/<EPAYNET_CALLBACK_TOKEN>
//       b) optionally, ePayNet server IPs:      EPAYNET_ALLOWED_IPS
//     (a) only helps if the callback is server-to-server: a browser redirect would show the URL.
//   - JSON vs form body (the Postman example uses form) -> EPAYNET_REQUEST_FORMAT
//   - cellNumber format (example "76645603") -> we send 8 digits without 268
const crypto = require('crypto');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');

const name = 'epaynet';

// Payment options from the ePayNet guide (Option Identifier). Only the ones in EPAYNET_METHODS are offered.
const CHANNELS = {
  1: { code: 'momo', label: 'MTN MoMo' },
  2: { code: 'emali', label: 'eMali' },
  3: { code: 'unayo', label: 'Unayo' },
  5: { code: 'card', label: 'Visa / Mastercard' },
  9: { code: 'nedbank', label: 'Nedbank' },
  13: { code: 'ott_voucher', label: 'OTT Voucher' },
  15: { code: 'epaynet_token', label: 'ePayNet Token' },
};

// ePayNet error codes (guide section 4) -> what we log. Buyers get a general message.
const ERRORS = {
  'OC-101': 'Incorrect credentials',
  'OC-102': 'Client details mismatch (credentials breach)',
  'OC-103': 'Client is not added as a 3c integrated company on ePayNet',
  'OC-104': 'Invalid payment method defined for the client (3c)',
  'OC-105': 'Missing API key in the payload',
  'OC-107': 'Payment method account not created on ePayNet for the client (3c)',
  'DG-100': 'Integration error',
};

// Options shown at checkout (all need the buyer's mobile number: cellNumber is a required field)
function channels() {
  return config.epaynet.methods
    .filter((id) => CHANNELS[id])
    .map((id) => ({ id, code: CHANNELS[id].code, label: CHANNELS[id].label, requiresCellNumber: true }));
}

// "+26876123456" / "26876123456" / "7612 3456" -> "76123456"
function localCellNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('268') && digits.length === 11 ? digits.slice(3) : digits;
  return /^[0-9]{8}$/.test(local) ? local : null;
}

// Our unique, digits-only transaction number for one attempt (like the guide's example 7664560333333)
const transactionNumberFor = (payment) => `${String(Date.now()).slice(-10)}${String(payment.id).padStart(6, '0')}`;

const gatewayError = (message, extra = {}) =>
  new ApiError(502, 'The payment service could not start your payment. Please try again or pay by bank transfer.', {
    code: 'PAYMENT_GATEWAY_ERROR',
    ...extra,
    errors: [{ field: 'payment', message }],
  });

// Credentials present? (online payment is only offered when true)
const isReady = () => {
  const c = config.epaynet;
  return Boolean(c.apiKey && c.appId && c.uid && c.password && c.methods.length);
};

// Checked BEFORE anything is saved: the setup, the payment option and the mobile number
function validateOptions(options = {}) {
  const c = config.epaynet;
  if (!c.apiKey || !c.appId || !c.uid || !c.password) {
    throw new ApiError(503, 'Online payment is not set up yet', { code: 'PAYMENT_GATEWAY_NOT_CONFIGURED' });
  }
  const channel = Number(options.channel);
  if (!c.methods.includes(channel) || !CHANNELS[channel]) {
    throw new ApiError(422, 'Choose how you want to pay online', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'channel', message: `channel must be one of: ${channels().map((x) => `${x.id} (${x.label})`).join(', ')}` }],
    });
  }
  const cellNumber = localCellNumber(options.cellNumber);
  if (!cellNumber) {
    throw new ApiError(422, 'Enter the mobile number to pay with', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'cellNumber', message: 'Enter a valid Eswatini mobile number, e.g. 7612 3456' }],
    });
  }
  return { channel, cellNumber };
}

async function createPayment({ payment, order, options = {} }) {
  const c = config.epaynet;
  const { channel, cellNumber } = validateOptions(options);

  const transactionNumber = transactionNumberFor(payment);
  const fields = {
    cellNumber,
    amount: Number(payment.amount).toFixed(2),
    transactionNumber,
    paymentMethod: String(channel),
    apiKey: c.apiKey,
    app_id: c.appId,
    reference: order.orderNumber,
    threec: c.threec,
    twoc: c.twoc,
    c: c.c,
    uid: c.uid,
    password: c.password,
  };
  const asJson = c.requestFormat === 'json';

  let response;
  try {
    response = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': asJson ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: asJson ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    console.error(`ePayNet unreachable for ${order.orderNumber}:`, err.message);
    throw new ApiError(502, 'The payment service is not responding. Please try again in a moment or pay by bank transfer.', {
      code: 'PAYMENT_GATEWAY_UNREACHABLE',
    });
  }

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = null;
  }
  const ok = data && (data.success === 1 || data.success === '1' || data.success === true) && data.paymentUrl;
  if (!response.ok || !ok) {
    const message = data && data.message ? String(data.message) : `HTTP ${response.status}`;
    const code = (message.match(/(OC|DG)-\d{3}/) || [])[0];
    // Never log the request (it holds the password); the reply is safe to log
    console.error(`ePayNet refused ${order.orderNumber}: ${code ? `${code} ${ERRORS[code] || ''}` : message}`, text.slice(0, 500));
    throw gatewayError(code ? `${code}: ${ERRORS[code] || message}` : message);
  }

  return {
    providerReference: transactionNumber,
    redirectUrl: String(data.paymentUrl),
    instructions: null,
    // Saved with the payment (no secrets)
    request: { channel, channelLabel: CHANNELS[channel].label, cellNumber: `${cellNumber.slice(0, 2)}****${cellNumber.slice(-2)}`, transactionNumber },
    reply: { success: data.success, message: data.message || null },
  };
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');

// GET (or POST) /payments/webhooks/epaynet/:token?transactionNumber=&success=&theirTransactionNumber=
async function parseWebhook(req) {
  const c = config.epaynet;
  if (c.callbackToken && !sameSecret(req.params.token, c.callbackToken)) {
    throw new ApiError(401, 'Invalid callback', { code: 'INVALID_WEBHOOK' });
  }
  if (c.allowedIps.length && !c.allowedIps.includes(clientIp(req))) {
    console.warn(`ePayNet callback refused from IP ${clientIp(req)}`);
    throw new ApiError(401, 'Invalid callback', { code: 'INVALID_WEBHOOK' });
  }

  const params = { ...(req.body || {}), ...(req.query || {}) };
  const transactionNumber = params.transactionNumber || params['system transactionNumber'];
  if (!transactionNumber) {
    throw new ApiError(422, 'transactionNumber is missing', { code: 'VALIDATION_ERROR' });
  }
  const success = params.success === 1 || params.success === '1' || params.success === true || params.success === 'true';
  return {
    providerReference: String(transactionNumber),
    status: success ? 'succeeded' : 'failed',
    amount: NaN, // ePayNet does not send the amount (open point)
    payload: {
      transactionNumber: String(transactionNumber),
      success: success ? 1 : 0,
      theirTransactionNumber: params.theirTransactionNumber ? String(params.theirTransactionNumber) : null,
      ip: clientIp(req),
    },
  };
}

// After the callback, send the buyer's browser on to the AFA result page
const redirectAfterCallback = () => config.epaynet.callbackRedirect;

module.exports = { name, isReady, channels, validateOptions, createPayment, parseWebhook, redirectAfterCallback, localCellNumber, CHANNELS, ERRORS };
