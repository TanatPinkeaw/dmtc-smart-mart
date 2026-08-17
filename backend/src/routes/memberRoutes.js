// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/memberRoutes.js — จับคู่ URL /api/members/* เข้ากับ handler + rate limit/validate/สิทธิ์
// ทำอะไร: check-line (public), register-line (public + จำกัดอัตรา + validate), lookup/:id (staff เท่านั้น)
//   → เรียก handler ใน memberController; requireRole/validateBody เขียนซ้ำในนี้เพราะของ server.js เรียกข้ามไฟล์ไม่ได้
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Route สำหรับสมัครสมาชิกผ่าน LINE LIFF — mount ที่ /api/members ใน server.js
// ทั้งสอง endpoint อยู่ใน PUBLIC_PATHS (เรียกก่อน login เสมอ, LIFF ยังไม่มี JWT ของระบบนี้)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/config');
const { checkLineStatus, registerViaLine, lookupMember } = require('../controllers/memberController');
const { registerLineValidator } = require('../validators');

const router = express.Router();

// ⭐️ /lookup/:identifier ไม่ใช่ public — ไม่ได้อยู่ใน PUBLIC_PATHS (server.js) จึงผ่าน authenticateToken
// มาก่อนแล้วเสมอเมื่อถึง router นี้ (req.user มีค่าแน่นอน) เช็ค role ซ้ำอีกชั้นตรงนี้
// ⭐️ requireRole/validateRequest ใช้ตัวกลางจาก middleware/guards (รวมไว้ที่เดียว — ไม่เขียนซ้ำเอง)
const { requireRole, validateRequest } = require('../middleware/guards');

// ⭐️ POST /register-line เป็น endpoint public ที่เขียนข้อมูลได้ (insert/update users) — ไม่มี rate limit
// จะโดนยิงสมัครปลอมถล่ม/เดา phone_number เพื่อ hijack line_user_id ผ่านบัญชีคนอื่นได้ จำกัดหลวมๆ
// ต่อ IP ตาม pattern เดียวกับ forgotPasswordLimiter (server.js)
const registerLineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.IS_PRODUCTION ? 10 : 100,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'ลงทะเบียนบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/check-line/:line_user_id', checkLineStatus);
router.post('/register-line', registerLineLimiter, validateRequest(registerLineValidator), registerViaLine);
router.get('/lookup/:identifier', requireRole('CASHIER', 'MANAGER', 'ADMIN'), lookupMember);

module.exports = router;
