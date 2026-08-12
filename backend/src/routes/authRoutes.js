// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/authRoutes.js — จับคู่ URL /api/auth/line-login เข้ากับ handler + rate limit
// ทำอะไร: กำหนดว่า POST /api/auth/line-login เรียก lineLogin (authController) พร้อมจำกัดอัตราต่อ IP
//   (endpoint /auth อื่นๆ เช่น login/refresh/logout ยังนิยามตรงใน server.js — router นี้จับแค่ /line-login)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Route สำหรับ LINE Auto-Login (LIFF) — mount ที่ /api/auth ใน server.js
// /line-login อยู่ใน PUBLIC_PATHS (server.js) จึงข้าม authenticateToken/requireCsrf (เรียกก่อน login)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/config');
const { lineLogin } = require('../controllers/authController');

const router = express.Router();

// ⭐️ จำกัดอัตราการเรียก — endpoint นี้ออก token ให้จาก line_user_id/id_token กันเดา userId ยิงถล่ม
// (pattern เดียวกับ registerLineLimiter/loginLimiter) ต่อ IP
const lineLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.IS_PRODUCTION ? 30 : 200,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/line-login', lineLoginLimiter, lineLogin);

module.exports = router;
