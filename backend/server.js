// ═══════════════════════════════════════════════════════════════════════════════════════════
// 📄 server.js — ไฟล์หลักของ backend (จุดเริ่มรัน + รวม endpoint ส่วนใหญ่ของทั้งระบบ)
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ทำอะไร: สร้าง Express app + Socket.io (realtime) แล้วตั้ง middleware กลาง + ประกาศ API endpoint
//   เกือบทั้งหมด (ขาย/สั่งจอง/สินค้า/กะ/สมาชิก/ตั้งค่า/สำรองข้อมูล ฯลฯ) จบในไฟล์เดียว ~5,400 บรรทัด
//   (บาง endpoint แยกออกไปเป็นโมดูลแล้ว: /api/reports, /api/members, /api/auth/line-login, /api/line,
//   /api/admin/reset — ดู src/routes/*)
//
// ลำดับการทำงานของทุก request (middleware chain — เรียงตามลำดับที่โค้ดประกาศ):
//   1) helmet + cors + express.json (แนบ rawBody ไว้ให้ LINE/PromptPay webhook ตรวจ signature)
//   2) attach req.io (ให้ทุก handler ยิง socket event ได้)
//   3) authenticateToken — อ่าน JWT จาก cookie (หรือ Bearer header) → เซ็ต req.user ; ข้าม PUBLIC_PATHS
//   4) requirePasswordChange — บังคับเปลี่ยนรหัสก่อนใช้งานถ้า must_change_password
//   5) requireCsrf — เช็ค X-CSRF-Token กับ claim ใน JWT (เฉพาะ POST/PUT/DELETE)
//   6) → เข้า route handler ; ปิดท้ายด้วย error handler กลาง (app.use ตัวสุดท้าย)
//
// จุดสำคัญที่ควรรู้ก่อนแก้:
//   • เงินคิดเป็น "สตางค์" (integer) เสมอ ผ่าน utils/money.js กัน float เพี้ยน
//   • วันที่/เวลา: คอลัมน์ TIMESTAMP + pool ตั้ง tz +07:00 → ใช้ NOW()/CURDATE()/คอลัมน์ตรงๆ
//     "ห้าม" ใส่ CONVERT_TZ ซ้ำ (เคยเป็นบั๊กเพี้ยนวัน/ชั่วโมงมาแล้ว)
//   • ขาย/สั่งจองใช้ transaction + SELECT ... FOR UPDATE ล็อกแถวสินค้า/สมาชิก กันแข่งกันตัดสต๊อก/แลกแต้มเกิน
//   • สิทธิ์คุมด้วย requireRole(...) ต่อ endpoint (MEMBER/CASHIER/MANAGER/ADMIN)
// ═══════════════════════════════════════════════════════════════════════════════════════════
const express = require('express');
const helmet = require('helmet'); // ⭐️ SECURITY FIX (#8) — security headers
const cors = require('cors');
const config = require('./src/config/config'); // ⭐️ Single source of truth for all env config — see config.js
const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');  // ← เพิ่มบรรทัดนี้
const sharp = require('sharp');  // ⭐️ Sprint 2 — B9: Image validation
const { slipUpload, shiftPhotoUpload, profilePhotoUpload } = require('./src/config/multer');  // ⭐️ Sprint 2 — B9: Multer config (organized by folder)
const { saveImage } = require('./src/config/cloudinary');  // ⭐️ เก็บรูปถาวรบน Cloudinary (memory → cloud)
const { requireRole, validateRequest } = require('./src/middleware/guards');  // ⭐️ guards รวมไว้ที่เดียว (server.js ไม่นิยามเอง)
const { serverError, badRequest, unauthorized, forbidden, notFound, conflict, gone } = require('./src/utils/http');  // ⭐️ response กลาง (500/400/401/403/404/409/410)
const { getOrderItems, getUserFullName, getUserRole, lockUserPoints } = require('./src/utils/queries');  // ⭐️ SQL ซ้ำรวมไว้ที่เดียว (เดิม copy 14 จุด)
const { logAudit } = require('./src/utils/auditLog');  // ⭐️ เขียน audit_logs กลาง (เดิม copy INSERT 24 จุด)

// ⭐️ Sprint 1 — B4: ผ่อนปรน rate limit ตอน dev/UAT (ค่าเดิม 5/15min แน่นเกินไปสำหรับ manual test
// รอบเดียวก็โดนล็อกยาว) NODE_ENV=production ยังคงเข้มเท่าเดิม, ค่าอื่นๆ (development/undefined) ผ่อนให้
// หมายเหตุ: ไม่ได้ปิด rate limit ไปเลยแม้ตอน dev เพราะยังอยากให้ทดสอบพฤติกรรม 429 ได้เหมือนเดิม แค่เพดานสูงขึ้น
const IS_PRODUCTION = config.IS_PRODUCTION;

// ⭐️ Update — ดึงออกไป src/utils/authTokens.js แล้ว (memberController.js ใหม่ต้องออก token/cookie
// แบบเดียวกันสำหรับสมัครผ่าน LINE ก็เลยแชร์ logic เดียวกันแทน copy-paste) ดูคำอธิบายเต็มที่ไฟล์นั้น
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, setAuthCookies, clearAuthCookies } = require('./src/utils/authTokens');
const { getStoreName } = require('./src/utils/storeConfig');
// ⭐️ จัดการ request ซ้ำ (idempotency-key) ที่ชน UNIQUE constraint ฝั่ง DB หลัง server restart — ดู utils/idempotency.js
const { isIdempotentDuplicate, respondIdempotentDuplicate } = require('./src/utils/idempotency');
const { evaluateRewardItem, checkItemStock, settleRewardPoints } = require('./src/utils/rewardRedemption'); // ⭐️ Part 5 — ลอจิกแลกของรางวัล (pure — เทสได้)
const { resolveOrderPoints, resolveRedeemPoints, computeEarnPoints, isMemberRole, resolveSaleMemberPoints } = require('./src/utils/preorderPolicy'); // ⭐️ นโยบายแต้ม (เฉพาะ MEMBER ได้สิทธิ์แต้ม — pure — เทสได้)

// ⭐️ อ่าน cookie จาก request header เอง (ไม่พึ่ง cookie-parser เพราะไม่ได้ติดตั้งไว้ใน dependencies)
function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) { try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; } }
  });
  return cookies;
}

// ⭐️ Security fix — เดิม csrf_token เป็น cookie แบบอ่านได้ (httpOnly:false) โดยหวังให้ frontend JS
// อ่าน document.cookie มาแนบเป็น header เอง (double-submit pattern) แต่ frontend (Vercel) กับ backend
// (Render) อยู่คนละ domain กัน — JS หน้าเว็บ "อ่าน cookie ของ domain อื่นไม่ได้เลย" ต่อให้ cookie นั้น
// ไม่ใช่ httpOnly ก็ตาม (นี่คือกฎ same-origin ของ browser, cookie ยังส่งไป backend ได้ปกติเพราะ
// browser แนบ cookie ตาม "domain ปลายทาง" ไม่ใช่ "domain หน้าเว็บ" แต่ JS อ่านค่ามันไม่ได้)
// ผลคือ requireCsrf ปฏิเสธทุก mutating request บน production จริงเสมอ (403 CSRF)
// แก้โดยเปลี่ยนช่องทางส่ง csrf token: ฝัง "csrf" claim ไว้ใน JWT ที่เซ็นแล้ว (ปลอมไม่ได้) แล้วส่งค่า
// เดียวกันกลับไปทาง JSON response body แทน (ไม่ใช่ cookie) — body อ่านข้าม origin ได้ปกติผ่าน fetch/axios
// frontend เก็บไว้ในตัวแปร JS (ไม่ persist) แล้วแนบเป็น header ทุก mutating request
// ⭐️ Task 7 — Login: กัน brute-force รหัสผ่าน
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 5 : 50, // ⭐️ B4 — prod เข้ม 5 ครั้ง/15นาที, dev ผ่อนเป็น 50
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⭐️ Task 7 — Checkout: กันยิงถี่ผิดปกติ (DoS/บั๊กหน้าเว็บกดซ้ำ) ต่อ user ที่ login แล้ว (fallback เป็น IP ถ้าไม่มี user)
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: IS_PRODUCTION ? 30 : 100, // ⭐️ B4 — prod เข้ม 30 ครั้ง/นาที, dev ผ่อนเป็น 100
  keyGenerator: (req) => req.user?.id?.toString() || ipKeyGenerator(req),  // ← เปลี่ยนเป็นนี้
  message: { error: 'ทำรายการขายถี่เกินไป กรุณารอสักครู่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🐛 FIX — เดิม sync-offline ใช้ checkoutLimiter ตัวเดียวกับ /checkout: คิวออฟไลน์ replay
// บิลค้าง >30 ใบ (prod) รัวๆ หลังเน็ตกลับ จะโดน 429 ทั้งชุด → queueProcessor retry 3 ครั้งแล้ว
// ตัดทิ้งถาวร = บิลออฟไลน์หลุดจริง. แยก limiter ตัวใหม่ + skipFailedRequests: ถ้าโดนจำกัดแล้ว
// request ที่ fail ไปแล้วไม่นับซ้ำ (กัน replay ติดลิมิตเพราะโดน 429 เอง) — ยังกัน DoS อยู่
const syncOfflineLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: IS_PRODUCTION ? 300 : 600, // prod 300 บิล/นาที = คิวออฟไลน์ทั้งวัน replay ได้ในรอบเดียว, dev ผ่อนเป็น 600
  keyGenerator: (req) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'ส่งบิลออฟไลน์ถี่เกินไป กรุณารอสักครู่' },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
});

// ⭐️ SECURITY FIX (วิกฤต #2) — forgot-password ยืนยันตัวตนด้วย student_id + เบอร์โทร (ทั้งคู่เดาง่าย)
// เดิมไม่มี rate limit = ยิงเดาเบอร์รัวๆ เพื่อยึดบัญชีได้ จำกัด 3 ครั้ง/ชม./IP
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: IS_PRODUCTION ? 3 : 30,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⭐️ Security remediation — POST /api/users/register เป็น public ที่เขียน DB ได้ ไม่มี rate limit
// ใครก็ยิงสร้างบัญชีปลอมถล่มได้ (แล้ว default password = เบอร์โทร ทำให้แย่ง student_id/เบอร์ของคนอื่น
// ก่อนเจ้าของตัวจริงสมัครได้). จำกัดต่อ IP แบบหลวมๆ — endpoint นี้ POS ใช้สมัครสมาชิกหน้าร้าน (ดู
// pages/POS.tsx) จึงต้องเผื่อพอให้ร้านเดียวสมัครได้หลายคน แต่ยังกันยิงถล่ม
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 60 : 200,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'ลงทะเบียนบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⭐️ Security remediation — /api/auth/refresh ไม่เคยมี rate limit เลย token หลุดโดนใครยิงซ้ำได้ไม่จำกัด
// จำกัดหลวมๆ (คนละสิทธิ์ต่างจาก login limiter) เพราะ client ปกติเรียกเป็นระยะตาม access token หมดอายุ
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 30 : 200,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'ขอ refresh token บ่อยเกินไป กรุณารอสักครู่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⭐️ Security remediation — reset-token/reset-password เป็น public route ไม่มี rate limit เลย
// token เดายากอยู่แล้ว (สุ่ม 256 บิต) แต่ป้องกัน DB-query spam/DoS ไว้ก่อน
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 20 : 200,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { error: 'ทำรายการถี่เกินไป กรุณารอสักครู่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⭐️ Security remediation — endpoint อัปโหลดรูป (เข้างาน/ปิดกะ/สลิป) ไม่มี rate limit เลย
// บัญชีที่ login ถูกต้อง (หรือถูกขโมย token) อาจสแปมอัปโหลดรูปใหญ่ถี่ๆ จน Cloudinary quota/ดิสก์ Render หมด
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 20 : 200,
  keyGenerator: (req) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'อัปโหลดไฟล์ถี่เกินไป กรุณารอสักครู่' },
  standardHeaders: true,
  legacyHeaders: false,
});

const {
  checkoutValidator, productValidator, productUpdateValidator, orderValidator,
  shiftCloseValidator, userRegisterValidator, syncOfflineValidator,
  updateRoleValidator, storeSettingsValidator, promotionValidator,
} = require('./src/validators');
const { toSatang, fromSatang } = require('./src/utils/money'); // ⭐️ Sprint 1 — B3
const { sendDailyReport } = require('./src/scripts/dailyReport'); // ⭐️ Sprint 1 — D4
const { createBackup, restoreBackupRow } = require('./src/services/backup'); // ⭐️ Sprint 2 — C3: Backup & Restore
const { sendMail } = require('./src/services/mailer'); // ⭐️ Phase 4 — backup success/failure notifications
const { sendLowStockAlert, sendPreOrderReadyNotification, pushLineMessage } = require('./src/services/lineService'); // ⭐️ Day 3 — LINE Messaging API
// ⭐️ Phase A (refactor) — reportsExport ทุก usage ย้ายไปที่ reportController.js แล้ว (executive-export/
// accounting-summary) เอา require ที่ตายแล้วออก

// ⭐️ Sprint 0 — A4: evaluated once at module load = ตอนที่ process นี้ boot ขึ้นมาจริงๆ
// ใช้เป็นลายนิ้วมือของ "process ที่กำลังรันอยู่ตอนนี้" — ถ้า frontend เห็นค่านี้เปลี่ยนระหว่าง session
// (poll ทุก 1 นาที) แปลว่า backend ถูก restart ไปแล้วตั้งแต่โหลดหน้าเว็บครั้งล่าสุด ควร reload
const BUILD_INFO = {
  timestamp: new Date().toISOString(),
  git_hash: config.GIT_HASH,
};

// ⭐️ Sprint 2 — B8: Timezone Helpers (Bangkok UTC+7)
const TZ_BANGKOK = 'Asia/Bangkok';
const TZ_UTC = 'UTC';

// Helper: Get today's date in Bangkok timezone
function getTodayBangkok() {
  const now = new Date();
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  return new Date(bangkokTime.getFullYear(), bangkokTime.getMonth(), bangkokTime.getDate());
}

// Helper: Get yesterday's date in Bangkok timezone
function getYesterdayBangkok() {
  const today = getTodayBangkok();
  today.setDate(today.getDate() - 1);
  return today;
}

// Helper: Convert Date to YYYY-MM-DD string
function dateToString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Format timestamp for display (Bangkok time)
function formatBangkokTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('th-TH', {
    timeZone: TZ_BANGKOK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ⭐️ Sprint 2 — C4: Password Policy Validation
function validatePasswordStrength(password) {
  const errors = [];

  if (!password) {
    return { valid: false, errors: ['Password is required'], strength: 'weak', score: 0 };
  }

  let score = 0;

  // Length
  if (password.length >= 8) score++;
  else errors.push('At least 8 characters');

  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  // Uppercase
  if (/[A-Z]/.test(password)) score++;
  else errors.push('At least 1 uppercase letter (A-Z)');

  // Lowercase
  if (/[a-z]/.test(password)) score++;
  else errors.push('At least 1 lowercase letter (a-z)');

  // Numbers
  if (/[0-9]/.test(password)) score++;
  else errors.push('At least 1 number (0-9)');

  // Special chars (bonus)
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

  // Determine strength
  let strength = 'weak';
  if (score <= 2) strength = 'weak';
  else if (score <= 4) strength = 'fair';
  else if (score <= 6) strength = 'good';
  else strength = 'strong';

  return {
    valid: errors.length === 0,
    errors,
    strength,
    score
  };
}

function calculateStrength(password) {
  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

  // Score: 0-2=weak, 3-4=fair, 5-6=good, 7+=strong
  if (score <= 2) return 'weak';
  if (score <= 4) return 'fair';
  if (score <= 6) return 'good';
  return 'strong';
}

// ⭐️ Refactor — เดิม legacyUpload (image-only filter) ถูกใช้กับ /api/members/import ด้วย ทั้งที่
// endpoint นั้นรับไฟล์ CSV ไม่ใช่รูปภาพ — filter เก่าจึงเตะไฟล์ CSV ทุกไฟล์ทิ้งด้วย error "อนุญาตเฉพาะ
// ไฟล์รูปภาพ" (import CSV ใช้งานไม่ได้เลยตั้งแต่ต้น) แยก multer เฉพาะสำหรับ CSV ออกมาให้ถูกต้อง
const csvUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ALLOWED_CSV_MIMES = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
    if (!ALLOWED_CSV_MIMES.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(new Error('อนุญาตเฉพาะไฟล์ CSV เท่านั้น'));
    }
    cb(null, true);
  },
});

// ⭐️ requireRole/validateRequest รวมไว้ที่ src/middleware/guards.js แล้ว (ยกมาจาก server.js เป๊ะ)
//    — อย่านิยามซ้ำในนี้ (เทส serverGuardRails section F ล็อก)

// ⭐️ Sprint 2 — B7: withTransaction Helper
// Purpose: Get connection, BEGIN TRANSACTION, execute callback(conn), COMMIT on success, ROLLBACK on error
// Usage: await withTransaction(pool, async (conn) => { /* your DB operations */ })
async function withTransaction(pool, callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await callback(conn);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ⭐️ Sprint 2 — B9: Image Dimension Validation
async function validateImageDimensions(filePath, minWidth, minHeight, maxWidth, maxHeight) {
  try {
    const metadata = await sharp(filePath).metadata();
    const { width, height } = metadata;

    if (width < minWidth || height < minHeight) {
      throw new Error(`Image too small: ${width}×${height} (min ${minWidth}×${minHeight})`);
    }

    if (width > maxWidth || height > maxHeight) {
      throw new Error(`Image too large: ${width}×${height} (max ${maxWidth}×${maxHeight})`);
    }

    return { width, height };
  } catch (err) {
    throw new Error(`Image validation failed: ${err.message}`);
  }
}

// 1. นำเข้า http และ socket.io
const http = require('http');
const { Server } = require('socket.io');

// ⭐️ Task 6 — env โหลด + ตรวจ required vars แล้วที่ config.js ที่เดียว (เดิมเช็คซ้ำเกือบทุกตัวอักษร
// กับ db.js ในไฟล์นี้เอง) ดู config.js สำหรับรายละเอียด
const JWT_SECRET = config.JWT_SECRET;

// ⭐️ Sprint 2 — B6: Idempotency Middleware
const idempotencyCache = new Map(); // In-memory cache for idempotent responses
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function idempotencyMiddleware(req, res, next) {
  // Only apply to POST, PUT, DELETE requests
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();

  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return next();

  // Check if we have a cached response for this key
  const cachedEntry = idempotencyCache.get(idempotencyKey);
  if (cachedEntry) {
    const isExpired = Date.now() - cachedEntry.timestamp > IDEMPOTENCY_TTL;
    if (!isExpired && (cachedEntry.status < 400 || cachedEntry.status === 400)) {
      // Return cached response (2xx or 4xx only, not 5xx)
      return res.status(cachedEntry.status).json(cachedEntry.response);
    } else if (isExpired) {
      // Remove expired entry
      idempotencyCache.delete(idempotencyKey);
    }
  }

  // Intercept res.json to cache the response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    if (res.statusCode < 500 && idempotencyKey) {
      idempotencyCache.set(idempotencyKey, {
        response: data,
        status: res.statusCode,
        timestamp: Date.now()
      });
    }
    return originalJson(data);
  };

  next();
}

const app = express();

// ⭐️ DEPLOY FIX (#7) — prod รันหลัง nginx/reverse proxy (Render ก็เช่นกัน) ต้องเชื่อ X-Forwarded-For 1 ชั้น
// ไม่งั้น rate limiter เห็น IP เดียว (ของ proxy) = login limiter ล็อกคนทั้งระบบพร้อมกัน
if (IS_PRODUCTION) app.set('trust proxy', 1);

// ⭐️ Security remediation — เช็ค/เตือนเรื่องนี้ย้ายไป config.js แล้ว (รันตอน require ครั้งแรก
// ก่อนถึงบรรทัดนี้ด้วยซ้ำ) เก็บ comment นี้ไว้อธิบายว่าทำไม trust proxy ด้านบนถึงสำคัญ:
// Render ตั้ง process.env.RENDER ให้อัตโนมัติ ถ้าเจอว่ารันบน Render แต่ NODE_ENV ดันไม่ใช่
// 'production' (ลืมตั้งใน dashboard) trust proxy ข้างบนจะไม่ทำงาน rate limiter ทุกตัวจะเห็น IP ของ
// Render load balancer ตัวเดียว แทน IP ผู้ใช้จริง

// ⭐️ SECURITY FIX (#8) — security headers (ป้องกัน clickjacking/MIME sniffing ฯลฯ)
// เป็น API ล้วน (ไม่เสิร์ฟ HTML) ปิด CSP; รูปโหลดข้ามโดเมนผ่าน XHR ตั้ง CORP เป็น cross-origin
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// 2. สร้าง HTTP Server ครอบ Express
const server = http.createServer(app);

// 3. ตั้งค่า Socket.io
// ⭐️ Task 9 — ล็อก origin เป็น FRONTEND_URL เดียว (เดิม "*" อนุญาตทุกโดเมน)
// ⭐️ Security remediation — เหตุผลเดียวกับ CORS ของ Express ด้านล่าง: ห้ามเปลี่ยนเป็น wildcard/regex
// (เช็ค/เตือนถ้าค่าผิดปกติตอน production ย้ายไป config.js แล้ว รันตั้งแต่ตอน require ครั้งแรก)
const FRONTEND_URL = config.FRONTEND_URL;

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

// ⭐️ Task 1A — ปฏิเสธ socket ที่ไม่มี/ไม่ผ่าน JWT ก่อนให้เชื่อมต่อ (เดิม: รับทุก connection โดยไม่เช็คเลย)
// ⭐️ Security remediation — token อยู่ใน httpOnly cookie แล้ว ไม่ใช่ handshake.auth (client แนบ
// cookie มาเองอัตโนมัติถ้าเปิด withCredentials); เก็บ auth.token/header ไว้เป็น fallback เฉยๆ
io.use(async (socket, next) => {
  try {
    const cookies = parseCookies({ headers: socket.handshake.headers });
    // ⭐️ SECURITY FIX (#5) — เดิม log JSON.stringify(handshake.auth) = พ่น JWT ลง log ตรงๆ เอาออก
    // ลำดับการหา token:
    //   1. cookie access_token — ใช้ได้ตอน same-site (dev, หรือเบราว์เซอร์ที่ไม่บล็อก third-party cookie)
    //   2. handshake.auth.token — token จาก /api/auth/socket-token ที่ frontend แนบมาเอง
    //      (ทางหลักบน production ข้ามโดเมน ที่ ITP บล็อก cookie)
    //   3. Authorization header — เผื่อ client ที่ไม่ใช่เบราว์เซอร์
    const token = cookies.access_token || socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Missing JWT token'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // ⭐️ รับได้เฉพาะ access token ปกติ (ไม่มี type) หรือ socket token เท่านั้น
    // refresh token ห้ามเอามาเปิด socket
    if (decoded.type && decoded.type !== 'socket') {
      console.log(`[SOCKET AUTH] rejected token type='${decoded.type}'`);
      return next(new Error('Invalid or expired token'));
    }

    // ⭐️ เดิม socket ไม่เช็ค revocation เลย — logout/เปลี่ยนรหัสผ่านแล้ว socket เดิมยังฟัง event ต่อ
    // ได้เรื่อยๆ ตอนนี้ socket token อ่านได้จาก JS ด้วย การเช็คตรงนี้เลยสำคัญขึ้นกว่าเดิม
    if (await isTokenRevoked(decoded)) {
      console.log(`[SOCKET AUTH] revoked token, user_id=${decoded.id}`);
      return next(new Error('Invalid or expired token'));
    }

    socket.user = decoded; // { id, role, full_name }
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
});

// 4. แทรค io เข้าไปใน req (ไม้ตายลับ!)
// ทำให้เราสั่ง Socket ส่งข้อมูลจากใน API ได้เลย เช่น ตอนกดจ่ายเงินสำเร็จ
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ⭐️ Task 9 — ล็อก origin เป็น FRONTEND_URL เดียว (เดิม cors() ไม่ใส่ options = สะท้อนกลับทุก origin)
// ⭐️ Security remediation — คำเตือนสำหรับคนแก้ทีหลัง: ถ้าจะรองรับ Vercel preview URL (เปลี่ยนทุก
// branch/PR) ห้ามเปลี่ยน origin ตรงนี้เป็น wildcard/regex แบบกว้างๆ (เช่น /\.vercel\.app$/) เด็ดขาด
// เพราะเปิดคู่กับ credentials:true = ใครก็ deploy .vercel.app ของตัวเองมายิง request แบบมี cookie/
// credential ได้ ถ้าต้องรองรับ preview จริงๆ ให้ใช้ allow-list function เทียบกับรายการ URL ที่รู้จักตายตัว
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  // ⭐️ Security remediation — เพิ่ม X-CSRF-Token (double-submit cookie) และ X-Setup-Key (bootstrap
  // endpoint) ให้ preflight ผ่าน ไม่งั้น browser บล็อกก่อนถึง server เลย
  allowedHeaders: ['Content-Type', 'Authorization', 'idempotency-key', 'X-CSRF-Token', 'X-Setup-Key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// ⭐️ verify hook เก็บ raw body ไว้ที่ req.rawBody — จำเป็นสำหรับตรวจ LINE webhook signature
// (HMAC ต้องคำนวณจาก bytes ดิบก่อน parse เป็น JSON) ไม่กระทบ route อื่นที่ใช้ req.body ปกติ
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// ⭐️ Security remediation — เติม req.cookies ให้เหมือน cookie-parser (parseCookies ประกาศไว้ข้างบน)
app.use((req, res, next) => {
  req.cookies = parseCookies(req);
  next();
});

// ⭐️ Task 12 — logging middleware: ทุก request บันทึก method/path/status/duration
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    if (res.statusCode >= 400) console.error(log);
    else console.log(log);
  });
  next();
});

// ⭐️ Sprint 2 — B6: Idempotency middleware
app.use(idempotencyMiddleware);

// ⭐️ SECURITY FIX (วิกฤต #1) — เดิมเสิร์ฟ /uploads แบบ static "ก่อน" ชั้นตรวจ JWT = ใครก็เปิดดู
// สลิปโอนเงิน/รูปเข้างานได้ถ้าเดาชื่อไฟล์ (ชื่อไฟล์เดาง่ายมาก) ลบทิ้ง แล้วเปลี่ยนไปเสิร์ฟผ่าน
// GET /api/media (มี authenticateToken คุมอยู่แล้วเพราะไม่ได้อยู่ใน PUBLIC_PATHS) ดูโค้ดด้านล่าง
const path = require('path');

// =========================================
// AUTH MIDDLEWARE — ตรวจ JWT ทุก request ยกเว้น path ที่ระบุไว้
// =========================================
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/users/register',   // สมัครสมาชิกหน้าเคาน์เตอร์ (ยังไม่มี token)
  '/api/docs',
  '/api/seed-data',        // bootstrap เท่านั้น — guard ด้วย SETUP_KEY แทน JWT (ดูด้านล่าง)
  '/api/create-admin',
  '/api/health',            // ⭐️ Task 12 — uptime monitor ต้องเรียกได้โดยไม่ต้องมี JWT
  '/api/version',           // ⭐️ Sprint 0 — A4 — frontend poll เช็ค stale backend, ต้องเรียกได้แม้ token จะหมดอายุ/ยังไม่ login
  '/api/auth/forgot-password', // ⭐️ Task 13 — ยังไม่ login จึงยังไม่มี token
  '/api/auth/reset-password',
  '/api/auth/reset-token',
  '/api/members/check-line', // ⭐️ LINE LIFF — เช็คสถานะสมัครก่อนเปิดฟอร์ม ยังไม่มี token (memberRoutes.js)
  '/api/members/register-line', // ⭐️ LINE LIFF — สมัคร/ผูกบัญชี ยังไม่มี token ตอนเรียก (memberRoutes.js)
  '/api/auth/line-login',   // ⭐️ LINE LIFF auto-login — เรียกก่อน login ยังไม่มี JWT (authRoutes.js)
  '/api/line/webhook',      // ⭐️ LINE webhook — LINE server ยิงเข้ามา ไม่มี JWT; กันปลอมด้วย X-Line-Signature แทน (lineRoutes.js)
  // ⭐️ SECURITY FIX (วิกฤต #1) — เอา '/uploads' ออกจาก public แล้ว สลิป/รูปเข้างานต้องผ่าน
  //    GET /api/media ที่มี JWT คุม (ไฟล์รูปสินค้าที่เคยพึ่ง static ให้ไปเสิร์ฟผ่าน /api/media เช่นกัน)
];

// ⭐️ BUGFIX — public เฉพาะ "GET" สำหรับ path ที่ตั้งใจให้ browse ไม่ต้อง login
// เดิม '/api/products' + '/api/categories' อยู่ใน PUBLIC_PATHS แล้วเช็คด้วย startsWith โดยไม่ดู method
// ทำให้ POST/PUT/DELETE ก็ match public → ข้าม auth → req.user ว่าง → requireRole ตอบ 403 เสมอ
// (admin เพิ่ม/แก้/ลบ สินค้า+หมวดหมู่ ไม่ได้เลย) — แก้รอบแรกเป็น "GET + startsWith" แต่ยังพลาดอีกชั้น:
// GET /api/products/export, /api/categories/export, /api/products/rewards ก็ match prefix ด้วย
// → ข้าม auth เหมือนกัน → requireRole ของ endpoint เหล่านั้นตอบ 403 เสมอ (ปุ่ม Export ในหน้า
// Settings + หน้าแลกของรางวัล POS พังถาวรทุกคน) แก้เป็น exact-path match: public เฉพาะ path ที่ตั้งใจ
// browse เท่านั้น ส่วน export/rewards ต้องผ่าน auth + requireRole ตามปกติ
const PUBLIC_GET_PATHS = new Set([
  '/api/products',
  '/api/products/highlights', // หน้าสินค้าเด่น (Home/PreOrder) — ข้อมูลสินค้าล้วน ไม่ลับ เปิด browse ได้
  '/api/categories',
]);

// ป้องกัน endpoint bootstrap ทั้ง 3 ตัว ด้วย key ลับใน .env
// เรียกใช้แบบ: GET /api/init-db (header X-Setup-Key: xxxxx)
// ⭐️ Security remediation — เดิมส่ง key ผ่าน query string (?key=) หลุดไป access log/browser history ได้
// ย้ายไปส่งผ่าน header แทน + เทียบแบบ constant-time กัน timing side-channel
function requireSetupKey(req, res, next) {
  const key = req.headers['x-setup-key'];
  if (!config.SETUP_KEY) {
    return res.status(503).json({ error: 'ปิดใช้งาน bootstrap endpoint นี้แล้ว (ไม่พบ SETUP_KEY ใน .env)' });
  }
  const provided = Buffer.from(String(key || ''));
  const expected = Buffer.from(config.SETUP_KEY);
  const isMatch = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!isMatch) {
    return forbidden(res, 'setup key ไม่ถูกต้อง');
  }
  next();
}

// ⭐️ Security remediation — token revocation check (logout / password-change invalidation)
async function isTokenRevoked(payload) {
  if (payload.jti) {
    const [rows] = await pool.query('SELECT 1 FROM revoked_tokens WHERE jti = ?', [payload.jti]);
    if (rows.length > 0) return true;
  }
  const [users] = await pool.query('SELECT token_valid_after FROM users WHERE id = ?', [payload.id]);
  const validAfter = users[0]?.token_valid_after;
  if (validAfter && payload.iat && new Date(payload.iat * 1000) < new Date(validAfter)) return true;
  return false;
}

function authenticateToken(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();
  // browse สินค้า/หมวดหมู่ = public เฉพาะ GET ที่ระบุใน PUBLIC_GET_PATHS (exact path — ดู comment ข้างบน;
  // path ย่อย เช่น /export /rewards ต้องผ่าน auth + requireRole ตามปกติ); POST/PUT/DELETE ไม่ match
  if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) return next();

  // ⭐️ Security remediation — access token อยู่ใน httpOnly cookie เป็นหลัก เก็บ header ไว้เป็น
  // fallback เฉยๆ (เผื่อ non-browser client/debug ไม่กระทบความปลอดภัย เพราะ verify+revoke check เดียวกัน)
  const authHeader = req.headers['authorization'];
  const token = req.cookies?.access_token || (authHeader && authHeader.split(' ')[1]);

  // ⭐️ F4 — Debug token verification
  if (!token) {
    console.warn(`[AUTH] No token found for ${req.method} ${req.path}`);
    return unauthorized(res, 'ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบ');
  }

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) {
      // ⭐️ Task 8 — แยก 401 (หมดอายุ ต้อง login ใหม่) ออกจาก 403 (token ผิด/ปลอม)
      if (err.name === 'TokenExpiredError') {
        console.warn(`[AUTH] Token expired for ${req.method} ${req.path}`);
        return unauthorized(res, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      }
      console.error(`[AUTH] Token verification failed for ${req.method} ${req.path}: ${err.message}`);
      return forbidden(res, 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
    }
    // ⭐️ Security — access token ปกติ (generateAccessToken) ไม่มี claim `type` เลย
    // token ที่มี type คือ token เฉพาะทาง ห้ามเอามาใช้แทน access token กับ REST:
    //   type='refresh' — ใช้ได้แค่ที่ /api/auth/refresh
    //   type='socket'  — ใช้ได้แค่ตอน handshake ของ Socket.io (JS อ่านได้ ดู /api/auth/socket-token)
    // ถ้าไม่กันตรงนี้ socket token ที่หลุดจาก XSS จะยิง REST API แทน user ได้ทันที
    if (payload.type) {
      console.warn(`[AUTH] Rejected '${payload.type}' token used as access token for ${req.method} ${req.path}`);
      return forbidden(res, 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
    }
    try {
      if (await isTokenRevoked(payload)) {
        console.warn(`[AUTH] Revoked token used for ${req.method} ${req.path}, user_id=${payload.id}`);
        return unauthorized(res, 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่');
      }
    } catch (revokeErr) {
      console.error('[AUTH] Revocation check failed:', revokeErr.message);
      return res.status(500).json({ error: 'ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองใหม่ภายหลัง' });
    }
    req.user = payload; // { id, role, full_name, jti }
    console.debug(`[AUTH] Token verified for user_id=${payload.id}, role=${payload.role}`);
    next();
  });
}


// ⭐️ Security fix — เช็ค CSRF จาก claim ที่ฝังในตัว JWT ที่ authenticateToken ถอดรหัสไว้แล้วใน
// req.user.csrf (เซ็นด้วย JWT_SECRET ปลอมไม่ได้) เทียบกับ header X-CSRF-Token ที่ frontend แนบมา
// (ได้ค่านี้จาก response body ตอน login/refresh — ไม่ใช่จาก cookie แล้ว เพราะ frontend/backend
// คนละ domain กัน อ่าน cookie ข้าม origin ไม่ได้ ดู setAuthCookies ด้านบนสำหรับรายละเอียด)
// PUBLIC_PATHS ยกเว้นได้ทั้งหมดรวม /api/auth/refresh — endpoint นั้น gate ด้วย refresh_token cookie
// อยู่แล้ว (bearer ของ cookie เท่านั้นที่เรียกได้) และ CSRF ยิงมาที่มันได้แค่ rotate token ของ
// เจ้าของ session เอง ไม่มีทางอ่าน response หรือเข้าถึงข้อมูลอะไรเพิ่ม จึงไม่คุ้มความซับซ้อนที่ต้องเพิ่ม
const CSRF_EXEMPT_PATHS = PUBLIC_PATHS;
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();
  if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) return next();

  const headerToken = req.headers['x-csrf-token'];
  if (!req.user?.csrf || !headerToken || req.user.csrf !== headerToken) {
    return forbidden(res, 'CSRF token ไม่ถูกต้องหรือหายไป กรุณารีเฟรชหน้าเว็บแล้วลองใหม่');
  }
  next();
}

