// Main router. Every module's routes are plugged in here.
const express = require('express');

const router = express.Router();

// Health check: quick way to confirm the API is running.
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AFA API is running',
    timestamp: new Date().toISOString(),
  });
});

// ---- Public dropdown data ----
router.use('/locations', require('./location.routes'));
router.use('/categories', require('./category.routes')); // product / service categories
router.use('/listings', require('./listing.routes')); // public marketplace (approved listings only)
router.use('/sellers', require('./seller.routes')); // public seller pages ("About the Seller", "Visit Store")
router.use('/reviews', require('./reviewReport.routes')); // report a review (login)
router.use(require('./cms.routes')); // public CMS: GET /banners, GET /faqs, POST /faqs/:id/view
router.use('/contact', require('./contact.routes')); // public Contact Us form
router.use('/blogs', require('./blog.routes')); // public blog: published posts only
router.use('/payments', require('./payment.routes')); // payment gateway callbacks (public)

// ---- SHARED by all user types ----
router.use('/auth', require('./auth.routes')); // login, forgot/reset password, me
router.use('/register', require('./registration.routes')); // resume, progress, Step 4 (OTP + submit)
router.use('/me/listings', require('./myListing.routes')); // seller's own listings (before /me)
router.use('/me/cart', require('./cart.routes')); // buyer cart (before /me)
router.use('/me/orders', require('./order.routes')); // buyer checkout + orders (before /me)
router.use('/me/bookings', require('./booking.routes')); // buyer service bookings (before /me)
router.use('/me/reviews', require('./review.routes')); // buyer reviews (before /me)
router.use('/me/sales', require('./sales.routes')); // seller orders received + claims (before /me)
router.use('/me/claims', require('./claim.routes')); // buyer claims: problems after delivery (before /me)
router.use('/me/refunds', require('./refund.routes')); // buyer refunds + refund bank account (before /me)
router.use('/me/invoices', require('./invoice.routes')); // invoices, receipts, credit notes (before /me)
router.use('/me/transactions', require('./transaction.routes')); // transaction history (before /me)
router.use('/me/notifications', require('./notification.routes')); // the bell (before /me)
router.use('/me/devices', require('./device.routes')); // push notification tokens (before /me)
router.use('/me/dashboard', require('./dashboard.routes')); // my dashboard by user type (before /me)
router.use('/me/conversations', require('./chat/conversation.routes')); // chat (your module, before /me)
router.use('/me', require('./me.routes')); // logged-in user's own account (profile, payments, KYC documents)

// ---- ONE file per user type ----
router.use('/farmers', require('./farmer.routes')); // farmer registration Steps 1-3
router.use('/buyers', require('./buyer.routes')); // buyer registration Steps 1-2
router.use('/traders', require('./trader.routes')); // trader registration Steps 1-3
router.use('/logistics', require('./logistics.routes')); // logistics provider registration Steps 1-3
router.use('/fis', require('./fi.routes')); // financial institution registration Steps 1-3

// ---- Admin ----
router.use('/admin/auth', require('./adminAuth.routes'));
router.use('/admin/locations', require('./adminLocation.routes'));
router.use('/admin/users', require('./adminUser.routes'));
router.use('/admin/kyc-queue', require('./kycQueue.routes'));
router.use('/admin/categories', require('./adminCategory.routes'));
router.use('/admin/listings', require('./adminListing.routes'));
router.use('/admin/banners', require('./adminBanner.routes')); // CMS banners
router.use('/admin/faqs', require('./adminFaq.routes')); // CMS FAQs + FAQ categories
router.use('/admin/blogs', require('./adminBlog.routes')); // CMS Blog & Resources
router.use('/admin/contact-messages', require('./adminContact.routes')); // Contact Us inbox
router.use('/admin/vat-registrations', require('./adminVat.routes')); // sellers' VAT registration review
router.use('/admin/orders', require('./adminOrder.routes')); // Orders & Transactions (+ cancellation requests)
router.use('/admin/payments', require('./adminPayment.routes')); // bank transfer review queue
router.use('/admin/claims', require('./adminClaim.routes')); // claims: decide escalated problems
router.use('/admin/reviews', require('./adminReview.routes')); // reviews: approve held, hide, restore, reports
router.use('/admin/refunds', require('./adminRefund.routes')); // refunds to pay
router.use('/admin/invoices', require('./adminInvoice.routes')); // invoices, receipts, credit notes
router.use('/admin/transactions', require('./adminTransaction.routes')); // all money in / out
router.use('/admin/notifications', require('./adminNotification.routes')); // admin bell
router.use('/admin/broadcasts', require('./adminBroadcast.routes')); // advisories / announcements (in-app + push)
router.use('/admin/dashboard', require('./adminDashboard.routes')); // marketplace overview, seller performance, reports
router.use('/admin/settings', require('./adminSetting.routes')); // System Settings (VAT rate, payment time limit...)

module.exports = router;
