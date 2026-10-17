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

// ---- SHARED by all user types ----
router.use('/auth', require('./auth.routes')); // login, forgot/reset password, me
router.use('/register', require('./registration.routes')); // resume, progress, Step 4 (OTP + submit)
router.use('/me/listings', require('./myListing.routes')); // seller's own listings (before /me)
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

module.exports = router;
