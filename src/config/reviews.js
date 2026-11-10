// Reviews & Ratings.
//
// After a seller order (or service booking) is COMPLETED, the buyer rates it once: 1-5 stars + an optional comment.
// One review per seller order. It counts for the SELLER and for each LISTING in that order.
//   - goes live at once ("published"), unless the comment has a blocked word, a phone number or an
//     email address -> "held" until the admin approves it
//   - the buyer can edit it ONCE, within 7 days of writing it
//   - the seller can post ONE public reply
//   - anyone logged in can report a review -> admin queue; the admin hides (with a reason) or restores
//   - hidden and held reviews don't count in the averages
// Blocked words: admin Settings -> Reviews (review_blocked_words, comma separated).

const REVIEW_STATUS = { PUBLISHED: 'published', HELD: 'held', HIDDEN: 'hidden' };
const REVIEW_STATUS_LABELS = { published: 'Published', held: 'Waiting for Approval', hidden: 'Hidden' };

const REVIEW_RULES = {
  windowDays: 30, // the buyer can review up to 30 days after the order completes
  editDays: 7, // one edit, within 7 days of writing the review
  maxEdits: 1,
  commentMin: 3,
  commentMax: 1000,
  replyMax: 1000,
  reportNoteMax: 500,
  hideReasonMax: 500,
};

// Why a user reports a review
const REPORT_REASONS = {
  offensive: 'Offensive or abusive',
  false_info: 'False or misleading',
  spam: 'Spam or advertising',
  personal_info: 'Shares personal information',
  not_about_order: 'Not about this order',
  other: 'Other',
};
const REPORT_STATUS = { OPEN: 'open', RESOLVED: 'resolved' };

// Why a review was held (shown to the admin)
const HOLD_REASONS = {
  blocked_words: 'Contains blocked words',
  phone: 'Contains a phone number',
  email: 'Contains an email address',
};

// Public list sorts
const REVIEW_SORTS = { newest: 'Newest', highest: 'Highest rating', lowest: 'Lowest rating' };

// Find why a comment should be held for the admin. blockedWords: array of lower-case words / phrases.
function holdReasons(text, blockedWords = []) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  const reasons = [];
  const found = blockedWords.filter((w) => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(t);
  });
  if (found.length) reasons.push({ code: 'blocked_words', label: HOLD_REASONS.blocked_words, words: found });
  // phone numbers: 8+ digits, allowing spaces / dashes / + (e.g. +268 7612 3456, 7612-3456)
  if (/(\+?\d[\d\s-]{6,}\d)/.test(t) && t.replace(/\D/g, '').length >= 8) reasons.push({ code: 'phone', label: HOLD_REASONS.phone });
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) reasons.push({ code: 'email', label: HOLD_REASONS.email });
  return reasons;
}

// "idiot, Stupid ,  scam" -> ['idiot', 'stupid', 'scam']
const parseWordList = (value) =>
  String(value || '')
    .split(/[,\n]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

module.exports = {
  REVIEW_STATUS,
  REVIEW_STATUS_LABELS,
  REVIEW_RULES,
  REPORT_REASONS,
  REPORT_STATUS,
  HOLD_REASONS,
  REVIEW_SORTS,
  holdReasons,
  parseWordList,
};