app.use(authenticateToken);
app.use(requirePasswordChange);
app.use(requireCsrf);

// ⭐️ ระบบสมัครสมาชิกผ่าน LINE LIFF — router แยกใน src/routes/memberRoutes.js (src/controllers/memberController.js)
// ทั้ง /check-line และ /register-line อยู่ใน PUBLIC_PATHS ด้านบนแล้ว จึงข้าม authenticateToken/requireCsrf ได้
// mount ไว้ตรงนี้ (คนละที่กับ /api/members/import ที่ยังนิยามตรงใน server.js อยู่ — path ไม่ชนกัน)
app.use('/api/members', require('./src/routes/memberRoutes'));
// ⭐️ เครื่องมือล้างข้อมูลทดสอบ ADMIN — บล็อกบน production ในตัว controller เอง (src/controllers/adminController.js)
app.use('/api/admin/reset', require('./src/routes/adminRoutes'));
app.use('/api/tenants', require('./src/routes/tenantRoutes'));
app.use('/api/admin/dashboard', require('./src/routes/adminDashboard'));  // ⭐️ SUPER ADMIN: Dashboard  // ⭐️ MULTI-TENANT: CRUD tenants
// ⭐️ LINE webhook — ตอบ Rich Menu / ข้อความ + ลงเวลาทำงานผ่าน LINE (src/controllers/lineWebhookController.js)
// /api/line/webhook อยู่ใน PUBLIC_PATHS แล้ว จึงข้าม JWT/CSRF (กันปลอมด้วย X-Line-Signature แทน)
app.use('/api/line', require('./src/routes/lineRoutes'));
// ⭐️ LINE auto-login (LIFF) — POST /api/auth/line-login (src/controllers/authController.js)
// /api/auth/line-login อยู่ใน PUBLIC_PATHS แล้ว; endpoint /api/auth/* อื่นๆ ยังนิยามตรงใน server.js
// (router นี้ match เฉพาะ /line-login จึงไม่ชนกับ /login, /refresh, /logout ฯลฯ ที่ประกาศไว้ด้านล่าง)
app.use('/api/auth', require('./src/routes/authRoutes'));
// ⭐️ Phase A (refactor) — report endpoints ย้ายออกจาก server.js ทีละ batch มาที่ reportRoutes.js
// mount ที่ /api/reports (path เดิมไม่เปลี่ยน) — endpoint ที่ยังไม่ย้ายยังนิยามตรงใน server.js ด้านล่าง
// router match เฉพาะ path ที่ย้ายมาแล้วเท่านั้น จึงไม่ชนกับ /api/reports/* ที่ยังอยู่ใน server.js
app.use('/api/reports', require('./src/routes/reportRoutes'));
// ⭐️ Phase B (refactor) — /api/settings/* (store/receipt/loyalty) ย้ายมาที่ settingsRoutes.js แล้ว
// (path เดิมไม่เปลี่ยน) ; member-groups/promotions ฯลฯ ที่ยังไม่ย้ายยังอยู่ใน server.js ด้านล่าง
app.use('/api/settings', require('./src/routes/settingsRoutes'));
app.use('/api/promotions', require('./src/routes/promotionsRoutes'));
app.use('/api/member-groups', require('./src/routes/memberGroupsRoutes'));

// ⭐️ Security remediation — block everything except password-change/logout until user sets a real password
// ⭐️ Security fix — เพิ่ม /api/auth/csrf-token เข้า exempt list ด้วย: user ที่ต้องเปลี่ยนรหัสผ่านอยู่
// ถ้า refresh หน้าเว็บกลางทาง (in-memory csrf token หาย) ต้องเรียก endpoint นี้ได้เพื่อเอา csrf token
// มาแนบตอนยิง PUT change-password (ซึ่งก็ต้องมี CSRF header เหมือนกัน) ไม่งั้นจะติดลูปออกไม่ได้เลย
function requirePasswordChange(req, res, next) {
  if (!req.user?.must_change_password) return next();
  const exempt = req.path.endsWith('/change-password') || req.path === '/api/auth/logout' || req.path === '/api/auth/csrf-token';
  if (exempt) return next();
  return forbidden(res, 'ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน', { code: 'MUST_CHANGE_PASSWORD' });
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
      uptime: process.uptime(),
    });
  } catch (err) {
    console.error('[health] DB check failed:', err.message);
    res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      error: 'database connection failed',
    });
  }
});

// ⭐️ SECURITY FIX (วิกฤต #3) — ลบ /api/auth/debug-token ทิ้ง เดิมเปิดสาธารณะ + คืน JWT ใช้งานได้จริง
//    และบอกความยาว JWT_SECRET = ช่วยคนโจมตี ไม่ควรมีบน production

app.get('/api/version', (req, res) => {
  res.json(BUILD_INFO);
});

// ⭐️ ตรวจสอบสต๊อกใกล้หมด (เกณฑ์ต่อสินค้า products.min_stock — เดิม hardcode <=10 ทุกตัว) แล้วสร้างแจ้งเตือนระบบ
// แจ้งเฉพาะตอนสต๊อก "ตกลงมาต่ำกว่าเกณฑ์ครั้งแรก" (ข้าม threshold) กันแจ้งซ้ำทุกบิลที่ตัดสต๊อก
// ⚠️ บันทึก notification ลง DB ภายใน transaction แต่ "ไม่ emit/ส่ง LINE" ตรงนี้ — คืนข้อมูลกลับไปให้
//    ผู้เรียก emit/ส่งเองหลัง commit (กัน race: ถ้า emit ก่อน commit client จะรีเฟรชแล้วเจอข้อมูลเก่า
//    และกันส่ง LINE ทั้งที่ transaction ดันถูก rollback ทีหลัง)
// ⭐️ Day 3 — คืน { message, product } แทนที่จะคืน message เฉยๆ: message สำหรับ socket/in-app
//    notification เหมือนเดิม, product สำหรับ caller เก็บสะสมแล้วส่งเป็น LINE alert เดียวรวมทุกรายการ
async function notifyIfLowStock(conn, io, productId, stockBefore, stockAfter) {
  const [rows] = await conn.query('SELECT name, min_stock FROM products WHERE id = ?', [productId]);
  const product = rows[0];
  if (!product) return null;
  const minStock = Number(product.min_stock) || 10;

  if (stockBefore > minStock && stockAfter <= minStock) {
    const msg = `สินค้า "${product.name}" สต๊อกใกล้หมด เหลือ ${stockAfter} ชิ้น`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
    return { message: msg, product: { name: product.name, stock: stockAfter, min_stock: minStock } };
  }
  return null;
}

// ⭐️ Phase B (refactor) — calculatePromotionDiscount + checkPromotionUsageLimit ย้ายไป
// src/services/promotionEngine.js แล้ว (ใช้ร่วมกับ promotionsController) require กลับมาที่นี่เพื่อให้
// checkout/sync-offline ที่ยังอยู่ใน server.js เรียกใช้ได้เหมือนเดิม สูตร/พฤติกรรมไม่เปลี่ยน
const { calculatePromotionDiscount, checkPromotionUsageLimit } = require('./src/services/promotionEngine');

// =========================================
// ตั้งค่าเหตุการณ์ (Events) ของ Socket.io
// =========================================
io.on('connection', (socket) => {
  console.log(`🟢 มีหน้าจอ POS เชื่อมต่อเข้ามาแล้ว: ${socket.id} (user_id=${socket.user?.id}, role=${socket.user?.role})`);
  // ⭐️ SECURITY FIX (#5) — เอา log handshake.auth ออก (มี JWT อยู่ข้างใน)

  // ⭐️ Task 1A — เข้าห้องส่วนตัวของ user ตัวเอง เพื่อให้ backend ยิง event เฉพาะคนได้ด้วย io.to(`user_${id}`)
  if (socket.user?.id) socket.join(`user_${socket.user.id}`);

  // ⭐️ Task 1A — audit log การเชื่อมต่อ socket
  logAudit(pool, 'SOCKET_CONNECTED', socket.user?.id || null, { socket_id: socket.id }).catch(err => console.error('audit_logs SOCKET_CONNECTED ล้มเหลว:', err.message));

  socket.on('disconnect', (reason) => {
    console.log(`🔴 หน้าจอ POS ปิดการเชื่อมต่อ: ${socket.id} - reason: ${reason}`);
    logAudit(pool, 'SOCKET_DISCONNECTED', socket.user?.id || null, { socket_id: socket.id, reason }).catch(err => console.error('audit_logs SOCKET_DISCONNECTED ล้มเหลว:', err.message));
  });
});

// Swagger Document Endpoint
// =========================================
// 3. CATEGORIES (ระบบหมวดหมู่สินค้า)
// =========================================

