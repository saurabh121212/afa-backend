// Sends emails through SMTP (Gmail) using nodemailer.
const nodemailer = require('nodemailer');
const { mail } = require('../config');
const { USER_TYPE_LABELS } = require('../utils/constants');

// The same email can have several AFA accounts (Farmer, Buyer, ...),
// so every email says which account it is about.
const accountLine = (userType) =>
  USER_TYPE_LABELS[userType]
    ? `<p style="color:#6B7280;">This email is about your AFA <strong>${USER_TYPE_LABELS[userType]}</strong> account.</p>`
    : '';

const transporter = nodemailer.createTransport({
  host: mail.host,
  port: mail.port,
  secure: mail.secure,
  auth: { user: mail.user, pass: mail.pass },
});

// Called once at startup: logs whether the SMTP login works (does not stop the server).
async function verifyEmailConnection() {
  if (!mail.user || !mail.pass) {
    console.warn('⚠️  SMTP_USER / SMTP_PASS not set in .env - emails will fail.');
    return;
  }
  try {
    await transporter.verify();
    console.log(`✅ SMTP ready: ${mail.user}`);
  } catch (err) {
    console.warn(`⚠️  SMTP login failed: ${err.message}`);
  }
}

// Simple AFA-branded layout for all emails.
function layout(title, bodyHtml) {
  return `
  <div style="font-family: Inter, Arial, sans-serif; background:#F7F9F7; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <div style="background:#1B5E20; color:#ffffff; padding:16px 24px; font-size:20px; font-weight:bold;">AFA</div>
      <div style="padding:24px; color:#1F2937; font-size:14px; line-height:1.6;">
        <h2 style="margin:0 0 12px; font-size:18px; color:#1B5E20;">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:12px 24px; font-size:12px; color:#6B7280; border-top:1px solid #E8F5E9;">
        Agricultural e-Marketplace for Eswatini
      </div>
    </div>
  </div>`;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send({ to, subject, html, text }) {
  return transporter.sendMail({ from: mail.from, to, subject, html, text });
}

async function sendOtpEmail({ to, name, otp, purpose, userType, expiresInMinutes }) {
  const isReset = purpose === 'password_reset';
  const label = USER_TYPE_LABELS[userType] ? ` (${USER_TYPE_LABELS[userType]})` : '';
  const subject = isReset
    ? `Your AFA password reset code${label}`
    : `Verify your email for AFA${label}`;
  const intro = isReset
    ? 'Use this code to reset your AFA password:'
    : 'Use this code to verify your email and complete your AFA registration:';

  const html = layout(
    subject,
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>${intro}</p>
     <p style="font-size:28px; letter-spacing:8px; font-weight:bold; color:#1B5E20; margin:16px 0;">${otp}</p>
     <p>This code expires in ${expiresInMinutes} minutes. Do not share it with anyone.</p>
     <p>If you did not request this, you can ignore this email.</p>`
  );
  const text = `${intro} ${otp} (expires in ${expiresInMinutes} minutes)`;
  return send({ to, subject, html, text });
}

async function sendRegistrationSubmittedEmail({ to, name, userType }) {
  const label = USER_TYPE_LABELS[userType] ? ` (${USER_TYPE_LABELS[userType]})` : '';
  const subject = `AFA registration received${label}`;
  const html = layout(
    'Registration received',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>Thank you for registering on AFA. Your application has been submitted and is now waiting for review by the AFA admin.</p>
     <p>We will email you as soon as your account is approved. You can then log in and start using the marketplace.</p>`
  );
  const text = 'Your AFA registration has been submitted and is waiting for admin approval.';
  return send({ to, subject, html, text });
}

// ---------- Account status emails (admin approval) ----------
const typeLabel = (userType) => (USER_TYPE_LABELS[userType] ? ` (${USER_TYPE_LABELS[userType]})` : '');
const reasonBlock = (title, text) =>
  text
    ? `<div style="background:#F7F9F7; border-left:4px solid #1B5E20; padding:12px 16px; margin:12px 0;">
         <strong>${title}</strong><br>${escapeHtml(text).replace(/\n/g, '<br>')}
       </div>`
    : '';

async function sendAccountApprovedEmail({ to, name, userType }) {
  const subject = `Your AFA account is approved${typeLabel(userType)}`;
  const html = layout(
    'Account approved',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>Good news! Your AFA account has been approved by the AFA admin.</p>
     <p>You can now log in and use all features of the marketplace.</p>`
  );
  return send({ to, subject, html, text: 'Your AFA account has been approved. You can now log in.' });
}

async function sendAccountRejectedEmail({ to, name, userType, reason }) {
  const subject = `Your AFA registration was not approved${typeLabel(userType)}`;
  const html = layout(
    'Registration not approved',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>We are sorry, your AFA registration has not been approved.</p>
     ${reasonBlock('Reason', reason)}
     <p>If you believe this is a mistake, please contact AFA support.</p>`
  );
  return send({ to, subject, html, text: `Your AFA registration was not approved. Reason: ${reason}` });
}

async function sendAccountSuspendedEmail({ to, name, userType, reason }) {
  const subject = `Your AFA account has been suspended${typeLabel(userType)}`;
  const html = layout(
    'Account suspended',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>Your AFA account has been suspended by the AFA admin. You cannot log in while it is suspended.</p>
     ${reasonBlock('Reason', reason)}
     <p>Please contact AFA support if you have any questions.</p>`
  );
  return send({ to, subject, html, text: `Your AFA account has been suspended. Reason: ${reason}` });
}

async function sendAccountReactivatedEmail({ to, name, userType }) {
  const subject = `Your AFA account is active again${typeLabel(userType)}`;
  const html = layout(
    'Account reactivated',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>Your AFA account has been reactivated. You can log in again.</p>`
  );
  return send({ to, subject, html, text: 'Your AFA account has been reactivated. You can log in again.' });
}

// Security notice after the user changed their password from the profile screen
async function sendPasswordChangedEmail({ to, name, userType }) {
  const subject = `Your AFA password was changed${typeLabel(userType)}`;
  const html = layout(
    'Password changed',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>The password of your AFA account was just changed. You have been logged out on your other devices.</p>
     <p><strong>Wasn't you?</strong> Reset your password right away with "Forgot password" on the login screen
     and contact AFA support.</p>`
  );
  return send({
    to,
    subject,
    html,
    text: "Your AFA password was just changed. If this wasn't you, reset your password with \"Forgot password\" and contact AFA support.",
  });
}

// Seller: the admin reviewed one of their marketplace listings
const LISTING_EMAIL = {
  approve: { subject: 'Your listing is now live', title: 'Listing approved', text: 'is approved and now visible on the AFA Marketplace.' },
  reject: { subject: 'Your listing was not approved', title: 'Listing not approved', text: 'was not approved. Please update it and publish it again.' },
  flag: { subject: 'Your listing was flagged', title: 'Listing flagged', text: 'was flagged by the AFA admin and is hidden. Please update it and publish it again.' },
  disable: { subject: 'Your listing was disabled', title: 'Listing disabled', text: 'was disabled by the AFA admin and is no longer visible.' },
  enable: { subject: 'Your listing is live again', title: 'Listing enabled', text: 'was enabled again and is visible on the AFA Marketplace.' },
};

async function sendListingStatusEmail({ to, name, userType, listingName, action, reason }) {
  const t = LISTING_EMAIL[action];
  if (!t) return null;
  const html = layout(
    t.title,
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>Your listing <strong>${escapeHtml(listingName)}</strong> ${t.text}</p>
     ${reasonBlock('Reason', reason)}`
  );
  return send({
    to,
    subject: `${t.subject}${typeLabel(userType)}`,
    html,
    text: `Your listing "${listingName}" ${t.text}${reason ? ` Reason: ${reason}` : ''}`,
  });
}

// ---------- Contact Us ----------
const contactRef = (id) => `AFA-CNT-${String(id).padStart(6, '0')}`;

// To the sender: "we received your message"
async function sendContactAcknowledgementEmail({ to, name, id, subjectLabel, message }) {
  const ref = contactRef(id);
  const html = layout(
    'We received your message',
    `<p>Hello ${escapeHtml(name || '')},</p>
     <p>Thank you for contacting AFA. Our support team will get back to you within one business day.</p>
     <p>Your reference number is <strong>${ref}</strong>.</p>
     ${reasonBlock(subjectLabel, message)}`
  );
  return send({
    to,
    subject: `We received your message (${ref})`,
    html,
    text: `Thank you for contacting AFA. Your reference number is ${ref}. We will reply within one business day.`,
  });
}

// To the admin: a new Contact Us message arrived
async function sendContactAdminAlertEmail({ to, id, fullName, email, phone, senderTypeLabel, subjectLabel, message }) {
  const ref = contactRef(id);
  const html = layout(
    'New Contact Us message',
    `<p><strong>${escapeHtml(fullName)}</strong> (${escapeHtml(senderTypeLabel)}) sent a message.</p>
     <p>Email: ${escapeHtml(email)}${phone ? `<br>Phone: ${escapeHtml(phone)}` : ''}</p>
     ${reasonBlock(subjectLabel, message)}
     <p>Reply from the AFA admin panel (reference ${ref}).</p>`
  );
  return send({ to, subject: `New message: ${subjectLabel} (${ref})`, html, text: `${fullName} <${email}>: ${message}` });
}

// To the sender: the admin's answer
async function sendContactReplyEmail({ to, name, id, subjectLabel, originalMessage, reply }) {
  const ref = contactRef(id);
  const html = layout(
    'Reply from AFA Support',
    `<p>Hello ${escapeHtml(name || '')},</p>
     <div style="white-space:normal;">${escapeHtml(reply).replace(/\n/g, '<br>')}</div>
     <p style="color:#6B7280; margin-top:16px;">Your message (${ref}):</p>
     ${reasonBlock(subjectLabel, originalMessage)}
     <p>If you need more help, simply send us another message from the Contact Us page.</p>`
  );
  return send({ to, subject: `Re: ${subjectLabel} (${ref})`, html, text: `${reply}\n\n--- Your message (${ref}) ---\n${originalMessage}` });
}

// ---------- VAT registration (sellers) ----------
// Listing names in an email: at most 20, then "and N more"
function listingNamesHtml(listings = []) {
  if (!listings.length) return '';
  const shown = listings.slice(0, 20).map((l) => `<li>${escapeHtml(l.name)}</li>`).join('');
  const more = listings.length > 20 ? `<li>and ${listings.length - 20} more</li>` : '';
  return `<ul style="margin:8px 0 12px; padding-left:20px;">${shown}${more}</ul>`;
}
const listingNamesText = (listings = []) =>
  listings.slice(0, 20).map((l) => `- ${l.name}`).join('\n') + (listings.length > 20 ? `\n- and ${listings.length - 20} more` : '');

function listingsBlocks({ hidden = [], shown = [] }) {
  return (
    (hidden.length
      ? `<p>These listings are <strong>hidden from the marketplace</strong> until your VAT registration is approved:</p>${listingNamesHtml(hidden)}`
      : '') +
    (shown.length ? `<p>These listings are <strong>visible again</strong> on the marketplace:</p>${listingNamesHtml(shown)}` : '')
  );
}

const VAT_EMAIL = {
  approved: {
    subject: 'Your VAT registration is approved',
    title: 'VAT registration approved',
    text: 'Your VAT registration has been approved. You can now list VAT-applicable items on the AFA Marketplace.',
  },
  rejected: {
    subject: 'Your VAT registration was not approved',
    title: 'VAT registration not approved',
    text: 'Your VAT registration was not approved. Please upload a valid VAT Registration Certificate and apply again from your profile.',
  },
  removed: {
    subject: 'Your VAT registration was removed',
    title: 'VAT registration removed',
    text: 'The AFA team removed your VAT registration. You can no longer list VAT-applicable items. Upload a valid VAT Registration Certificate to apply again.',
  },
  review_again: {
    subject: 'Your new VAT certificate is being checked',
    title: 'VAT certificate under review',
    text: 'You uploaded a new VAT Registration Certificate. The AFA team will check it again.',
  },
};

// Seller: VAT status changed. hidden / shown = listings affected by the change
async function sendVatStatusEmail({ to, name, userType, status, reason, hidden = [], shown = [] }) {
  const t = VAT_EMAIL[status];
  if (!t) return null;
  const html = layout(
    t.title,
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     <p>${t.text}</p>
     ${reasonBlock('Reason', reason)}
     ${listingsBlocks({ hidden, shown })}`
  );
  const text = [
    t.text,
    reason ? `Reason: ${reason}` : '',
    hidden.length ? `Hidden until your VAT registration is approved:\n${listingNamesText(hidden)}` : '',
    shown.length ? `Visible again:\n${listingNamesText(shown)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return send({ to, subject: `${t.subject}${typeLabel(userType)}`, html, text });
}

// Seller: the admin changed a category's VAT setting, so some listings were hidden / shown again
async function sendVatListingsEmail({ to, name, userType, hidden = [], shown = [] }) {
  const html = layout(
    'VAT update for your listings',
    `<p>Hello ${escapeHtml(name || '')},</p>
     ${accountLine(userType)}
     ${
       hidden.length
         ? `<p>Some of your listings are now in a <strong>VAT-applicable</strong> category. Only VAT-registered sellers can sell these items, so they are <strong>hidden</strong> from the marketplace:</p>${listingNamesHtml(hidden)}
            <p>To show them again, upload your VAT Registration Certificate and switch on "I am VAT-registered" in your profile, or move the listings to another category.</p>`
         : ''
     }
     ${shown.length ? `<p>These listings are <strong>visible again</strong> on the marketplace:</p>${listingNamesHtml(shown)}` : ''}`
  );
  const text = [
    hidden.length ? `Hidden (VAT-applicable category, VAT registration needed):\n${listingNamesText(hidden)}` : '',
    shown.length ? `Visible again:\n${listingNamesText(shown)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return send({ to, subject: `VAT update for your listings${typeLabel(userType)}`, html, text });
}

// Admin: a seller asked for VAT registration (or uploaded a new certificate)
async function sendVatRequestAdminEmail({ to, sellerName, userType, tin, newCertificate }) {
  const what = newCertificate ? 'uploaded a new VAT Registration Certificate' : 'applied for VAT registration';
  const html = layout(
    'VAT registration to review',
    `<p><strong>${escapeHtml(sellerName || 'A seller')}</strong>${typeLabel(userType)} ${what}.</p>
     <p>TIN on AFA: <strong>${escapeHtml(tin || '-')}</strong>. Check that it matches the TIN on the certificate.</p>
     <p>Review it in the AFA admin panel: VAT Registrations.</p>`
  );
  return send({
    to,
    subject: `VAT registration to review: ${sellerName || 'seller'}`,
    html,
    text: `${sellerName || 'A seller'}${typeLabel(userType)} ${what}. TIN: ${tin || '-'}.`,
  });
}

module.exports = {
  sendVatStatusEmail,
  sendVatListingsEmail,
  sendVatRequestAdminEmail,
  verifyEmailConnection,
  sendContactAcknowledgementEmail,
  sendContactAdminAlertEmail,
  sendContactReplyEmail,
  sendPasswordChangedEmail,
  sendListingStatusEmail,
  sendOtpEmail,
  sendRegistrationSubmittedEmail,
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
  sendAccountSuspendedEmail,
  sendAccountReactivatedEmail,
};
