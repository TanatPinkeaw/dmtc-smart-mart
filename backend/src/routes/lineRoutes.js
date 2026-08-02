// ⭐️ LINE webhook route — POST /api/line/webhook (public: ดู PUBLIC_PATHS ใน server.js ไม่ผ่าน JWT/CSRF)
// ตั้งค่า URL นี้ใน LINE Developers Console → Messaging API → Webhook URL:
//   https://<backend-domain>/api/line/webhook
const express = require('express');
const { handleWebhook } = require('../controllers/lineWebhookController');

const router = express.Router();
router.post('/webhook', handleWebhook);

module.exports = router;
