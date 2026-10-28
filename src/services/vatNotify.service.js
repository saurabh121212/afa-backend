// Emails for VAT registration and VAT hold. Called AFTER the database change is saved.
// Emails are sent in the background: a failed email is logged and never fails the action.
//
//   afterStatusChange(change)  -> seller's VAT status changed (vat.service changeStatus result)
//       approved               -> seller: "approved" (+ listings visible again)
//       rejected (was pending) -> seller: "not approved" + reason
//       rejected (was approved)-> seller: "removed" + reason (+ listings hidden)
//       pending (new request)  -> admin: "VAT registration to review"
//       pending (new certificate while approved) -> seller: "being checked" (+ listings hidden) and admin alert
//       none                   -> the seller did it themselves: no email
//   afterCategoryChange(holds) -> each affected seller: which listings were hidden / shown
const { Admin, User } = require('../models');
const emailService = require('./email.service');
const directory = require('./userDirectory');
const { bySeller } = require('./vatHold.service');
const { VAT_STATUS } = require('../config/vat');
const { LISTING_STATUS } = require('../config/listingOptions');

// Drafts are private and never on the website: not worth mentioning in an email
const worthTelling = (listings = []) => listings.filter((l) => l.status !== LISTING_STATUS.DRAFT);

const background = (label, promise) =>
  Promise.resolve(promise).catch((err) => console.error(`VAT email failed (${label}):`, err.message));

async function adminEmail() {
  const admin = await Admin.findOne({ attributes: ['email'], order: [['id', 'ASC']] });
  return admin ? admin.email : null;
}

async function sendStatus(change) {
  const { user, from, to } = change;
  const holds = change.holds || { hidden: [], shown: [] };
  const hidden = worthTelling(holds.hidden);
  const shown = worthTelling(holds.shown);
  const dir = await directory.findOne(user.id);
  const name = dir ? dir.display_name : '';
  const seller = { to: user.email, name, userType: user.userType };

  if (to === VAT_STATUS.APPROVED) {
    await emailService.sendVatStatusEmail({ ...seller, status: 'approved', shown });
  } else if (to === VAT_STATUS.REJECTED) {
    await emailService.sendVatStatusEmail({
      ...seller,
      status: from === VAT_STATUS.APPROVED ? 'removed' : 'rejected',
      reason: user.vatStatusReason,
      hidden,
    });
  } else if (to === VAT_STATUS.PENDING) {
    const newCertificate = from === VAT_STATUS.APPROVED || from === VAT_STATUS.REJECTED;
    if (from === VAT_STATUS.APPROVED) {
      await emailService.sendVatStatusEmail({ ...seller, status: 'review_again', hidden });
    }
    const to_ = await adminEmail();
    if (to_) {
      await emailService.sendVatRequestAdminEmail({
        to: to_,
        sellerName: name,
        userType: user.userType,
        tin: dir ? dir.tin : null,
        newCertificate,
      });
    }
  }
  // to === none: the seller switched VAT off or deleted the certificate - they already know
}

// change = { user, from, to, holds } from vat.service changeStatus (null = nothing changed)
function afterStatusChange(change) {
  if (!change || !change.user || change.from === change.to) return;
  background(`seller ${change.user.id} ${change.from}->${change.to}`, sendStatus(change));
}

async function sendCategory(holds) {
  const groups = bySeller({ hidden: worthTelling(holds.hidden), shown: worthTelling(holds.shown) });
  if (!groups.size) return;
  const ids = [...groups.keys()];
  const [users, dirs] = await Promise.all([
    User.findAll({ where: { id: ids }, attributes: ['id', 'email', 'userType'] }),
    directory.findMany(ids),
  ]);
  await Promise.all(
    users.map((u) => {
      const group = groups.get(u.id);
      const dir = dirs.get(u.id);
      return background(
        `category change, seller ${u.id}`,
        emailService.sendVatListingsEmail({
          to: u.email,
          name: dir ? dir.display_name : '',
          userType: u.userType,
          hidden: group.hidden,
          shown: group.shown,
        })
      );
    })
  );
}

// holds = { hidden, shown } from vatHold.forCategory
function afterCategoryChange(holds) {
  if (!holds || (!holds.hidden.length && !holds.shown.length)) return;
  background('category change', sendCategory(holds));
}

module.exports = { afterStatusChange, afterCategoryChange };
