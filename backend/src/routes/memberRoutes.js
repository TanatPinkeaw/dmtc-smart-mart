// ⭐️ Route สำหรับสมัครสมาชิกผ่าน LINE LIFF — mount ที่ /api/members ใน server.js
// ทั้งสอง endpoint อยู่ใน PUBLIC_PATHS (เรียกก่อน login เสมอ, LIFF ยังไม่มี JWT ของระบบนี้)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/config');
const { checkLineStatus, registerViaLine, lookupMember } = require('../controllers/memberController');
const { registerLineValidator } = require('../../validators');

const router = express.Router();

// ⭐️ /lookup/:identifier ไม่ใช่ public — ไม่ได้อยู่ใน PUBLIC_PATHS (server.js) จึงผ่าน authenticateToken
// มาก่อนแล้วเสมอเมื่อถึง router นี้ (req.user มีค่าแน่นอน) เช็ค role ซ้ำอีกชั้นตรงนี้แบบเดียวกับ
// requireRole ใน server.js (เขียนซ้ำเพราะ requireRole เป็น local function เรียกข้ามไฟล์ไม่ได้)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

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

// ⭐️ validate เอง (แยกจาก validateRequest ใน server.js ซึ่งเป็น local function เรียกข้ามไฟล์ไม่ได้ —
// logic เดียวกันทุกอย่าง: stripUnknown, abortEarly:false, เซ็ต req.body เป็นค่าที่ sanitize แล้ว)
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }
    req.body = value;
    next();
  };
}

router.get('/check-line/:line_user_id', checkLineStatus);
router.post('/register-line', registerLineLimiter, validateBody(registerLineValidator), registerViaLine);
router.get('/lookup/:identifier', requireRole('CASHIER', 'MANAGER', 'ADMIN'), lookupMember);

module.exports = router;
