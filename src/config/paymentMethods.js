// Bank & payment details that users add to their profile (Figma "Bank & Payment Details").
// Every user type EXCEPT financial institutions can add them.

const PAYMENT_METHOD_USER_TYPES = ['farmer', 'buyer', 'trader', 'logistics'];

const PAYMENT_METHOD_TYPES = ['bank_account', 'mobile_money'];
const PAYMENT_METHOD_TYPE_LABELS = { bank_account: 'Bank Account', mobile_money: 'Mobile Money' };

const BANK_ACCOUNT_TYPES = ['savings', 'current'];
const BANK_ACCOUNT_TYPE_LABELS = { savings: 'Savings', current: 'Current / Cheque' };

// Mobile money services in Eswatini (add more here if needed)
const MOBILE_MONEY_PROVIDERS = ['mtn_momo', 'eswatini_mobile_emali'];
const MOBILE_MONEY_PROVIDER_LABELS = {
  mtn_momo: 'MTN MoMo',
  eswatini_mobile_emali: 'Eswatini Mobile e-Mali',
};

// Most payment methods one account can have
const MAX_PAYMENT_METHODS = 5;

module.exports = {
  PAYMENT_METHOD_USER_TYPES,
  PAYMENT_METHOD_TYPES,
  PAYMENT_METHOD_TYPE_LABELS,
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  MOBILE_MONEY_PROVIDERS,
  MOBILE_MONEY_PROVIDER_LABELS,
  MAX_PAYMENT_METHODS,
};
