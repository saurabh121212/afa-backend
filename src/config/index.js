// Central place to read environment variables.
// Every other file imports settings from here instead of reading process.env directly.
require('dotenv').config();

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 5000),
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: toInt(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'afa_db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1d', // normal login
    rememberMeExpiresIn: process.env.JWT_REMEMBER_ME_EXPIRES_IN || '30d', // "Remember me" ticked
    registrationExpiresIn: process.env.JWT_REGISTRATION_EXPIRES_IN || '24h', // to finish registration steps
  },

  mail: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: toInt(process.env.SMTP_PORT, 465),
    secure: (process.env.SMTP_SECURE || 'true') === 'true', // true for port 465
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || `AFA <${process.env.SMTP_USER || 'no-reply@afa.local'}>`,
  },

  otp: {
    expiresInMinutes: toInt(process.env.OTP_EXPIRES_MINUTES, 10),
    maxAttempts: toInt(process.env.OTP_MAX_ATTEMPTS, 5),
    resendCooldownSeconds: toInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSizeMB: toInt(process.env.MAX_FILE_SIZE_MB, 5),
  },

  // Online payments (payment gateway).
  //   PAYMENT_GATEWAY = none (default: online payment not offered, bank transfer only)
  //                   | test (development only: fake gateway, pay with POST /me/orders/:id/pay/test)
  //                   | <the AFA gateway provider, added when its documents arrive>
  //   PAYMENT_RETURN_URL     -> frontend page the gateway sends the buyer back to (?order=AFA-ORD-000123)
  //   PAYMENT_WEBHOOK_SECRET -> shared secret to check gateway callbacks
  payment: {
    gateway: (process.env.PAYMENT_GATEWAY || 'none').trim().toLowerCase(),
    returnUrl: process.env.PAYMENT_RETURN_URL || 'http://localhost:3000/checkout/result',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
  },

  // ePayNet (Eswatini payment gateway). Used when PAYMENT_GATEWAY=epaynet.
  // Credentials come from ePayNet onboarding; they live ONLY here, never in the frontend.
  epaynet: {
    url: process.env.EPAYNET_URL || 'https://www.epaynetsz.com/bridge_gateway/bridge_receive_getway_transaction.php',
    apiKey: process.env.EPAYNET_API_KEY || '',
    appId: process.env.EPAYNET_APP_ID || '',
    threec: process.env.EPAYNET_THREEC || '',
    twoc: process.env.EPAYNET_TWOC || '',
    c: process.env.EPAYNET_C || '',
    uid: process.env.EPAYNET_UID || '',
    password: process.env.EPAYNET_PASSWORD || '',
    // Payment options enabled for AFA at ePayNet registration (ids from the ePayNet guide)
    methods: (process.env.EPAYNET_METHODS || '1,2,5')
      .split(',')
      .map((m) => parseInt(m, 10))
      .filter((m) => Number.isInteger(m)),
    requestFormat: (process.env.EPAYNET_REQUEST_FORMAT || 'form').toLowerCase(), // form | json
    timeoutMs: toInt(process.env.EPAYNET_TIMEOUT_MS, 20000),
    // Callback protection until ePayNet gives a signature / status API (see the gateway file):
    callbackToken: process.env.EPAYNET_CALLBACK_TOKEN || '', // secret part of the callback URL
    allowedIps: (process.env.EPAYNET_ALLOWED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean),
    // true = the callback arrives through the buyer's browser: send the buyer on to the AFA result page
    callbackRedirect: (process.env.EPAYNET_CALLBACK_REDIRECT || 'true') === 'true',
  },

  // Behind a proxy / load balancer (nginx), set TRUST_PROXY=1 so the real client IP is used
  // (rate limits, ePayNet IP allow-list)
  trustProxy: process.env.TRUST_PROXY || '',

  // Background jobs inside the API (auto-cancel unpaid orders, complete delivered orders).
  // Set RUN_JOBS=false on extra servers if the API ever runs on more than one server.
  runJobs: (process.env.RUN_JOBS || 'true') === 'true',

  // 64 hex characters (32 bytes). Encrypts sensitive data such as bank account numbers.
  encryptionKey: process.env.DATA_ENCRYPTION_KEY || '',

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

// The fake "test" payment gateway must never run in production
if (config.env === 'production' && config.payment.gateway === 'test') {
  throw new Error('PAYMENT_GATEWAY=test is not allowed in production');
}

// ePayNet callbacks carry no signature yet: in production at least one protection is required
if (
  config.env === 'production' &&
  config.payment.gateway === 'epaynet' &&
  !config.epaynet.callbackToken &&
  !config.epaynet.allowedIps.length
) {
  throw new Error('PAYMENT_GATEWAY=epaynet in production needs EPAYNET_CALLBACK_TOKEN and/or EPAYNET_ALLOWED_IPS');
}

// Stop the app early if the JWT secret is missing or too weak.
if (!config.jwt.secret || config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long');
}

module.exports = config;
