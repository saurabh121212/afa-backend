// PUSH NOTIFICATIONS through Firebase Cloud Messaging (FCM HTTP v1), with NO extra npm package.
//
//   1. Log in to Google with the Firebase service account: a JWT signed (RS256) with its private key
//      is exchanged for an access token (valid 1 hour, cached and renewed 5 minutes before it ends).
//   2. One HTTPS request per device token to
//      https://fcm.googleapis.com/v1/projects/<project>/messages:send
//   3. Tokens Firebase says are dead (app removed, token rotated) are reported back so they can be removed.
//
// Push is OFF until FCM_SERVICE_ACCOUNT_FILE or FCM_SERVICE_ACCOUNT_BASE64 is set (see config/index.js).
// A push failure never fails the action that caused it: the in-app notification is already saved.
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PARALLEL = 10; // requests at the same time

let account; // undefined = not loaded yet, null = not configured / unreadable
let cachedToken = null; // { value, expiresAt }
let loggingIn = null; // the login in progress (sends started together share it)

function loadAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    let json = null;
    if (config.fcm.serviceAccountFile) json = fs.readFileSync(config.fcm.serviceAccountFile, 'utf8');
    else if (config.fcm.serviceAccountBase64) json = Buffer.from(config.fcm.serviceAccountBase64, 'base64').toString('utf8');
    if (json) {
      const a = JSON.parse(json);
      if (!a.project_id || !a.client_email || !a.private_key) throw new Error('project_id, client_email or private_key missing');
      account = { projectId: a.project_id, clientEmail: a.client_email, privateKey: a.private_key, tokenUri: a.token_uri || TOKEN_URL };
    }
  } catch (err) {
    console.error('Push notifications are OFF: the Firebase service account could not be read:', err.message);
    account = null;
  }
  return account;
}

const isReady = () => Boolean(loadAccount());

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Google access token for FCM (cached; one login at a time)
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60 * 1000) return cachedToken.value;
  if (!loggingIn) loggingIn = login().finally(() => {
    loggingIn = null;
  });
  return loggingIn;
}

async function login() {
  const a = loadAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: a.clientEmail, scope: SCOPE, aud: a.tokenUri, iat: now, exp: now + 3600 }));
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(a.privateKey));
  const res = await fetch(a.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }).toString(),
    signal: AbortSignal.timeout(config.fcm.timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google login for FCM failed: HTTP ${res.status} ${data.error || ''} ${data.error_description || ''}`.trim());
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

// FCM "data" values must all be strings
const stringData = (data = {}) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );

function buildMessage(token, { title, body, data, badge, platform }) {
  const message = {
    token,
    notification: { title, body },
    data: stringData(data),
  };
  if (platform === 'android' || !platform) {
    message.android = { priority: 'high', notification: { channel_id: config.fcm.androidChannelId, sound: 'default' } };
  }
  if (platform === 'ios' || !platform) {
    message.apns = { payload: { aps: { sound: 'default', ...(Number.isInteger(badge) ? { badge } : {}) } } };
  }
  if (platform === 'web' || !platform) {
    message.webpush = {
      notification: { icon: '/icon-192.png' },
      ...(config.webAppUrl ? { fcm_options: { link: `${config.webAppUrl}/notifications` } } : {}),
    };
  }
  return { message };
}

// Firebase error -> is the token itself dead?
function deadToken(status, error) {
  const details = (error && error.details) || [];
  const codes = details.map((d) => d.errorCode).filter(Boolean);
  if (codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH')) return true;
  if (status === 404) return true;
  return status === 400 && /registration token|not a valid FCM/i.test((error && error.message) || '');
}

async function sendOne(device, payload, retry = true) {
  const a = loadAccount();
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(device.token, { ...payload, platform: device.platform })),
      signal: AbortSignal.timeout(config.fcm.timeoutMs),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const error = body.error || {};
    if (res.status === 401 && retry) {
      cachedToken = null; // access token expired early: log in again once
      return sendOne(device, payload, false);
    }
    if ((res.status === 429 || res.status >= 500) && retry) {
      await new Promise((r) => setTimeout(r, 1000));
      return sendOne(device, payload, false);
    }
    return { ok: false, dead: deadToken(res.status, error), error: `HTTP ${res.status} ${error.status || ''} ${error.message || ''}`.trim().slice(0, 255) };
  } catch (err) {
    return { ok: false, dead: false, error: String(err.message || err).slice(0, 255) };
  }
}

// Send one notification to several devices: [{ id, token, platform }]
//   payload: { title, body, data, badge }
// -> { sent, failed, results: [{ id, ok, dead, error }] }   (never throws)
async function sendToDevices(devices, payload) {
  const results = [];
  if (!devices.length || !isReady()) return { sent: 0, failed: 0, results };
  const queue = devices.slice();
  const worker = async () => {
    while (queue.length) {
      const device = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      const r = await sendOne(device, payload);
      results.push({ id: device.id, ...r });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, devices.length) }, worker));
  const sent = results.filter((r) => r.ok).length;
  return { sent, failed: results.length - sent, results };
}

// For tests / a config change at runtime
function reset() {
  account = undefined;
  cachedToken = null;
  loggingIn = null;
}

module.exports = { isReady, sendToDevices, buildMessage, reset };
