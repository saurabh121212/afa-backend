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

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

// Stop the app early if the JWT secret is missing or too weak.
if (!config.jwt.secret || config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long');
}

module.exports = config;
