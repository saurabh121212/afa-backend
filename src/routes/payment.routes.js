// PUBLIC payment gateway callbacks, mounted at /api/v1/payments. No login: the gateway
// proves who it is (signature / shared secret, checked by the gateway file).
//
//   POST /payments/webhooks/:provider     e.g. /payments/webhooks/test
//        test gateway: header X-Webhook-Secret: <PAYMENT_WEBHOOK_SECRET>
//                      body { reference, status: "succeeded" | "failed", amount }
//   GET  /payments/webhooks/epaynet/:token?transactionNumber=&success=1|0&theirTransactionNumber=
//        ePayNet callback. Register this URL at ePayNet onboarding:
//        https://<api>/api/v1/payments/webhooks/epaynet/<EPAYNET_CALLBACK_TOKEN>
const express = require('express');
const controller = require('../controllers/paymentWebhook.controller');

const router = express.Router();

router.post('/webhooks/:provider', controller.webhook);
router.post('/webhooks/:provider/:token', controller.webhook);
router.get('/webhooks/:provider', controller.webhook);
router.get('/webhooks/:provider/:token', controller.webhook);

module.exports = router;