app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/categories', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { name } = req.body;
  if (!name) return badRequest(res, "กรุณาระบุชื่อหมวดหมู่");

  // ⭐️ เก็บ idempotency_key (กัน offline queue retry แล้วสร้างหมวดหมู่ซ้ำ) — มี UNIQUE ที่คอลัมน์นี้ใน DB
  const idempotencyKey = req.headers['idempotency-key'];
  try {
    const [result] = await pool.query('INSERT INTO categories (name, idempotency_key) VALUES (?, ?)', [name, idempotencyKey || null]);
    res.status(201).json({ id: result.insertId, name });
  } catch (error) {
    // 🐛 FIX — retry หลัง server restart: row เดิมยังอยู่ใน DB (UNIQUE idempotency_key) → ตอบ "สำเร็จซ้ำ" แทน error
    if (isIdempotentDuplicate(error)) {
      const [rows] = await pool.query('SELECT id FROM categories WHERE idempotency_key = ?', [idempotencyKey]);
      if (rows.length > 0) return res.status(201).json({ id: rows[0].id, name, message: 'เพิ่มหมวดหมู่สำเร็จ (request ซ้ำ — ไม่ได้สร้างซ้ำ)', duplicated: true });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Export หมวดหมู่ CSV/Excel — แก้ไขนอกระบบแล้วนำเข้ากลับผ่าน POST /api/categories/import ด้านล่าง
app.get('/api/categories/export', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM categories ORDER BY id');
    await sendTableExport(res, {
      filename: `categories-export_${Date.now()}`, sheetName: 'หมวดหมู่',
      headers: ['id', 'name'], rows: rows.map(r => [r.id, r.name]),
    }, validateExportFormat(req, res));
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// ⭐️ Import หมวดหมู่ CSV — มี id = UPDATE ชื่อ (แก้ของเดิม), ไม่มี id/id ว่าง = INSERT ใหม่ (เพิ่ม)
// มี id แต่หา id นั้นไม่เจอ = ข้ามแถวนั้นไปเงียบๆ (กันพิมพ์ id ผิดแล้วสร้างแถวใหม่โดยไม่ตั้งใจ)
app.post('/api/categories/import', requireRole('ADMIN'), uploadLimiter, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return badRequest(res, 'กรุณาเลือกไฟล์ CSV');
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        let inserted = 0, updated = 0, skipped = 0;
        for (const row of results) {
          const name = (row.name || '').trim();
          const id = row.id ? Number(row.id) : null;
          if (!name) { skipped++; continue; }
          if (id) {
            const [r] = await pool.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
            if (r.affectedRows > 0) updated++; else skipped++;
          } else {
            await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
            inserted++;
          }
        }
        fs.unlinkSync(req.file.path);
        res.json({ message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${inserted}, แก้ไข ${updated}, ข้าม ${skipped} รายการ` });
      } catch (error) {
        console.error('[500]', error.message);
        serverError(res);
      }
    });
});

app.delete('/api/categories/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบหมวดหมู่สำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// 4. PRODUCTS & INVENTORY (ระบบสินค้าและคลัง)
// =========================================

// ⭐️ Sprint 2 — Expiry Discount: Helper function to calculate product expiry status
// ⭐️ คืน "วันปฏิทินไทย" (YYYY-MM-DD) ของ Date/ค่าวันที่ใดๆ — กัน 2 ปัญหาพร้อมกัน: (1) TZ ของ Node
// process (cloud ปกติรัน UTC) (2) mysql2 แปลง DATE column เป็น Date object โดย shift ตาม pool
// timezone (+07:00) ทำให้ new Date()+setHours date-math เพี้ยน. Intl แปลงเป็นวันปฏิทินโซนกรุงเทพจาก
// "instant" ที่ถูกต้องเสมอ ไม่ว่าค่าจะมาเป็น Date object หรือ string
function toBangkokDateStr(dateLike) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(dateLike));
}
// จำนวนวันเต็มระหว่าง 2 วันปฏิทินไทย (b - a) — เทียบเป็น UTC midnight ของแต่ละวันปฏิทิน ไม่มีเรื่องเวลา/tz
function daysBetweenBangkok(aStr, bStr) {
  return Math.round((Date.parse(bStr + 'T00:00:00Z') - Date.parse(aStr + 'T00:00:00Z')) / 86400000);
}

function getProductExpiry(product) {
  if (!product.expiry_date) return { status: 'no_expiry' };

  // 🐛 FIX (root cause) — เดิมใช้ new Date(expiry_date) + set*Hours(0,0,0,0) แล้ว date-math ซึ่งเพี้ยน
  // เพราะ mysql2 แปลง DATE column เป็น Date object ที่ shift ตาม pool tz (+07:00) — เทียบวันปฏิทินไทย
  // ตรงๆ ด้วย Intl แทน (ไม่ขึ้นกับทั้ง TZ ของ process และวิธี parse ของ mysql2) ให้ตรงกับ SQL CURDATE()
  // ที่ badge ใน /api/products ใช้ (แหล่งเดียวกัน = ป้ายกับผลลัพธ์ตรงกันเสมอ)
  const daysLeft = daysBetweenBangkok(toBangkokDateStr(new Date()), toBangkokDateStr(product.expiry_date));

  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft === 0) return { status: 'expires_today', daysLeft: 0 };
  if (daysLeft === 1) return { status: 'near_expiry', daysLeft: 1, applyDiscount: true };
  return { status: 'ok', daysLeft };
}

// ⭐️ Phase 1 — โปรระดับสินค้า (ช่วงวันที่): เช็คว่าโปรกำลัง active วันนี้ไหม
function isProductPromoActive(product) {
  const pct = Number(product.promo_percent) || 0;
  if (pct <= 0 || !product.promo_start || !product.promo_end) return false;
  // 🐛 FIX (root cause เดียวกับ getProductExpiry) — เดิม new Date()+setHours เพี้ยนเพราะ mysql2 shift
  // DATE column ตาม pool tz — เทียบวันปฏิทินไทยแบบ string ตรงๆ (โซนกรุงเทพ) แทน
  const today = toBangkokDateStr(new Date());
  const s = toBangkokDateStr(product.promo_start);
  const e = toBangkokDateStr(product.promo_end);
  return today >= s && today <= e;
}

// ⭐️ Phase 1 — คืน % ส่วนลด "ที่ดีที่สุดอันเดียว" ระหว่างโปรช่วงวันที่ กับ ลดใกล้หมดอายุ
// ไม่ลดซ้อน (เอาอันมากกว่า) — ลูกค้าได้ดีลดีสุด, ป้องกันลดทับกันจนขาดทุน
function getBestItemDiscountPercent(product) {
  let pct = 0;
  if (isProductPromoActive(product)) pct = Math.max(pct, Number(product.promo_percent) || 0);
  if (getProductExpiry(product).status === 'near_expiry') pct = Math.max(pct, Number(product.discount_percent) || 0);
  return pct;
}

// ⭐️ CSV/Excel export ใช้ร่วมกันทั้ง 4 หน้าจัดการข้อมูล (พนักงาน/สิทธิ์, ซัพพลายเออร์, หมวดหมู่, สินค้า)
// — ผู้ใช้ขอไว้ในหน้าคลังสินค้า/Settings เพื่อดึงออกไปแก้ไขนอกระบบแล้วนำเข้ากลับ (ดู import คู่กันด้านล่าง
// ของแต่ละ entity) รูปแบบเดียวกับ toCsv ใน /api/reports/export/sales-csv (ครอบ " กัน , ในข้อมูล + BOM)
function toCsvString(headers, rows) {
  const body = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return '﻿' + body; // BOM ให้ Excel อ่านภาษาไทยถูก
}
async function sendTableExport(res, { filename, sheetName, headers, rows }, format) {
  if (format === 'excel') {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = await getStoreName(req.user?.tenant_id);
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
    rows.forEach(r => sheet.addRow(r));
    sheet.columns.forEach((col, i) => {
      let maxLen = String(headers[i] ?? '').length;
      for (const r of rows) { const len = String(r[i] ?? '').length; if (len > maxLen) maxLen = len; }
      col.width = Math.min(Math.max(maxLen + 2, 10), 40);
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(toCsvString(headers, rows));
}
function validateExportFormat(req, res) {
  const format = req.query.format === 'excel' ? 'excel' : 'csv';
  return format;
}

app.get('/api/products', async (req, res) => {
  try {
    const { search, category_id } = req.query;
    // ⭐️ Sprint 2 — B8: Use Bangkok timezone for expiry checks
    let query = `
      SELECT p.*, c.name as category_name,
             CASE
               WHEN p.expiry_date IS NULL THEN 'no_expiry'
               WHEN DATE(p.expiry_date) < CURDATE() THEN 'expired'
               WHEN DATE(p.expiry_date) = CURDATE() THEN 'expires_today'
               WHEN DATEDIFF(DATE(p.expiry_date), CURDATE()) = 1 THEN 'near_expiry'
               ELSE 'ok'
             END as expiry_status,
             (p.promo_percent > 0 AND p.promo_start IS NOT NULL AND p.promo_end IS NOT NULL
               AND CURDATE() BETWEEN p.promo_start AND p.promo_end) AS promo_active
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.name LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category_id) {
      query += ` AND p.category_id = ?`;
      params.push(category_id);
    }

    query += ` ORDER BY p.name`;

    const [rows] = await pool.query(query, params);

    // ⭐️ Enrich with expiry and discount info
    // 🐛 FIX (root cause ของ "badge ขึ้น 40% OFF แต่ราคาไม่ลด") — เดิมส่วนลดคิดจาก JS getProductExpiry(p)
    // ที่ new Date(p.expiry_date) ให้ผลเพี้ยน เพราะ mysql2 แปลง DATE column เป็น Date object โดย shift
    // ตาม pool timezone (+07:00) แล้ว JS date math คลาด → applyDiscount=false ทั้งที่ badge (จาก SQL)
    // ขึ้น near_expiry. ใช้ expiry_status จาก SQL (คำนวณด้วย CURDATE ล้วนๆ ไม่มี JS date parsing) เป็น
    // แหล่งเดียวกับ badge → ป้ายกับราคาตรงกันเสมอ 100%
    const enrichedProducts = rows.map(p => {
      const isNearExpiry = p.expiry_status === 'near_expiry';
      const discount = isNearExpiry ? Math.round(p.price * p.discount_percent / 100) : 0;
      return {
        ...p,
        days_left: getProductExpiry(p).daysLeft,
        discount_amount: discount,
        price_after_discount: p.price - discount
      };
    });

    res.json(enrichedProducts);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ ไฮไลต์สินค้า: ยอดนิยม (ขายดี) + มีโปร (ใกล้หมดอายุ ลดราคาอยู่) — สำหรับหน้าจองสินค้า/สมาชิก
// public GET (อยู่ใต้ prefix /api/products ที่เปิด browse ได้โดยไม่ต้อง login)
app.get('/api/products/highlights', async (req, res) => {
  try {
    const expiryCase = `CASE
      WHEN p.expiry_date IS NULL THEN 'no_expiry'
      WHEN DATE(p.expiry_date) < CURDATE() THEN 'expired'
      WHEN DATE(p.expiry_date) = CURDATE() THEN 'expires_today'
      WHEN DATEDIFF(DATE(p.expiry_date), CURDATE()) = 1 THEN 'near_expiry'
      ELSE 'ok' END`;
    // ยอดนิยม — ขายดีรวมทั้งหน้าร้าน (sale_items) + พรีออเดอร์ที่ COMPLETED (order_items)
    const [popular] = await pool.query(`
      SELECT p.*, c.name AS category_name, ${expiryCase} AS expiry_status, ps.sold
      FROM products p
      LEFT JOIN categories c ON p.category_id=c.id
      JOIN (
        SELECT product_id, SUM(qty) AS sold FROM (
          SELECT si.product_id, si.quantity AS qty FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE s.status='COMPLETED'
          UNION ALL
          SELECT oi.product_id, oi.quantity FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='COMPLETED'
        ) t GROUP BY product_id
      ) ps ON ps.product_id=p.id
      WHERE p.is_active=1 AND p.stock>0
      ORDER BY ps.sold DESC LIMIT 8
    `);
    // มีโปร — โปรระดับสินค้าช่วงวันที่ (promo_percent) ที่กำลัง active + สินค้าใกล้หมดอายุ (near_expiry) + มีสต๊อก
    const promoActiveExpr = `(p.promo_percent > 0 AND p.promo_start IS NOT NULL AND p.promo_end IS NOT NULL
      AND CURDATE() BETWEEN p.promo_start AND p.promo_end)`;
    const [promo] = await pool.query(`
      SELECT p.*, c.name AS category_name, ${expiryCase} AS expiry_status, ${promoActiveExpr} AS promo_active
      FROM products p
      LEFT JOIN categories c ON p.category_id=c.id
      WHERE p.is_active=1 AND p.stock>0
        AND (
          (DATEDIFF(DATE(p.expiry_date), CURDATE()) = 1 AND COALESCE(p.discount_percent,0) > 0)
          OR ${promoActiveExpr}
        )
      ORDER BY promo_active DESC, p.promo_end ASC, p.expiry_date ASC LIMIT 12
    `);
    res.json({ popular, promo });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/products', requireRole('ADMIN', 'MANAGER'), validateRequest(productValidator), async (req, res) => {
  const { barcode, name, category_id, price, cost = 0, stock = 0, image_url, vendor_id, gp_rate, promo_percent, promo_start, promo_end, is_reward_item, points_required, min_stock } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO products (barcode, name, category_id, price, cost, stock, image_url, vendor_id, gp_rate, promo_percent, promo_start, promo_end, is_reward_item, points_required, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [barcode || null, name, category_id || null, price, cost || 0, stock, image_url || null, vendor_id || null, gp_rate || 0, promo_percent || 0, promo_start || null, promo_end || null, is_reward_item ? 1 : 0, points_required || 0, (min_stock === undefined || min_stock === null || min_stock === '') ? 10 : min_stock]
    );
    // ⭐️ Task 5 — audit log
    await logAudit(pool, 'CREATE_PRODUCT', req.user.id, { name, price }, 'PRODUCT', result.insertId);
    res.status(201).json({ id: result.insertId, message: "เพิ่มสินค้าสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return badRequest(res, "บาร์โค้ดนี้ซ้ำกับในระบบแล้ว");
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Export สินค้า CSV/Excel — เลือกคอลัมน์ที่แก้บ่อยสุด (ไม่รวม vendor_id/gp_rate/promo/รูป/วันหมดอายุ
// ที่ควรแก้ผ่านฟอร์มปกติเพราะมี validation เฉพาะทาง เช่น เช็ควันที่ย้อนหลัง) ตัด id ออกก็ยัง export ได้
// ปกติแต่ import กลับจะกลายเป็น "เพิ่มใหม่" เสมอ (ไม่มี id ให้จับคู่อัปเดตของเดิม)
app.get('/api/products/export', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, barcode, name, category_id, price, cost, stock, min_stock FROM products WHERE is_active = 1 ORDER BY id'
    );
    await sendTableExport(res, {
      filename: `products-export_${Date.now()}`, sheetName: 'สินค้า',
      headers: ['id', 'barcode', 'name', 'category_id', 'price', 'cost', 'stock', 'min_stock'],
      rows: rows.map(r => [r.id, r.barcode || '', r.name, r.category_id ?? '', r.price, r.cost, r.stock, r.min_stock]),
    }, validateExportFormat(req, res));
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// ⭐️ Import สินค้า CSV — มี id ที่มีจริง = UPDATE (แก้ไข, เฉพาะ 6 คอลัมน์ที่ export ไป ฟิลด์อื่นไม่แตะ)
// ไม่มี id/id หาไม่เจอ = INSERT ใหม่ — barcode ซ้ำจะโดน DB unique constraint reject แถวนั้น (ข้าม ไม่ทำทั้งไฟล์พัง)
app.post('/api/products/import', requireRole('ADMIN'), uploadLimiter, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return badRequest(res, 'กรุณาเลือกไฟล์ CSV');
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        let inserted = 0, updated = 0, skipped = 0;
        for (const row of results) {
          const name = (row.name || '').trim();
          const price = Number(row.price);
          if (!name || !Number.isFinite(price) || price < 0) { skipped++; continue; }
          const barcode = (row.barcode || '').trim() || null;
          const category_id = row.category_id ? Number(row.category_id) : null;
          const cost = Number(row.cost) || 0;
          const stock = Number.isFinite(Number(row.stock)) ? Number(row.stock) : 0;
          const min_stock = Number.isFinite(Number(row.min_stock)) ? Number(row.min_stock) : 10;
          const id = row.id ? Number(row.id) : null;

          try {
            if (id) {
              const [r] = await pool.query(
                'UPDATE products SET barcode=?, name=?, category_id=?, price=?, cost=?, stock=?, min_stock=? WHERE id=?',
                [barcode, name, category_id, price, cost, stock, min_stock, id]
              );
              if (r.affectedRows > 0) updated++; else skipped++;
            } else {
              await pool.query(
                'INSERT INTO products (barcode, name, category_id, price, cost, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [barcode, name, category_id, price, cost, stock, min_stock]
              );
              inserted++;
            }
          } catch (rowErr) {
            if (rowErr.code === 'ER_DUP_ENTRY') { skipped++; continue; } // บาร์โค้ดซ้ำ — ข้ามแถวนี้ ไม่ทำทั้งไฟล์พัง
            throw rowErr;
          }
        }
        fs.unlinkSync(req.file.path);
        res.json({ message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${inserted}, แก้ไข ${updated}, ข้าม ${skipped} รายการ` });
      } catch (error) {
        console.error('[500]', error.message);
        serverError(res);
      }
    });
});

app.put('/api/products/:id', requireRole('ADMIN', 'MANAGER'), validateRequest(productUpdateValidator), async (req, res) => {
  const { barcode, name, category_id, price, cost, image_url, vendor_id, gp_rate, expiry_date, discount_percent, promo_percent, promo_start, promo_end, is_reward_item, points_required, min_stock } = req.body;
  try {
    // ⭐️ Sprint 2: Validate expiry_date if provided
    if (expiry_date && new Date(expiry_date) < new Date()) {
      return badRequest(res, 'วันหมดอายุไม่สามารถเป็นวันที่ผ่านมาแล้ว');
    }

    // ⭐️ Task 5 — เก็บค่าเดิมไว้เทียบใน audit log (รวม cost เผื่อ client ไม่ส่ง cost มา จะได้ไม่ทับเป็น 0)
    const [oldRows] = await pool.query('SELECT barcode, name, category_id, price, cost, image_url, vendor_id, gp_rate, expiry_date, discount_percent, is_reward_item, points_required, min_stock FROM products WHERE id = ?', [req.params.id]);
    const finalCost = (cost === undefined || cost === null || cost === '') ? (oldRows[0]?.cost ?? 0) : cost;
    // ⭐️ reward fields: ถ้า client ไม่ส่งมา คงค่าเดิมไว้ (กันฟอร์มที่ยังไม่อัปเดตทับเป็น 0)
    const finalIsReward = (is_reward_item === undefined) ? (oldRows[0]?.is_reward_item ?? 0) : (is_reward_item ? 1 : 0);
    const finalPointsRequired = (points_required === undefined || points_required === null || points_required === '') ? (oldRows[0]?.points_required ?? 0) : points_required;
    // ⭐️ Day 3 — เช่นเดียวกับ points_required: ไม่ส่งมา = คงค่าเดิม (เดิม 10 จาก default ตอนสร้าง)
    const finalMinStock = (min_stock === undefined || min_stock === null || min_stock === '') ? (oldRows[0]?.min_stock ?? 10) : min_stock;

    await pool.query(
      'UPDATE products SET barcode=?, name=?, category_id=?, price=?, cost=?, image_url=?, vendor_id=?, gp_rate=?, expiry_date=?, discount_percent=?, promo_percent=?, promo_start=?, promo_end=?, is_reward_item=?, points_required=?, min_stock=? WHERE id=?',
      [barcode || null, name, category_id || null, price, finalCost, image_url || null, vendor_id || null, gp_rate || null, expiry_date || null, discount_percent || 40, promo_percent || 0, promo_start || null, promo_end || null, finalIsReward, finalPointsRequired, finalMinStock, req.params.id]
    );

    await logAudit(pool, 'UPDATE_PRODUCT', req.user.id, { old: oldRows[0] || null, new: { barcode, name, category_id, price, image_url, vendor_id, gp_rate, expiry_date, discount_percent } }, 'PRODUCT', req.params.id);

    res.json({ message: "อัปเดตข้อมูลสินค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/products/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: "ลบสินค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// 1. AUTH & USERS (ระบบเข้าสู่ระบบและพนักงาน)
// =========================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body; // หน้าเว็บส่งช่อง username มา เราจะเอาไปเทียบกับ student_id
  try {
    // ⭐️ MULTI-TENANT: Query from master DB to get tenant info
    const masterPool = require('./src/config/tenantRegistry').getMasterPool();
    const [tenants] = await masterPool.query('SELECT db_name FROM tenants WHERE is_active = TRUE');
    
    // Search for user across all tenant databases
    let userFound = null;
    let userDbName = null;
    for (const tenant of tenants) {
      try {
        // 🐛 FIX — เดิม require('./src/config/tenantDB') แต่ไฟล์จริงอยู่ที่ src/middleware/tenantDB.js
        //   MODULE_NOT_FOUND โดน catch/continue กลืนทุก tenant → userFound ว่างเสมอ = "login ไม่ได้ทุกบัญชี"
        const tenantPool = require('./src/middleware/tenantDB').getOrCreatePool(tenant.db_name);
        const [users] = await tenantPool.query('SELECT * FROM users WHERE student_id = ? AND is_active = TRUE', [username]);
        if (users.length > 0) {
          userFound = users[0];
          userDbName = tenant.db_name;
          break;
        }
      } catch (err) {
        // Skip this tenant if connection fails
        continue;
      }
    }
    
    if (!userFound) return unauthorized(res, "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง");
    // ⭐️ MULTI-TENANT — user มาจาก master-registry loop ด้านบน (userFound + userDbName)
    //   เดิมค้างโค้ดเก่า 2 บรรทัด (`if (users.length === 0)` + `const user = users[0]`) ทำให้เป็น
    //   SyntaxError: Identifier 'user' has already been declared → backend บูตไม่ขึ้นเลยทันที
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return unauthorized(res, "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง");

    // ⭐️ NEW — บอก frontend ว่าคนนี้ "กำลังเข้างานอยู่" หรือเปล่า เพื่อตั้งโหมดใช้งานให้อัตโนมัติตอนล็อกอิน
    //   (CASHIER = มีกะที่ยังเปิดค้างอยู่ / ADMIN = ลงชื่อเข้างานวันนี้แล้วยังไม่ได้ลงชื่อออก)
    //   เช็คทั้งสองแบบกับ staff ทุกคน ไม่ผูกกับ role เพราะ ADMIN ก็เปิดกะขายเองได้เหมือนกัน
    //   ถ้าไม่ได้เข้างาน = เข้ามาซื้อของ frontend จะให้เป็นโหมดสมาชิกตามเดิม
    //   เงื่อนไข attendance ยกมาจาก GET /api/attendance/today ให้ตรงกัน (รองรับ row เก่าที่เก็บเป็น UTC)
    let hasActiveWorkSession = false;
    if (user.role === 'ADMIN' || user.role === 'CASHIER') {
      const [workRows] = await pool.query(
        `SELECT
           EXISTS(SELECT 1 FROM shifts WHERE cashier_id = ? AND status = 'OPEN') AS has_open_shift,
           EXISTS(SELECT 1 FROM attendance WHERE user_id = ?
                    AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
                    AND check_out IS NULL) AS has_open_attendance`,
        [user.id, user.id]
      );
      hasActiveWorkSession = !!(workRows[0].has_open_shift || workRows[0].has_open_attendance);
    }

    // ⭐️ Sprint 2 — B5: Issue both access token (8h) and refresh token (7d)
    // ⭐️ Security fix — สุ่ม csrf token ที่นี่ ฝังลง access token (เซ็นแล้ว) แล้วคืนค่าเดียวกันทาง
    // response body ให้ frontend เก็บไว้แนบเป็น header (ไม่ใช่ cookie — อ่านข้าม origin ไม่ได้)
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const accessToken = generateAccessToken(user, csrfToken);
    const refreshToken = generateRefreshToken(user);

    // ⭐️ Security remediation — token ทั้งคู่ไปเป็น httpOnly cookie ไม่คืนใน JSON body แล้ว
    // (JS ฝั่ง client อ่านไม่ได้เลย ต่อให้มี XSS ก็ขโมย token ไปใช้ที่อื่นไม่ได้)
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      message: "ล็อกอินสำเร็จ",
      user: { id: user.id, student_id: user.student_id, full_name: user.full_name, role: user.role, must_change_password: !!user.must_change_password, profile_image_url: user.profile_image_url || null, tenant_id: user.tenant_id || null, db_name: userDbName },
      csrfToken,
      has_active_work_session: hasActiveWorkSession, // ⭐️ frontend ใช้ตั้ง session_mode (work/shop) อัตโนมัติ
    });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Sprint 2 — B5: Token Refresh Endpoint
// ⭐️ Security remediation — rate limited + rotates the refresh token on every use (old jti revoked,
// new one issued) so a replayed/stolen refresh token stops working the moment the legitimate client
// refreshes again, instead of staying valid for the full 7-day lifetime. Tokens read/written via
// httpOnly cookie now, not request body — refresh_token cookie is path-scoped to this route only.
app.post('/api/auth/refresh', refreshLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      return unauthorized(res, 'ไม่พบ refresh token');
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return unauthorized(res, 'Refresh token ไม่ถูกต้องหรือหมดอายุ');
    }

    // ⭐️ Security remediation — reject refresh with a revoked/blacklisted refresh token
    if (await isTokenRevoked(decoded)) {
      return unauthorized(res, 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่');
    }

    // Fetch user to get fresh data
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (users.length === 0) {
      return unauthorized(res, 'ไม่พบผู้ใช้งาน');
    }

    // ⭐️ Security remediation — rotate: revoke the refresh token just used, issue a fresh one
    if (decoded.jti && decoded.exp) {
      await pool.query(
        'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
        [decoded.jti, decoded.id, decoded.exp]
      );
    }

    // Issue new access + refresh tokens (rotates csrf token too), set as cookies again
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const accessToken = generateAccessToken(users[0], csrfToken);
    const newRefreshToken = generateRefreshToken(users[0]);
    setAuthCookies(res, accessToken, newRefreshToken);

    res.json({ success: true, csrfToken });
  } catch (err) {
    unauthorized(res, err.message);
  }
});

// ⭐️ Security fix — fallback สำหรับตอน frontend refresh หน้าเว็บ (in-memory csrf token หายไปกับ JS
// state แต่ access_token cookie ยังอยู่) ให้ดึง csrf claim จาก token ปัจจุบันกลับมาใหม่ได้โดยไม่ต้อง
// login/refresh ใหม่ทั้งกระบวนการ — เป็น GET จึงไม่โดน requireCsrf บล็อกตัวเอง (chicken-and-egg)
app.get('/api/auth/csrf-token', (req, res) => {
  res.json({ csrfToken: req.user?.csrf || null });
});

// ⭐️ Socket.io auth — token อายุสั้นสำหรับ handshake โดยเฉพาะ
//
// ทำไมต้องมี: REST วิ่งผ่าน Vercel rewrite แล้ว (/api/* proxy ไป Render) cookie จึงเป็น first-party
// ส่งได้ปกติ แต่ Vercel rewrite ไม่รองรับ WebSocket upgrade — Socket.io จึงยังต้องต่อตรงไป Render
// = ยัง cross-site อยู่ Safari/iOS (ITP) บล็อก third-party cookie ทิ้ง handshake เลยไม่มี
// access_token ติดไป ได้ error 'Missing JWT token' ทั้งที่ผู้ใช้ล็อกอินอยู่
//
// endpoint นี้เรียกผ่าน proxy (cookie ใช้ได้) แล้วคืน token ที่ JS ถือไปแนบใน handshake ได้
//
// ⚠️ token นี้ JS อ่านได้ (ไม่ใช่ httpOnly) จึงตั้งใจจำกัดความเสียหายไว้:
//   - อายุ 5 นาที พอสำหรับต่อ socket ทันทีหลังขอ (frontend ขอใหม่ทุกครั้งที่ reconnect)
//   - ติด claim type='socket' ซึ่ง authenticateToken ปฏิเสธ = เอาไปยิง REST API ไม่ได้
//   - ไม่ใส่ csrf claim จึงใช้ทำ mutating request แทนผู้ใช้ไม่ได้อยู่แล้ว
app.get('/api/auth/socket-token', (req, res) => {
  const socketToken = jwt.sign(
    { id: req.user.id, role: req.user.role, full_name: req.user.full_name, type: 'socket' },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
  res.json({ socketToken });
});

// ⭐️ Sprint 2 — B5: Token Logout Endpoint
// ⭐️ Security remediation — actually revoke the access token (and refresh token) server-side, and
// clear the cookies so the browser stops sending them
app.post('/api/auth/logout', requireRole('ADMIN', 'CASHIER', 'MEMBER'), async (req, res) => {
  try {
    if (req.user?.jti && req.user?.exp) {
      await pool.query(
        'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
        [req.user.jti, req.user.id, req.user.exp]
      );
    }
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      const decoded = jwt.decode(refreshToken);
      if (decoded?.jti && decoded?.exp) {
        await pool.query(
          'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
          [decoded.jti, decoded.id, decoded.exp]
        );
      }
    }
    clearAuthCookies(res);
    res.json({ success: true });
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

app.get('/api/users/search', requireRole('CASHIER', 'MANAGER', 'ADMIN'), async (req, res) => {
  const { q } = req.query;
  if (!q) return badRequest(res, "กรุณาระบุคำค้นหา");

  try {
    // ค้นหาทั้งจาก student_id และ phone_number + แนบข้อมูลกลุ่มสมาชิก (ให้ POS โชว์ badge สิทธิ์ลด)
    const [rows] = await pool.query(
      `SELECT u.id, u.student_id, u.full_name, u.phone_number, u.points, u.role, u.group_id,
              mg.name AS group_name, mg.code AS group_code, mg.default_discount_percent AS group_default_discount
       FROM users u LEFT JOIN member_groups mg ON u.group_id = mg.id
       WHERE u.student_id = ? OR u.phone_number = ?`,
      [q, q]
    );
    if (rows.length === 0) return notFound(res, "ไม่พบข้อมูลสมาชิก");

    const member = rows[0];
    // rule รายหมวดหมู่ของกลุ่มนี้ (ให้ POS คำนวณ preview ต่อชิ้นได้ตรงกับ backend)
    let group_rules = [];
    if (member.group_id) {
      const [ruleRows] = await pool.query(
        'SELECT category_id, discount_percent FROM group_discount_rules WHERE group_id = ?',
        [member.group_id]
      );
      group_rules = ruleRows;
    }
    res.json({ ...member, group_rules });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Sprint 0 — A2: เดิม PreOrder.tsx ใช้ /api/users/search (staff-only) มายืนยันเบอร์โทรตัวเอง
// ก่อนสั่งจอง ทำให้ MEMBER โดน 403 ทุกครั้ง — endpoint นี้เปิดให้ทุก role ที่ login แล้วเรียกได้
// (ไม่จำกัดแค่ MEMBER เพราะ CASHIER/ADMIN ก็อาจสั่งจองแทนตัวเองได้เหมือนกัน) แต่คืนข้อมูลน้อยกว่า
// /users/search มาก: ไม่มีเบอร์โทร ไม่มีแต้มสะสม มีแค่ matched (boolean) + ชื่อ (สำหรับ confirm
// ก่อนสั่งจอง) กันไม่ให้กลายเป็นช่องทาง enumerate เบอร์โทร→แต้ม/ข้อมูลส่วนตัวคนอื่นเหมือน endpoint เดิม
app.post('/api/users/verify-phone', async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return badRequest(res, 'กรุณาระบุเบอร์โทรศัพท์');

  try {
    if (req.user.role === 'MEMBER') {
      const [ownRows] = await pool.query('SELECT phone_number FROM users WHERE id = ?', [req.user.id]);
      if (ownRows[0]?.phone_number !== phone_number) {
        return forbidden(res, 'สิทธิ์ไม่เพียงพอ');
      }
    }

    const [rows] = await pool.query(
      'SELECT full_name FROM users WHERE phone_number = ?',
      [phone_number]
    );
    res.json({ matched: rows.length > 0, member_name: rows[0]?.full_name || null });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// 🐛 FIX (MEMBER login bug, follow-up) — PreOrder.tsx (MEMBER-facing page, /pre-order) was calling
// GET /api/users/search?q=<own student_id> just to read its own points balance. That endpoint is
// correctly CASHIER/ADMIN-only (it does arbitrary cross-user lookup by phone/student_id — opening
// it to MEMBER would let any member read any other member's phone number + points). So every
// PreOrder mount 403'd, spamming the log. Real fix: a self-only endpoint, scoped to req.user.id,
// safe for any authenticated role since it can only ever return the caller's own data.
app.get('/api/users/me', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, student_id, full_name, phone_number, points, role, profile_image_url FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return notFound(res, "ไม่พบข้อมูลผู้ใช้");
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/users/register', registerLimiter, validateRequest(userRegisterValidator), async (req, res) => {
  const { student_id, full_name, phone_number } = req.body;
  if (!student_id || !full_name || !phone_number) {
    return badRequest(res, "กรุณากรอกข้อมูลให้ครบถ้วน");
  }

  try {
    // ⭐️ ทริค: ตั้งรหัสผ่านเริ่มต้นเป็น "เบอร์โทรศัพท์" ไปก่อน (ตั้งใจออกแบบไว้แบบนี้)
    // อนาคตตอนทำระบบจองออนไลน์ ลูกค้าค่อยเอาเบอร์โทรไปล็อกอินแล้วเปลี่ยนรหัสผ่านเอง
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(phone_number, salt);

    const [result] = await pool.query(
      'INSERT INTO users (student_id, password, full_name, phone_number, role, points) VALUES (?, ?, ?, ?, ?, 0)',
      [student_id, hashedPassword, full_name, phone_number, 'MEMBER']
    );

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      user: { id: result.insertId, student_id, full_name, phone_number, points: 0 }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return badRequest(res, "รหัสนักศึกษา หรือ เบอร์โทรศัพท์นี้ มีในระบบแล้ว");
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// ⭐️ Task 13 — PASSWORD RESET
// ระบบนี้ไม่มีคอลัมน์ email บน users (identity คือ student_id, ไม่มีระบบส่งอีเมล/SMS จริง) —
// สเปกเดิมอิง email; ปรับให้ยืนยันตัวตนด้วย student_id + phone_number แทน (สองอย่างที่มีอยู่แล้วในระบบ)
// TODO: ต่อระบบส่ง SMS/LINE Notify จริงตอน deploy — ตอนนี้ log token ไว้ที่ server console แทน "ส่งอีเมล"
// =========================================

app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { student_id, phone_number } = req.body;
  if (!student_id || !phone_number) {
    return badRequest(res, "กรุณาระบุรหัสนักศึกษาและเบอร์โทรศัพท์");
  }

  try {
    const [users] = await pool.query('SELECT id FROM users WHERE student_id = ? AND phone_number = ? AND is_active = TRUE', [student_id, phone_number]);

    // ⭐️ ไม่ยืนยัน/ปฏิเสธว่ามีบัญชีนี้จริงไหม (กัน enumeration) — ตอบข้อความเดียวกันเสมอ
    if (users.length === 0) {
      return res.json({ message: "ถ้าข้อมูลถูกต้อง ระบบจะสร้างลิงก์รีเซ็ตรหัสผ่านให้ (ติดต่อเจ้าหน้าที่หากไม่ได้รับ)" });
    }

    const userId = users[0].id;
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 ชั่วโมง

    // ล้าง token เก่าของ user คนนี้ทิ้งก่อน (ให้ใช้ได้แค่ token ล่าสุด)
    await pool.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    await pool.query(
      'INSERT INTO password_resets (user_id, reset_token, expires_at) VALUES (?, ?, ?)',
      [userId, resetToken, expiresAt]
    );

    // ⭐️ SECURITY FIX (#5) — เลิก log token ลง console (แอดมินดู/ส่งลิงก์ผ่านแท็บ "รีเซ็ตรหัสผ่าน" ใน Settings แทน)
    console.log(`🔑 [password reset] สร้างคำขอให้ student_id=${student_id} แล้ว (หมดอายุ ${expiresAt.toISOString()})`);

    res.json({ message: "ถ้าข้อมูลถูกต้อง ระบบจะสร้างลิงก์รีเซ็ตรหัสผ่านให้ (ติดต่อเจ้าหน้าที่หากไม่ได้รับ)" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/auth/reset-token/:token', resetPasswordLimiter, async (req, res) => {
  try {
    const [tokens] = await pool.query(
      'SELECT 1 FROM password_resets WHERE reset_token = ? AND expires_at > NOW() AND used_at IS NULL',
      [req.params.token]
    );
    res.json(tokens.length > 0 ? { valid: true } : { valid: false, reason: 'expired or already used' });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/auth/reset-password', resetPasswordLimiter, async (req, res) => {
  const { reset_token, new_password } = req.body;

  if (!reset_token) return badRequest(res, "ไม่พบ token");

  // ⭐️ Sprint 2 — C4: Validate new password strength
  const passwordCheck = validatePasswordStrength(new_password);
  if (!passwordCheck.valid) {
    return badRequest(res, 'Password does not meet strength requirements', { requirements: passwordCheck.errors });
  }

  try {
    const [tokens] = await pool.query(
      'SELECT user_id FROM password_resets WHERE reset_token = ? AND expires_at > NOW() AND used_at IS NULL',
      [reset_token]
    );
    if (tokens.length === 0) return badRequest(res, "Token ไม่ถูกต้องหรือหมดอายุแล้ว");

    const userId = tokens[0].user_id;
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update both password and password_hash columns for compatibility
    // ⭐️ Security remediation — clear must_change_password + bump token_valid_after (invalidate stale tokens)
    await pool.query('UPDATE users SET password = ?, password_hash = ?, must_change_password = FALSE, token_valid_after = NOW() WHERE id = ?', [hashedPassword, hashedPassword, userId]);
    // ⭐️ token ใช้ครั้งเดียว — mark used_at กันเอาไปใช้ซ้ำ
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE reset_token = ?', [reset_token]);

    await logAudit(pool, 'PASSWORD_RESET', userId, { via: 'reset_token' }, 'USER', userId);

    res.json({ message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ FIX — คิวคำขอรีเซ็ตรหัสผ่านให้ ADMIN ดูและส่งลิงก์ให้นักเรียนเอง (แทนการต่อ SMS/อีเมลจริงซึ่งมีค่าใช้จ่าย)
// ADMIN เห็น token ได้เพราะเป็นคนกลางที่ต้องคัดลอกลิงก์ไปส่งให้นักเรียนเอง (ผ่าน LINE/บอกปากเปล่า)
app.get('/api/admin/password-resets', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pr.id, pr.user_id, pr.reset_token, pr.created_at, pr.expires_at,
              u.student_id, u.full_name, u.phone_number
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.used_at IS NULL AND pr.expires_at > NOW()
       ORDER BY pr.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/admin/password-resets/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT user_id FROM password_resets WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return notFound(res, "ไม่พบคำขอนี้ (อาจถูกใช้งานหรือลบไปแล้ว)");

    await pool.query('DELETE FROM password_resets WHERE id = ?', [req.params.id]);

    await logAudit(pool, 'REJECT_PASSWORD_RESET', req.user.id, { password_reset_id: req.params.id }, 'USER', existing[0].user_id);

    res.json({ message: "ปฏิเสธคำขอรีเซ็ตรหัสผ่านแล้ว ลิงก์นี้ใช้งานไม่ได้อีกต่อไป" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  const userId = req.params.id;
  // ⭐️ SECURITY FIX (#4) — เดิม endpoint นี้เปลี่ยนรหัสผ่านได้โดยไม่ต้องกรอกรหัสเดิม (ถ้า token ค้าง = โดนยึดบัญชี)
  //   ตัด new_password ออก บังคับให้เปลี่ยนรหัสผ่านทางเดียวคือ PUT /api/users/:id/change-password ที่ยืนยันรหัสเดิม
  const { full_name, phone_number } = req.body;

  // ⭐️ Task 1 audit — เดิมไม่มีการเช็ค ownership: user คนไหนก็แก้โปรไฟล์ id อื่นได้แค่เปลี่ยน :id ใน URL
  if (req.user.role !== 'ADMIN' && String(req.user.id) !== String(userId)) {
    return forbidden(res, "แก้ไขได้เฉพาะโปรไฟล์ของตัวเองเท่านั้น");
  }

  try {
    const conn = await pool.getConnection();

    // 1. เช็คก่อนว่าเบอร์โทรใหม่นี้ ไปซ้ำกับของคนอื่นในระบบไหม (ถ้ามีการเปลี่ยนเบอร์)
    let phoneChanged = false;
    if (phone_number) {
      const [existing] = await conn.query('SELECT id FROM users WHERE phone_number = ? AND id != ?', [phone_number, userId]);
      if (existing.length > 0) { conn.release(); return badRequest(res, "เบอร์โทรศัพท์นี้ถูกใช้งานโดยบัญชีอื่นแล้ว"); }

      const [current] = await conn.query('SELECT phone_number, full_name FROM users WHERE id = ?', [userId]);
      phoneChanged = current.length > 0 && current[0].phone_number !== phone_number;
    }

    // ⭐️ SECURITY FIX (#4) — อัปเดตแค่ชื่อ + เบอร์ ไม่แตะรหัสผ่านที่นี่แล้ว
    let query = 'UPDATE users SET full_name = COALESCE(?, full_name), phone_number = COALESCE(?, phone_number)';
    let params = [full_name, phone_number];

    query += ' WHERE id = ?';
    params.push(userId);

    await conn.query(query, params);

    // ⭐️ เบอร์โทรเปลี่ยน = อาจกระทบฐานข้อมูลรายชื่อภายนอก (Sheet) แจ้ง ADMIN ให้ไปปรับปรุงให้ตรงกัน
    if (phoneChanged) {
      const userRow = await getUserFullName(conn, userId);
      const msg = `${userRow[0]?.full_name || 'ผู้ใช้'} เปลี่ยนเบอร์โทรศัพท์เป็น ${phone_number} กรุณาตรวจสอบ/ปรับปรุงฐานข้อมูลรายชื่อ (Sheet) ให้ตรงกัน`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
      req.io.emit('notifications_updated', { message: msg });
    }

    conn.release();

    res.json({ message: "อัปเดตข้อมูลบัญชีสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Home page feature — อัปโหลดรูปโปรไฟล์ (self-only เหมือน PUT /profile ด้านบน, เก็บผ่าน
// Cloudinary/saveImage แบบเดียวกับรูปสลิป/เข้างาน)
app.post('/api/users/:id/profile-photo', uploadLimiter, profilePhotoUpload.single('photo'), async (req, res) => {
  const userId = req.params.id;
  if (req.user.role !== 'ADMIN' && String(req.user.id) !== String(userId)) {
    return forbidden(res, "แก้ไขได้เฉพาะโปรไฟล์ของตัวเองเท่านั้น");
  }
  if (!req.file) return badRequest(res, "ไม่พบไฟล์รูปภาพ");

  try {
    // 🐛 FIX — ตรวจว่าเป็นรูปจริง (sharp parse) + ขนาดสมเหตุผล เหมือนรูปสลิป/เข้างาน (Sprint 2 B9) —
    // เดิม MIME มาจาก client ประกาศเอง ปลอมได้ เก็บไฟล์ที่ไม่ใช่รูปจริงได้
    await validateImageDimensions(req.file.buffer, 200, 200, 4000, 4000);
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const photoUrl = await saveImage(req.file.buffer, 'profile-photos', `user_${userId}_${Date.now()}`, ext);
    await pool.query('UPDATE users SET profile_image_url = ? WHERE id = ?', [photoUrl, userId]);
    res.json({ photo_url: photoUrl });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/users', requireRole('ADMIN'), async (req, res) => {
  try {
    // ⭐️ ทริค: ใช้ AS username เพื่อหลอกหน้าเว็บ React ให้ยังใช้งานได้โดยไม่ต้องไปแก้โค้ดฝั่งหน้าเว็บอีกรอบ
    // คืนทุก role รวม MEMBER (สมัครผ่าน LINE) — ไม่มี WHERE role หรือ is_active กรองเลย
    // ⭐️ ไม่ใช้ SELECT * เพราะ users มี password/password_hash อยู่ในตาราง — ห้ามส่งออกไป frontend เด็ดขาด
    const [rows] = await pool.query(
      'SELECT id, student_id, student_id AS username, full_name, phone_number, role, points, line_user_id, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Export พนักงาน/สมาชิก CSV/Excel — ห้ามใส่ password/password_hash ลงไปเด็ดขาด (เหตุผลเดียวกับ
// GET /api/users ด้านบน) student_id ที่ผูก LINE แล้วส่งออกมาด้วยได้ (ดูอย่างเดียว) แต่ import กลับเข้า
// จะไม่แก้ student_id ของแถวที่ผูก LINE แล้วเช่นกัน (ดู PUT /api/users/:id ที่ล็อกฟิลด์นี้ไว้)
app.get('/api/users/export', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, student_id, full_name, phone_number, role, points, is_active FROM users ORDER BY created_at DESC'
    );
    await sendTableExport(res, {
      filename: `users-export_${Date.now()}`, sheetName: 'พนักงาน-สมาชิก',
      headers: ['id', 'student_id', 'full_name', 'phone_number', 'role', 'points', 'is_active'],
      rows: rows.map(r => [r.id, r.student_id, r.full_name, r.phone_number || '', r.role, r.points, r.is_active ? 1 : 0]),
    }, validateExportFormat(req, res));
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// ⭐️ Update — ใช้เลือก "พนักงานที่กำหนดกะได้" ในหน้าตารางเวลา (Schedules.tsx) เท่านั้น
//   คืนเฉพาะ CASHIER/MANAGER (คนที่ลงชื่อเข้า-ออกงาน/เปิดปิดกะจริง) ตัด ADMIN ออกทั้งหมด
app.get('/api/staff-list', requireRole('ADMIN', 'CASHIER', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, role FROM users WHERE role IN ('CASHIER', 'MANAGER') AND is_active = TRUE ORDER BY full_name`
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/users', requireRole('ADMIN'), async (req, res) => {
  const { username, password, full_name, role = 'CASHIER' } = req.body;
  try {
    // ⭐️ Sprint 2 — C4: Validate password strength
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return badRequest(res, 'Password does not meet strength requirements', { requirements: passwordCheck.errors });
    }

    // เข้ารหัสผ่านก่อนบันทึกลงฐานข้อมูล
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await pool.query(
      'INSERT INTO users (username, password, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [username, hashedPassword, hashedPassword, full_name, role]
    );

    // Audit log
    await logAudit(pool, 'CREATE_USER', req.user.id, { username, full_name, role }, 'USER', result.insertId);

    res.status(201).json({ id: result.insertId, message: "สร้างพนักงานสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return badRequest(res, "ชื่อผู้ใช้งานนี้มีในระบบแล้ว");
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/users/:id', requireRole('ADMIN'), async (req, res) => {
  const { full_name, student_id, phone_number, role, points, is_active } = req.body;
  if (!full_name || !full_name.trim() || !student_id || !student_id.trim() || !role) {
    return badRequest(res, 'กรุณาระบุชื่อ, รหัสนักศึกษา และบทบาทให้ครบถ้วน');
  }
  try {
    const [existingRows] = await pool.query('SELECT is_active, student_id, line_user_id FROM users WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) return notFound(res, 'ไม่พบผู้ใช้งานนี้');

    // 🐛 FIX — สมาชิกที่ผูกบัญชี LINE แล้ว (line_user_id ไม่ null) ห้ามแก้ student_id: สมัครผ่าน LIFF
    // ตอนแรกจะสร้าง student_id คู่กับ line_user_id ไว้แน่นแล้ว (memberController.registerViaLine)
    // ถ้าแอดมินพลาดแก้รหัสนี้ทีหลัง จะทำให้บัตรสมาชิก/QR ที่แคชเชียร์สแกน (ค้นด้วย student_id ตรงๆ)
    // ไม่ตรงกับตัวตนจริงของเจ้าของบัญชี LINE อีกต่อไป — ล็อกไว้ที่ backend ด้วย (กัน frontend เพี้ยน/ยิง
    // API ตรง ไม่ใช่ล็อกแค่ UI) ใช้ค่าจาก DB ทับ ไม่ error ทิ้งไปเงียบๆ ให้เปลี่ยนฟิลด์อื่นสำเร็จต่อได้
    const nextStudentId = existingRows[0].line_user_id ? existingRows[0].student_id : student_id;

    // ⭐️ is_active/points เป็น optional — ไม่ส่งมาก็คงค่าเดิมไว้ (ฟอร์มแก้ไขปัจจุบันไม่ได้มีสวิตช์ is_active)
    const nextIsActive = is_active !== undefined ? is_active : existingRows[0].is_active;

    await pool.query(
      'UPDATE users SET full_name = ?, student_id = ?, phone_number = ?, role = ?, points = COALESCE(?, points), is_active = ? WHERE id = ?',
      [full_name, nextStudentId, phone_number || null, role, points === undefined || points === null || points === '' ? null : points, nextIsActive, req.params.id]
    );

    await logAudit(pool, 'UPDATE_USER', req.user.id, { full_name, student_id, phone_number, role, points }, 'USER', req.params.id);

    const [rows] = await pool.query(
      'SELECT id, student_id, student_id AS username, full_name, phone_number, role, points, line_user_id, is_active, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: "อัปเดตข้อมูลผู้ใช้งานสำเร็จ", user: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return badRequest(res, 'รหัสนักศึกษาหรือเบอร์โทรนี้มีผู้ใช้งานอื่นใช้อยู่แล้ว');
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/users/:id/change-password', async (req, res) => {
  const { id } = req.params;
  const { current_password, new_password, confirm_password } = req.body;
  const user_id = req.user?.id;

  try {
    // Verify ownership (user can only change their own password)
    if (!user_id || parseInt(id) !== user_id) {
      return forbidden(res, 'Cannot change other user passwords');
    }

    // Get user
    const [users] = await pool.query('SELECT password, password_hash FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return notFound(res, 'User not found');
    }

    // Verify current password (support both 'password' and 'password_hash' columns for compatibility)
    const userPassword = users[0].password_hash || users[0].password;
    const currentMatch = await bcrypt.compare(current_password, userPassword);
    if (!currentMatch) {
      return unauthorized(res, 'Current password incorrect');
    }

    // Validate new password strength
    const passwordCheck = validatePasswordStrength(new_password);
    if (!passwordCheck.valid) {
      return badRequest(res, 'New password does not meet strength requirements', { requirements: passwordCheck.errors });
    }

    // Confirm passwords match
    if (new_password !== confirm_password) {
      return badRequest(res, 'Passwords do not match');
    }

    // Hash and update
    const newHash = await bcrypt.hash(new_password, 10);
    // Update both password and password_hash columns for compatibility
    // ⭐️ Security remediation — clear must_change_password + bump token_valid_after (invalidate stale tokens)
    await pool.query('UPDATE users SET password = ?, password_hash = ?, must_change_password = FALSE, token_valid_after = NOW() WHERE id = ?', [newHash, newHash, id]);

    // Audit log
    await logAudit(pool, 'PASSWORD_CHANGED', user_id, { via: 'change_password_modal' }, 'USER', id);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

app.put('/api/users/update-role', requireRole('ADMIN'), validateRequest(updateRoleValidator), async (req, res) => {
  const { student_id, role } = req.body;
  try {
    // ⭐️ Task 5 — เก็บ role เดิมไว้เทียบใน audit log
    const [oldRows] = await pool.query('SELECT id, role FROM users WHERE student_id = ?', [student_id]);

    // ⭐️ Security remediation — bump token_valid_after so tokens issued under the old role stop working
    const [result] = await pool.query(
      'UPDATE users SET role = ?, token_valid_after = NOW() WHERE student_id = ?',
      [role, student_id]
    );

    if (result.affectedRows === 0) {
      return notFound(res, "ไม่พบรหัสนักศึกษานี้ในระบบ");
    }

    await logAudit(pool, 'ROLE_CHANGE', req.user.id, { student_id, old_role: oldRows[0]?.role || null, new_role: role }, 'USER', oldRows[0]?.id || null);

    res.json({ message: `อัปเดตสิทธิ์ ${student_id} เป็น ${role} สำเร็จ` });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/users/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    // เราจะไม่ใช้ DELETE FROM users จริงๆ เพราะจะทำให้บิลเก่าพัง
    // แต่เราจะใช้วิธีปิดสถานะ (Soft Delete) แทน
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [req.params.id]);
    res.json({ message: "ระงับการใช้งานพนักงานสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ ปลดระงับ (unsuspend) — คืนสถานะ is_active=TRUE ให้ user ที่เคยถูก soft-delete
app.put('/api/users/:id/reactivate', requireRole('ADMIN'), async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE users SET is_active = TRUE WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return notFound(res, 'ไม่พบผู้ใช้งานนี้');
    await logAudit(pool, 'REACTIVATE_USER', req.user.id, { target_user_id: req.params.id }, 'USER', req.params.id);
    res.json({ message: 'ปลดระงับการใช้งานสำเร็จ' });
  } catch (error) {
    console.error('[500] reactivate user', error.message);
    serverError(res);
  }
});

// ⭐️ Hard delete ราย user — ลบถาวรจริง (ไม่ใช่ soft-delete) ใช้ FK-cleanup helper ชุดเดียวกับ
// bulk resetMembers เป๊ะ (adminController.cleanupUserReferences) ป้องกัน FK constraint พัง
// เหมือนที่เจอกับ bulk delete: ตัดสาย sales/orders/purchases, ลบ log ภายใน, และ (ถ้ายืนยัน) ลบ
// ประวัติทำงาน staff. Guard: ห้ามลบตัวเอง และห้ามลบ ADMIN คนสุดท้ายที่ยัง active อยู่
const { findWorkHistoryBlockers, cleanupUserReferences } = require('./src/controllers/adminController');
app.delete('/api/users/:id/permanent', requireRole('ADMIN'), async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return badRequest(res, 'id ไม่ถูกต้อง');
  if (targetId === req.user.id) return badRequest(res, 'ลบบัญชีตัวเองไม่ได้');
  const deleteWorkHistory = req.body?.deleteWorkHistory === true;

  const conn = await pool.getConnection();
  try {
    const [userRows] = await conn.query('SELECT id, role FROM users WHERE id = ?', [targetId]);
    if (userRows.length === 0) return notFound(res, 'ไม่พบผู้ใช้งานนี้');

    // ⭐️ กันลบ ADMIN คนสุดท้ายทิ้ง = ล็อกตัวเองออกจากระบบถาวร
    if (userRows[0].role === 'ADMIN') {
      const [[{ cnt }]] = await conn.query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'ADMIN' AND is_active = TRUE");
      if (cnt <= 1) return badRequest(res, 'ลบ ADMIN คนสุดท้ายไม่ได้ — ต้องมีผู้ดูแลระบบเหลืออย่างน้อย 1 คน');
    }

    // ⭐️ ประวัติทำงาน staff (attendance/shifts/schedules, NOT NULL) — ถ้ามีและยังไม่ยืนยัน ให้ถามก่อน
    const blockers = await findWorkHistoryBlockers(conn, [targetId]);
    if (blockers.length > 0 && !deleteWorkHistory) {
      return res.json({
        needsConfirmation: true,
        blockedMembers: blockers,
        message: 'ผู้ใช้คนนี้มีประวัติการทำงาน (เข้า-ออกงาน/กะ/ตารางเวร) ติดอยู่ — ยืนยันจะลบประวัติการทำงานทิ้งไปด้วยหรือไม่?',
      });
    }

    await conn.beginTransaction();
    await cleanupUserReferences(conn, [targetId], { deleteWorkHistory });
    await conn.query('DELETE FROM users WHERE id = ?', [targetId]);
    await conn.commit();

    await logAudit(pool, 'HARD_DELETE_USER', req.user.id, { target_user_id: targetId, deleteWorkHistory }, 'USER', null);
    res.json({ success: true, message: 'ลบบัญชีผู้ใช้ถาวรแล้ว' });
  } catch (error) {
    await conn.rollback();
    console.error('[hardDeleteUser] FK/DB error:', error.code, error.message);
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
      return conflict(res, 'ลบไม่สำเร็จ — ยังมีข้อมูลอ้างอิงที่ระบบจัดการอัตโนมัติไม่ได้', { detail: error.message });
    }
    serverError(res);
  } finally {
    conn.release();
  }
});

app.post('/api/users/sync-csv', requireRole('ADMIN'), async (req, res) => {
  const { rows, dry_run } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return badRequest(res, "รายชื่อจาก CSV ว่างเปล่า ยกเลิกการซิงค์เพื่อความปลอดภัย");
  }

  const usernames = rows.map(r => r.username).filter(Boolean);
  if (usernames.length === 0) return badRequest(res, "ไม่พบ username ในไฟล์");

  try {
    const placeholders = usernames.map(() => '?').join(',');

    // 1. ใครอยู่ใน CSV แต่ไม่มีในระบบ → สร้างใหม่ (รวมทั้ง inactive ด้วย เพราะอาจถูก soft-delete ไปก่อน)
    const [existing] = await pool.query(`SELECT student_id, is_active FROM users WHERE student_id IN (${placeholders})`, usernames);
    const existingSet = new Set(existing.map(u => u.student_id));
    // ⭐️ คนที่มีอยู่แล้วแต่ถูก soft-delete → reactivate แทนสร้างใหม่
    const inactiveInCsv = existing.filter(u => !u.is_active).map(u => u.student_id);
    const toCreate = rows.filter(r => r.username && !existingSet.has(r.username));

    // 2. ใครอยู่ในระบบแต่ไม่มีใน CSV (ไม่ใช่ ADMIN) → ปิดการใช้งาน
    const [toDeactivate] = await pool.query(
      `SELECT id, student_id AS username, full_name, role FROM users WHERE role != 'ADMIN' AND is_active = TRUE AND student_id NOT IN (${placeholders})`,
      usernames
    );

    const toReactivate = existing.filter(u => !u.is_active);

    if (dry_run) return res.json({ to_create: toCreate, to_reactivate: toReactivate, to_deactivate: toDeactivate });

    // สร้างสมาชิกใหม่ (password = phone_number)
    let created_count = 0;
    for (const row of toCreate) {
      const phone = (row.phone_number || row.username).trim();
      const hashed = await bcrypt.hash(phone, 10);
      await pool.query(
        'INSERT INTO users (student_id, full_name, phone_number, password, role, is_active) VALUES (?, ?, ?, ?, \'MEMBER\', TRUE)',
        [row.username.trim(), (row.full_name || row.username).trim(), row.phone_number?.trim() || null, hashed]
      );
      created_count++;
    }

    // ⭐️ reactivate คนที่เคยถูก soft-delete + อัปเดตชื่อ/เบอร์
    let reactivated_count = 0;
    for (const u of toReactivate) {
      const row = rows.find(r => r.username === u.student_id);
      if (!row) continue;
      await pool.query(
        'UPDATE users SET is_active = TRUE, full_name = ?, phone_number = ? WHERE student_id = ?',
        [(row.full_name || u.student_id).trim(), row.phone_number?.trim() || null, u.student_id]
      );
      reactivated_count++;
    }

    // ปิดการใช้งานคนที่ไม่มีใน CSV
    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map(u => u.id);
      await pool.query(`UPDATE users SET is_active = FALSE WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }

    res.json({
      message: `เพิ่มใหม่ ${created_count} คน, เปิดใช้งานคืน ${reactivated_count} คน, ปิดการใช้งาน ${toDeactivate.length} คน`,
      created_count, reactivated_count, deactivated_count: toDeactivate.length
    });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// 2. SHIFT MANAGEMENT (ระบบจัดการกะการขาย)
// =========================================
app.post('/api/shifts/open', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id: bodyCashierId, opening_cash, cash_breakdown, open_photo } = req.body;
  // 🐛 FIX — ไม่เชื่อ cashier_id จาก body (cashier เปิดกะให้คนอื่นได้) — CASHIER ใช้ตัวตนจาก JWT
  // เสมอ; ADMIN ยังเปิดให้ cashier คนอื่นได้ตามปกติ (จัดการกะ)
  const cashier_id = req.user.role === 'ADMIN' ? bodyCashierId : req.user.id;
  if (!cashier_id || opening_cash === undefined) {
    return badRequest(res, "กรุณาระบุรหัสแคชเชียร์และเงินตั้งต้น");
  }
  if (!open_photo) return badRequest(res, "กรุณาถ่ายรูปยืนยันสถานที่ก่อนเปิดกะ");

  try {
    // ⭐️ Sprint 2 — B8: Check no open shift for this cashier today (Bangkok timezone)
    const today = getTodayBangkok();
    const todayStr = dateToString(today);

    // 🐛 FIX (root cause) — เดิม CONVERT_TZ(...,'+00:00','+07:00') แปลงเวลาซ้ำ (opened_at เป็น
    // TIMESTAMP + session tz +07:00 จัดการให้แล้ว) บวก 7 ชม.เกิน ทำให้ช่วง 17:00–23:59 ทุกวัน เช็ค
    // กะซ้อนพลาด (มองว่า opened_at อยู่ "พรุ่งนี้" เทียบกับ todayStr ที่ถูกต้อง) เปิดกะซ้ำได้โดยระบบไม่รู้
    const [existing] = await pool.query(
      "SELECT id FROM shifts WHERE cashier_id = ? AND DATE(opened_at) = ? AND status = 'OPEN'",
      [cashier_id, todayStr]
    );

    if (existing.length > 0) {
      return badRequest(res, "แคชเชียร์คนนี้มีกะที่เปิดอยู่แล้วในวันนี้ (เวลาประเทศไทย) ต้องปิดกะเดิมก่อน");
    }

    // ⭐️ Sprint 2 — B6: Store idempotency_key
    const idempotencyKey = req.headers['idempotency-key'];
    const [result] = await pool.query(
      'INSERT INTO shifts (cashier_id, opening_cash, opening_cash_breakdown, open_photo, idempotency_key, opened_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [cashier_id, opening_cash, cash_breakdown ? JSON.stringify(cash_breakdown) : null, open_photo, idempotencyKey || null]
    );
    res.status(201).json({ shift_id: result.insertId, message: "เปิดกะการขายสำเร็จ", opened_at: formatBangkokTime(new Date()) });
  } catch (error) {
    console.error('[500]', error.message);

    // 🐛 FIX — retry หลัง server restart: แคช idempotency หาย แต่กะเคยเปิดแล้ว (UNIQUE shifts.idempotency_key)
    // → ตอบ "สำเร็จซ้ำ" พร้อม shift_id เดิม แทน error 500 (กันเปิดกะซ้ำ)
    if (isIdempotentDuplicate(error)) {
      const [existingShifts] = await pool.query('SELECT id FROM shifts WHERE idempotency_key = ?', [idempotencyKey || null]);
      if (existingShifts.length > 0) return res.status(201).json({ shift_id: existingShifts[0].id, message: 'เปิดกะการขายสำเร็จ (request ซ้ำ — ไม่ได้เปิดซ้ำ)', duplicated: true, opened_at: formatBangkokTime(new Date()) });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }

    serverError(res);
  }
});

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย และไม่เช็ค ownership — ใครก็ตามที่ login แล้ว
// (รวม MEMBER) ใส่ cashier_id คนอื่นมาดูยอดเงินสดปิดกะของ cashier คนนั้นได้ ล็อกเป็น CASHIER/ADMIN
// เท่านั้น และ CASHIER ดูได้แค่ของตัวเอง (ADMIN ดูของใครก็ได้ เผื่อใช้ตรวจสอบ)
app.get('/api/shifts/last-closed', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id } = req.query;
  if (!cashier_id) return badRequest(res, "กรุณาระบุ cashier_id");
  if (req.user.role !== 'ADMIN' && Number(cashier_id) !== req.user.id) {
    return forbidden(res, "ดูได้เฉพาะยอดปิดกะของตัวเองเท่านั้น");
  }
  try {
    const [rows] = await pool.query(
      "SELECT actual_cash, closing_cash_breakdown FROM shifts WHERE cashier_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1",
      [cashier_id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Sprint 1 — C1 audit finding: เหตุผลเดียวกับ /api/shifts/last-closed ด้านบน (`SELECT *` ด้วย —
// เผยข้อมูลกะที่กำลังเปิดของ cashier คนอื่นทั้งแถว ถ้าไม่ล็อก)
app.get('/api/shifts/current', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id } = req.query;
  if (req.user.role !== 'ADMIN' && Number(cashier_id) !== req.user.id) {
    return forbidden(res, "ดูได้เฉพาะกะของตัวเองเท่านั้น");
  }
  try {
    // ⭐️ แก้เป็น 'OPEN' (ฟันหนูเดี่ยว)
    const [rows] = await pool.query(
      "SELECT * FROM shifts WHERE cashier_id = ? AND status = 'OPEN'",
      [cashier_id]
    );
    if (rows.length === 0) return res.json(null);

    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});
app.post('/api/shifts/close', requireRole('CASHIER', 'ADMIN'), validateRequest(shiftCloseValidator), async (req, res) => {
  // ⭐️ Sprint 2 — D1: Dual-Control Shift Close: Cashier initiates close request (status → PENDING_CLOSE)
  // Manager must approve via PUT /api/shifts/:id/approve before shift is fully closed
  const { cashier_id: bodyCashierId, actual_cash, note, cash_breakdown, close_photo, discrepancy_category } = req.body;
  // 🐛 FIX — ไม่เชื่อ cashier_id จาก body: CASHIER ปิดได้เฉพาะกะตัวเอง (JWT); ADMIN ปิดให้คนอื่นได้
  const cashier_id = req.user.role === 'ADMIN' ? bodyCashierId : req.user.id;
  if (!cashier_id) return badRequest(res, "กรุณาระบุรหัสแคชเชียร์");
  if (!close_photo) return badRequest(res, "กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ");

  try {
    // 🐛 FIX — เลือกกะที่เปิดล่าสุด (เดิมไม่มี ORDER BY — ถ้ามีกะ OPEN ค้างข้ามวันหลายใบ จะปิดผิดใบ)
    const [shifts] = await pool.query(
      "SELECT id, opening_cash, opened_at FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
      [cashier_id]
    );

    if (shifts.length === 0) {
      return notFound(res, "ไม่พบกะที่กำลังเปิดอยู่สำหรับแคชเชียร์คนนี้");
    }

    const currentShift = shifts[0];

    // สรุปยอดขายทุกช่องทางในกะนี้ (ไม่ใช่แค่เงินสด) — นับเฉพาะบิลที่ COMPLETED
    const [sales] = await pool.query(
      `SELECT
         COUNT(*) as bill_count,
         COALESCE(SUM(total_amount), 0) as total_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) as cash_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END), 0) as qr_sales,
         COALESCE(SUM(CASE WHEN payment_method NOT IN ('CASH','QR') THEN total_amount ELSE 0 END), 0) as other_sales
       FROM sales
       WHERE cashier_id = ? AND status = 'COMPLETED' AND created_at >= ?`,
      [cashier_id, currentShift.opened_at]
    );

    const s = sales[0];
    const totalCashSales = Number(s.cash_sales);
    // B3 — เทียบ/คำนวณส่วนต่างเงินสดในหน่วยสตางค์ กันพลาดตรง threshold ±20/±100 บาท จาก float drift
    const expectedCashSatang = toSatang(currentShift.opening_cash) + toSatang(totalCashSales);
    const expected_cash = fromSatang(expectedCashSatang);
    const difference = fromSatang(toSatang(actual_cash) - expectedCashSatang);

    // tolerance ส่วนต่างเงินสด ±20 บาทถือว่าปกติ เกินกว่านี้บังคับกรอก note อธิบาย
    const CASH_DIFF_TOLERANCE = 20;
    if (Math.abs(difference) > CASH_DIFF_TOLERANCE && !(note && note.trim())) {
      return badRequest(res, `ส่วนต่างเงินสด ${difference > 0 ? 'เกิน' : 'ขาด'} ฿${Math.abs(difference).toFixed(2)} เกินเกณฑ์ปกติ (±${CASH_DIFF_TOLERANCE}) กรุณาระบุหมายเหตุอธิบายก่อนปิดกะ`);
    }

    // ⭐️ Sprint 2 — D1: ALL closes now go to PENDING_CLOSE (dual-control workflow)
    // Manager must verify and approve via PUT /api/shifts/:id/approve
    const idempotencyKey = req.headers['idempotency-key'];
    await pool.query(
      `UPDATE shifts
       SET expected_cash = ?, actual_cash = ?, difference = ?, status = 'PENDING_CLOSE',
           discrepancy_amount = ?, discrepancy_flag = 0, note = ?, discrepancy_category = ?,
           closing_cash_breakdown = ?, close_photo = ?, idempotency_key = ?
       WHERE id = ?`,
      [expected_cash, actual_cash, difference, Math.abs(difference), note || null, discrepancy_category || null,
       cash_breakdown ? JSON.stringify(cash_breakdown) : null, close_photo, idempotencyKey || null, currentShift.id]
    );

    // Emit Socket.io event to notify managers
    req.io.emit('shift_pending_close', {
      shift_id: currentShift.id,
      cashier_id,
      timestamp: new Date(),
      message: `แคชเชียร์ ${cashier_id} ขอปิดกะ (รอการอนุมัติ)`,
      variance: Math.abs(difference)
    });

    await logAudit(pool, 'CLOSE_SHIFT_PENDING_CLOSE', req.user.id, { discrepancy: difference, expected_cash, actual_cash, variance: Math.abs(difference) }, 'SHIFT', currentShift.id);

    // ⭐️ Day 3 — end-of-shift stock sweep: ปิดกะไม่ได้ตัดสต๊อกเอง (ต่างจาก checkout/sync-offline ที่
    // แจ้งเฉพาะตอน "ข้าม threshold ครั้งแรก") จึงเช็คสต๊อกปัจจุบันทั้งร้านทีเดียวแทน รวมเป็น LINE alert
    // เดียวถ้ามีของใกล้หมด — เตือนซ้ำได้ทุกครั้งที่ปิดกะแม้ยังไม่มีใครตัดสต๊อกเพิ่มตั้งแต่ครั้งก่อน
    // ไม่รอ (await) ก่อนตอบ response — cashier ไม่ควรรอ LINE API เพื่อดูผลปิดกะ
    pool.query('SELECT name, stock, min_stock FROM products WHERE is_active = TRUE AND stock <= min_stock ORDER BY stock ASC')
      .then(([lowStockRows]) => {
        if (lowStockRows.length > 0) {
          sendLowStockAlert(lowStockRows).catch(err => console.error('[LINE] sendLowStockAlert error:', err.message));
        }
      })
      .catch(err => console.error('[shift close] low-stock sweep query failed:', err.message));

    res.json({
      message: "ส่งคำขอปิดกะแล้ว รอการอนุมัติจากผู้จัดการ",
      shift_id: currentShift.id,
      status: 'PENDING_CLOSE',
      variance: Math.abs(difference),
      summary: {
        opening_cash: Number(currentShift.opening_cash),
        opened_at: currentShift.opened_at,
        bill_count: Number(s.bill_count),
        total_sales: Number(s.total_sales),
        cash_sales: totalCashSales,
        expected_cash: expected_cash,
        actual_cash: Number(actual_cash),
        difference: difference
      }
    });

  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/shifts/:id/approve', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { approval_notes, password } = req.body;
  const shiftId = req.params.id;
  const approverId = req.user.id;

  if (!approval_notes || !approval_notes.trim()) {
    return badRequest(res, "กรุณาระบุหมายเหตุการอนุมัติ");
  }
  if (!password) {
    return badRequest(res, "กรุณาระบุรหัสผ่านสำหรับยืนยันตัวตน");
  }

  try {
    // Verify password of approver
    const [users] = await pool.query("SELECT password FROM users WHERE id = ?", [approverId]);
    if (users.length === 0) {
      return unauthorized(res, "ไม่พบผู้ใช้นี้");
    }

    const passwordMatch = await bcrypt.compare(password, users[0].password);
    if (!passwordMatch) {
      return unauthorized(res, "รหัสผ่านไม่ถูกต้อง");
    }

    // Verify shift exists and is PENDING_CLOSE
    const [shifts] = await pool.query(
      "SELECT id, cashier_id, status FROM shifts WHERE id = ?",
      [shiftId]
    );
    if (shifts.length === 0) {
      return notFound(res, "ไม่พบกะนี้");
    }

    const shift = shifts[0];
    if (shift.status !== 'PENDING_CLOSE') {
      return badRequest(res, `กะนี้ไม่ได้อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${shift.status})`);
    }

    // Approve close: PENDING_CLOSE → CLOSED
    await pool.query(
      `UPDATE shifts
       SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP,
           approved_by = ?, approval_notes = ?, approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [approverId, approval_notes, shiftId]
    );

    // Audit log
    await logAudit(pool, 'APPROVE_SHIFT_CLOSE', approverId, { approval_notes }, 'SHIFT', shiftId);

    // Notify cashier
    req.io.to(`user_${shift.cashier_id}`).emit('shift_approved', {
      shift_id: shiftId,
      status: 'CLOSED',
      message: "คำขอปิดกะของคุณได้รับการอนุมัติแล้ว",
      approved_at: new Date()
    });

    res.json({
      message: "อนุมัติปิดกะสำเร็จ",
      shift_id: shiftId,
      status: 'CLOSED',
      approved_at: formatBangkokTime(new Date())
    });
  } catch (error) {
    console.error("Error approving shift:", error);
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/shifts/:id/reject', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { reason } = req.body;
  const shiftId = req.params.id;
  const rejectorId = req.user.id;

  if (!reason || !reason.trim()) {
    return badRequest(res, "กรุณาระบุเหตุผลในการปฏิเสธ");
  }

  try {
    // Verify shift exists and is PENDING_CLOSE
    const [shifts] = await pool.query(
      "SELECT id, cashier_id, status FROM shifts WHERE id = ?",
      [shiftId]
    );
    if (shifts.length === 0) {
      return notFound(res, "ไม่พบกะนี้");
    }

    const shift = shifts[0];
    if (shift.status !== 'PENDING_CLOSE') {
      return badRequest(res, `กะนี้ไม่ได้อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${shift.status})`);
    }

    // Reject close: PENDING_CLOSE → OPEN (reopen for cashier correction)
    // Clear close-related data
    await pool.query(
      `UPDATE shifts
       SET status = 'OPEN', actual_cash = NULL, difference = NULL,
           close_photo = NULL, closing_cash_breakdown = NULL,
           approval_notes = ?, discrepancy_category = NULL
       WHERE id = ?`,
      [reason, shiftId]
    );

    // Audit log
    await logAudit(pool, 'REJECT_SHIFT_CLOSE', rejectorId, { reason }, 'SHIFT', shiftId);

    // Notify cashier
    req.io.to(`user_${shift.cashier_id}`).emit('shift_rejected', {
      shift_id: shiftId,
      status: 'OPEN',
      reason,
      message: `คำขอปิดกะของคุณถูกปฏิเสธ: ${reason}`,
      rejected_at: new Date()
    });

    res.json({
      message: "ปฏิเสธการปิดกะเรียบร้อย กะถูกเปิดใหม่สำหรับแคชเชียร์ดำเนินการอีกครั้ง",
      shift_id: shiftId,
      status: 'OPEN',
      reason
    });
  } catch (error) {
    console.error("Error rejecting shift:", error);
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/shifts/pending', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        sh.id, sh.cashier_id, u.full_name as cashier_name,
        sh.opening_cash, sh.expected_cash, sh.actual_cash,
        sh.difference, sh.discrepancy_amount as variance,
        sh.opened_at, sh.note, sh.close_photo, sh.discrepancy_category
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'PENDING_CLOSE'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching pending shifts:", error);
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// 2.1 SCHEDULES / ATTENDANCE (หมวด 7 — ตารางเวลา + เช็คมาสาย)
// =========================================

app.post('/api/schedules', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { cashier_id, work_date, expected_start, expected_end } = req.body;
  if (!cashier_id || !work_date || !expected_start || !expected_end) {
    return badRequest(res, "กรุณาระบุ cashier_id, work_date, expected_start, expected_end ให้ครบ");
  }
  try {
    // ⭐️ กันหลังบ้าน — เผื่อมีคนยิง API ตรงๆ ด้วย cashier_id ที่ไม่ใช่ CASHIER/MANAGER (เช่น ADMIN/MEMBER)
    //   ข้าม dropdown /staff-list ที่กรองไว้แล้วฝั่ง UI ต้องเช็คซ้ำที่นี่ด้วย
    const [target] = await getUserRole(pool, cashier_id);
    if (!target) return notFound(res, 'ไม่พบพนักงานคนนี้');
    if (!['CASHIER', 'MANAGER'].includes(target.role)) {
      return badRequest(res, 'กำหนดตารางเวลาได้เฉพาะพนักงาน CASHIER หรือ MANAGER เท่านั้น');
    }

    // ⭐️ upsert แบบ manual (ไม่มี unique key): มีอยู่แล้ว = update, ยังไม่มี = insert
    const [existing] = await pool.query('SELECT id FROM schedules WHERE cashier_id = ? AND work_date = ?', [cashier_id, work_date]);
    if (existing.length > 0) {
      await pool.query('UPDATE schedules SET expected_start = ?, expected_end = ? WHERE id = ?', [expected_start, expected_end, existing[0].id]);
      return res.json({ message: "แก้ไขตารางเวลาสำเร็จ", id: existing[0].id });
    }
    const [result] = await pool.query(
      'INSERT INTO schedules (cashier_id, work_date, expected_start, expected_end) VALUES (?, ?, ?, ?)',
      [cashier_id, work_date, expected_start, expected_end]
    );
    res.status(201).json({ message: "ตั้งตารางเวลาสำเร็จ", id: result.insertId });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/schedules/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return notFound(res, 'ไม่พบตารางเวลานี้');
    res.json({ message: 'ลบตารางเวลาสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/schedules', requireRole('ADMIN', 'CASHIER', 'MANAGER'), async (req, res) => {
  try {
    const { cashier_id, date } = req.query;
    let query = `SELECT s.id, s.cashier_id, DATE_FORMAT(s.work_date, '%Y-%m-%d') as work_date, s.expected_start, s.expected_end, u.full_name FROM schedules s JOIN users u ON s.cashier_id = u.id WHERE 1=1`;
    const params = [];
    if (cashier_id) { query += ' AND s.cashier_id = ?'; params.push(cashier_id); }
    if (date) { query += ' AND s.work_date = ?'; params.push(date); }
    query += ' ORDER BY s.work_date DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Security remediation — เดิมมีแค่ authenticateToken (global) ไม่มี requireRole เลย ทำให้ MEMBER
// เรียกตรงได้ทั้งที่หน้า Shift (ที่ใช้ endpoint นี้) จำกัดเฉพาะ ADMIN/CASHIER ฝั่ง frontend เท่านั้น
app.post('/api/attendance/upload-photo', requireRole('CASHIER', 'MANAGER'), uploadLimiter, shiftPhotoUpload.single('photo'), async (req, res) => {
  if (!req.file) return badRequest(res, "ไม่พบไฟล์รูปภาพ");
  try {
    // Get type from query param: ?type=clock-in or ?type=clock-out (default: clock-out)
    const photoType = req.query.type || 'clock-out';
    const bangkokDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const year = bangkokDate.getFullYear();
    const month = String(bangkokDate.getMonth() + 1).padStart(2, '0');
    const day = String(bangkokDate.getDate()).padStart(2, '0');
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const base = `${year}-${month}-${day}_${Date.now()}_${req.user?.id || 'x'}`;
    // ⭐️ อัปโหลดขึ้น Cloudinary (หรือดิสก์ถ้า dev) → คืน URL/พาธเต็ม
    const photoUrl = await saveImage(req.file.buffer, `shift-photos/${photoType}/${year}-${month}-${day}`, base, ext);
    res.json({ photo_url: photoUrl });
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

// ⭐️ Sprint 0 — A3: เดิม requireRole('ADMIN') เท่านั้น ทั้งที่ query ข้างในใช้ req.user.id (self-scoped)
// และ Shift.tsx (clock-in flow) เรียกใช้จากทั้ง CASHIER และ ADMIN — ทำให้ CASHIER check-in ไม่ได้เลย
// ⭐️ Update — clock-in/out เปลี่ยนสิทธิ์เป็น CASHIER + MANAGER เท่านั้น (ADMIN ไม่ต้องลงชื่อเข้า-ออกงานอีกต่อไป)
app.post('/api/attendance/check-in', requireRole('CASHIER', 'MANAGER'), async (req, res) => {
  const { check_in_photo } = req.body;
  if (!check_in_photo) return badRequest(res, "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อเข้างาน");
  try {
    const [openRows] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL`,
      [req.user.id]
    );
    // ⭐️ ถ้าลงชื่อเข้างานวันนี้แล้วและยังไม่ได้ออกงาน ห้ามลงชื่อซ้ำ
    if (openRows.length > 0) return badRequest(res, "ลงชื่อเข้างานวันนี้ไปแล้ว ยังไม่ได้ลงชื่อออกงาน");

    const [result] = await pool.query('INSERT INTO attendance (user_id, check_in_photo) VALUES (?, ?)', [req.user.id, check_in_photo]);
    res.status(201).json({ message: "ลงชื่อเข้างานสำเร็จ", id: result.insertId });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Sprint 0 — A3: เหตุผลเดียวกับ check-in ด้านบน
app.put('/api/attendance/check-out', requireRole('CASHIER', 'MANAGER'), async (req, res) => {
  const { check_out_photo } = req.body;
  if (!check_out_photo) return badRequest(res, "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อออกงาน");
  try {
    // ⭐️ เช็คทั้ง CURDATE() (Bangkok หลัง fix tz) และ CONVERT_TZ (กัน row เก่าที่เก็บเป็น UTC)
    const [rows] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL
       ORDER BY check_in DESC LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) return badRequest(res, "ยังไม่ได้ลงชื่อเข้างานวันนี้");

    await pool.query('UPDATE attendance SET check_out = NOW(), check_out_photo = ? WHERE id = ?', [check_out_photo, rows[0].id]);
    res.json({ message: "ลงชื่อออกงานสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/attendance/today', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL
       ORDER BY check_in DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/attendance', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { user_id, month } = req.query;

    // ⭐️ รวม attendance (ADMIN ลงชื่อเข้า-ออกงาน) + shifts (CASHIER เปิด-ปิดกะ) เป็นรายการเดียว
    // ทั้งคู่มีรูปเข้า/ออก + เวลาเข้า/ออก แค่คนละตาราง — tag source แยกประเภท
    let attFilter = '';
    let shiftFilter = '';
    const attParams = [];
    const shiftParams = [];
    if (user_id) { attFilter += ' AND a.user_id = ?'; attParams.push(user_id); shiftFilter += ' AND sh.cashier_id = ?'; shiftParams.push(user_id); }
    if (month) { attFilter += ` AND DATE_FORMAT(a.check_in, '%Y-%m') = ?`; attParams.push(month); shiftFilter += ` AND DATE_FORMAT(sh.opened_at, '%Y-%m') = ?`; shiftParams.push(month); }

    const query = `
      SELECT * FROM (
        SELECT a.id, 'ATTENDANCE' as source, a.user_id, u.full_name, u.role,
               a.check_in, a.check_out, a.check_in_photo, a.check_out_photo, a.note
        FROM attendance a JOIN users u ON a.user_id = u.id
        WHERE 1=1 ${attFilter}
        UNION ALL
        SELECT sh.id, 'SHIFT' as source, sh.cashier_id as user_id, u.full_name, u.role,
               sh.opened_at as check_in, sh.closed_at as check_out, sh.open_photo as check_in_photo, sh.close_photo as check_out_photo, sh.note
        FROM shifts sh JOIN users u ON sh.cashier_id = u.id
        WHERE 1=1 ${shiftFilter}
      ) combined
      ORDER BY check_in DESC LIMIT 200
    `;
    const [rows] = await pool.query(query, [...attParams, ...shiftParams]);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.put('/api/attendance/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { check_in, check_out, note, source } = req.body;
  try {
    if (source === 'SHIFT') {
      // แก้กะ (CASHIER): map check_in->opened_at, check_out->closed_at
      await pool.query(
        'UPDATE shifts SET opened_at = COALESCE(?, opened_at), closed_at = COALESCE(?, closed_at), note = COALESCE(?, note) WHERE id = ?',
        [check_in || null, check_out || null, note || null, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE attendance SET check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out), note = COALESCE(?, note) WHERE id = ?',
        [check_in || null, check_out || null, note || null, req.params.id]
      );
    }
    res.json({ message: "แก้ไขข้อมูลลงเวลาสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/attendance/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { source } = req.query;
  try {
    if (source === 'SHIFT') {
      // ไม่ลบ shift จริง แค่ reset เวลาออกงานออก (กัน FK issues)
      await pool.query('UPDATE shifts SET closed_at = NULL, status = \'OPEN\' WHERE id = ?', [req.params.id]);
    } else {
      await pool.query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    }
    res.json({ message: "ลบรายการสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ ตรรกะตัดออกงาน/ปิดกะอัตโนมัติ (แยกเป็นฟังก์ชันเพื่อให้ทั้ง endpoint และ cron เรียกใช้ร่วมกันได้)
async function runAutoCheckoutStale(io) {
  // ⭐️ attendance ที่ค้าง (ADMIN ลืมลงชื่อออกงานข้ามวัน)
  const [staleAttendance] = await pool.query(
    `SELECT a.id, a.user_id, u.full_name FROM attendance a JOIN users u ON a.user_id = u.id WHERE a.check_out IS NULL AND DATE(a.check_in) < CURDATE()`
  );
  for (const a of staleAttendance) {
    await pool.query(`UPDATE attendance SET check_out = check_in, note = 'ระบบตัดออกงานอัตโนมัติ (ลืมลงชื่อออก) กรุณาตรวจสอบ' WHERE id = ?`, [a.id]);
    const msg = `${a.full_name} ลืมลงชื่อออกงาน ระบบตัดให้อัตโนมัติแล้ว กรุณาตรวจสอบ/แก้ไขเวลาที่ถูกต้อง`;
    await pool.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
  }

  // ⭐️ กะที่ค้าง (CASHIER ลืมปิดกะข้ามวัน) — ปิดให้โดยสมมติว่าเงินตรง (ไม่รู้ยอดจริง) ต้องให้ ADMIN ตรวจสอบทีหลัง
  const [staleShifts] = await pool.query(
    `SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name FROM shifts sh JOIN users u ON sh.cashier_id = u.id WHERE sh.status = 'OPEN' AND DATE(sh.opened_at) < CURDATE()`
  );
  for (const sh of staleShifts) {
    const [salesRows] = await pool.query(
      // 🐛 FIX — filter status='COMPLETED' ด้วย (เดิมนับ VOIDED/HOLD เข้าเงินสดคาดการณ์) ให้ตรงกับ
      // สูตรปิดกะปกติ (manual close) ที่ filter ไว้แล้ว
      `SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE cashier_id = (SELECT cashier_id FROM shifts WHERE id = ?) AND payment_method = 'CASH' AND status = 'COMPLETED' AND created_at >= ?`,
      [sh.id, sh.opened_at]
    );
    const expectedCash = Number(sh.opening_cash) + Number(salesRows[0].total);
    await pool.query(
      `UPDATE shifts SET status = 'CLOSED', closed_at = NOW(), expected_cash = ?, actual_cash = ?, difference = 0, auto_closed = TRUE, note = 'ระบบปิดกะอัตโนมัติ (ลืมปิดกะ) สมมติเงินตรงตามยอดคาดการณ์ กรุณาตรวจนับจริงย้อนหลัง' WHERE id = ?`,
      [expectedCash, expectedCash, sh.id]
    );
    const msg = `กะของ ${sh.full_name} ลืมปิดข้ามวัน ระบบปิดให้อัตโนมัติแล้ว (สมมติเงินตรง) กรุณาตรวจนับเงินจริงย้อนหลัง`;
    await pool.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
  }

  if (io && staleAttendance.length + staleShifts.length > 0) io.emit('notifications_updated', { message: 'มีการตัดออกงาน/ปิดกะอัตโนมัติ กรุณาตรวจสอบ' });

  return { attendance_closed: staleAttendance.length, shifts_closed: staleShifts.length };
}

app.post('/api/attendance/auto-checkout-stale', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await runAutoCheckoutStale(req.io);
    res.json({ message: "ตรวจสอบและตัดออกอัตโนมัติเรียบร้อย", ...result });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/holidays', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { holiday_date, note } = req.body;
  if (!holiday_date) return badRequest(res, "กรุณาระบุวันที่");
  try {
    await pool.query('INSERT INTO holidays (holiday_date, note) VALUES (?, ?)', [holiday_date, note || null]);
    res.status(201).json({ message: "เพิ่มวันหยุดสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return badRequest(res, "วันที่นี้ถูกตั้งเป็นวันหยุดไปแล้ว");
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/holidays', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date, note FROM holidays ORDER BY holiday_date DESC");
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Phase A (refactor) — /api/reports/attendance ย้ายไปที่ reportController.js/reportRoutes.js แล้ว

app.post('/api/orders/:id/assign', requireRole('ADMIN', 'CASHIER', 'MANAGER'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, assigned_to, status FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) { await conn.rollback(); return notFound(res, "ไม่พบออเดอร์"); }

    const order = rows[0];
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) { await conn.rollback(); return badRequest(res, "ออเดอร์นี้ปิดแล้ว"); }
    if (order.assigned_to && order.assigned_to !== req.user.id) {
      // ดึงชื่อคนที่ล็อคไปแล้ว
      const assignee = await getUserFullName(conn, order.assigned_to);
      await conn.rollback();
      return conflict(res, `ออเดอร์นี้ถูกรับงานโดย ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว`);
    }

    await conn.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [req.user.id, order.id]);

    // ⭐️ ถ้าสถานะ WAITING_ACCEPT → เปลี่ยนเป็น PREPARING อัตโนมัติ (พนักงานรับงาน = เริ่มเตรียมของ)
    let newStatus = null;
    if (order.status === 'WAITING_ACCEPT') {
      newStatus = 'PREPARING';
      await conn.query('UPDATE orders SET status = ? WHERE id = ?', [newStatus, order.id]);
    }

    await conn.commit();

    // ⭐️ ยิง event หลัง commit เสมอ — ให้หน้า OrderManagement + badge + notification รีเฟรชทันที
    if (newStatus) {
      req.io.emit('order_status_changed', { order_id: order.id, status: newStatus });
      req.io.to(`user_${order.user_id}`).emit(`order_update_user_${order.user_id}`, { order_id: order.id, status: newStatus });
    }

    res.json({ message: "รับงานสำเร็จ", assigned_to: req.user.id });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally { conn.release(); }
});

// ⭐️ ลูกค้าส่งสลิปใหม่ (หลังโดน SLIP_REJECTED)
app.put('/api/orders/:id/resubmit-slip', authenticateToken, async (req, res) => {
  const { slip_image } = req.body;
  if (!slip_image) return badRequest(res, "กรุณาแนบสลิปใหม่");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? AND status = ? FOR UPDATE', [req.params.id, 'SLIP_REJECTED']);
    if (orders.length === 0) { await conn.rollback(); return notFound(res, "ไม่พบออเดอร์หรือสถานะไม่ถูกต้อง"); }
    if (orders[0].user_id !== req.user.id) { await conn.rollback(); return forbidden(res, "ไม่มีสิทธิ์แก้ไขออเดอร์นี้"); }
    // 🐛 FIX — สต๊อกถูกคืนกลับตอนโดน SLIP_REJECTED แล้ว การส่งสลิปใหม่ต้องตัดสต๊อกกลับคืนทันที
    // ไม่งั้นออเดอร์กลับเป็น PENDING_VERIFY แล้วพนักงานกด PREPARING ต่อจะไม่มีการหักสต๊อกอีก
    // (branch ใน PUT /orders/:id/status เช็ค order.status === 'SLIP_REJECTED' ซึ่งผ่านไปแล้ว) = ของออกโดยไม่หักสต๊อก
    const items = await getOrderItems(conn, req.params.id);
    for (const item of items) {
      const [res] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity]);
      if (res.affectedRows === 0) throw new Error(`สต๊อกสินค้าไม่พอสำหรับออเดอร์ #${req.params.id} กรุณาติดต่อลูกค้า`);
    }
    // ⭐️ Task 4 — reset สถานะตรวจสลิปกลับเป็น PENDING ตอนลูกค้าส่งสลิปใหม่
    await conn.query("UPDATE orders SET slip_image = ?, slip_file_path = ?, slip_verification_status = 'PENDING', status = 'PENDING_VERIFY', reject_reason = NULL WHERE id = ?", [slip_image, slip_image, req.params.id]);
    await conn.commit();
    req.io.emit('new_order_received', { message: `ลูกค้าส่งสลิปใหม่ ออเดอร์ #${req.params.id}`, order_id: req.params.id });
    req.io.emit('order_status_changed', { order_id: req.params.id, status: 'PENDING_VERIFY' });
    req.io.emit('payment_slip_received', { order_id: req.params.id, message: `ออเดอร์ #${req.params.id} ส่งสลิปใหม่ รอตรวจสอบ` });
    res.json({ message: "ส่งสลิปใหม่สำเร็จ รอพนักงานตรวจสอบ" });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally { conn.release(); }
});

// ⭐️ อ่านอัตราแต้มสะสมจากตาราง settings (ปรับได้จากหน้า Pricing & Loyalty โดยไม่ต้อง restart)
//   คืนค่า default = พฤติกรรมเดิม (20 บาท/แต้ม, 1 แต้ม = ฿1) ถ้าค่าในตารางหาย/ผิดปกติ
async function getLoyaltyRates(conn) {
  const [[row]] = await conn.query('SELECT points_earn_amount_per_point AS earnPer, points_redeem_value_per_point AS redeemRate FROM settings WHERE id = 1');
  const earnPer = Number(row?.earnPer) > 0 ? Number(row.earnPer) : 20;
  const redeemRate = Number(row?.redeemRate) > 0 ? Number(row.redeemRate) : 1;
  return { earnPer, redeemRate };
}

// ⭐️ โหลดสิทธิ์ส่วนลดกลุ่มของสมาชิก: ส่วนลด default ของกลุ่ม + rule รายหมวดหมู่
//   คืน { defaultPct, ruleByCategory: Map<category_id, percent> } — ถ้าไม่มีสมาชิก/ไม่มีกลุ่ม จะได้ 0/ว่าง
async function getMemberGroupDiscount(conn, memberId) {
  const result = { defaultPct: 0, ruleByCategory: new Map() };
  if (!memberId) return result;
  const [grpRows] = await conn.query(
    `SELECT mg.default_discount_percent AS pct FROM users u JOIN member_groups mg ON u.group_id = mg.id WHERE u.id = ?`,
    [memberId]
  );
  if (grpRows.length === 0) return result; // สมาชิกไม่ได้อยู่กลุ่มไหน
  result.defaultPct = Number(grpRows[0].pct) || 0;
  const [ruleRows] = await conn.query(
    `SELECT r.category_id AS cid, r.discount_percent AS pct FROM group_discount_rules r JOIN users u ON u.group_id = r.group_id WHERE u.id = ?`,
    [memberId]
  );
  for (const r of ruleRows) result.ruleByCategory.set(r.cid, Number(r.pct) || 0);
  return result;
}

// ⭐️ เขียน 1 แถวลง point_transactions (ledger) ต้องเรียกในทรานแซกชันเดียวกับที่แต้มถูกแก้เสมอ
//   points เป็นค่ามีเครื่องหมาย: + สำหรับ EARN, - สำหรับ REDEEM/REWARD
async function writePointTxn(conn, userId, type, points, refSaleId, refOrderId, performedBy, note) {
  await conn.query(
    'INSERT INTO point_transactions (user_id, type, points, ref_sale_id, ref_order_id, performed_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, type, points, refSaleId || null, refOrderId || null, performedBy || null, note || null]
  );
}

// ⭐️ ขายหน้าร้านเป็นงานของ CASHIER เท่านั้น — ตัด ADMIN ออกตามนโยบายที่ตกลงกับผู้ใช้
//   เหตุผล: เงินสดต้องผูกกับกะเสมอเพื่อให้ปิดกะแล้วยอดตรง แต่ ADMIN เปิดกะผ่าน UI ไม่ได้
//   (หน้า /shift ส่ง ADMIN ไปลงชื่อเข้า-ออกงาน) ถ้าปล่อยให้ขายได้ บิลจะผูก shift_id = NULL
//   = เงินไม่มีเจ้าของ ตามไม่ได้ — งานคืนเงิน/ยกเลิกบิลของ ADMIN ยังทำได้ที่หน้าตั้งค่า (ประวัติขาย)
app.post('/api/sales/checkout', requireRole('CASHIER'), checkoutLimiter, validateRequest(checkoutValidator), async (req, res) => {
  // ⭐️ เพิ่มการรับค่า member_id, promotion_id, redeem_points เข้ามาด้วย
  const { member_id, promotion_id, redeem_points, payment_method, amount_received, items } = req.body;
  // 🐛 FIX — cashier_id ต้องมาจาก JWT (req.user.id) ห้ามเชื่อจาก body: เดิม cashier ส่ง id คนอื่นได้
  // → บิลเข้ากะ/ชื่อคนอื่น (แอบอ้างหรือโยนความผิดตอนเงินไม่ตรง) — sync-offline ทำถูกแล้ว ตัวนี้ทำตาม
  const cashier_id = req.user.id;
  if (!items || items.length === 0) return badRequest(res, "ตะกร้าสินค้าว่างเปล่า");

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    // ⭐️ Sprint 1 — B3: totalAmount สะสมในหน่วยสตางค์ (integer) แทน float บาท กัน drift สะสมข้ามหลาย
    // รายการในตะกร้า (เดิม: product.price * item.quantity เป็น float คูณ+บวกสะสมทีละรายการ)
    let totalAmountSatang = 0;
    let groupDiscountSatang = 0;   // ⭐️ ยอดส่วนลดกลุ่มสมาชิกที่เกิดในบิลนี้ (แยกรายงาน)
    let rewardPointsNeeded = 0;    // ⭐️ แต้มที่ต้องหักจากการแลกของรางวัลในบิลนี้
    const processedItems = [];
    const stockIssues = []; // ⭐️ Sprint 2 — B7: Collect stock validation errors

    // ⭐️ โหลดอัตราแต้ม + สิทธิ์ส่วนลดกลุ่มของสมาชิกครั้งเดียวก่อนวนรายการ
    const { earnPer, redeemRate } = await getLoyaltyRates(conn);
    const groupDiscount = await getMemberGroupDiscount(conn, member_id || null);

    // 1. เช็คราคาสินค้าและสต๊อก + ⭐️ Sprint 2: เช็ค expiry status
    for (let item of items) {
      const [productRows] = await conn.query(`
        SELECT id, name, price, stock, category_id, is_reward_item, points_required, expiry_date, discount_percent, promo_percent, promo_start, promo_end,
               GREATEST(
                 CASE WHEN promo_percent > 0 AND promo_start IS NOT NULL AND promo_end IS NOT NULL
                        AND CURDATE() BETWEEN promo_start AND promo_end
                      THEN promo_percent ELSE 0 END,
                 CASE WHEN expiry_date IS NOT NULL
                        AND DATEDIFF(DATE(expiry_date), CURDATE()) = 1
                      THEN COALESCE(discount_percent,0) ELSE 0 END
               ) AS best_discount_percent
        FROM products WHERE id = ? FOR UPDATE`, [item.product_id]);
      if (productRows.length === 0) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);

      const product = productRows[0];
      // ⭐️ Sprint 2 — B7: Collect insufficient stock issues instead of throwing
      //   (ลอจิกอยู่ใน utils/rewardRedemption.js — มีเทส regression ครอบกรณีของรางวัลหมดสต๊อก)
      const stockIssue = checkItemStock({ product, quantity: item.quantity, productId: item.product_id });
      if (stockIssue) {
        stockIssues.push(stockIssue);
        continue; // Skip this item but continue checking others
      }

      // ⭐️ Sprint 2: Check for expired products — block sale if expired
      const expiryStatus = getProductExpiry(product);
      if (expiryStatus.status === 'expired') {
        throw new Error(`ไม่สามารถขายสินค้าที่หมดอายุแล้ว: ${product.name}`);
      }

      // ⭐️ Part 5 — สินค้าแลกของรางวัล: ราคาเงินสด = 0, จ่ายด้วยแต้ม, ไม่คิดส่วนลด/ไม่ได้แต้มสะสม
      //   (เช็คสมาชิก + is_reward_item + คำนวณแต้มที่ต้องใช้ อยู่ใน utils/rewardRedemption.js —
      //   มีเทส regression ครอบกรณีส่ง redeem_reward กับสินค้าธรรมดา / ไม่ได้เลือกสมาชิก)
      if (item.redeem_reward) {
        const reward = evaluateRewardItem({ item, product, memberId: member_id });
        rewardPointsNeeded += reward.need;
        processedItems.push(reward.processedItem);
        continue;
      }

      let itemPrice = Number(product.price);
      // ⭐️ ลำดับความสำคัญของส่วนลดต่อชิ้น เลือกอย่างใดอย่างหนึ่ง:
      //   1) โปร/ใกล้หมดอายุระดับสินค้า (best_discount_percent จาก SQL) — ชนะทุกอย่าง ไม่นับเป็นส่วนลดกลุ่ม
      //   2) rule รายหมวดหมู่ของกลุ่มสมาชิก  3) ส่วนลด default ของกลุ่ม
      const bestDiscPct = Number(product.best_discount_percent) || 0;
      if (bestDiscPct > 0) {
        itemPrice -= Math.round(itemPrice * bestDiscPct / 100);
        console.log(`[CHECKOUT] -${bestDiscPct}% (product promo) applied to ${product.name}`);
      } else if (member_id) {
        const rulePct = groupDiscount.ruleByCategory.has(product.category_id)
          ? groupDiscount.ruleByCategory.get(product.category_id)
          : groupDiscount.defaultPct;
        if (rulePct > 0) {
          const perUnitDisc = Math.round(itemPrice * rulePct / 100);
          itemPrice -= perUnitDisc;
          groupDiscountSatang += toSatang(perUnitDisc) * item.quantity;
          console.log(`[CHECKOUT] -${rulePct}% (group) applied to ${product.name}`);
        }
      }

      const subtotalSatang = toSatang(itemPrice) * item.quantity;
      const subtotal = fromSatang(subtotalSatang);
      totalAmountSatang += subtotalSatang;

      processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: itemPrice, subtotal: subtotal, stock_before: product.stock, redeemed_with_points: false });
    }

    // ⭐️ Sprint 2 — B7: If any stock issues, return 400 with details
    if (stockIssues.length > 0) {
      await conn.rollback();
      conn.release();
      return badRequest(res, "สต๊อกไม่เพียงพอสำหรับบางรายการ", { issues: stockIssues });
    }

    let totalAmount = fromSatang(totalAmountSatang);

    // ⭐️ 1.5 คำนวณส่วนลดจากโปรโมชั่นใหม่ฝั่ง Backend เอง (ห้ามเชื่อ discount ที่ client ส่งมา)
    let discountAmount = 0;
    let appliedPromo = null;
    if (promotion_id) {
      const [promoRows] = await conn.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE FOR UPDATE', [promotion_id]);
      if (promoRows.length === 0) throw new Error('โปรโมชั่นไม่ถูกต้อง หรือหมดอายุแล้ว');
      const promo = promoRows[0];

      const limitError = await checkPromotionUsageLimit(conn.query.bind(conn), promo, member_id || null);
      if (limitError) throw new Error(limitError);

      discountAmount = await calculatePromotionDiscount(conn.query.bind(conn), promo, totalAmount, items);
      appliedPromo = promo;
    }
    // ⭐️ B3 — ลบส่วนลดในหน่วยสตางค์เช่นกัน
    let netTotalSatang = totalAmountSatang - toSatang(discountAmount);
    let netTotal = fromSatang(netTotalSatang);

    // ⭐️ 1.6 แลกแต้ม — ทั้งของรางวัล (rewardPointsNeeded) และแลกเป็นส่วนลดเงินสด (redeem_points)
    //   ดึงยอดแต้มครั้งเดียวแบบ FOR UPDATE กันแลกซ้อนเกินยอด: หักของรางวัลก่อน เหลือเท่าไรค่อยแลกเป็นส่วนลด
    //   อัตราแลก = points_redeem_value_per_point (ปรับได้) — 1 แต้ม = redeemRate บาท
    let pointsRedeemed = 0;   // แต้มที่แลกเป็นส่วนลดเงินสด
    // ⭐️ นโยบายแต้ม (เดียวกับพรีออเดอร์ — utils/preorderPolicy.js): แต้ม/ของรางวัล = สิทธิ์ MEMBER เท่านั้น
    // /members/lookup ค้นได้ทุก role (รวมบัญชีพนักงาน) — ถ้า cashier เลือกบัญชี staff เป็น "สมาชิก"
    // (เช่น คิดเงินให้ตัวเอง/พนักงานคนอื่นในบิล) บัญชีนั้นไม่มีสิทธิ์แต้ม: ห้ามแลกแต้ม/แลกของรางวัล
    // (ตอบ 400 ชัดเจน ไม่ใช่เงียบๆ เพราะลูกค้าจะเข้าใจผิดว่าลดแล้วทั้งที่ไม่ได้ลด) + ไม่ได้แต้มสะสม
    let memberCanUsePoints = true;
    if (member_id) {
      const memberRoleRows = await getUserRole(conn, member_id);
      if (memberRoleRows.length === 0) throw new Error('ไม่พบข้อมูลสมาชิก');
      const salePoints = resolveSaleMemberPoints({ role: memberRoleRows[0].role, redeemPoints: redeem_points, rewardPointsNeeded });
      memberCanUsePoints = salePoints.canUsePoints;
      if (salePoints.blockedRedeem) {
        const err = new Error('บัญชีที่เลือกไม่ใช่สมาชิก (เป็นบัญชีพนักงาน) ไม่สามารถใช้แต้ม/แลกของรางวัลได้');
        err.statusCode = 400;
        throw err;
      }
    }

    let pointsDiscount = 0;   // มูลค่าส่วนลด (บาท)
    let rewardPoints = 0;     // แต้มที่ใช้แลกของรางวัล (ยืนยันหลังเช็คยอดแล้ว)
    if (member_id && (redeem_points > 0 || rewardPointsNeeded > 0)) {
      const memberRows = await lockUserPoints(conn, member_id);
      if (memberRows.length === 0) throw new Error('ไม่พบข้อมูลสมาชิก');
      // ⭐️ ลอจิกคิดแต้ม (ของรางวัลก่อน → เหลือค่อยแลกส่วนลดเงินสด กันใช้แต้มซ้ำ) อยู่ใน
      //   utils/rewardRedemption.js — pure function มีเทส regression ครอบกรณีแต้มไม่พอ/
      //   ใช้แต้มซ้ำ/ปัดสตางค์ (ลอจิกเดิมย้ายมาตรงนี้เป๊ะ ไม่เปลี่ยนพฤติกรรม)
      const settled = settleRewardPoints({
        memberPoints: memberRows[0].points,
        rewardPointsNeeded,
        redeemPoints: redeem_points,
        redeemRate,
        netTotalSatang,
      });
      pointsRedeemed = settled.pointsRedeemed;
      pointsDiscount = settled.pointsDiscount;
      rewardPoints = settled.rewardPoints;
      netTotalSatang = settled.netTotalSatang;
      netTotal = fromSatang(netTotalSatang);
    }

    // 2. ตรวจสอบเงินทอน (เทียบกับยอดสุทธิหลังหักส่วนลด+แต้ม) — ⭐️ B3: เทียบ/คำนวณในหน่วยสตางค์
    const amountReceivedSatang = toSatang(amount_received);
    if (amountReceivedSatang < netTotalSatang) throw new Error("รับเงินลูกค้ามาไม่พอ!");
    const changeAmount = fromSatang(amountReceivedSatang - netTotalSatang);

    // ⭐️ หากะที่เปิดอยู่ของแคชเชียร์คนนี้ ผูกเข้าบิล (แม่นกว่าเทียบช่วงเวลา ถ้าเปิดกะซ้อนเวลากันหลายคน)
    const [openShiftRows] = await conn.query(`SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`, [cashier_id]);
    const shiftId = openShiftRows[0]?.id || null;

    // 🐛 FIX (เงินหาย) — เดิมถ้าไม่มีกะเปิดอยู่ บิลจะถูกบันทึกด้วย shift_id = NULL เฉยๆ คือ "ขายผ่าน"
    //   รับเงินสด ตัดสต๊อก ออกใบเสร็จครบ แต่เงินก้อนนั้นไม่ถูกนับเข้ากะไหนเลย พอปิดกะยอดที่ควรมีจึงไม่ตรง
    //   และตามไม่ได้ว่าเงินไปอยู่กับใคร — บล็อกไปเลยดีกว่าปล่อยให้เกิดเงินที่ไม่มีเจ้าของ
    //   ตอนนี้ endpoint นี้เปิดให้เฉพาะ CASHIER แล้ว (ดู requireRole ด้านบน) จึงไม่ต้องเช็ค role ซ้ำ
    if (!shiftId) {
      await conn.rollback();
      return badRequest(res, 'ยังไม่ได้เปิดกะการขาย กรุณาเปิดกะก่อนเริ่มขายสินค้า', { code: 'NO_OPEN_SHIFT' });
    }

    // 3. สร้างหัวบิลใบเสร็จ (ผูก member_id, promotion_id, discount_amount, points_redeemed, shift_id ลงไป)
    // ⭐️ Sprint 2 — B6: Store idempotency_key for offline handling
    const idempotencyKey = req.headers['idempotency-key'];
    const groupDiscountAmount = fromSatang(groupDiscountSatang);
    const [saleResult] = await conn.query(
      'INSERT INTO sales (cashier_id, member_id, promotion_id, total_amount, discount_amount, group_discount_amount, points_redeemed, points_discount, payment_method, amount_received, change_amount, shift_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cashier_id, member_id || null, promotion_id || null, netTotal, discountAmount, groupDiscountAmount, pointsRedeemed, pointsDiscount, payment_method, amount_received, changeAmount, shiftId, idempotencyKey || null]
    );
    const saleId = saleResult.insertId;

    // 4. บันทึกรายละเอียดสินค้าและตัดสต๊อก
    const lowStockMsgs = [];
    const lowStockProducts = []; // ⭐️ Day 3 — เก็บไว้ส่ง LINE alert รวมเป็นข้อความเดียวหลัง commit
    const raceConditionItems = []; // ⭐️ Sprint 2 — B7: Collect race condition errors
    for (let item of processedItems) {
      await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)', [saleId, item.product_id, item.quantity, item.unit_price, item.subtotal]);

      // ⭐️ Sprint 2 — B7: Check affectedRows to detect race condition
      const [updateResult] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity]);
      if (updateResult.affectedRows === 0) {
        // Stock was modified by another transaction (race condition)
        raceConditionItems.push(item.product_id);
      }

      const lowStock = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (lowStock) { lowStockMsgs.push(lowStock.message); lowStockProducts.push(lowStock.product); }
    }

    // ⭐️ Sprint 2 — B7: If any race condition detected, return 409
    if (raceConditionItems.length > 0) {
      await conn.rollback();
      conn.release();
      return conflict(res, "สต๊อกถูกแก้ไขโดยระบบอื่นพร้อมกัน กรุณาลองใหม่", { conflicted_products: raceConditionItems });
    }

    // ⭐️ 5. หักแต้ม (แลกส่วนลด + แลกของรางวัล) แล้วบวกแต้มสะสมใหม่ (ทุก earnPer บาท = 1 แต้ม
    //   คิดจากยอดสุทธิหลังหักทุกส่วนลด ของรางวัลราคา 0 จึงไม่ทำให้ได้แต้มเพิ่ม) + เขียน ledger ทุกการเคลื่อนไหว
    let earnedPoints = 0;
    if (member_id) {
      const totalDeduct = pointsRedeemed + rewardPoints;
      if (totalDeduct > 0) {
        await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [totalDeduct, member_id]);
      }
      // ⭐️ สมาชิกที่เลือกเป็นบัญชี staff → ไม่ได้แต้มสะสม (memberCanUsePoints = false)
      earnedPoints = memberCanUsePoints ? Math.floor(netTotal / earnPer) : 0;
      if (earnedPoints > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [earnedPoints, member_id]);
      }
      if (pointsRedeemed > 0) await writePointTxn(conn, member_id, 'REDEEM', -pointsRedeemed, saleId, null, req.user.id, 'แลกแต้มเป็นส่วนลด');
      if (rewardPoints > 0) await writePointTxn(conn, member_id, 'REWARD', -rewardPoints, saleId, null, req.user.id, 'แลกของรางวัล');
      if (earnedPoints > 0) await writePointTxn(conn, member_id, 'EARN', earnedPoints, saleId, null, req.user.id, 'แต้มสะสมจากการซื้อ');
    }

    // ⭐️ 5.5 นับสิทธิ์การใช้โปรโมชั่น (usage_count รวม + per-user ถ้ามีจำกัด)
    if (appliedPromo && discountAmount > 0) {
      await conn.query('UPDATE promotions SET usage_count = usage_count + 1 WHERE id = ?', [appliedPromo.id]);
      if (member_id) {
        await conn.query('INSERT INTO promotion_usages (promotion_id, member_id) VALUES (?, ?)', [appliedPromo.id, member_id]);
      }
    }

    // ⭐️ Task 5 — audit log (ในทรานแซกชันเดียวกับบิล กันเคส commit สำเร็จแต่ log หาย)
    await logAudit(conn, 'CHECKOUT', req.user.id, { amount: netTotal, items: processedItems.length, payment_method }, 'SALE', saleId);

    await conn.commit();
    req.io.emit('stock_updated', { message: 'มีการตัดสต๊อกสินค้า ให้โหลดข้อมูลใหม่' });
    req.io.emit('dashboard_updated', { message: 'มีบิลขายใหม่' });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));
    // ⭐️ Day 3 — LINE alert หลัง commit เท่านั้น (ไม่ยิงถ้า transaction rollback) best-effort ล้วนๆ
    //   ไม่รอ (await) ให้ยิงเสร็จก่อนตอบ response — ผู้ใช้ไม่ควรรอ LINE API เพื่อดูใบเสร็จ
    if (lowStockProducts.length > 0) {
      sendLowStockAlert(lowStockProducts).catch(err => console.error('[LINE] sendLowStockAlert error:', err.message));
    }

    res.json({
      message: "ทำรายการสำเร็จ",
      receipt: {
        sale_id: saleId,
        subtotal: totalAmount,
        discount_amount: discountAmount,
        group_discount_amount: groupDiscountAmount,
        points_redeemed: pointsRedeemed,
        points_discount: pointsDiscount,
        reward_points_used: rewardPoints,
        total_amount: netTotal,
        amount_received: amount_received,
        change_amount: changeAmount,
        earned_points: earnedPoints,
        payment_method
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    // 🐛 FIX — retry หลัง server restart: แคช idempotency ในหน่วยความจำหาย แต่บิลเคย commit แล้ว
    // (UNIQUE sales.idempotency_key) → ตอบ "สำเร็จ" พร้อมใบเสร็จจริง แทน error 500 — กัน client
    // เข้าใจผิดว่าขายไม่สำเร็จแล้วขายซ้ำ (ของเดิมตอบ 500 → queue retry → ทิ้ง + แจ้งเตือนผู้ใช้)
    if (isIdempotentDuplicate(error)) {
      const [existingSales] = await conn.query('SELECT * FROM sales WHERE idempotency_key = ?', [idempotencyKey || null]);
      if (existingSales.length > 0) {
        const r = existingSales[0];
        return res.status(200).json({
          message: 'ทำรายการสำเร็จ (บิลนี้เคยบันทึกแล้ว — request ซ้ำ ไม่ได้ขายซ้ำ)',
          duplicated: true,
          receipt: {
            sale_id: r.id,
            subtotal: fromSatang(toSatang(r.total_amount) + toSatang(r.discount_amount) + toSatang(r.group_discount_amount) + toSatang(r.points_discount)),
            discount_amount: Number(r.discount_amount),
            group_discount_amount: Number(r.group_discount_amount),
            points_redeemed: Number(r.points_redeemed),
            points_discount: Number(r.points_discount),
            reward_points_used: 0,
            total_amount: Number(r.total_amount),
            amount_received: Number(r.amount_received),
            change_amount: Number(r.change_amount),
            earned_points: 0,
            payment_method: r.payment_method
          }
        });
      }
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }

    // ⭐️ client error ที่ตั้งใจตอบ (ตั้ง statusCode ไว้ตอน throw เช่น เลือกบัญชี staff เป็นสมาชิกแล้ว
    // ขอใช้แต้ม) — อย่าให้กลายเป็น 500 ทั้งที่ความผิดอยู่ที่ request ฝั่งผู้ใช้
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    serverError(res);
  } finally {
    conn.release();
  }
});

// ⭐️ Update — Offline POS sales batch sync. POS.tsx queues sales in IndexedDB while offline
// (blocking member/promo/points/reward features there, since those need live server truth that
// can't be trusted from a stale cache) and replays the whole queue here once reconnected.
//
// Deliberate design choices, since "offline" inherently can't be reconciled perfectly:
//   - Money trust: total_amount/amount_received and each item's unit_price are the client's
//     (cashier's own cash drawer/receipt) record of what was actually charged and collected —
//     NOT recomputed from current product prices, which may have changed since the sale happened.
//   - Timing: created_at uses the real offline capture time (created_at_offline), so date-based
//     reports (today's sales, etc.) reflect when the sale actually happened, not when it synced.
//   - Shift attribution: uses whichever shift is OPEN for this cashier at SYNC time, not capture
//     time — there is no way to reconstruct which shift was open during a disconnected period,
//     especially if it already closed. If no shift is open at sync time, that sale fails with
//     NO_OPEN_SHIFT and stays queued client-side for the next retry. is_offline_sale=1 flags every
//     row synced this way so reports/reconciliation can identify them.
//   - Stock: still checked and decremented against the LIVE stock at sync time (not offline-time
//     stock) — if another sale already used up the stock while this cashier was offline, that
//     specific offline sale fails with STOCK_ISSUE for manual reconciliation, rather than silently
//     allowing negative stock.
//   - Dedup: client_offline_id (UNIQUE) is generated once when IndexedDB captures the sale, so
//     re-submitting the same batch (e.g. the network drops mid-sync) never double-charges/double-
//     decrements — an already-synced client_offline_id just reports success again with the
//     existing sale_id.
//   - Batch semantics: each sale in the batch is its own transaction — one bad item never blocks
//     the rest of the batch from syncing.
app.post('/api/sales/sync-offline', requireRole('CASHIER'), syncOfflineLimiter, validateRequest(syncOfflineValidator), async (req, res) => {
  const { sales } = req.body;
  const cashierId = req.user.id; // ⭐️ ตัวตนจาก JWT เสมอ ไม่เชื่อ client-sent cashier_id (เหมือน checkout)
  const results = [];
  // ⭐️ Day 3 — สะสมสินค้าใกล้หมดจากทั้ง batch แล้วส่ง LINE alert รวมเป็นข้อความเดียวตอนจบ (ไม่ใช่
  //   แยกส่งทีละบิลออฟไลน์ในนั้น กันสแปมกลุ่ม LINE ถ้า batch หนึ่งมีหลายบิล)
  const allLowStockProducts = [];

  for (const offlineSale of sales) {
    const { client_offline_id, payment_method, amount_received, total_amount, items, created_at_offline } = offlineSale;
    const conn = await pool.getConnection();
    let inTransaction = false;

    try {
      const [existing] = await conn.query('SELECT id FROM sales WHERE client_offline_id = ?', [client_offline_id]);
      if (existing.length > 0) {
        results.push({ client_offline_id, success: true, sale_id: existing[0].id, already_synced: true });
        continue;
      }

      await conn.beginTransaction();
      inTransaction = true;

      const [openShiftRows] = await conn.query(
        `SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`,
        [cashierId]
      );
      const shiftId = openShiftRows[0]?.id || null;
      if (!shiftId) {
        await conn.rollback();
        inTransaction = false;
        results.push({
          client_offline_id, success: false, code: 'NO_OPEN_SHIFT',
          error: 'ยังไม่ได้เปิดกะการขาย กรุณาเปิดกะก่อนถึงจะซิงค์ยอดขายออฟไลน์รายการนี้ได้',
        });
        continue;
      }

      const stockIssues = [];
      const processedItems = [];
      for (const item of items) {
        const [productRows] = await conn.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        if (productRows.length === 0) {
          stockIssues.push({ product_id: item.product_id, product_name: '(ไม่พบสินค้านี้แล้ว)', requested: item.quantity, available: 0 });
          continue;
        }
        const product = productRows[0];
        // ⭐️ เช็คสต๊อกใช้ util เดียวกับ checkout (utils/rewardRedemption.js) — พฤติกรรมเหมือนเดิม
        //   (SELECT FOR UPDATE ด้านบนล็อกแถวไว้ทั้ง transaction กัน race ระหว่างเช็คกับตัด)
        const stockIssue = checkItemStock({ product, quantity: item.quantity, productId: item.product_id });
        if (stockIssue) {
          stockIssues.push(stockIssue);
          continue;
        }
        processedItems.push({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: fromSatang(toSatang(item.unit_price) * item.quantity),
          stock_before: product.stock,
        });
      }

      if (stockIssues.length > 0) {
        await conn.rollback();
        inTransaction = false;
        results.push({
          client_offline_id, success: false, code: 'STOCK_ISSUE',
          error: 'สต๊อกไม่เพียงพอสำหรับบางรายการ ณ เวลาซิงค์ (อาจถูกขายไปแล้วระหว่างที่ยังไม่มีเน็ต)',
          issues: stockIssues,
        });
        continue;
      }

      const netTotal = Number(total_amount);
      const amountReceivedNum = Number(amount_received);
      const changeAmount = Math.max(0, fromSatang(toSatang(amountReceivedNum) - toSatang(netTotal)));

      const [saleResult] = await conn.query(
        `INSERT INTO sales (cashier_id, total_amount, amount_received, change_amount, payment_method, shift_id, client_offline_id, is_offline_sale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [cashierId, netTotal, amountReceivedNum, changeAmount, payment_method, shiftId, client_offline_id, new Date(created_at_offline)]
      );
      const saleId = saleResult.insertId;

      const saleLowStockMsgs = []; // ⭐️ Day 3 — เก็บไว้ emit "หลัง" commit เท่านั้น (กัน race เดียวกับ checkout)
      for (const item of processedItems) {
        await conn.query(
          'INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
          [saleId, item.product_id, item.quantity, item.unit_price, item.subtotal]
        );
        await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);

        const lowStock = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
        if (lowStock) { saleLowStockMsgs.push(lowStock.message); allLowStockProducts.push(lowStock.product); }
      }

      await logAudit(conn, 'CHECKOUT_OFFLINE_SYNC', req.user.id, { amount: netTotal, items: processedItems.length, payment_method, client_offline_id }, 'SALE', saleId);

      await conn.commit();
      inTransaction = false;

      req.io.emit('stock_updated', { message: 'มีการตัดสต๊อกสินค้า (ซิงค์บิลออฟไลน์)' });
      req.io.emit('dashboard_updated', { message: 'มีบิลขายใหม่ (ออฟไลน์)' });
      saleLowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));

      results.push({ client_offline_id, success: true, sale_id: saleId });
    } catch (err) {
      if (inTransaction) { try { await conn.rollback(); } catch (_) { /* connection may already be dead */ } }
      console.error('[sync-offline] ERROR:', err.message);
      results.push({ client_offline_id, success: false, error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
    } finally {
      conn.release();
    }
  }

  // ⭐️ Day 3 — LINE alert เดียวรวมทุกรายการใกล้หมดจากทั้ง batch หลังประมวลผลครบทุกบิลแล้ว
  //   ไม่รอ (await) ก่อนตอบ response — cashier ไม่ควรรอ LINE API เพื่อดูผล sync
  if (allLowStockProducts.length > 0) {
    sendLowStockAlert(allLowStockProducts).catch(err => console.error('[LINE] sendLowStockAlert error:', err.message));
  }

  res.json({ results });
});

// =========================================
// 5.1 SALES HISTORY, HOLD & VOID (ประวัติ, พักบิล และ ยกเลิกบิล)
// =========================================

app.get('/api/sales/history', requireRole('CASHIER', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // ⭐️ รวมบิลหน้าร้าน (sales) + บิลจองที่ปิดแล้ว (orders COMPLETED) เข้าด้วยกัน
    // ใช้ source แยกประเภท ('POS'/'PREORDER') เพราะ id ชนกันได้ระหว่าง 2 ตาราง
    // orders นับวันที่ตาม completed_at (วันที่มารับจริง) ไม่ใช่วันจอง
    let dateClauseSales = 'DATE(s.created_at) = CURDATE()';
    let dateClauseOrders = 'DATE(o.completed_at) = CURDATE()';
    const params = [];
    if (start_date && end_date) {
      dateClauseSales = 'DATE(s.created_at) BETWEEN ? AND ?';
      dateClauseOrders = 'DATE(o.completed_at) BETWEEN ? AND ?';
      params.push(start_date, end_date, start_date, end_date);
    }

    const query = `
      SELECT * FROM (
        SELECT s.id, 'POS' as source, s.created_at, s.total_amount, s.payment_method, s.status, u.full_name as cashier_name
        FROM sales s
        JOIN users u ON s.cashier_id = u.id
        WHERE ${dateClauseSales}
        UNION ALL
        SELECT o.id, 'PREORDER' as source, o.completed_at as created_at, o.total_amount, o.payment_method, o.status, cust.full_name as cashier_name
        FROM orders o
        JOIN users cust ON o.user_id = cust.id
        WHERE o.status = 'COMPLETED' AND ${dateClauseOrders}
      ) combined
      ORDER BY created_at DESC
    `;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/sales/history/:id', requireRole('CASHIER', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { source } = req.query; // 'PREORDER' = ดูจาก order_items, อื่นๆ = sale_items (บิลหน้าร้าน)
    let rows;
    if (source === 'PREORDER') {
      [rows] = await pool.query(`
        SELECT oi.quantity, oi.price, oi.subtotal, p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [req.params.id]);
    } else {
      [rows] = await pool.query(`
        SELECT si.quantity, si.price, si.subtotal, p.name as product_name
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `, [req.params.id]);
    }
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/sales/:id/void', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const saleId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ ใช้ status ตรวจสอบอย่างเดียว (points_redeemed ไว้คืนแต้มที่แลกใช้ตอน void)
    const [sales] = await conn.query('SELECT member_id, total_amount, status, points_redeemed FROM sales WHERE id = ? FOR UPDATE', [saleId]);
    if (sales.length === 0) throw new Error("ไม่พบข้อมูลบิลนี้");

    const sale = sales[0];
    if (sale.status === 'VOIDED') throw new Error("บิลนี้ถูกยกเลิกไปแล้ว");
    if (sale.status === 'HOLD') throw new Error("บิลนี้เป็นบิลพัก ต้องใช้ API ลบบิลพักแทน");

    // ⭐️ เปลี่ยนสถานะบิลเป็น VOIDED
    await conn.query('UPDATE sales SET status = "VOIDED" WHERE id = ?', [saleId]);

    // ⭐️ บันทึก audit log: ใครสั่ง void บิลไหน มูลค่าเท่าไร (ใช้ req.user.id/role จาก JWT เท่านั้น ห้ามเชื่อ body)
    await logAudit(conn, 'VOID_SALE', req.user.id, { role: req.user.role, total_amount: sale.total_amount, member_id: sale.member_id }, 'sale', saleId);

    // คืนสต๊อก
    const [items] = await conn.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [saleId]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // คืนแต้ม (หารด้วยอัตราที่ตั้งไว้ ให้ตรงกับตอนได้แต้มใน checkout) + เขียน ledger
    // 🐛 FIX — เดิมคืนแค่แต้มสะสมที่ได้จากการซื้อ ไม่คืนแต้มที่ลูกค้า "แลกใช้" ในบิลนี้ (แลกเป็นส่วนลด
    // + ของรางวัล) → ลูกค้าเสียแต้มทั้งที่บิลถูก void. คืนให้ครบ: points_redeemed + แต้มของรางวัล
    if (sale.member_id) {
      const redeemed = Number(sale.points_redeemed) || 0;
      if (redeemed > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [redeemed, sale.member_id]);
        await writePointTxn(conn, sale.member_id, 'ADJUST', redeemed, saleId, null, req.user.id, 'คืนแต้มที่แลกใช้จากการยกเลิกบิล (void)');
      }
      const [rewardItems] = await conn.query(
        `SELECT si.quantity, p.points_required FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? AND p.is_reward_item = 1`,
        [saleId]
      );
      let rewardRefund = 0;
      for (const ri of rewardItems) rewardRefund += Number(ri.points_required || 0) * ri.quantity;
      if (rewardRefund > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [rewardRefund, sale.member_id]);
        await writePointTxn(conn, sale.member_id, 'ADJUST', rewardRefund, saleId, null, req.user.id, 'คืนแต้มของรางวัลจากการยกเลิกบิล (void)');
      }
      const { earnPer } = await getLoyaltyRates(conn);
      const points = Math.floor(sale.total_amount / earnPer);
      if (points > 0) {
        await conn.query('UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?', [points, sale.member_id]);
        await writePointTxn(conn, sale.member_id, 'ADJUST', -points, saleId, null, req.user.id, 'คืนแต้มจากการยกเลิกบิล (void)');
      }
    }

    // ⭐️ บันทึกแจ้งเตือนระบบ: บิลถูกยกเลิก (VOID)
    const voidMsg = `บิล #${saleId} ถูกยกเลิก (VOID) มูลค่า ฿${Number(sale.total_amount).toFixed(2)}`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [voidMsg]);

    await conn.commit();
    req.io.emit('stock_updated', { message: `บิล #${saleId} ถูกยกเลิก สต๊อกคืนแล้ว` });
    req.io.emit('dashboard_updated', { message: `บิล #${saleId} ถูกยกเลิก` });
    req.io.emit('notifications_updated', { message: voidMsg });
    res.json({ message: `ยกเลิกบิล #${saleId} สำเร็จ` });
  } catch (error) {
    await conn.rollback();
    badRequest(res, error.message);
  } finally {
    conn.release();
  }
});

app.post('/api/sales/hold', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id, member_id, items } = req.body;

  if (!items || items.length === 0) return badRequest(res, "ตะกร้าว่างเปล่า");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let grandTotal = 0;
    const processedItems = [];

    // คำนวณยอดรวม แต่ยัง "ไม่เช็คและไม่ตัด" สต๊อก
    for (const item of items) {
      const [rows] = await conn.query('SELECT price FROM products WHERE id = ?', [item.product_id]);
      if (rows.length === 0) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);

      const subtotal = Number(rows[0].price) * item.quantity;
      grandTotal += subtotal;
      processedItems.push({ ...item, price: rows[0].price, subtotal });
    }

    // สร้างบิลด้วยสถานะ 'HOLD' (เงินรับและเงินทอนให้เป็น 0 ไว้ก่อน)
    const [saleResult] = await conn.query(
      `INSERT INTO sales (cashier_id, member_id, total_amount, amount_received, change_amount, status) 
       VALUES (?, ?, ?, 0, 0, 'HOLD')`,
      [cashier_id, member_id || null, grandTotal]
    );
    const saleId = saleResult.insertId;

    // บันทึกรายการสินค้าในตะกร้า
    for (const item of processedItems) {
      await conn.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [saleId, item.product_id, item.quantity, item.price, item.subtotal]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "พักบิลสำเร็จ", sale_id: saleId });
  } catch (error) {
    await conn.rollback();
    badRequest(res, error.message);
  } finally {
    conn.release();
  }
});

app.get('/api/sales/hold', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sales WHERE status = "HOLD"');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.delete('/api/sales/hold/:id', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const saleId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // ต้องลบรายการสินค้าในบิลออกก่อน (ตารางลูก) แล้วค่อยลบตัวบิลหลัก (ตารางแม่)
    await conn.query('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    await conn.query('DELETE FROM sales WHERE id = ? AND status = "HOLD"', [saleId]);
    await conn.commit();
    res.json({ message: "ลบบิลที่พักไว้สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally {
    conn.release();
  }
});

// =========================================
// 6. MEMBERS (ระบบสมาชิกสหกรณ์)
// =========================================
// ⭐️ HOTFIX: GET/POST /api/members และ /api/members/:id/points ถูกลบออก —
// อ้างอิงตาราง `members` ที่ไม่มีอยู่จริง (single-identity design: สมาชิกคือ users role=MEMBER, ดู db.js)
// ทำให้ทุก call ไปที่ 4 endpoint นี้ crash ด้วย ER_NO_SUCH_TABLE เสมอ
// ระบบสมาชิกตัวจริงอยู่ที่ /api/users/search, /api/users/register, /api/users/:id/profile
// เหลือไว้เฉพาะ /api/members/import เพราะ insert เข้า users ถูกต้องอยู่แล้ว (ดูโค้ดด้านล่าง)

// 🐛 FIX (ผู้ใช้ขอ) — เดิมรองรับแค่คอลัมน์ student_id/full_name/phone_number สร้าง role=MEMBER เสมอ
// (import พนักงาน/เปลี่ยนสิทธิ์ผ่าน CSV ทำไม่ได้) เพิ่ม role เป็น optional column: ถ้า CSV มีคอลัมน์
// role ที่ valid (MEMBER/CASHIER/MANAGER/ADMIN) จะ set ให้ตอนสร้างใหม่ + update ตอนซ้ำ (re-import)
// ด้วย — ถ้าไม่มีคอลัมน์นี้/ค่าว่าง พฤติกรรมเดิมเป๊ะ (สร้างใหม่=MEMBER, ซ้ำ=ไม่แตะ role เดิม กัน
// import ซ้ำแล้ว role พนักงานเดิมโดนรีเซ็ตกลับ MEMBER โดยไม่ตั้งใจ)
app.post('/api/members/import', requireRole('ADMIN'), uploadLimiter, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return badRequest(res, "กรุณาเลือกไฟล์ CSV");
  const VALID_ROLES = ['MEMBER', 'CASHIER', 'MANAGER', 'ADMIN'];

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        for (const row of results) {
          // สมมติใน CSV มีหัวตาราง: student_id, full_name, phone_number, role (optional)
          const { student_id, full_name, phone_number } = row;
          if (!student_id || !full_name) continue; // ข้ามแถวที่ข้อมูลไม่ครบ

          const rawPassword = phone_number || crypto.randomBytes(8).toString('hex');
          const password = await bcrypt.hash(rawPassword, 10);
          const mustChangePassword = phone_number ? 0 : 1;
          const role = VALID_ROLES.includes(String(row.role || '').trim().toUpperCase())
            ? String(row.role).trim().toUpperCase() : null;

          if (role) {
            await pool.query(
              `INSERT INTO users (student_id, password, full_name, phone_number, role, must_change_password)
               VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone_number = VALUES(phone_number), role = VALUES(role)`,
              [student_id, password, full_name, phone_number || null, role, mustChangePassword]
            );
          } else {
            await pool.query(
              `INSERT INTO users (student_id, password, full_name, phone_number, role, must_change_password)
               VALUES (?, ?, ?, ?, 'MEMBER', ?)
               ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone_number = VALUES(phone_number)`,
              [student_id, password, full_name, phone_number || null, mustChangePassword]
            );
          }
        }
        fs.unlinkSync(req.file.path); // ลบไฟล์ทิ้งหลัง Import เสร็จ
        res.json({ message: `นำเข้าสำเร็จ ${results.length} รายการ` });
      } catch (error) {
        console.error('[500]', error.message);

        serverError(res);
      }
    });
});

// =========================================
// 7. REPORTS & DASHBOARD (ระบบรายงานสรุป)
// =========================================

// ⭐️ Phase A (refactor) — dashboard, top-selling, vendor-sales(+detail), void-summary,
// shift-anomalies, sales-comparison, sales-by-cashier, open-shifts ย้ายไปที่
// reportController.js/reportRoutes.js แล้ว (mount /api/reports ด้านบน) พฤติกรรม/path เดิมไม่เปลี่ยน
// =========================================
// REPORTS เพิ่มเติม (หมวด 5 — Dashboard ADMIN) — ทุก endpoint requireRole('ADMIN')
// =========================================

app.get('/api/shifts/pending-approval', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sh.id, sh.cashier_id, u.full_name as cashier_name, sh.opening_cash, sh.expected_cash,
             sh.actual_cash, sh.difference, sh.discrepancy_amount, sh.opened_at, sh.closed_at, sh.note
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'PENDING_APPROVAL'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Phase A (refactor) — pending-orders, sales-channel, gross-profit, profit-summary, dead-stock,
// vendor-summary ย้ายไปที่ reportController.js/reportRoutes.js แล้ว พฤติกรรม/path เดิมไม่เปลี่ยน

// =========================================
// ⭐️ SUMMARY / PAYROLL (หน้า "สรุปข้อมูล" — ADMIN เท่านั้น)
// =========================================

// ⭐️ Phase A (refactor) — payroll + my-hours ย้ายไปที่ reportController.js/reportRoutes.js แล้ว

app.put('/api/users/:id/hourly-rate', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { hourly_rate } = req.body;
  const rate = Number(hourly_rate);
  if (hourly_rate === undefined || hourly_rate === null || !Number.isFinite(rate) || rate < 0) {
    return badRequest(res, 'กรุณาระบุอัตราค่าจ้างต่อชั่วโมงที่ถูกต้อง (ตัวเลข ≥ 0)');
  }
  try {
    const [result] = await pool.query('UPDATE users SET hourly_rate = ? WHERE id = ? AND role IN (\'CASHIER\',\'MANAGER\',\'ADMIN\')', [rate, id]);
    if (result.affectedRows === 0) return notFound(res, 'ไม่พบพนักงานนี้');
    res.json({ message: 'อัปเดตอัตราค่าจ้างสำเร็จ', hourly_rate: rate });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Phase A (refactor) — monthly-overview ย้ายไปที่ reportController.js/reportRoutes.js แล้ว

// =========================================
// 10. SETTINGS (ตั้งค่าร้านค้า)
// =========================================

// ⭐️ Phase B (refactor) — /api/settings/* (store/receipt/loyalty) ย้ายไป src/routes/settingsRoutes.js
// + src/controllers/settingsController.js แล้ว (mount ใน section app.use ด้านบน) พฤติกรรม/path เดิมทุกอย่าง

// =========================================
// ⭐️ MEMBER GROUPS (Part 3) — กลุ่มสมาชิก + rule ส่วนลดรายหมวดหมู่ (ADMIN+MANAGER)
// =========================================
// ⭐️ Phase B (refactor) — /api/member-groups/* (CRUD กลุ่ม + rule) ย้ายไป memberGroupsRoutes.js +
// memberGroupsController.js แล้ว (mount ด้านบน) ; PUT /api/users/:id/group ด้านล่างยังเป็น users domain

// ⭐️ ผูกสมาชิกเข้ากลุ่ม — endpoint แยกต่างหาก (ADMIN+MANAGER) ไม่ปน role-editing ที่เป็น ADMIN-only
app.put('/api/users/:id/group', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { group_id } = req.body;
  try {
    await pool.query('UPDATE users SET group_id = ? WHERE id = ?', [group_id || null, req.params.id]);
    res.json({ message: 'กำหนดกลุ่มสมาชิกสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// ⭐️ ปลดผูกบัญชี LINE รายบุคคล — ต่างจาก POST /api/admin/reset/unlink-line (adminController.js) ที่
// ปลดทั้งหมดทีเดียวและเป็นเครื่องมือรีเซ็ตข้อมูลสำหรับ demo (ปิดใช้งานบน production ตาม
// ALLOW_DATA_RESET) endpoint นี้ใช้งานได้ปกติทุกวัน เช่น สมาชิกทำมือถือหาย/เปลี่ยนบัญชี LINE ต้องผูกใหม่
// — ปลดแล้ว student_id กลับมาแก้ไขได้ตามปกติ (ดู PUT /api/users/:id ด้านบนที่ล็อกฟิลด์นี้ไว้ตอนมี line_user_id)
app.put('/api/users/:id/unlink-line', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT line_user_id, full_name FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return notFound(res, 'ไม่พบผู้ใช้งานนี้');
    if (!rows[0].line_user_id) return badRequest(res, 'สมาชิกคนนี้ยังไม่ได้ผูกบัญชี LINE');

    await pool.query('UPDATE users SET line_user_id = NULL WHERE id = ?', [req.params.id]);
    await logAudit(pool, 'UNLINK_LINE', req.user.id, { target_full_name: rows[0].full_name }, 'USER', req.params.id);
    res.json({ message: `ปลดผูกบัญชี LINE ของ ${rows[0].full_name} แล้ว` });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// =========================================
// ⭐️ REWARD PRODUCTS (Part 4/5) — สินค้าที่แลกด้วยแต้มได้ (ให้ POS โชว์ในโมดัลแลกของรางวัล)
// =========================================
app.get('/api/products/rewards', requireRole('CASHIER', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, price, image_url, points_required, stock FROM products WHERE is_reward_item = 1 AND is_active = 1 AND stock > 0 ORDER BY points_required ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

// =========================================
// 4.1 INVENTORY (ส่วนเสริมของระบบสินค้า)
// =========================================

app.patch('/api/products/:id/stock', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { adjustment, type, note } = req.body;
  if (adjustment === undefined || !type) {
    return badRequest(res, "ข้อมูลไม่ครบ (ต้องมี adjustment และ type)");
  }

  try {
    // ใช้ GREATEST เพื่อป้องกันไม่ให้สต๊อกติดลบในกรณีที่ตัดของเสียมากกว่าที่มี
    const [result] = await pool.query(
      'UPDATE products SET stock = GREATEST(0, stock + ?) WHERE id = ?',
      [adjustment, req.params.id]
    );

    if (result.affectedRows === 0) {
      return notFound(res, "ไม่พบสินค้า");
    }

    // หมายเหตุ: ในระบบจริง อาจจะมีการบันทึกลงตาราง stock_history (ประวัติการปรับสต๊อก) ด้วย
    res.json({ message: `ปรับสต๊อกสำเร็จ (เหตุผล: ${type})` });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย — เผยระดับสต๊อกภายใน (สินค้าใกล้หมด) ให้ MEMBER
// เห็นได้ด้วย ทั้งที่เป็นข้อมูลปฏิบัติการภายในร้าน (ใช้เติมสต๊อก) ไม่ใช่ข้อมูลสำหรับลูกค้า
app.get('/api/inventory/low-stock', requireRole('CASHIER', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // ⭐️ Day 3 — เกณฑ์ต่อสินค้า (products.min_stock) แทน hardcode <=10 ทุกตัว ให้ตรงกับที่ใช้ตัดสินใจ
    // ส่งแจ้งเตือน LINE (ดู notifyIfLowStock/sendLowStockAlert)
    const [rows] = await pool.query('SELECT id, barcode, name, stock, min_stock FROM products WHERE stock <= min_stock AND is_active = TRUE ORDER BY stock ASC');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// 8. PROMOTIONS (ระบบโปรโมชั่นและส่วนลด)
// =========================================

// ⭐️ Phase B (refactor) — /api/promotions/* (list/active/create/delete/verify) ย้ายไป
// promotionsRoutes.js + promotionsController.js แล้ว (mount ด้านบน) พฤติกรรม/path เดิมทุกอย่าง

// =========================================
// 9. SUPPLIERS & PURCHASES (รับของเข้า)
// =========================================

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย — `SELECT *` เผยชื่อ+ข้อมูลติดต่อซัพพลายเออร์
// (ข้อมูลธุรกิจภายใน) ให้ MEMBER เห็นได้ด้วย ไม่ใช่ข้อมูลสำหรับลูกค้า
app.get('/api/suppliers', requireRole('CASHIER', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM suppliers');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/suppliers', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { name, contact_info } = req.body;

  // ⭐️ เก็บ idempotency_key (กัน offline queue retry แล้วสร้างซัพพลายเออร์ซ้ำ) — มี UNIQUE ที่คอลัมน์นี้ใน DB
  const idempotencyKey = req.headers['idempotency-key'];
  try {
    const [result] = await pool.query('INSERT INTO suppliers (name, contact_info, idempotency_key) VALUES (?, ?, ?)', [name, contact_info, idempotencyKey || null]);
    res.status(201).json({ id: result.insertId, message: "เพิ่มซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    // 🐛 FIX — retry หลัง server restart: row เดิมยังอยู่ใน DB (UNIQUE idempotency_key) → ตอบ "สำเร็จซ้ำ" แทน error
    if (isIdempotentDuplicate(error)) {
      const [rows] = await pool.query('SELECT id FROM suppliers WHERE idempotency_key = ?', [idempotencyKey]);
      if (rows.length > 0) return res.status(201).json({ id: rows[0].id, message: 'เพิ่มซัพพลายเออร์สำเร็จ (request ซ้ำ — ไม่ได้สร้างซ้ำ)', duplicated: true });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.get('/api/suppliers/export', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, contact_info FROM suppliers ORDER BY id');
    await sendTableExport(res, {
      filename: `suppliers-export_${Date.now()}`, sheetName: 'ซัพพลายเออร์',
      headers: ['id', 'name', 'contact_info'], rows: rows.map(r => [r.id, r.name, r.contact_info || '']),
    }, validateExportFormat(req, res));
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
});

app.post('/api/suppliers/import', requireRole('ADMIN'), uploadLimiter, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return badRequest(res, 'กรุณาเลือกไฟล์ CSV');
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        let inserted = 0, updated = 0, skipped = 0;
        for (const row of results) {
          const name = (row.name || '').trim();
          const contact = (row.contact_info || '').trim();
          const id = row.id ? Number(row.id) : null;
          if (!name) { skipped++; continue; }
          if (id) {
            const [r] = await pool.query('UPDATE suppliers SET name = ?, contact_info = ? WHERE id = ?', [name, contact || null, id]);
            if (r.affectedRows > 0) updated++; else skipped++;
          } else {
            await pool.query('INSERT INTO suppliers (name, contact_info) VALUES (?, ?)', [name, contact || null]);
            inserted++;
          }
        }
        fs.unlinkSync(req.file.path);
        res.json({ message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${inserted}, แก้ไข ${updated}, ข้าม ${skipped} รายการ` });
      } catch (error) {
        console.error('[500]', error.message);
        serverError(res);
      }
    });
});

app.delete('/api/suppliers/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // ลบข้อมูลซัพพลายเออร์ตาม ID
    await pool.query('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบข้อมูลซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    // ดัก Error กรณีที่ซัพพลายเออร์เจ้านี้เคยส่งของให้เราแล้ว (มีบิลผูกอยู่)
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return badRequest(res, "ไม่สามารถลบได้ เนื่องจากซัพพลายเออร์นี้มีประวัติการรับสินค้าในคลังแล้ว");
    }
    console.error('[500]', error.message);

    serverError(res);
  }
});

app.post('/api/purchases', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { supplier_id, user_id, items } = req.body;
  if (!items || items.length === 0) return badRequest(res, "ไม่มีรายการสินค้า");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let totalCost = 0;
    const processedItems = [];

    // ⭐️ ตรวจสอบ + คำนวณยอดรวมบิลสั่งซื้อ (กัน quantity/unit_cost ติดลบหรือศูนย์)
    for (const item of items) {
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unit_cost);
      if (!quantity || quantity <= 0) throw new Error(`จำนวนรับเข้าต้องมากกว่า 0 (สินค้า ID: ${item.product_id})`);
      if (!(unitCost > 0)) throw new Error(`ทุน/ชิ้นต้องมากกว่า 0 (สินค้า ID: ${item.product_id})`);

      const subtotal = quantity * unitCost;
      totalCost += subtotal;
      processedItems.push({ product_id: item.product_id, quantity, unit_cost: unitCost, subtotal });
    }

    // 1. สร้างบิลรับของเข้า
    // ⭐️ Sprint 2 — B6: Store idempotency_key
    const idempotencyKey = req.headers['idempotency-key'];
    const [purchaseResult] = await conn.query(
      'INSERT INTO purchases (supplier_id, user_id, total_cost, idempotency_key) VALUES (?, ?, ?, ?)',
      [supplier_id || null, user_id, totalCost, idempotencyKey || null]
    );
    const purchaseId = purchaseResult.insertId;

    // 2. บันทึกรายการของเข้า และ อัปเดตสต๊อก+ต้นทุนถัวเฉลี่ยถ่วงน้ำหนักในตาราง products
    for (const item of processedItems) {
      // บันทึกรายการ (unit_cost ต่อล็อตจริง เก็บไว้ตรงนี้เสมอ ใช้คำนวณกำไรย้อนหลังแบบแยกตามล็อตได้แม่นยำ ไม่อิง products.cost ปัจจุบัน)
      await conn.query(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)',
        [purchaseId, item.product_id, item.quantity, item.unit_cost, item.subtotal]
      );

      // ⭐️ ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก: new_avg = (stock_เดิม*cost_เดิม + qty_รับเข้า*unit_cost_ใหม่) / (stock_เดิม+qty_รับเข้า)
      const [prodRows] = await conn.query('SELECT stock, cost FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (prodRows.length === 0) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);
      const { stock: stockBefore, cost: costBefore } = prodRows[0];

      const newStock = Number(stockBefore) + item.quantity;
      const newAvgCost = ((Number(stockBefore) * Number(costBefore)) + (item.quantity * item.unit_cost)) / newStock;

      await conn.query('UPDATE products SET stock = ?, cost = ? WHERE id = ?', [newStock, newAvgCost, item.product_id]);
    }

    await conn.commit();
    req.io.emit('stock_updated', { message: 'มีการรับสินค้าเข้าคลัง สต๊อกอัปเดตแล้ว' });
    res.status(201).json({ message: "บันทึกการรับสินค้าเข้าคลังสำเร็จ", purchase_id: purchaseId });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    // 🐛 FIX — retry หลัง server restart: แคช idempotency หาย แต่บิลรับของเคยบันทึกแล้ว
    // (UNIQUE purchases.idempotency_key) → ตอบ "สำเร็จซ้ำ" พร้อม purchase_id เดิม แทน error 500
    // (กันรับสินค้า/บวกสต๊อกซ้ำ — สำคัญสุดเพราะ transaction นี้บวก stock+ต้นทุนถัวเฉลี่ย)
    if (isIdempotentDuplicate(error)) {
      const [existingPurchases] = await conn.query('SELECT id FROM purchases WHERE idempotency_key = ?', [idempotencyKey || null]);
      if (existingPurchases.length > 0) return res.status(201).json({ message: 'บันทึกการรับสินค้าเข้าคลังสำเร็จ (request ซ้ำ — ไม่ได้รับซ้ำ)', purchase_id: existingPurchases[0].id, duplicated: true });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }

    serverError(res);
  } finally {
    conn.release();
  }
});

// =========================================
// 11. PRE-ORDER & NOTIFICATIONS (ระบบสั่งจองและแจ้งเตือน)
// =========================================

// ⭐️ Refactor — ลบ endpoint เก่า POST /api/orders/upload-slip (ไม่มี :id) ทิ้ง: ไม่มี frontend
// เรียกใช้แล้ว (PreOrder.tsx เปลี่ยนไปใช้ POST /api/orders/:id/upload-slip ทั้งหมดแล้ว) และของเก่า
// เก็บไฟล์ลง uploads/ ตรงๆ ไม่ได้จัดโฟลเดอร์ตามวันที่แบบระบบใหม่ (slipUpload ใน src/config/multer.js)

// 2. API สร้างออเดอร์ใหม่
// ⭐️ เปิดให้ staff (รวม MANAGER) สั่งจองได้ด้วย — พนักงานที่กดเข้า LINE/เว็บก็จองสินค้าเป็นของตัวเองได้
//   (order ผูก user_id ของคนสั่ง ตรวจ ownership ตามปกติ ไม่มีสิทธิ์เห็น/แตะออเดอร์คนอื่นเพิ่มขึ้น)
app.post('/api/orders', requireRole('MEMBER', 'CASHIER', 'MANAGER', 'ADMIN'), validateRequest(orderValidator), async (req, res) => {
  // รับข้อมูลจากหน้าเว็บ (⭐️ เพิ่ม redeem_points สำหรับแลกแต้มเป็นส่วนลด)
  const { items, payment_method, slip_image, use_phone_for_points, redeem_points } = req.body;
  const user_id = req.user.id; // ดึงจากคนที่ล็อกอินอยู่

  if (!items || items.length === 0) return badRequest(res, "ตะกร้าว่างเปล่า");

  // ⭐️ นโยบายแต้ม: เฉพาะ MEMBER มีสิทธิ์แต้มสมาชิก — staff จองได้แต่ไม่มีสิทธิ์แลก/สะสม
  // (ดู utils/preorderPolicy.js) — ตอบ 403 ก่อนเริ่ม transaction เลย (ไม่มีการเขียนอะไรทั้งสิ้น)
  // กัน staff ปลอม payload ส่ง redeem_points มาหวังส่วนลด แล้วโดนเงียบๆ (เข้าใจผิดว่าลดแล้ว)
  // 🐛 FIX — เดิมส่ง `usePhoneForPoints` (camelCase) ทั้งที่ destructure รับ `use_phone_for_points`
  // (snake_case) → ตัวแปรไม่เคยถูกประกาศ = ReferenceError 500 ทุกออเดอร์ (เงินสด/QR ทุกใบ)
  const pointsPolicy = resolveOrderPoints({ role: req.user.role, usePhoneForPoints: use_phone_for_points, redeem_points });
  if (pointsPolicy.blockedRedeem) {
    return forbidden(res, 'บัญชีพนักงานไม่มีสิทธิ์ใช้แต้มสมาชิก (แต้มสงวนสำหรับสมาชิกเท่านั้น)');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ Sprint 1 — B3: สะสมยอดในหน่วยสตางค์ (integer) กัน float drift ข้ามหลายรายการ — pattern เดียวกับ /sales/checkout
    let totalAmountSatang = 0;
    const processedItems = [];

    // ⭐️ อัตราแต้ม + สิทธิ์ส่วนลดกลุ่มของผู้สั่ง (pre-order สั่งด้วยตัวเอง user_id = สมาชิก)
    const { earnPer, redeemRate } = await getLoyaltyRates(conn);
    const groupDiscount = await getMemberGroupDiscount(conn, user_id);

    // คำนวณราคา + เช็คสต๊อกพอจริง (ล็อกแถวสินค้ากันขายเกินตอนมีหลายคนจองพร้อมกัน)
    for (const item of items) {
      const [rows] = await conn.query(`
        SELECT id, name, price, stock, category_id, expiry_date,
               GREATEST(
                 CASE WHEN promo_percent > 0 AND promo_start IS NOT NULL AND promo_end IS NOT NULL
                        AND CURDATE() BETWEEN promo_start AND promo_end
                      THEN promo_percent ELSE 0 END,
                 CASE WHEN expiry_date IS NOT NULL
                        AND DATEDIFF(DATE(expiry_date), CURDATE()) = 1
                      THEN COALESCE(discount_percent,0) ELSE 0 END
               ) AS best_discount_percent
        FROM products WHERE id = ? FOR UPDATE`, [item.product_id]);
      if (rows.length === 0) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);
      // 🐛 FIX — เดิมสั่งจองสินค้าหมดอายุได้ (หน้าจองโชว์ badge ไม่ได้ + backend ไม่ block) — เพิ่ม
      // ชั้นป้องกันเดียวกับ POST /api/sales/checkout (สินค้าหมดอายุขายไม่ได้) กันสั่งแล้วค้างออเดอร์
      if (getProductExpiry(rows[0]).status === 'expired') {
        throw new Error(`ไม่สามารถสั่งสินค้าที่หมดอายุแล้ว: ${rows[0].name}`);
      }
      if (rows[0].stock < item.quantity) {
        throw new Error(`สต๊อกไม่พอสำหรับ "${rows[0].name}" (เหลือ ${rows[0].stock}, ต้องการ ${item.quantity})`);
      }
      // ⭐️ ส่วนลดต่อชิ้น ลำดับเดียวกับ POS: โปรสินค้า > rule หมวดหมู่ของกลุ่ม > ส่วนลด default ของกลุ่ม
      let unitPrice = Number(rows[0].price);
      const discPct = Number(rows[0].best_discount_percent) || 0;
      if (discPct > 0) {
        unitPrice -= Math.round(unitPrice * discPct / 100);
      } else {
        const rulePct = groupDiscount.ruleByCategory.has(rows[0].category_id)
          ? groupDiscount.ruleByCategory.get(rows[0].category_id)
          : groupDiscount.defaultPct;
        if (rulePct > 0) unitPrice -= Math.round(unitPrice * rulePct / 100);
      }
      const subtotalSatang = toSatang(unitPrice) * item.quantity;
      const subtotal = fromSatang(subtotalSatang);
      totalAmountSatang += subtotalSatang;
      processedItems.push({ product_id: item.product_id, quantity: item.quantity, price: unitPrice, subtotal, stock_before: rows[0].stock });
    }
    const totalAmount = fromSatang(totalAmountSatang);

    // ⭐️ แลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — คำนวณ/ตรวจสอบใหม่ฝั่ง backend ทั้งหมด ห้ามเชื่อ client
    // (pattern เดียวกับ POST /sales/checkout: ล็อกแถว users FOR UPDATE กันแลกแต้มซ้ำ/เกินยอดจริง)
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (pointsPolicy.redeemPoints > 0) {
      const userRows = await lockUserPoints(conn, user_id);
      if (userRows.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้');
      const availablePoints = userRows[0].points;

      pointsRedeemed = resolveRedeemPoints({ requested: pointsPolicy.redeemPoints, availablePoints, totalAmount, redeemRate });
      pointsDiscount = fromSatang(toSatang(pointsRedeemed * redeemRate)); // อัตราแลก = redeemRate บาท/แต้ม
    }
    const netTotal = fromSatang(totalAmountSatang - toSatang(pointsDiscount));

    // คำนวณแต้มสะสมใหม่ที่จะได้รับ ถ้าลูกค้ากรอกเบอร์มา หรือติ๊กว่าจะสะสมแต้ม
    // (ทุก earnPer บาท = 1 แต้ม, คิดจากยอดสุทธิ "หลังหักแต้มที่แลกไปแล้ว") — เครดิตจริงตอนออเดอร์ COMPLETED
    const earnPoints = computeEarnPoints({ usePhoneForPoints: pointsPolicy.usePhoneForPoints, netTotal, earnPer });
    
    // สถานะ: ถ้าจ่ายสแกน = รอตรวจสอบสลิป, ถ้าเงินสด = รอจ่ายหน้าร้าน
    const status = payment_method === 'QR' ? 'PENDING_VERIFY' : 'WAITING_CASH';

    // บันทึกหัวบิลออเดอร์ (⭐️ total_amount = ยอดสุทธิหลังหักแต้มแล้ว, เก็บ points_redeemed/points_discount ไว้ด้วย)
    // ⭐️ Task 4 — slip_verification_status='PENDING' ตั้งแต่สร้าง ถ้าจ่ายแบบ QR (มีสลิปมาตั้งแต่ต้น)
    // ⭐️ Sprint 2 — B6: Store idempotency_key
    const idempotencyKey = req.headers['idempotency-key'];
    const [orderResult] = await conn.query(
      'INSERT INTO orders (user_id, total_amount, payment_method, slip_image, slip_file_path, slip_verification_status, earn_points, points_redeemed, points_discount, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, netTotal, payment_method, slip_image || null, slip_image || null, payment_method === 'QR' ? 'PENDING' : null, earnPoints, pointsRedeemed, pointsDiscount, status, idempotencyKey || null]
    );
    const orderId = orderResult.insertId;

    // บันทึกรายการสินค้าในออเดอร์ + ตัดสต๊อกทันที (กันขายเกินตั้งแต่ลูกค้ากดจอง)
    const lowStockMsgs = [];
    for (const item of processedItems) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price, item.subtotal]
      );
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
      // ⭐️ Day 3 — พรีออเดอร์ไม่ยิง LINE alert (ตาม scope ที่ระบุไว้: checkout/sync-offline/shift-close
      // เท่านั้น) แค่ดึง .message ออกมาให้ตรง type เดิมของ lowStockMsgs (in-app notification เหมือนเดิม)
      const lowStock = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (lowStock) lowStockMsgs.push(lowStock.message);
    }

    // ⭐️ หักแต้มที่แลกใช้ไปทันที (กันแลกแต้มซ้ำ/เกินยอดจริงถ้าลูกค้ามีออเดอร์ค้างหลายใบพร้อมกัน)
    // ถ้าออเดอร์นี้ถูกยกเลิกภายหลัง ระบบจะคืนแต้มให้ที่ PUT /orders/:id/status (CANCELLED) และ /orders/:id/cancel-by-user
    if (pointsRedeemed > 0) {
      await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, user_id]);
      await writePointTxn(conn, user_id, 'REDEEM', -pointsRedeemed, null, orderId, user_id, 'แลกแต้มเป็นส่วนลด (พรีออเดอร์)');
    }

    // ⭐️ บันทึกแจ้งเตือนระบบ: มีออเดอร์จองใหม่เข้ามา (ให้พนักงานเห็นในหน้าแจ้งเตือนด้วย ไม่ใช่แค่ badge)
    // ⭐️ FIX: ข้อความแจ้งเตือนเดิมใช้คำซ้อน "คำสั่งซื้อจอง" ฟังดูเป็นทางการเกินไป ปรับให้เข้าใจง่ายขึ้น
    const newOrderMsg = `มีออเดอร์จองใหม่ #${orderId} เข้ามา`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [newOrderMsg]);

    await conn.commit();

    // ⭐️ เวทมนตร์ WebSocket: แจ้งเตือนพนักงานว่ามีออเดอร์ใหม่เข้าแล้ว!!
    req.io.emit('new_order_received', { message: 'มีคำสั่งซื้อใหม่เข้ามา!', order_id: orderId });
    req.io.emit('notifications_updated', { message: newOrderMsg });
    req.io.emit('stock_updated', { message: `ออเดอร์จอง #${orderId} ตัดสต๊อกแล้ว` });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));
    // ⭐️ Task 4 — แจ้ง ADMIN/CASHIER ว่ามีสลิปรอตรวจ (เฉพาะจ่ายแบบ QR ที่มีสลิปแนบมาตั้งแต่ต้น)
    if (payment_method === 'QR' && slip_image) {
      req.io.emit('payment_slip_received', { order_id: orderId, message: `ออเดอร์ #${orderId} มีสลิปรอตรวจสอบ` });
    }

    res.status(201).json({
      message: "สั่งจองสินค้าสำเร็จ",
      order_id: orderId,
      points_redeemed: pointsRedeemed,
      points_discount: pointsDiscount,
      total_amount: netTotal
    });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    // 🐛 FIX — retry หลัง server restart: แคช idempotency หาย แต่ออเดอร์เคยสร้างแล้ว (UNIQUE orders.idempotency_key)
    // → ตอบ "สำเร็จซ้ำ" พร้อม order_id เดิม แทน error 500 (กันสั่งจองซ้ำ)
    if (isIdempotentDuplicate(error)) {
      const [existingOrders] = await conn.query('SELECT id FROM orders WHERE idempotency_key = ?', [idempotencyKey || null]);
      if (existingOrders.length > 0) return res.status(201).json({ message: 'สั่งจองสินค้าสำเร็จ (request ซ้ำ — ไม่ได้สั่งซ้ำ)', order_id: existingOrders[0].id, duplicated: true });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }

    serverError(res);
  } finally {
    conn.release();
  }
});

// 3. API ดึงรายการออเดอร์
app.get('/api/orders', async (req, res) => {
  try {
    // ⭐️ ?mine=1 — หน้า "ประวัติการสั่ง" ของผู้ใช้ (รวม staff ที่สั่งจองของตัวเอง): ครอบเฉพาะออเดอร์
    //   ของตัวเองเสมอ ไม่ว่า role อะไร (เดิม staff ที่สั่งจองได้แล้วจะเห็นออเดอร์ของคนอื่นทั้งระบบ
    //   เพราะ default ของ staff คือ "ดูทั้งหมด" สำหรับหน้า OrderManagement) — staff ที่ใช้หน้า
    //   OrderManagement ไม่ส่ง param นี้จึงยังเห็นทั้งหมดตามเดิม
    const mineOnly = req.query.mine === '1' || req.query.mine === 'true';
    const scopeOwn = mineOnly || req.user.role === 'MEMBER';
    let query = `
      SELECT o.*, u.full_name as customer_name, u.phone_number,
             DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') as created_at_bkk
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
    `;
    const params = [];

    // MEMBER มองเห็นแค่ออเดอร์ของตัวเอง; staff มองเห็นทั้งหมดยกเว้นขอ ?mine=1 (ดูออเดอร์ตัวเองในหน้าสั่งจอง)
    if (scopeOwn) {
      query += ` WHERE o.user_id = ?`;
      params.push(req.user.id);
    }
    query += ` ORDER BY o.created_at DESC`;

    const [orders] = await pool.query(query, params);

    // 🐛 FIX (N+1) — เดิมยิง query ทีละออเดอร์ในลูป: ออเดอร์ N ใบ = N query ทุกครั้งที่โหลด
    // (OrderManagement poll ทุก 5 วิ + หน้า MyOrders/OrderDetail). ดึง items ทั้งหมดครั้งเดียว
    // ด้วย IN แล้ว group ใน JS — 1 query เสมอ ไม่ว่า N เท่าไร
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const [allItems] = await pool.query(`
        SELECT oi.*, p.name as product_name, p.image_url 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
        ORDER BY oi.id
      `, orderIds);
      const itemsByOrder = new Map();
      for (const it of allItems) {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push(it);
      }
      for (const order of orders) order.items = itemsByOrder.get(order.id) || [];
    }

    res.json(orders);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// 4. API จัดการสถานะออเดอร์ (พนักงานกดยืนยัน / ยกเลิก)
app.put('/api/orders/:id/status', requireRole('ADMIN', 'CASHIER', 'MANAGER'), async (req, res) => {
  const orderId = req.params.id;
  // ⭐️ F3 (frontend) — รับ notes เป็น alias ของ reject_reason ด้วย เผื่อ frontend ส่งชื่อ field ต่างกันตามบริบท (ตรวจสลิป vs ยกเลิก)
  const { status, reject_reason: rawRejectReason, notes } = req.body;
  const reject_reason = rawRejectReason || notes || null;
  // status: PENDING_VERIFY/WAITING_CASH → WAITING_ACCEPT (รอพนักงานรับ) → PREPARING → READY → COMPLETED
  //         PENDING_VERIFY → SLIP_REJECTED (สลิปผิด, ขอส่งใหม่)
  //         PENDING_VERIFY → REFUND_REQUESTED (โอนแล้วแต่ไม่เอาแล้ว)
  //         PENDING_VERIFY/WAITING_CASH/WAITING_ACCEPT/any → CANCELLED (สลิปปลอม/ยกเลิก)

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ดึงข้อมูลออเดอร์มาเช็ค
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) throw new Error("ไม่พบออเดอร์นี้");
    const order = orders[0];

    // ⭐️ ตรวจสิทธิ์: ถ้ามี assigned_to แล้ว เฉพาะคนนั้น (หรือ ADMIN) เท่านั้นที่แก้ได้
    if (order.assigned_to && order.assigned_to !== req.user.id && req.user.role !== 'ADMIN') {
      const assignee = await getUserFullName(conn, order.assigned_to);
      throw new Error(`ออเดอร์นี้อยู่ในความรับผิดชอบของ ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว`);
    }

    // 🐛 FIX — guard transition ของสถานะออเดอร์ (เดิมมีแค่กัน CANCELLED ซ้ำ): สถานะ terminal
    // (COMPLETED/CANCELLED) เปลี่ยนต่อไม่ได้ — กัน COMPLETED ซ้ำ (ได้แต้มซ้ำ), CANCELLED → COMPLETED
    // (ได้แต้มจากออเดอร์ที่ยกเลิก), CANCELLED หลังรับของแล้ว (คืนสต๊อก/แต้มทั้งที่ของออกไปแล้ว) ฯลฯ
    if (order.status === 'CANCELLED') {
      throw new Error("ออเดอร์นี้ถูกยกเลิกไปแล้ว");
    }
    if (order.status === 'COMPLETED') {
      throw new Error("ออเดอร์นี้เสร็จสมบูรณ์แล้ว ไม่สามารถเปลี่ยนสถานะได้");
    }
    // ⭐️ ห้ามยกเลิกออเดอร์ที่เริ่มเตรียมของ/พร้อมให้รับแล้ว (กันเตรียมของไปแล้วโดนยกเลิกทีหลัง)
    if (status === 'CANCELLED' && ['PREPARING', 'READY'].includes(order.status)) {
      throw new Error("ไม่สามารถยกเลิกได้ เนื่องจากเริ่มเตรียมสินค้าไปแล้ว");
    }

    let stockChanged = false;
    const lowStockMsgs = [];

    // ⭐️ ถ้ายังไม่มีคนรับงาน → auto-assign ให้คนที่กดเลย (first action = claim)
    if (!order.assigned_to) {
      await conn.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [req.user.id, orderId]);
    }

    // อัปเดตสถานะ
    // ⭐️ ตั้ง ready_at ตอนเปลี่ยนเป็น READY เท่านั้น — ใช้เป็นจุดอ้างอิงของ cron เตือนลูกค้าที่ของพร้อม
    // แล้วแต่ยังไม่มารับ (แยกจาก completed_at ที่นับตอนลูกค้ามารับของจริงๆ)
    if (status === 'READY') {
      await conn.query('UPDATE orders SET status = ?, ready_at = NOW() WHERE id = ?', [status, orderId]);
    } else {
      await conn.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    }

    // ถ้ายกเลิกออเดอร์ (เช่น สลิปมั่ว) — คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนลูกค้าจอง
    let cancelMsg = null;
    if (status === 'CANCELLED') {
      // ⭐️ FIX: ข้อความแจ้งเตือนปรับให้อ่านเข้าใจง่ายขึ้น ไม่ใช้ศัพท์ทางการ/รูปแบบ log ระบบ
      cancelMsg = `ออเดอร์ #${orderId} ถูกยกเลิกแล้ว สาเหตุ: ${reject_reason || 'สลิปไม่ถูกต้อง'}`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [order.user_id, cancelMsg]);

      // 🐛 FIX — คืนสต๊อก/แต้มเฉพาะที่ยังไม่ได้คืน: ถ้าเคย SLIP_REJECTED (คืนสต๊อกไปแล้วตอน reject)
      // หรือ REFUND_REQUESTED (คืนแต้มไปแล้ว) ห้ามคืนซ้ำ ไม่งั้นสต๊อก/แต้มเกินจริง
      if (order.status !== 'SLIP_REJECTED') {
        const items = await getOrderItems(conn, orderId);
        for (const item of items) {
          await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
        }
        stockChanged = true;
      }
      // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
      if (order.points_redeemed > 0 && order.status !== 'REFUND_REQUESTED') {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
        await writePointTxn(conn, order.user_id, 'ADJUST', order.points_redeemed, null, orderId, req.user.id, 'คืนแต้มจากการยกเลิกออเดอร์');
      }
    }

    // ⭐️ สลิปผิด — คืนสต๊อก แจ้งลูกค้าให้ส่งสลิปใหม่หรือยกเลิก
    if (status === 'SLIP_REJECTED') {
      const items = await getOrderItems(conn, orderId);
      for (const item of items) {
        await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      stockChanged = true;

      // ⭐️ Task 4 — บันทึกผลตรวจสลิป (reject) ลง orders โดยตรง แทนการสร้าง endpoint แยกที่จะตัดสต๊อกซ้ำ
      await conn.query(
        `UPDATE orders SET slip_verification_status = 'REJECTED' WHERE id = ?`,
        [orderId]
      );
      await logAudit(conn, 'REJECT_SLIP', req.user.id, { reason: reject_reason || null }, 'ORDER', orderId);
    }

    // ⭐️ ขอคืนเงิน (โอนมาแล้วแต่ไม่เอาแล้ว) — แจ้งลูกค้าให้นำสลิปมาที่ร้าน + คืนแต้ม
    // 🐛 FIX — กันคืนแต้มซ้ำถ้ากด REFUND_REQUESTED ซ้ำ (ต้องมาจากสถานะที่ยังไม่ได้คืน)
    if (status === 'REFUND_REQUESTED') {
      if (order.points_redeemed > 0 && order.status !== 'REFUND_REQUESTED') {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
        await writePointTxn(conn, order.user_id, 'ADJUST', order.points_redeemed, null, orderId, req.user.id, 'คืนแต้มจากการขอคืนเงิน');
      }
    }

    // 🐛 FIX — SLIP_REJECTED คืนสต๊อกไปตอน reject แล้ว ถ้าออกจากสถานะนี้กลับสู่สถานะที่ต้องขายของ
    // (ตรวจสลิปใหม่ = PENDING_VERIFY หรือ accept ผ่านหน้าร้าน = PREPARING ตรงๆ) ต้องตัดสต๊อกกลับคืน
    // ไม่งั้นสินค้าหลุดออกโดยไม่หักสต๊อก (ขายเกินได้) — PENDING_VERIFY เคยหลุดเพราะ branch เช็คแค่ PREPARING
    if (order.status === 'SLIP_REJECTED' && ['PENDING_VERIFY', 'WAITING_ACCEPT', 'PREPARING'].includes(status)) {
      const items = await getOrderItems(conn, orderId);
      for (const item of items) {
        const [res] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity]);
        if (res.affectedRows === 0) throw new Error(`สต๊อกสินค้าไม่พอสำหรับออเดอร์ #${orderId} กรุณาติดต่อลูกค้า`);
      }
      stockChanged = true;
    }

    // ถ้าออเดอร์เสร็จสมบูรณ์ (ลูกค้ามารับของแล้ว) ให้เพิ่มแต้มสะสม (สต๊อกตัดไปแล้วตั้งแต่ตอนจอง)
    if (status === 'COMPLETED') {
      await conn.query('UPDATE orders SET completed_at = NOW() WHERE id = ?', [orderId]);
      if (order.earn_points > 0) {
        // ⭐️ กันแต้มรั่วเข้าบัญชี staff (defense-in-depth): เครดิตเฉพาะเมื่อเจ้าของออเดอร์ยังเป็น
        // MEMBER อยู่ (เช่น ถูกเลื่อน role ระหว่างรอรับของ) — แต้ม = สิทธิ์สมาชิกเท่านั้น
        // (นโยบาย utils/preorderPolicy.js) — staff ที่สั่งตอนนี้ earn_points = 0 อยู่แล้ว
        const ownerRows = await getUserRole(conn, order.user_id);
        if (isMemberRole(ownerRows[0]?.role)) {
          await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.earn_points, order.user_id]);
          await writePointTxn(conn, order.user_id, 'EARN', order.earn_points, null, orderId, req.user.id, 'แต้มสะสมจากพรีออเดอร์');
        }
      }
    }

    // ⭐️ F3 — จุดที่ "ตรวจสลิปผ่าน" จริงๆ คือ PENDING_VERIFY → PREPARING (ไม่ใช่ตอน COMPLETED ซึ่งคือลูกค้ามารับของ
    // แก้จาก Task 4 เดิมที่ผูก slip_verification_status='VERIFIED' ไว้ผิดจุดที่ COMPLETED)
    // 🐛 FIX — SLIP_REJECTED → PREPARING (accept หน้าร้าน) ก็ต้อง mark VERIFIED ด้วย เดิมหลุด (ยังค้าง REJECTED)
    if (['PENDING_VERIFY', 'SLIP_REJECTED'].includes(order.status) && ['PREPARING', 'WAITING_ACCEPT'].includes(status)) {
      await conn.query(
        `UPDATE orders SET slip_verification_status = 'VERIFIED', slip_verified_by = ?, slip_verified_at = NOW() WHERE id = ?`,
        [req.user.id, orderId]
      );
      await logAudit(conn, 'VERIFY_SLIP', req.user.id, { notes: reject_reason || null }, 'ORDER', orderId);
    }

    // ⭐️ แจ้งเตือนลูกค้าแบบมีข้อความจริง บันทึกลง notifications ด้วย (ไม่ใช่แค่ socket เฉยๆ กันพลาดถ้าลูกค้าไม่ได้เปิดแอปอยู่ตอนนั้น)
    // ⭐️ FIX: ข้อความแจ้งเตือนลูกค้าเดิมใช้คำทางการ/ระบบเกินไป (เช่น "พนักงานรับเรื่องแล้ว", "เนื่องจาก:")
    // ปรับเป็นภาษาพูดธรรมดาที่คนทั่วไปอ่านแล้วเข้าใจทันที ความหมาย/ตัวแปรเหมือนเดิมทุกจุด
    const statusMessages = {
      WAITING_ACCEPT: `ออเดอร์ #${orderId} รอพนักงานรับงาน`,
      PREPARING: `ร้านได้รับออเดอร์ #${orderId} แล้ว กำลังจัดเตรียมสินค้าให้คุณ${order.payment_method === 'CASH' ? ' เตรียมเงินสดไว้ได้เลยนะครับ' : ''}`,
      READY: `สินค้าออเดอร์ #${orderId} เตรียมเสร็จแล้ว มารับได้เลยครับ`,
      COMPLETED: `รับสินค้าออเดอร์ #${orderId} เรียบร้อยแล้ว ขอบคุณที่ใช้บริการครับ`,
      SLIP_REJECTED: `สลิปโอนเงินของออเดอร์ #${orderId} ไม่ถูกต้อง: ${reject_reason || 'กรุณาตรวจสอบอีกครั้ง'} — กรุณาแนบสลิปใหม่ หรือแจ้งพนักงานถ้าต้องการยกเลิกออเดอร์`,
      REFUND_REQUESTED: `ออเดอร์ #${orderId} กำลังดำเนินการคืนเงิน กรุณานำหลักฐานการโอนมาที่ร้านเพื่อรับเงินคืนเป็นเงินสด`,
    };
    const statusMsg = statusMessages[status] || cancelMsg;
    if (statusMessages[status]) {
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [order.user_id, statusMsg]);
    }

    await conn.commit();

    // ⭐️ ย้ายมาหลัง commit เสมอ กัน client รีเฟรชแล้วเจอข้อมูลเก่า (transaction ยังไม่ commit ตอนยิง event)
    if (stockChanged) req.io.emit('stock_updated', { message: `ออเดอร์ #${orderId} อัปเดตสต๊อกแล้ว` });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));
    if (statusMsg) req.io.to(`user_${order.user_id}`).emit(`notification_user_${order.user_id}`, { message: statusMsg });
    req.io.to(`user_${order.user_id}`).emit(`order_update_user_${order.user_id}`, { order_id: orderId, status: status });
    req.io.emit('order_status_changed', { order_id: orderId, status: status });

    // ⭐️ Day 3 — พรีออเดอร์พร้อมรับ: แจ้งลูกค้าตรงผ่าน LINE ด้วย (แยกจากแจ้งเตือนในแอปด้านบน ซึ่งลูกค้า
    // ต้องเปิดแอปถึงจะเห็น) ไม่รอ (await) ก่อนตอบ response — ไม่ควรให้ LINE API ช้าทำให้ staff รอ
    if (status === 'READY') {
      pool.query('SELECT line_user_id FROM users WHERE id = ?', [order.user_id])
        .then(async ([userRows]) => {
          const lineUserId = userRows[0]?.line_user_id;
          if (!lineUserId) return; // notifyIfLowStock-style fail-soft: ไม่มีผูกบัญชี LINE ก็ข้ามเงียบๆ
          const [itemRows] = await pool.query(
            'SELECT p.name, oi.quantity FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
            [orderId]
          );
          await sendPreOrderReadyNotification({
            id: orderId,
            line_user_id: lineUserId,
            items: itemRows.map(r => ({ name: r.name, quantity: r.quantity })),
          });
        })
        .catch(err => console.error('[LINE] sendPreOrderReadyNotification error:', err.message));
    }

    res.json({ message: "อัปเดตสถานะออเดอร์สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally {
    conn.release();
  }
});

// ⭐️ 1. แก้ไข API ดึงแจ้งเตือนให้ดึงแค่ 50 รายการล่าสุด
// ⭐️ ADMIN/CASHIER เห็นแจ้งเตือนระบบ (user_id IS NULL: ออเดอร์ใหม่/void/สต๊อกใกล้หมด) รวมกับของตัวเอง
// MEMBER เห็นเฉพาะแจ้งเตือนของตัวเอง (เช่น สถานะออเดอร์ที่จอง/ตีกลับสลิป)
app.get('/api/notifications', async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'CASHIER'].includes(req.user.role);
    const query = isStaff
      ? 'SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 50'
      : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50';
    const [rows] = await pool.query(query, [req.user.id]);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ ทำเครื่องหมายอ่าน "ทีละรายการ" — เดิมมีแต่ read-all ทำให้ frontend ที่อยากมาร์คแค่รายการเดียว
// ต้องเรียก read-all แทน (= อ่านหมดทั้งกล่องทั้งที่ผู้ใช้คลิกอันเดียว) แจ้งเตือนที่ยังไม่ได้อ่านจริง
// เลยหายเกลี้ยงหลัง refresh
// scope ตาม visibility เดียวกับ GET /api/notifications: staff เห็นของระบบ (user_id IS NULL) ด้วย
// ส่วน MEMBER แตะได้เฉพาะของตัวเอง — กันมาร์คแจ้งเตือนของคนอื่น
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'CASHIER'].includes(req.user.role);
    const query = isStaff
      ? 'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id IS NULL OR user_id = ?)'
      : 'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?';
    const [result] = await pool.query(query, [req.params.id, req.user.id]);
    if (result.affectedRows === 0) {
      return notFound(res, 'ไม่พบการแจ้งเตือนนี้');
    }
    res.json({ message: 'อ่านแจ้งเตือนแล้ว' });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ ทำเครื่องหมายอ่านแจ้งเตือนทั้งหมดแล้ว — ตอนนี้เรียกจากปุ่ม "อ่านทั้งหมด" เท่านั้น
// (เดิมยิงอัตโนมัติตอนกดกระดิ่งเปิดหน้าแจ้งเตือน ทำให้ทุกอย่างถูกมาร์คว่าอ่านโดยที่ผู้ใช้ยังไม่ได้อ่าน)
app.put('/api/notifications/read-all', async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'CASHIER'].includes(req.user.role);
    const query = isStaff
      ? 'UPDATE notifications SET is_read = 1 WHERE user_id IS NULL OR user_id = ?'
      : 'UPDATE notifications SET is_read = 1 WHERE user_id = ?';
    await pool.query(query, [req.user.id]);
    res.json({ message: "อ่านแจ้งเตือนทั้งหมดแล้ว" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ API ดึงจำนวนออเดอร์ที่รอจัดการ (แสดงเลข Badge แดงๆ) — ย้ายมาไว้ก่อน จะได้ลบ route ซ้ำด้านล่างได้สะดวก
app.get('/api/orders/pending-count', requireRole('ADMIN', 'CASHIER', 'MANAGER'), async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(id) as count FROM orders WHERE status IN ('PENDING_VERIFY', 'WAITING_CASH', 'WAITING_ACCEPT', 'PREPARING')");
    res.json({ count: rows[0].count || 0 });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// ⭐️ เพิ่ม API ให้ลูกค้ายกเลิกออเดอร์ตัวเอง
app.put('/api/orders/:id/cancel-by-user', authenticateToken, async (req, res) => {
  const orderId = req.params.id;
  const { refund_info } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE', [orderId, req.user.id]);
    if (orders.length === 0) throw new Error("ไม่พบออเดอร์นี้ หรือคุณไม่มีสิทธิ์ยกเลิก");
    const order = orders[0];

    if (!['PENDING_VERIFY', 'WAITING_CASH', 'WAITING_ACCEPT'].includes(order.status)) {
      throw new Error("ไม่สามารถยกเลิกได้ (ระบบกำลังเตรียมของหรือเสร็จแล้ว) กรุณาติดต่อพนักงาน");
    }

    const cancelReason = order.payment_method === 'QR' 
      ? `ลูกค้ายกเลิกเอง (คืนเงินไปที่: ${refund_info})` 
      : 'ลูกค้ายกเลิกเอง';

    await conn.query('UPDATE orders SET status = ?, reject_reason = ? WHERE id = ?', ['CANCELLED', cancelReason, orderId]);

    // ⭐️ คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนจอง
    const items = await getOrderItems(conn, orderId);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
    if (order.points_redeemed > 0) {
      await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
      await writePointTxn(conn, order.user_id, 'ADJUST', order.points_redeemed, null, orderId, req.user.id, 'คืนแต้มจากการยกเลิกออเดอร์ (ลูกค้ายกเลิกเอง)');
    }

    await conn.commit();

    req.io.emit('new_order_received', { message: `❌ ลูกค้ายกเลิกออเดอร์ #${orderId}`, order_id: orderId });
    req.io.emit('order_status_changed', { order_id: orderId, status: 'CANCELLED' });
    req.io.emit('stock_updated', { message: `ออเดอร์ #${orderId} ยกเลิก คืนสต๊อกแล้ว` });
    req.io.to(`user_${order.user_id}`).emit(`order_update_user_${order.user_id}`, { order_id: orderId, status: 'CANCELLED' });

    res.json({ message: "ยกเลิกออเดอร์สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally {
    conn.release();
  }
});

// ⭐️ Sprint 2 — B9: File Upload Validation Endpoints

/**
 * POST /api/orders/:id/upload-slip — Upload payment slip for an order
 * Only MEMBER can upload
 * Validates: MIME type (jpeg, png, gif, webp), size (5MB max), dimensions (400×300 to 4000×3000)
 * Returns: { success, filename, path, dimensions }
 */
// ⭐️ เปิดให้ MANAGER ส่งสลิปได้ด้วย (staff สั่งจองของตัวเองแล้วต้องส่งสลิปเหมือนสมาชิก) — ownership
//   ยังเช็ค user_id ใน handler เหมือนเดิม กันแตะออเดอร์คนอื่น
app.post('/api/orders/:id/upload-slip', requireRole('MEMBER', 'CASHIER', 'MANAGER', 'ADMIN'), uploadLimiter, slipUpload.single('slip'), async (req, res) => {
  const { id } = req.params;
  try {
    if (!req.file) {
      return badRequest(res, 'No file uploaded');
    }

    // ⭐️ ตรวจว่า order มีจริงและเป็นของ user ก่อน
    const [orders] = await pool.query(
      'SELECT id, status FROM orders WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (orders.length === 0) {
      return notFound(res, 'Order not found or does not belong to you');
    }

    const order = orders[0];
    // ⭐️ อนุญาตอัปสลิปเมื่อสถานะ PENDING_VERIFY (สลิปใหม่) หรือ SLIP_REJECTED (ส่งใหม่)
    if (!['PENDING_VERIFY', 'SLIP_REJECTED'].includes(order.status)) {
      return badRequest(res, `Order must be in PENDING_VERIFY or SLIP_REJECTED status to upload slip. Current status: ${order.status}`);
    }

    // ⭐️ ตรวจ MIME (jpeg, png, gif, webp)
    const allowedPaymentSlipMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedPaymentSlipMimes.includes(req.file.mimetype)) {
      return badRequest(res, `Invalid file type: ${req.file.mimetype}. Only JPEG, PNG, GIF, WebP allowed.`);
    }

    // ตรวจขนาดไฟล์ (สลิป ≤ 5 MB)
    if (req.file.size > 5 * 1024 * 1024) {
      return badRequest(res, 'File too large (max 5 MB for payment slip)');
    }

    // ตรวจ dimensions จาก buffer (สลิป min 400×300, max 4000×3000)
    const dimensions = await validateImageDimensions(req.file.buffer, 400, 300, 4000, 3000);

    // ⭐️ อัปโหลดขึ้น Cloudinary (หรือดิสก์ถ้า dev) → เก็บ URL/พาธเต็มลง slip_image
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const base = `${Date.now()}_${req.user.id}`;
    const slipUrl = await saveImage(req.file.buffer, 'slips', base, ext);

    // 🐛 FIX — เดิมอัปเดตตรงๆ ไม่มี transaction: ตอน SLIP_REJECTED คืนสต๊อกไปแล้ว พอลูกค้าส่งสลิปใหม่
    // (สถานะกลับ PENDING_VERIFY) ไม่มีใครตัดสต๊อกคืน → พอออเดอร์เดินต่อถึง COMPLETED สินค้าหลุดออก
    // โดยไม่หักสต๊อก (ขายเกินได้). ทำใน transaction + ล็อกแถว FOR UPDATE กันส่งซ้ำ/ตัดสต๊อกซ้ำ
    const conn = await pool.getConnection();
    let wasRejected = false; // hoist ออกมา — ต้องใช้นอก transaction เพื่อตัดสินใจยิง event realtime
    try {
      await conn.beginTransaction();
      const [lockedOrders] = await conn.query(
        'SELECT id, status FROM orders WHERE id = ? AND user_id = ? FOR UPDATE',
        [id, req.user.id]
      );
      if (lockedOrders.length === 0) throw new Error('Order not found or does not belong to you');
      const locked = lockedOrders[0];
      if (!['PENDING_VERIFY', 'SLIP_REJECTED'].includes(locked.status)) {
        throw new Error(`Order must be in PENDING_VERIFY or SLIP_REJECTED status to upload slip. Current status: ${locked.status}`);
      }

      wasRejected = locked.status === 'SLIP_REJECTED';
      const statusUpdate = wasRejected ? ', status = \'PENDING_VERIFY\'' : '';
      const [result] = await conn.query(
        `UPDATE orders SET slip_image = ?${statusUpdate} WHERE id = ? AND user_id = ?`,
        [slipUrl, id, req.user.id]
      );
      if (result.affectedRows === 0) throw new Error('Failed to save payment slip to order');

      if (wasRejected) {
        const items = await getOrderItems(conn, id);
        for (const item of items) {
          const [res] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity]);
          if (res.affectedRows === 0) throw new Error(`สต๊อกสินค้าไม่พอสำหรับออเดอร์ #${id} กรุณาติดต่อพนักงาน`);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // ⭐️ แจ้ง ADMIN/CASHIER ว่ามีสลิปเข้ามา
    req.io.emit('payment_slip_received', {
      order_id: id,
      message: `ออเดอร์ #${id} ส่งสลิปใหม่ (resubmit)`
    });
    req.io.emit('notifications_updated', {
      message: `ลูกค้าส่งสลิปใหม่สำหรับออเดอร์ #${id}`
    });

    // ⭐️ realtime กลับเจ้าของออเดอร์ เฉพาะตอน resubmit (SLIP_REJECTED → PENDING_VERIFY):
    //   เดิมไม่ยิง event นี้ → แถบเตือนสลิปไม่ผ่านใน Layout ค้างอยู่บนเครื่องอื่นจนกว่าจะ refresh หน้า
    //   (ฝั่งที่ส่งเองซ่อนได้เพราะ refetch ผ่าน onUploaded) + หน้า PreOrder ไม่รู้ว่าสถานะเปลี่ยน
    //   ครอบ staff ด้วย (staff สั่งจองของตัวเองได้ — socket อยู่ในห้อง user_${id} เหมือนกัน)
    if (wasRejected) {
      req.io.to(`user_${req.user.id}`).emit(`order_update_user_${req.user.id}`, { order_id: id, status: 'PENDING_VERIFY' });
      // ⭐️ ให้หน้า OrderManagement (list) + badge นับออเดอร์ค้างใน Layout รีเฟรชทันที
      req.io.emit('order_status_changed', { order_id: id, status: 'PENDING_VERIFY' });
    }

    res.json({ success: true, path: slipUrl, dimensions });
  } catch (err) {
    console.error(`[upload-slip] ${err.message}`);
    badRequest(res, err.message);
  }
});

/**
 * POST /api/shifts/:id/upload-photo — Upload close photo for a shift
 * Only CASHIER/ADMIN can upload
 * Validates: MIME type (jpeg, png only), size (10MB max), dimensions (min 800×600)
 * Returns: { success, filename, path, dimensions }
 */
app.post('/api/shifts/:id/upload-photo', requireRole('CASHIER', 'ADMIN'), uploadLimiter, shiftPhotoUpload.single('photo'), async (req, res) => {
  const { id } = req.params;

  try {
    if (!req.file) {
      return badRequest(res, 'No file uploaded');
    }

    // ⭐️ Sprint 2 — B9: ตรวจ MIME (jpeg, png เท่านั้น)
    const allowedPhotoMimes = ['image/jpeg', 'image/png'];
    if (!allowedPhotoMimes.includes(req.file.mimetype)) {
      return badRequest(res, `Invalid file type: ${req.file.mimetype}. Only JPEG and PNG allowed for shift photos.`);
    }

    // ตรวจขนาดไฟล์ (≤ 10 MB)
    if (req.file.size > 10 * 1024 * 1024) {
      return badRequest(res, 'File too large (max 10 MB)');
    }

    // ตรวจ dimensions จาก buffer (รูปปิดกะ min 800×600)
    const dimensions = await validateImageDimensions(req.file.buffer, 800, 600, 10000, 10000);

    // 🐛 FIX — เช็ค ownership ก่อนอัปโหลด (เดิมอัปโหลดก่อนแล้วค่อย UPDATE) กันไฟล์孤儿เมื่อกะไม่ใช่
    // ของเรา/ไม่มีอยู่จริง: CASHIER ใช้ได้เฉพาะกะของตัวเอง (cashier_id จาก JWT — ไม่เชื่อจาก body),
    // ADMIN อัปโหลดให้กะใครก็ได้ (จัดการกะ) — ตาราง shifts ใช้ cashier_id ไม่ใช่ user_id
    const isAdmin = req.user.role === 'ADMIN';
    const [shiftRows] = await pool.query(
      isAdmin
        ? 'SELECT id FROM shifts WHERE id = ?'
        : 'SELECT id FROM shifts WHERE id = ? AND cashier_id = ?',
      isAdmin ? [id] : [id, req.user.id]
    );
    if (shiftRows.length === 0) {
      return notFound(res, isAdmin ? 'ไม่พบกะนี้' : 'ไม่พบกะนี้ หรือคุณไม่มีสิทธิ์อัปโหลดรูปให้กะนี้');
    }

    // ⭐️ อัปโหลดขึ้น Cloudinary (หรือดิสก์ถ้า dev) → เก็บ URL/พาธเต็มลง close_photo
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const base = `${Date.now()}_${req.user.id}`;
    const photoUrl = await saveImage(req.file.buffer, 'shift-photos/close', base, ext);

    // 🐛 FIX — เดิมใช้ `WHERE id = ? AND user_id = ?` แต่ตาราง shifts ไม่มีคอลัมน์ user_id
    // (เป็น cashier_id) → SQL error ทุกครั้ง (ER_BAD_FIELD_ERROR) + 400 พร้อมข้อความ error ดิบรั่ว
    // อัปเดตด้วย cashier_id + ล็อก scope ตามสิทธิ์อีกชั้น (เผื่อกะถูกลบ/เปลี่ยนเจ้าของระหว่างเช็ค)
    await pool.query(
      isAdmin
        ? 'UPDATE shifts SET close_photo = ? WHERE id = ?'
        : 'UPDATE shifts SET close_photo = ? WHERE id = ? AND cashier_id = ?',
      isAdmin ? [photoUrl, id] : [photoUrl, id, req.user.id]
    );

    res.json({ success: true, path: photoUrl, dimensions });
  } catch (err) {
    // 🐛 FIX — กัน error ดิบ (SQL/Cloudinary message) รั่วไปให้ client: เก็บรายละเอียดไว้ใน log
    // เฉพาะ error ตรวจขนาดรูป (ตั้งใจให้ผู้ใช้เห็น) ถึงจะส่งข้อความจริงกลับไป
    console.error('[500]', err.message);
    if (err.message && err.message.startsWith('Image validation failed:')) {
      return badRequest(res, err.message.replace(/^Image validation failed:\s*/, ''));
    }
    serverError(res);
  }
});

/**
 * GET /api/uploads/:filename — Serve uploaded file
 * Security: validates filename (no directory traversal)
 * Returns: file with proper Content-Type headers
 */
// ⭐️ SECURITY FIX (วิกฤต #1) — เสิร์ฟไฟล์อัปโหลด (สลิป/รูปเข้างาน/รูปสินค้า) แบบมี JWT คุม
// รับ path เต็มที่เก็บใน DB เช่น ?path=/uploads/slips/2026-07-18/xxx.jpg (มี subfolder ได้)
// endpoint นี้ไม่อยู่ใน PUBLIC_PATHS จึงผ่าน authenticateToken อัตโนมัติ = ต้อง login ก่อนถึงเปิดดูได้
// (ของเดิม /api/uploads/:filename ชี้ผิดไดเรกทอรี '../uploads' + ไม่รองรับ subfolder — เลิกใช้)
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
app.get('/api/media', async (req, res) => {
  try {
    let rel = String(req.query.path || '');
    if (!rel) return badRequest(res, 'ต้องระบุ path');

    // ตัด prefix '/uploads' ออก (path ใน DB ขึ้นต้นด้วย /uploads/...)
    rel = rel.replace(/^\/+/, '');            // ตัด / นำหน้า
    if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);

    // ป้องกัน directory traversal — resolve แล้วต้องยังอยู่ใต้ UPLOADS_ROOT เท่านั้น
    const abs = path.normalize(path.join(UPLOADS_ROOT, rel));
    if (!abs.startsWith(UPLOADS_ROOT + path.sep)) {
      return badRequest(res, 'path ไม่ถูกต้อง');
    }
    if (!fs.existsSync(abs)) {
      return notFound(res, 'ไม่พบไฟล์');
    }

    // กันไม่ให้ browser/proxy แคชสลิปไว้แชร์ต่อ (เป็นข้อมูลส่วนตัว)
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(abs);
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

// =========================================
// API สำหรับล้างข้อมูล (เตรียมอัปเกรดระบบ)
// =========================================
// ⭐️ Fix 1 — เดิมเป็น GET (ลบข้อมูลจริงแค่เปิดลิงก์/prefetch ก็โดน) เปลี่ยนเป็น DELETE + ยังคง requireRole('ADMIN')
app.delete('/api/clear-data', requireRole('ADMIN'), async (req, res) => {
  try {
    // ปิดการเช็ค Foreign Key ชั่วคราว เพื่อให้ลบข้อมูลที่ผูกกันอยู่ได้
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    // รายชื่อตารางที่ต้องการล้างข้อมูลทิ้ง (ไม่รวม users และ settings)
    // ⭐️ เอา 'members' ออก — ตารางนี้ไม่มีอยู่จริงในสคีมา (ดูจุดที่ลบ /api/members/* ใน HOTFIX 3)
    // ทิ้งไว้จะทำให้ทุกครั้งที่เรียก endpoint นี้ crash ด้วย ER_NO_SUCH_TABLE
    const tablesToClear = [
      'purchase_items',
      'purchases',
      'sale_items',
      'sales',
      'shifts',
      'products',
      'promotions',
      'suppliers'
    ];

    // วนลูปใช้คำสั่ง TRUNCATE ล้างข้อมูลและรีเซ็ต AUTO_INCREMENT เป็น 1
    for (let table of tablesToClear) {
      await pool.query(`TRUNCATE TABLE ${table}`);
    }

    // เปิดการเช็ค Foreign Key กลับมาเหมือนเดิม
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    res.json({ message: "เคลียร์ข้อมูลสำเร็จ! ข้อมูลสินค้าและบิลหายไปแล้ว (แต่ยังคง User ไว้) 🎉" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// API สำหรับนำเข้าข้อมูลสินค้าเริ่มต้น (Seed Data)
// =========================================
app.get('/api/seed-data', requireSetupKey, async (req, res) => {
  // ⭐️ Security remediation — bootstrap/dev-only endpoint, must not be reachable in production regardless of SETUP_KEY
  if (IS_PRODUCTION) return res.status(404).end();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. นำเข้าหมวดหมู่สินค้า 5 หมวด
    const categories = ['ไอศกรีม', 'เครื่องดื่ม', 'ขนมขบเคี้ยวและเบเกอรี่', 'อาหารกึ่งสำเร็จรูป', 'เครื่องเขียนและของเบ็ดเตล็ด'];
    const catMap = {}; // เก็บ ID ของหมวดหมู่ที่เพิ่งสร้าง
    for (let i = 0; i < categories.length; i++) {
      const [result] = await conn.query('INSERT INTO categories (name) VALUES (?)', [categories[i]]);
      catMap[categories[i]] = result.insertId;
    }

    // 2. รายการสินค้าทั้งหมดจากไฟล์ที่นายส่งมา (ให้สต๊อกเริ่มต้นที่ 50 ชิ้น และตั้งต้นทุนให้)
    const products = [
      // หมวด: ไอศกรีม
      { cat: 'ไอศกรีม', code: 'IC001', name: 'ไอศกรีมแม็กนั่ม อัลมอนด์ / คลาสสิก', price: 50 },
      { cat: 'ไอศกรีม', code: 'IC002', name: 'คอร์นเนตโต รสช็อกโกแลต คลาสสิก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC003', name: 'คอร์นเนตโต รสสตรอเบอร์รี่', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC004', name: 'คอร์นเนตโต รสช็อกโกแลต-วานิลลา', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC005', name: 'คอร์นเนตโต รสชาเขียว / รสพิเศษขนาดใหญ่', price: 35 },
      { cat: 'ไอศกรีม', code: 'IC006', name: 'คอร์นเนตโต รสพิเศษ', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC007', name: 'วอลล์ ท็อปเท็น รสช็อกโกแลต', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC008', name: 'วอลล์ ท็อปเท็น รสวานิลลาช็อก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC009', name: 'วอลล์ สวีทฮาร์ท ช็อกโกแลต', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC010', name: 'วอลล์ บอนด์ บอนด์ รสช็อกโกแลต', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC011', name: 'วอลล์ บอนด์ บอนด์ รสผลไม้/วานิลลา', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC012', name: 'วอลล์คัพ รสช็อกโกแลต', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC013', name: 'วอลล์คัพ รสสตรอเบอร์รี่', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC014', name: 'วอลล์คัพ รสวานิลลา', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC015', name: 'วอลล์ ป๊อป ถ้วยกลมเล็ก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC016', name: 'แพดเดิลป๊อป ทวิสเตอร์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC017', name: 'แพดเดิลป๊อป ฟรุตตี้แม็กซ์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC018', name: 'แพดเดิลป๊อป รสเรนโบว์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC019', name: 'แพดเดิลป๊อป จรวด ทอยสตอรี่', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC020', name: 'แพดเดิลป๊อป ผีน้อย', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC021', name: 'แพดเดิลป๊อป ช็อกลาวา', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC022', name: 'แพดเดิลป๊อป รสฟุตบอล', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC023', name: 'แพดเดิลป๊อป แท่งเล็กราคาประหยัด', price: 5 },
      { cat: 'ไอศกรีม', code: 'IC024', name: 'เนสท์เล่ ลาฟรุ๊ตต้า รสโยเกิร์ตลิ้นจี่', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC025', name: 'ไอศกรีมโอรีโอ แซนด์วิช/สติ๊ก', price: 35 },
      { cat: 'ไอศกรีม', code: 'IC026', name: 'เนสกาแฟ โกลด์ คาปูชิโน่ แท่ง', price: 40 },
      { cat: 'ไอศกรีม', code: 'IC027', name: 'วอลล์ รสข้าวเหนียวมะม่วง', price: 20 },

      // หมวด: เครื่องดื่ม
      { cat: 'เครื่องดื่ม', code: 'BV001', name: 'ชาคูลล์ซ่า กรีนที เลมอน', price: 15 },
      { cat: 'เครื่องดื่ม', code: 'BV002', name: 'ชาคูลล์ซ่า รสองุ่นเคียวโฮ', price: 15 },
      { cat: 'เครื่องดื่ม', code: 'BV003', name: 'นม UHT รสจืด/รสหวาน', price: 17 },
      { cat: 'เครื่องดื่ม', code: 'BV004', name: 'น้ำอัดลมกระป๋อง', price: 17 },
      { cat: 'เครื่องดื่ม', code: 'BV005', name: 'โออิชิ รสน้ำผึ้งผสมมะนาว', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV006', name: 'โออิชิ รสข้าวญี่ปุ่น', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV007', name: 'โออิชิ รสองุ่นเคียวโฮ', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV008', name: 'น้ำดื่มเพียวไลฟ์ / คริสตัล', price: 10 },
      { cat: 'เครื่องดื่ม', code: 'BV009', name: 'นมกล่องโฟร์โมสต์/ไทย-เดนมาร์ค', price: 12 },
      { cat: 'เครื่องดื่ม', code: 'BV010', name: 'ดีไลท์ / ดัชมิลล์ ขวดเล็ก', price: 10 },
      { cat: 'เครื่องดื่ม', code: 'BV011', name: 'น้ำอัดลมน้ำดำ/น้ำแดง ขวดใหญ่', price: 30 },

      // หมวด: ขนมขบเคี้ยวและเบเกอรี่
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN001', name: 'เลย์ รสคลาสสิก', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN002', name: 'เลย์ รสมะเขือเทศ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN003', name: 'เลย์ รสโนริสาหร่าย', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN004', name: 'เลย์ รสเอ็กซ์ตร้าบาร์บีคิว', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN005', name: 'ขนมโตโต้', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN006', name: 'ขนมรูปไก่ย่าง / ปาปริก้า', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN007', name: 'สแน็คแจ๊ค', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN008', name: 'คอนเน่ รสดั้งเดิม', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN009', name: 'วาฟเฟิลอบกรอบแผ่นกลม', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN010', name: 'ครองแครงกรอบ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN011', name: 'กล้วยฉาบ / เผือกฉาบ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN012', name: 'แคบหมูทอดกรอบ', price: 15 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN013', name: 'ขนมซองขนาดเล็ก (คละยี่ห้อ)', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN014', name: 'ขนมปังอบกรอบหน้าเนยน้ำตาล (เล็ก)', price: 10 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN015', name: 'ขนมปังอบกรอบหน้าเนยน้ำตาล (ใหญ่)', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN016', name: 'มาร์ชแมลโลว์ / เยลลี่กระปุก', price: 10 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN017', name: 'สาหร่ายเถ้าแก่น้อย บิ๊กชีท', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN018', name: 'เวเฟอร์ทิวลี่ทวิน รสช็อกโกแลต', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN019', name: 'ปลาหมึกแผ่นปรุงรส / เบนโตะ', price: 5 },

      // หมวด: อาหารกึ่งสำเร็จรูป
      { cat: 'อาหารกึ่งสำเร็จรูป', code: 'IF001', name: 'มาม่าคัพ รสต้มยำกุ้ง / หมูสับ', price: 15 },
      { cat: 'อาหารกึ่งสำเร็จรูป', code: 'IF002', name: 'ไวไวคัพ รสดั้งเดิม / ต้มยำ', price: 15 },

      // หมวด: เครื่องเขียนและของเบ็ดเตล็ด
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST001', name: 'กระบอกพลาสติกใสเอนกประสงค์', price: 25 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST002', name: 'ไม้บรรทัดพลาสติกสี', price: 10 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST003', name: 'ยางลบก้อนสีขาว', price: 5 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST004', name: 'กรรไกรสำนักงาน', price: 20 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST005', name: 'สมุดโน้ตปกพลาสติกอ่อน', price: 15 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST006', name: 'เหรียญของเล่นพลาสติกสีทอง', price: 10 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST007', name: 'เข็มขัดนักเรียนชายสีดำ', price: 50 },
    ];

    // นำเข้าสินค้า
    for (const p of products) {
      const categoryId = catMap[p.cat];
      const stock = 50; // ให้สต๊อกเริ่มต้น 50 ชิ้น จะได้กดขายได้เลย
      const cost = Math.floor(p.price * 0.7); // จำลองต้นทุนเป็น 70% ของราคาขาย

      await conn.query(
        'INSERT INTO products (barcode, name, category_id, price, stock, cost) VALUES (?, ?, ?, ?, ?, ?)',
        [p.code, p.name, categoryId, p.price, stock, cost]
      );
    }

    await conn.commit();
    res.json({ message: `เสกข้อมูลสำเร็จ! เพิ่มหมวดหมู่ ${categories.length} รายการ และสินค้า ${products.length} รายการ เรียบร้อยแล้ว 🎉` });

  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    serverError(res);
  } finally {
    conn.release();
  }
});

// =========================================
// API สร้างผู้จัดการคนแรก (เข้ารหัสผ่านเรียบร้อย!)
// =========================================
app.get('/api/create-admin', requireSetupKey, async (req, res) => {
  // ⭐️ Security remediation — bootstrap/dev-only endpoint, must not be reachable in production regardless of SETUP_KEY
  if (IS_PRODUCTION) return res.status(404).end();
  try {
    // ⭐️ Security remediation — เดิม hardcode รหัสผ่าน '1234' เปลี่ยนเป็นสุ่ม + บังคับเปลี่ยนรหัสผ่านก่อนใช้งาน
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    await pool.query("DELETE FROM users WHERE student_id = 'admin'");

    // ⭐️ เปลี่ยนจาก username เป็น student_id
    await pool.query(
      "INSERT INTO users (student_id, password, full_name, role, is_active, must_change_password) VALUES (?, ?, 'ผู้จัดการระบบ', 'ADMIN', 1, TRUE)",
      ['admin', hashedPassword]
    );

    console.log(`🔑 [create-admin] สร้างบัญชี admin แล้ว รหัสผ่านชั่วคราว: ${tempPassword}`);
    res.json({ message: "สร้างบัญชีสำเร็จ! 🎉 ดูรหัสผ่านชั่วคราวใน server log (ต้องเปลี่ยนรหัสผ่านทันทีหลังเข้าสู่ระบบครั้งแรก)" });
  } catch (error) {
    console.error('[500]', error.message);

    serverError(res);
  }
});

// =========================================
// BACKUP & SCHEDULED JOBS (หมวด 13 + auto-checkout)
// =========================================
// ⭐️ Refactor — เดิมมี backup 2 ระบบซ้อนกัน: runBackup() (docker exec mysqldump, ใช้ไม่ได้นอก
// docker/ไม่มี DB_ROOT_PASSWORD ก็พัง) กับ createBackup() จาก backup.js (query ตรงผ่าน pool, มี
// DB tracking table, ใช้งานได้จริงบนเครื่อง dev นี้). ลบระบบแรกทิ้ง เหลือระบบเดียวคือ createBackup()
// (ดู POST /api/admin/backups/create และ cron ด้านล่าง)

// ⭐️ Sprint 1 — D4: manual trigger เอาไว้เทสต์โดยไม่ต้องรอ cron 06:00 น. — คืนข้อมูลรายงานกลับมาด้วย
// เผื่อ ADMIN_EMAIL ยังไม่ตั้งค่า (sent: false) จะได้ยังเห็นตัวเลขได้
// ⭐️ Phase A (refactor) — daily/send ย้ายไปที่ reportController.js/reportRoutes.js แล้ว

// =========================================
// BACKUP & RESTORE (Sprint 2 — C3)
// =========================================

app.get('/api/admin/backups', requireRole('ADMIN'), async (req, res) => {
  try {
    const [backups] = await pool.query(`
      SELECT id, filename, backup_date, file_size_mb, status, created_at, restored_at,
             (cloud_public_id IS NOT NULL) AS cloud_backed
      FROM backups
      ORDER BY backup_date DESC
      LIMIT 50
    `);

    res.json(backups);
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

app.post('/api/admin/backups/create', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await createBackup(pool);

    if (!result) {
      return badRequest(res, 'Backup already exists for today');
    }

    res.json({ success: true, backup: result });
  } catch (err) {
    // ⭐️ ADMIN เท่านั้น — โชว์ error จริงได้ปลอดภัย เหมือน pattern ที่ใช้ใน backups/:id/restore
    console.error('[backups/create] ERROR:', err.code || '', err.sqlMessage || err.message);
    console.error(err.stack);

    serverError(res);
  }
});

app.post('/api/admin/backups/:id/restore', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { confirm } = req.body;

  if (!confirm) {
    return badRequest(res, 'Restore requires explicit confirmation');
  }

  try {
    const [backups] = await pool.query(
      'SELECT * FROM backups WHERE id = ? AND status = ?',
      [id, 'SUCCESS']
    );

    if (backups.length === 0) {
      return notFound(res, 'Backup not found or not successful');
    }

    const backup = backups[0];

    // ⭐️ Update — backup_path ชี้ไปไฟล์บน local disk (backend/backups/) ซึ่งบน Render filesystem
    // เป็น ephemeral (เหมือน uploads/ ก่อนย้ายไป Cloudinary) redeploy/restart ล้างไฟล์ทิ้งได้ แต่ row
    // ใน DB ยังอยู่ — restoreBackupRow() จัดการ fallback ไปดึงจาก Cloudinary ให้เองถ้ามีสำเนาผูกไว้
    // (cloud_public_id) เหลือแค่กรณีไม่มีทั้งไฟล์บนดิสก์และสำเนาบนคลาวด์เลยที่ต้องแยก error ให้ admin
    // เห็นสาเหตุจริงทันที ไม่ใช่ 500 เปล่าๆ
    let restoreInfo;
    try {
      restoreInfo = await restoreBackupRow(pool, backup);
    } catch (restoreErr) {
      if (restoreErr.code === 'BACKUP_FILE_MISSING') {
        console.error(`[restore] ไม่พบไฟล์ backup ทั้งบนดิสก์และ Cloudinary: ${backup.backup_path} (id=${id})`);
        return gone(res, `ไม่พบไฟล์ backup บนเซิร์ฟเวอร์และบน Cloudinary (${backup.backup_path}) — ไฟล์อาจถูกลบไปตอน redeploy/restart และไม่มีสำเนาบนคลาวด์ (สร้างก่อนตั้งค่า Cloudinary) กู้คืนจากไฟล์นี้ไม่ได้แล้ว ต้องใช้ backup อันใหม่กว่า`, { code: 'BACKUP_FILE_MISSING' });
      }
      throw restoreErr;
    }

    // Log restore
    await pool.query(
      'UPDATE backups SET restored_at = NOW(), restored_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    res.json({
      success: true,
      message: `Restored from ${backup.filename}${restoreInfo.source === 'cloud' ? ' (กู้จาก Cloudinary เพราะไฟล์บนดิสก์หายไปแล้ว)' : ''}`,
    });
  } catch (err) {
    // ⭐️ endpoint นี้ ADMIN เท่านั้น (requireRole('ADMIN')) — โชว์ error จริงได้ปลอดภัย ไม่ใช่ user ทั่วไป
    // เหมือน pattern ที่ใช้ใน /api/reports/export/sales-csv และ /api/reports/executive-export
    console.error('[restore] ERROR:', err.code || '', err.sqlMessage || err.message);
    console.error(err.stack);

    serverError(res);
  }
});

// ⭐️ Sprint 2 — C2: Audit Log Viewer — GET /api/audit-logs
app.get('/api/audit-logs', requireRole('ADMIN', 'CASHIER', 'MEMBER'), async (req, res) => {
  // 🐛 FIX — เดิม parseInt ตรงๆ ไม่มี guard: `?page=abc` → offset = NaN → mysql2 throw → 500 generic,
  // และ `?limit=100000000` (MEMBER กดได้) → query ยักษ์. clamp ทั้งคู่: page ≥ 1, limit 1–200
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const { action, user_id, start_date, end_date, search } = req.query;
  const currentUser = req.user;

  try {
    let query = `
      SELECT
        al.id, al.user_id, u.full_name,
        al.action, al.resource_type, al.resource_id,
        al.description, al.amount_cents, al.status,
        DATE_FORMAT(al.created_at, '%Y-%m-%d %H:%i:%s') as timestamp_bkk
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;

    const params = [];

    // Access control: non-admins only see own logs
    if (currentUser.role !== 'ADMIN') {
      query += ' AND al.user_id = ?';
      params.push(currentUser.id);
    }

    // Filters
    if (action) {
      query += ' AND al.action = ?';
      params.push(action);
    }

    if (user_id && currentUser.role === 'ADMIN') {
      query += ' AND al.user_id = ?';
      params.push(user_id);
    }

    if (start_date && end_date) {
      query += ' AND DATE(al.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (search) {
      query += ' AND (al.description LIKE ? OR al.resource_id = ?)';
      params.push(`%${search}%`, parseInt(search) || 0);
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM audit_logs al WHERE 1=1';
    const countParams = [];

    if (currentUser.role !== 'ADMIN') {
      countQuery += ' AND al.user_id = ?';
      countParams.push(currentUser.id);
    }

    if (action) {
      countQuery += ' AND al.action = ?';
      countParams.push(action);
    }

    if (user_id && currentUser.role === 'ADMIN') {
      countQuery += ' AND al.user_id = ?';
      countParams.push(user_id);
    }

    if (start_date && end_date) {
      countQuery += ' AND DATE(al.created_at) BETWEEN ? AND ?';
      countParams.push(start_date, end_date);
    }

    if (search) {
      countQuery += ' AND (al.description LIKE ? OR al.resource_id = ?)';
      countParams.push(`%${search}%`, parseInt(search) || 0);
    }

    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    // Pagination
    const offset = (page - 1) * limit;
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [logs] = await pool.query(query, params);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

// ⭐️ Sprint 2 — C2: Audit Log Viewer — GET /api/audit-logs/:id
app.get('/api/audit-logs/:id', requireRole('ADMIN', 'CASHIER', 'MEMBER'), async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;

  try {
    const [logs] = await pool.query(
      `SELECT * FROM audit_logs WHERE id = ? ${currentUser.role !== 'ADMIN' ? 'AND user_id = ?' : ''}`,
      currentUser.role !== 'ADMIN' ? [id, currentUser.id] : [id]
    );

    if (logs.length === 0) {
      return notFound(res, 'Audit log not found');
    }

    res.json(logs[0]);
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

// ⭐️ Sprint 2 — C2: Audit Log Viewer — GET /api/audit-logs/export/csv (ADMIN only)
app.get('/api/audit-logs/export/csv', requireRole('ADMIN'), async (req, res) => {
  const { start_date, end_date } = req.query;

  try {
    let query = `
      SELECT
        al.id, u.full_name as user_name,
        al.action, al.resource_type, al.description,
        al.amount_cents, al.status,
        DATE_FORMAT(al.created_at, '%Y-%m-%d %H:%i:%s') as timestamp_bkk
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ' AND DATE(al.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY al.created_at DESC';

    const [logs] = await pool.query(query, params);

    // Convert to CSV
    const headers = ['ID', 'User', 'Action', 'Resource Type', 'Description', 'Amount', 'Status', 'Timestamp'];
    const rows = logs.map((log) => [
      log.id,
      log.user_name,
      log.action,
      log.resource_type || '',
      log.description || '',
      log.amount_cents ? (log.amount_cents / 100).toFixed(2) : '0.00',
      log.status || 'SUCCESS',
      log.timestamp_bkk
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM for Excel UTF-8
  } catch (err) {
    console.error('[500]', err.message);

    serverError(res);
  }
});

// ⭐️ Phase A (refactor) — export/sales-csv, executive-export, accounting-summary(+export)
// ย้ายไปที่ reportController.js/reportRoutes.js แล้ว พฤติกรรม/path เดิมไม่เปลี่ยน (รวม bug tz ของ
// export/sales-csv ที่ยังไม่ได้แก้ — ย้ายแบบคงพฤติกรรมเดิมไว้ก่อน แยกแก้ทีหลัง แจ้งผู้ใช้แยกต่างหาก)

// ⭐️ Task 12A — centralized error handler (must be the LAST app.use()).
// Express 5 auto-forwards rejected promises from async route handlers here, and multer
// upload errors (bad mimetype / oversized file) also land here via next(err).
// NOTE: most existing routes already catch their own errors locally and respond with
// { error: error.message } directly — this handler does NOT retrofit all ~60 of them
// (out of scope for this pass), it's the safety net for anything that slips past those
// local catches (unhandled throws, multer errors, jwt errors bubbling from middleware).
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substr(2, 9);

  console.error(`[${timestamp}] ERROR ${requestId}: ${err.message}`);
  console.error(err.stack);

  if (req.user?.id && (req.path.includes('/sales') || req.path.includes('/orders'))) {
    logAudit(pool, 'ERROR', req.user.id, { error: err.message, path: req.path, method: req.method, requestId }).catch(logErr => console.error('audit_logs ERROR insert ล้มเหลว:', logErr.message));
  }

  let statusCode = 500;
  let userMessage = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

  if (err.statusCode) {
    statusCode = err.statusCode;
    userMessage = err.message;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    userMessage = err.message;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 403;
    userMessage = 'Token ไม่ถูกต้อง';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    userMessage = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    userMessage = 'ไฟล์มีขนาดใหญ่เกินไป (จำกัด 5MB)';
  } else if (err.message?.includes('อนุญาตเฉพาะไฟล์รูปภาพ')) {
    statusCode = 400;
    userMessage = err.message;
  }

  res.status(statusCode).json({ error: userMessage, requestId });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const PORT = config.PORT; // ⭐️ DEPLOY — อ่านจาก .env ได้ (default 3000)
// เปลี่ยนจาก app.listen เป็น server.listen
// ⭐️ DEPLOY FIX — bind 0.0.0.0 (IPv4 ทุก interface) ไม่งั้น Node default ไปที่ IPv6 '::'
// แล้ว Render สแกนพอร์ตทาง IPv4 มองไม่เห็น → "No open ports detected" → deploy timeout → คงโค้ดเก่า
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`⚡ WebSocket Server is ready!`);

  // ⭐️ MULTI-TENANT — bootstrap master DB (CREATE DATABASE IF NOT EXISTS + ตาราง tenants) รอบเดียวตอน boot.
  //   เดิม initMasterDB "ไม่เคย" ถูกเรียกเลย → deploy ใหม่/DB หาย = dashboard+login พังทันที (500/401 วน)
  //   ไม่ fatal: MySQL ยังไม่พร้อม/สิทธิ์ไม่พอ → server ยังบูตต่อ getAllTenants() จะ self-heal ตอน request แรก
  require('./src/config/tenantRegistry').initMasterDB()
    .then(() => console.log('✅ Master database initialized'))
    .catch((err) => console.error(`⚠️ [BOOT] Master DB bootstrap failed (${err.code || 'NO_CODE'}: ${err.message}) — จะลอง self-heal ตอน request แรก`));

  // ⭐️ Sprint 2 — C3: Cron backup ทุกวัน 19:00 UTC (ตี 2 เวลาไทย วันถัดไป)
  cron.schedule('0 19 * * *', async () => {
    try {
      console.log('[CRON] Starting daily backup...');
      const result = await createBackup(pool);

      if (result) {
        console.log(`[CRON] ✅ Backup successful: ${result.filename}`);

        // Send email notification if enabled
        if (config.ENABLE_BACKUP_EMAIL && config.ADMIN_EMAIL) {
          await sendMail({
            to: config.ADMIN_EMAIL,
            subject: `✅ สำรองข้อมูลสำเร็จ ${result.filename} — ${await getStoreName()}`,
            html: `<div style="font-family:sans-serif;">
              <h2>สำรองข้อมูลประจำวันสำเร็จ</h2>
              <p>ไฟล์: <b>${result.filename}</b></p>
              <p>ขนาด: <b>${result.size} MB</b></p>
              <p>สำเนาบนคลาวด์: <b>${result.cloudBacked ? '✅ มี (Cloudinary)' : '⚠️ ไม่มี — อยู่บนดิสก์เซิร์ฟเวอร์เท่านั้น'}</b></p>
              <p style="color:#aaa;font-size:11px;margin-top:20px;">อีเมลนี้ส่งอัตโนมัติทุกวันตี 2 — ${await getStoreName()}</p>
            </div>`,
          });
        }
      } else {
        console.log('[CRON] ⏭️  Backup skipped (already exists today)');
      }
    } catch (err) {
      console.error('[CRON] ❌ Backup failed:', err.message);

      // Send error email if enabled
      if (config.ENABLE_BACKUP_EMAIL && config.ADMIN_EMAIL) {
        await sendMail({
          to: config.ADMIN_EMAIL,
          subject: `❌ สำรองข้อมูลล้มเหลว — ${await getStoreName()}`,
          html: `<div style="font-family:sans-serif;">
            <h2>สำรองข้อมูลประจำวันล้มเหลว</h2>
            <p style="color:#c00;">${err.message}</p>
            <p style="color:#aaa;font-size:11px;margin-top:20px;">อีเมลนี้ส่งอัตโนมัติทุกวันตี 2 — DMTC Mart</p>
          </div>`,
        });
      }
    }
  });

  // ⭐️ Cron: ตัดออกงาน/ปิดกะอัตโนมัติทุกเที่ยงคืน (ข้อ 12 — ลืมออกงาน/ลืมปิดกะข้ามวัน)
  // ⭐️ ตัดออกงาน/ปิดกะที่ค้างข้ามวัน ทุกวัน 07:05 น. เวลาไทย (00:05 UTC — process รันโซน UTC)
  // เกณฑ์เป็นวันไทยล้วน (DATE(check_in/opened_at) < CURDATE() ซึ่ง CURDATE() = session tz +07:00)
  // → ยิงกี่โมงหลังเที่ยงคืนไทยก็ได้ผลเหมือนกัน 07:05 เช้าก่อนร้านเปิดจึงปลอดภัย ไม่ต้องปรับ
  cron.schedule('5 0 * * *', async () => {
    try {
      const result = await runAutoCheckoutStale(io);
      console.log(`⏰ ตัดออกงานอัตโนมัติ: attendance ${result.attendance_closed}, shifts ${result.shifts_closed}`);
    } catch (e) { console.error('❌ auto-checkout cron ล้มเหลว:', e.message); }
  });

  // ⭐️ Sprint 1 — D4: รายงานสรุปยอดประจำวัน ทุกวัน 06:00 น. เวลาไทย (23:00 UTC วันก่อน — เพราะไทย = UTC+7
  // และ process รันโซน UTC: เดิมเผลอเขียน '0 6 * * *' = 06:00 UTC = บ่ายโมงไทย รายงานไปถึงหลังร้านเปิดแล้ว
  // — เปรียบเทียบกับ cron ตัวอื่นในไฟล์นี้ (backup 19:00 UTC = ตี 2 ไทย, low-stock 10:00 UTC = 17:00 ไทย)
  // ที่แปลงเวลาไทย→UTC ไว้ชัดเจน) ก่อนร้านเปิด ส่งอีเมลถึง ADMIN_EMAIL — sendDailyReport() ไม่ส่ง param
  // = รายงาน "เมื่อวาน" ตามเวลาไทยเสมอ (getYesterdayBangkok) ถูกต้องไม่ว่า cron จะยิงกี่โมง
  cron.schedule('0 23 * * *', async () => {
    console.log('⏰ เริ่มสร้าง/ส่งรายงานสรุปยอดประจำวัน (06:00 น. ไทย)...');
    try {
      const result = await sendDailyReport();
      console.log(`📧 รายงานประจำวัน ${result.data.date}: ${result.sent ? 'ส่งอีเมลสำเร็จ' : 'สร้างรายงานแล้วแต่ไม่ได้ส่ง (เช็ค ADMIN_EMAIL/SMTP)'}`);
    } catch (e) { console.error('❌ daily report cron ล้มเหลว:', e.message); }
  });

  // ⭐️ Sprint 2 — Expiry Discount: เช็คสินค้าหมดอายุ ทุกชั่วโมง (0 * * * * = top-of-hour เดียวกันทั้ง
  // UTC/ไทย ไม่มีเวลาตายตัว ไม่ต้องแปลงโซน) แจ้งเตือน cashiers ผ่าน socket (products_expired)
  cron.schedule('0 * * * *', async () => {
    try {
      const [expiredToday] = await pool.query(`
        SELECT id, name FROM products
        WHERE expiry_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND is_active = 1
      `);

      if (expiredToday.length > 0) {
        console.log(`⏰ พบสินค้าหมดอายุ ${expiredToday.length} รายการ`);
        io.emit('products_expired', {
          count: expiredToday.length,
          products: expiredToday.map(p => p.name),
          timestamp: new Date()
        });
      }
    } catch (e) { console.error('❌ expired products cron ล้มเหลว:', e.message); }
  });

  // ⭐️ Security remediation — ล้าง revoked_tokens ที่หมดอายุแล้วทุกวัน 02:30 น. เวลาไทย (19:30 UTC —
  // process รันโซน UTC) กันตารางโตไม่จำกัด — เปรียบเทียบ expires_at (FROM_UNIXTIME = เวลาไทย session tz)
  // กับ NOW() (เวลาไทยเหมือนกัน) ยิงกี่โมงก็ได้ผลถูกต้อง
  cron.schedule('30 19 * * *', async () => {
    try {
      const [result] = await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
      console.log(`🧹 ล้าง revoked_tokens ที่หมดอายุแล้ว: ${result.affectedRows} แถว`);
    } catch (e) { console.error('❌ revoked_tokens cleanup cron ล้มเหลว:', e.message); }
  });

  // ⭐️ LINE Bot — แจ้งเตือนสต๊อกใกล้หมดประจำวัน ทุกวัน 17:00 น. เวลาไทย (10:00 UTC เพราะไทย = UTC+7)
  // ส่งถึง MANAGER ที่ผูกบัญชี LINE แล้วเท่านั้น (ตามสเปก ไม่ส่งถึง ADMIN/CASHIER)
  // ต่างจาก sendLowStockAlert เดิม (ยิงเข้ากลุ่ม LINE_MANAGER_GROUP_ID กลุ่มเดียว) — อันนี้ push ถึง
  // ผู้จัดการแต่ละคนเป็นรายบุคคลโดยตรง ตาม role ไม่ใช่กลุ่มแชท
  cron.schedule('0 10 * * *', async () => {
    try {
      const [lowStock] = await pool.query(
        'SELECT name, stock, min_stock FROM products WHERE is_active = 1 AND stock <= min_stock ORDER BY stock ASC'
      );
      if (lowStock.length === 0) {
        console.log('📦 [CRON] เช็คสต๊อกประจำวัน (17:00) — ไม่มีสินค้าใกล้หมด');
        return;
      }
      const [managers] = await pool.query(
        "SELECT line_user_id FROM users WHERE role = 'MANAGER' AND is_active = 1 AND line_user_id IS NOT NULL"
      );
      if (managers.length === 0) {
        console.log('📦 [CRON] พบสินค้าใกล้หมด แต่ไม่มี MANAGER ที่ผูกบัญชี LINE ไว้ — ข้ามการแจ้งเตือน');
        return;
      }
      const list = lowStock.map(p => `• ${p.name} (เหลือ ${p.stock} ชิ้น)`).join('\n');
      const text = `⚠️ อัปเดตสต๊อกสินค้าประจำวัน (17:00 น.) ⚠️\nแอดมินครับ ตอนนี้มีสินค้าใกล้หมดสต๊อก:\n${list}\nอย่าลืมเช็กและสั่งมาเติมด้วยนะครับ 📦`;
      for (const m of managers) {
        await pushLineMessage(m.line_user_id, [{ type: 'text', text }])
          .catch(err => console.error('❌ [CRON] ส่ง low-stock alert ไม่สำเร็จ (manager):', err.message));
      }
      console.log(`📦 [CRON] แจ้งเตือนสต๊อกใกล้หมด ${lowStock.length} รายการ ถึง MANAGER ${managers.length} คน`);
    } catch (e) { console.error('❌ low-stock alert cron ล้มเหลว:', e.message); }
  });

  // ⭐️ LINE Bot — เตือนลูกค้ามารับของ ทุกชั่วโมง (0 * * * * เป็น top-of-hour เดียวกันทั้ง UTC/ไทย เพราะ
  // ต่างกันแค่จำนวนชั่วโมงเต็มๆ ไม่ต้องปรับ offset เหมือน cron รายวันด้านบน) เตือนแค่ครั้งเดียวต่อออเดอร์
  // (pickup_reminder_sent กันสแปมทุกชั่วโมงไม่รู้จบ) เฉพาะออเดอร์ที่ READY มาแล้วเกิน threshold ชั่วโมง
  const PICKUP_REMINDER_THRESHOLD_HOURS = 2;
  cron.schedule('0 * * * *', async () => {
    try {
      const [staleOrders] = await pool.query(
        `SELECT o.id, u.line_user_id FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.status = 'READY' AND (o.pickup_reminder_sent = 0 OR o.pickup_reminder_sent IS NULL)
           AND o.ready_at IS NOT NULL AND o.ready_at <= (NOW() - INTERVAL ? HOUR)`,
        [PICKUP_REMINDER_THRESHOLD_HOURS]
      );
      const sentIds = [];
      for (const o of staleOrders) {
        if (!o.line_user_id) continue; // ไม่ได้ผูกบัญชี LINE — ข้ามเงียบๆ (fail-soft เหมือนจุดอื่น)
        const storeName = await getStoreName(o.tenant_id);
        const text = `🏃‍♂️ ก๊อกๆ! ออเดอร์ #${o.id} ของคุณเตรียมเสร็จเรียบร้อยแล้วน้า อย่าลืมแวะมารับที่ร้าน ${storeName} นะครับ รออยู่น้าค้าบ ✨`;
        const sent = await pushLineMessage(o.line_user_id, [{ type: 'text', text }])
          .catch(err => { console.error(`❌ [CRON] ส่ง pickup reminder ไม่สำเร็จ (order #${o.id}):`, err.message); return false; });
        // ⭐️ ตั้ง sent flag เฉพาะตอนส่งสำเร็จจริง — ถ้าพัง (เช่น LINE API ล่มชั่วคราว) ปล่อยให้ลองใหม่ชั่วโมงถัดไป
        if (sent) sentIds.push(o.id);
      }
      // 🐛 FIX (N+1) — เดิม UPDATE ทีละออเดอร์ในลูป — batch ครั้งเดียวด้วย IN แทน
      if (sentIds.length > 0) {
        await pool.query(`UPDATE orders SET pickup_reminder_sent = 1 WHERE id IN (${sentIds.map(() => '?').join(',')})`, sentIds);
      }
      if (staleOrders.length > 0) console.log(`🏃 [CRON] เตือนมารับของแล้ว ${staleOrders.length} ออเดอร์`);
    } catch (e) { console.error('❌ pickup reminder cron ล้มเหลว:', e.message); }
  });

  console.log('🕐 ตั้ง cron: backup (ตี 2), auto-checkout (เที่ยงคืน), รายงานประจำวัน (ตี 6), ตรวจสินค้าหมดอายุ (ทุกชั่วโมง), ล้าง revoked tokens (ตี 2:30), แจ้งสต๊อกใกล้หมด (17:00), เตือนมารับของ (ทุกชั่วโมง) เรียบร้อย');
});