// Encrypts sensitive values before they are saved in the database (e.g. bank account numbers).
//
//   encrypt('1234567890') -> "v1:<iv>:<tag>:<data>"   (AES-256-GCM, a new random IV every time)
//   decrypt(that)         -> '1234567890'
//   fingerprint('1234567890') -> same text always gives the same hash (to find duplicates
//                                without decrypting anything)
//
// The key is DATA_ENCRYPTION_KEY in .env: 64 hex characters (32 bytes). Create one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Keep it safe and never change it: data encrypted with the old key can't be read with a new one.
const crypto = require('crypto');
const config = require('../config');
const ApiError = require('./ApiError');

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function getKey() {
  const hex = config.encryptionKey;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.error('DATA_ENCRYPTION_KEY is missing or not 64 hex characters in .env');
    throw new ApiError(500, 'This feature is not configured yet. Please contact AFA support.', {
      code: 'ENCRYPTION_NOT_CONFIGURED',
    });
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  const [version, iv, tag, data] = String(stored || '').split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Unknown encrypted value format');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Keyed hash: equal inputs give equal outputs, but it can't be reversed
function fingerprint(value) {
  return crypto.createHmac('sha256', getKey()).update(String(value)).digest('hex');
}

module.exports = { encrypt, decrypt, fingerprint };
