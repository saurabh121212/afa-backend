// Settings for the CMS (Figma "Content Management": Banners, FAQs).

// Where a banner can be shown on the website / apps. Add more here when new pages get banners.
const BANNER_PLACEMENTS = {
  homepage_hero: 'Homepage Hero',
  homepage_promo: 'Homepage Promo',
  marketplace: 'Marketplace Page',
  finance_page: 'Finance Page',
  resources_page: 'Resources Page',
  mobile_app_home: 'Mobile App Home',
};

// Banner status shown in the admin list (worked out from the dates + the on/off switch)
//   active    -> on, started, not ended (visible on the website)
//   scheduled -> on, starts in the future
//   expired   -> on, end date passed
//   inactive  -> switched off by the admin
const BANNER_STATUSES = ['active', 'scheduled', 'expired', 'inactive'];

// Banner image: public file, saved in uploads/public/banners/
const BANNER_IMAGE = { folder: 'banners', prefix: 'banner', formats: ['jpg', 'png'], maxSizeMB: 5 };

// Eswatini time (UTC+2): a date without a time means the whole day there
const BUSINESS_TZ = '+02:00';

module.exports = { BANNER_PLACEMENTS, BANNER_STATUSES, BANNER_IMAGE, BUSINESS_TZ };
