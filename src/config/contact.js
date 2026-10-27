// Contact Us form (Figma "Website - Contact Us") + admin inbox.

// "I am a..." dropdown
const CONTACT_SENDER_TYPES = {
  farmer: 'Farmer',
  buyer: 'Buyer / Food Processor',
  trader: 'Trader',
  logistics: 'Logistics Provider',
  financial_institution: 'Financial Institution',
  other: 'Other',
};

// "Subject" dropdown
const CONTACT_SUBJECTS = {
  general_enquiry: 'General Enquiry',
  technical_support: 'Technical Support',
  report_issue: 'Report an Issue',
  partnership: 'Partnership',
};

// Admin inbox status
//   new      -> nobody has opened it yet
//   read     -> the admin opened it
//   replied  -> the admin answered (email sent to the sender)
//   closed   -> done; can be reopened
const CONTACT_STATUSES = {
  new: 'New',
  read: 'Read',
  replied: 'Replied',
  closed: 'Closed',
};

module.exports = { CONTACT_SENDER_TYPES, CONTACT_SUBJECTS, CONTACT_STATUSES };
