const express = require('express');
const helmet = require('helmet'); // ⭐️ SECURITY FIX (#8) — security headers
const cors = require('cors');
const pool = require('./db');
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
const { slipUpload, shiftPhotoUpload } = require('./multer-config');  // ⭐️ Sprint 2 — B9: Multer config (organized by folder)
const { saveImage } = require('./cloudinary-config');  // ⭐️ เก็บรูปถาวรบน Cloudinary (memory → cloud)

// ⭐️ Sprint 1 — B4: ผ่อนปรน rate limit ตอน dev/UAT (ค่าเดิม 5/15min แน่นเกินไปสำหรับ manual test
// รอบเดียวก็โดนล็อกยาว) NODE_ENV=production ยังคงเข้มเท่าเดิม, ค่าอื่นๆ (development/undefined) ผ่อนให้
// หมายเหตุ: ไม่ได้ปิด rate limit ไปเลยแม้ตอน dev เพราะยังอยากให้ทดสอบพฤติกรรม 429 ได้เหมือนเดิม แค่เพดานสูงขึ้น
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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

const {
  checkoutValidator, productValidator, orderValidator,
  shiftCloseValidator, userRegisterValidator,
} = require('./validators');
const { toSatang, fromSatang } = require('./money'); // ⭐️ Sprint 1 — B3
const { sendDailyReport } = require('./daily-report'); // ⭐️ Sprint 1 — D4
const { createBackup, restoreBackup } = require('./backup'); // ⭐️ Sprint 2 — C3: Backup & Restore

// ⭐️ Sprint 0 — A4: evaluated once at module load = ตอนที่ process นี้ boot ขึ้นมาจริงๆ
// ใช้เป็นลายนิ้วมือของ "process ที่กำลังรันอยู่ตอนนี้" — ถ้า frontend เห็นค่านี้เปลี่ยนระหว่าง session
// (poll ทุก 1 นาที) แปลว่า backend ถูก restart ไปแล้วตั้งแต่โหลดหน้าเว็บครั้งล่าสุด ควร reload
const BUILD_INFO = {
  timestamp: new Date().toISOString(),
  git_hash: process.env.GIT_HASH || 'dev-local',
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

// ⭐️ Task 5A — validates req.body against a Joi schema, sets req.validatedBody on success
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message).join('; ');
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }
    req.validatedBody = value;
    req.body = value; // ⭐️ existing handlers destructure req.body directly; keep them working unmodified with sanitized/coerced values
    next();
  };
}

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

require('dotenv').config();

// ⭐️ Task 6 — ตรวจ environment variable ที่จำเป็นทั้งหมดก่อนบูท ไม่ใช่แค่ JWT_SECRET
// (เดิม db.js มี fallback รหัสผ่านเริ่มต้น 'rootpassword' ซ่อนอยู่ — ถ้า DB_PASSWORD หายจาก .env
//  ระบบจะบูทต่อแบบเงียบๆ ด้วยรหัสผ่านอ่อนแอแทนที่จะพัง เอาออกแล้ว ดู db.js)
const REQUIRED_ENV = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`❌ ไม่พบ environment variable ที่จำเป็น: ${missingEnv.join(', ')} — ห้ามรันระบบโดยไม่มีค่านี้`);
  process.exit(1);
}
console.log('✓ All required environment variables loaded');

const JWT_SECRET = process.env.JWT_SECRET;

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

// ⭐️ DEPLOY FIX (#7) — prod รันหลัง nginx/reverse proxy ต้องเชื่อ X-Forwarded-For 1 ชั้น
// ไม่งั้น rate limiter เห็น IP เดียว (ของ proxy) = login limiter ล็อกคนทั้งระบบพร้อมกัน
if (IS_PRODUCTION) app.set('trust proxy', 1);

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
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

// ⭐️ Task 1A — ปฏิเสธ socket ที่ไม่มี/ไม่ผ่าน JWT ก่อนให้เชื่อมต่อ (เดิม: รับทุก connection โดยไม่เช็คเลย)
io.use((socket, next) => {
  try {
    // ⭐️ SECURITY FIX (#5) — เดิม log JSON.stringify(handshake.auth) = พ่น JWT ลง log ตรงๆ เอาออก
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Missing JWT token'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded; // { id, role, full_name }
    console.log(`[DEBUG SOCKET AUTH] Token verified - user_id=${decoded.id}, role=${decoded.role}`);
    next();
  } catch (err) {
    console.log(`[DEBUG SOCKET AUTH] ERROR: ${err.message}`);
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
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'idempotency-key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());

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
  '/api/init-db',          // bootstrap เท่านั้น — guard ด้วย SETUP_KEY แทน JWT (ดูด้านล่าง)
  '/api/seed-data',
  '/api/create-admin',
  '/api/health',            // ⭐️ Task 12 — uptime monitor ต้องเรียกได้โดยไม่ต้องมี JWT
  '/api/version',           // ⭐️ Sprint 0 — A4 — frontend poll เช็ค stale backend, ต้องเรียกได้แม้ token จะหมดอายุ/ยังไม่ login
  '/api/auth/forgot-password', // ⭐️ Task 13 — ยังไม่ login จึงยังไม่มี token
  '/api/auth/reset-password',
  '/api/auth/reset-token',
  // ⭐️ SECURITY FIX (วิกฤต #1) — เอา '/uploads' ออกจาก public แล้ว สลิป/รูปเข้างานต้องผ่าน
  //    GET /api/media ที่มี JWT คุม (ไฟล์รูปสินค้าที่เคยพึ่ง static ให้ไปเสิร์ฟผ่าน /api/media เช่นกัน)
];

// ⭐️ BUGFIX — public เฉพาะ "GET" (browse ไม่ต้อง login) เท่านั้น
// เดิม '/api/products' + '/api/categories' อยู่ใน PUBLIC_PATHS แล้วเช็คด้วย startsWith โดยไม่ดู method
// ทำให้ POST/PUT/DELETE ก็ match public → ข้าม auth → req.user ว่าง → requireRole ตอบ 403 เสมอ
// (admin เพิ่ม/แก้/ลบ สินค้า+หมวดหมู่ ไม่ได้เลย) แยกออกมาให้ public เฉพาะ GET
const PUBLIC_GET_PREFIXES = [
  '/api/products',
  '/api/categories',
];

// ป้องกัน endpoint bootstrap ทั้ง 3 ตัว ด้วย key ลับใน .env
// เรียกใช้แบบ: GET /api/init-db?key=xxxxx
function requireSetupKey(req, res, next) {
  const key = req.query.key;
  if (!process.env.SETUP_KEY) {
    return res.status(503).json({ error: 'ปิดใช้งาน bootstrap endpoint นี้แล้ว (ไม่พบ SETUP_KEY ใน .env)' });
  }
  if (key !== process.env.SETUP_KEY) {
    return res.status(403).json({ error: 'setup key ไม่ถูกต้อง' });
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
  // browse สินค้า/หมวดหมู่ = public เฉพาะ GET; POST/PUT/DELETE ต้องผ่าน auth + requireRole ตามปกติ
  if (req.method === 'GET' && PUBLIC_GET_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // ⭐️ F4 — Debug token verification
  if (!token) {
    console.warn(`[AUTH] No token found for ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบ' });
  }

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) {
      // ⭐️ Task 8 — แยก 401 (หมดอายุ ต้อง login ใหม่) ออกจาก 403 (token ผิด/ปลอม)
      if (err.name === 'TokenExpiredError') {
        console.warn(`[AUTH] Token expired for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
      console.error(`[AUTH] Token verification failed for ${req.method} ${req.path}: ${err.message}`);
      return res.status(403).json({ error: 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
    }
    try {
      if (await isTokenRevoked(payload)) {
        console.warn(`[AUTH] Revoked token used for ${req.method} ${req.path}, user_id=${payload.id}`);
        return res.status(401).json({ error: 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่' });
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

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

app.use(authenticateToken);
app.use(requirePasswordChange);

// ⭐️ Sprint 2 — B5: Token Refresh Helpers
function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, full_name: user.full_name, must_change_password: !!user.must_change_password, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '8h' } // ⭐️ Changed from 15m to 8h to reduce token refresh frequency during work hours
  );
}

// ⭐️ Security remediation — block everything except password-change/logout until user sets a real password
function requirePasswordChange(req, res, next) {
  if (!req.user?.must_change_password) return next();
  const exempt = req.path.endsWith('/change-password') || req.path === '/api/auth/logout';
  if (exempt) return next();
  return res.status(403).json({ error: 'ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน', code: 'MUST_CHANGE_PASSWORD' });
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh', jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.type === 'refresh' ? decoded : null;
  } catch {
    return null;
  }
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
    res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      error: err.message,
    });
  }
});

// ⭐️ SECURITY FIX (วิกฤต #3) — ลบ /api/auth/debug-token ทิ้ง เดิมเปิดสาธารณะ + คืน JWT ใช้งานได้จริง
//    และบอกความยาว JWT_SECRET = ช่วยคนโจมตี ไม่ควรมีบน production

app.get('/api/version', (req, res) => {
  res.json(BUILD_INFO);
});

// ⭐️ ตรวจสอบสต๊อกใกล้หมด (เกณฑ์ <=10 ชิ้น ตาม /api/inventory/low-stock) แล้วสร้างแจ้งเตือนระบบ
// แจ้งเฉพาะตอนสต๊อก "ตกลงมาต่ำกว่าเกณฑ์ครั้งแรก" (ข้าม threshold) กันแจ้งซ้ำทุกบิลที่ตัดสต๊อก
// ⚠️ บันทึก notification ลง DB ภายใน transaction แต่ "ไม่ emit" ตรงนี้ — คืน message กลับไปให้ผู้เรียก emit หลัง commit
//    (กัน race: ถ้า emit ก่อน commit client จะรีเฟรชแล้วเจอข้อมูลเก่า)
const LOW_STOCK_THRESHOLD = 10;
async function notifyIfLowStock(conn, io, productId, stockBefore, stockAfter) {
  if (stockBefore > LOW_STOCK_THRESHOLD && stockAfter <= LOW_STOCK_THRESHOLD) {
    const [rows] = await conn.query('SELECT name FROM products WHERE id = ?', [productId]);
    const productName = rows[0]?.name || `#${productId}`;
    const msg = `สินค้า "${productName}" สต๊อกใกล้หมด เหลือ ${stockAfter} ชิ้น`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
    return msg; // คืน message ให้ผู้เรียกเก็บไว้ emit หลัง commit
  }
  return null;
}

// ⭐️ คำนวณส่วนลดของโปรโมชั่น รองรับ PERCENT/FIXED/BOGO (BOGO ต้องมี items ของตะกร้าเพื่อเช็คจำนวนจริง)
// queryFn คือ conn.query หรือ pool.query แล้วแต่บริบท (ใน transaction หรือ preview เฉยๆ)
async function calculatePromotionDiscount(queryFn, promo, totalAmount, items) {
  if (promo.discount_type === 'PERCENT') {
    return Math.min((totalAmount * Number(promo.discount_value)) / 100, totalAmount);
  }
  if (promo.discount_type === 'FIXED') {
    return Math.min(Number(promo.discount_value), totalAmount);
  }
  if (promo.discount_type === 'BOGO') {
    if (!promo.buy_product_id || !promo.buy_qty || !promo.free_product_id || !promo.free_qty || !items) return 0;

    const sameProduct = Number(promo.buy_product_id) === Number(promo.free_product_id);
    const buyQty = items.filter(i => Number(i.product_id) === Number(promo.buy_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);
    const freeQtyInCart = items.filter(i => Number(i.product_id) === Number(promo.free_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);

    let freeUnitsGranted;
    if (sameProduct) {
      // ซื้อ X แถม Y ของชิ้นเดียวกัน (เช่น ซื้อ1แถม1 = ต้องมีในตะกร้าครบ buy_qty+free_qty ต่อ 1 เซ็ต)
      const setSize = Number(promo.buy_qty) + Number(promo.free_qty);
      const sets = Math.floor(buyQty / setSize);
      freeUnitsGranted = sets * Number(promo.free_qty);
    } else {
      // ซื้อสินค้า A ครบ แถมสินค้า B (คนละตัว) — B ต้องมีในตะกร้าด้วย
      if (buyQty < promo.buy_qty || freeQtyInCart === 0) return 0;
      const freeSets = Math.floor(buyQty / Number(promo.buy_qty));
      freeUnitsGranted = Math.min(freeSets * Number(promo.free_qty), freeQtyInCart);
    }
    if (freeUnitsGranted <= 0) return 0;

    const [freeProductRows] = await queryFn('SELECT price FROM products WHERE id = ?', [promo.free_product_id]);
    if (freeProductRows.length === 0) return 0;
    return Math.min(freeUnitsGranted * Number(freeProductRows[0].price), totalAmount);
  }
  return 0;
}

// ⭐️ เช็คสิทธิ์การใช้โปรโมชั่น (usage_limit รวม + usage_limit_per_user) คืน error message หรือ null ถ้าใช้ได้
async function checkPromotionUsageLimit(queryFn, promo, memberId) {
  if (promo.usage_limit != null && promo.usage_count >= promo.usage_limit) {
    return "โปรโมชั่นนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว";
  }
  if (promo.usage_limit_per_user != null) {
    if (!memberId) return "โปรโมชั่นนี้จำกัดสิทธิ์ต่อคน กรุณาระบุสมาชิกก่อนใช้สิทธิ์";
    const [rows] = await queryFn('SELECT COUNT(*) as cnt FROM promotion_usages WHERE promotion_id = ? AND member_id = ?', [promo.id, memberId]);
    if (rows[0].cnt >= promo.usage_limit_per_user) return "คุณใช้สิทธิ์โปรโมชั่นนี้ครบจำนวนแล้ว";
  }
  return null;
}

// =========================================
// ตั้งค่าเหตุการณ์ (Events) ของ Socket.io
// =========================================
io.on('connection', (socket) => {
  console.log(`🟢 มีหน้าจอ POS เชื่อมต่อเข้ามาแล้ว: ${socket.id} (user_id=${socket.user?.id}, role=${socket.user?.role})`);
  // ⭐️ SECURITY FIX (#5) — เอา log handshake.auth ออก (มี JWT อยู่ข้างใน)

  // ⭐️ Task 1A — เข้าห้องส่วนตัวของ user ตัวเอง เพื่อให้ backend ยิง event เฉพาะคนได้ด้วย io.to(`user_${id}`)
  if (socket.user?.id) socket.join(`user_${socket.user.id}`);

  // ⭐️ Task 1A — audit log การเชื่อมต่อ socket
  pool.query(
    'INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
    ['SOCKET_CONNECTED', socket.user?.id || null, JSON.stringify({ socket_id: socket.id })]
  ).catch(err => console.error('audit_logs SOCKET_CONNECTED ล้มเหลว:', err.message));

  // ⭐️ Task 1A — ตัวอย่าง event ที่ต้องเช็ค role ก่อนตอบข้อมูล (เฉพาะ ADMIN)
  socket.on('request_shift_report', () => {
    if (socket.user?.role !== 'ADMIN') {
      socket.emit('error', 'Unauthorized');
      return;
    }
    socket.emit('shift_report_ack', { message: 'ok' });
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔴 หน้าจอ POS ปิดการเชื่อมต่อ: ${socket.id} - reason: ${reason}`);
    console.log(`[DEBUG SOCKET] Disconnect details - socket.id=${socket.id}, user_id=${socket.user?.id}, reason=${reason}`);
    pool.query(
      'INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
      ['SOCKET_DISCONNECTED', socket.user?.id || null, JSON.stringify({ socket_id: socket.id, reason })]
    ).catch(err => console.error('audit_logs SOCKET_DISCONNECTED ล้มเหลว:', err.message));
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/categories', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "กรุณาระบุชื่อหมวดหมู่" });

  try {
    const [result] = await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/categories/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบหมวดหมู่สำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 4. PRODUCTS & INVENTORY (ระบบสินค้าและคลัง)
// =========================================

// ⭐️ Sprint 2 — Expiry Discount: Helper function to calculate product expiry status
function getProductExpiry(product) {
  if (!product.expiry_date) return { status: 'no_expiry' };

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
  const expiry = new Date(product.expiry_date);
  expiry.setHours(0, 0, 0, 0);

  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft === 0) return { status: 'expires_today', daysLeft: 0 };
  if (daysLeft === 1) return { status: 'near_expiry', daysLeft: 1, applyDiscount: true };
  return { status: 'ok', daysLeft };
}

// ⭐️ Phase 1 — โปรระดับสินค้า (ช่วงวันที่): เช็คว่าโปรกำลัง active วันนี้ไหม
function isProductPromoActive(product) {
  const pct = Number(product.promo_percent) || 0;
  if (pct <= 0 || !product.promo_start || !product.promo_end) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = new Date(product.promo_start); s.setHours(0, 0, 0, 0);
  const e = new Date(product.promo_end); e.setHours(0, 0, 0, 0);
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

app.get('/api/products', async (req, res) => {
  try {
    const { search, category_id } = req.query;
    // ⭐️ Sprint 2 — B8: Use Bangkok timezone for expiry checks
    let query = `
      SELECT p.*, c.name as category_name,
             CASE
               WHEN p.expiry_date IS NULL THEN 'no_expiry'
               WHEN DATE(p.expiry_date) < DATE(CONVERT_TZ(NOW(), '+00:00', '+07:00')) THEN 'expired'
               WHEN DATE(p.expiry_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '+07:00')) THEN 'expires_today'
               WHEN DATEDIFF(DATE(p.expiry_date), DATE(CONVERT_TZ(NOW(), '+00:00', '+07:00'))) = 1 THEN 'near_expiry'
               ELSE 'ok'
             END as expiry_status,
             (p.promo_percent > 0 AND p.promo_start IS NOT NULL AND p.promo_end IS NOT NULL
               AND DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) BETWEEN p.promo_start AND p.promo_end) AS promo_active
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
    const enrichedProducts = rows.map(p => {
      const expiry = getProductExpiry(p);
      const discount = expiry.applyDiscount ? Math.round(p.price * p.discount_percent / 100) : 0;
      return {
        ...p,
        days_left: expiry.daysLeft,
        discount_amount: discount,
        price_after_discount: p.price - discount
      };
    });

    res.json(enrichedProducts);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ ไฮไลต์สินค้า: ยอดนิยม (ขายดี) + มีโปร (ใกล้หมดอายุ ลดราคาอยู่) — สำหรับหน้าจองสินค้า/สมาชิก
// public GET (อยู่ใต้ prefix /api/products ที่เปิด browse ได้โดยไม่ต้อง login)
app.get('/api/products/highlights', async (req, res) => {
  try {
    const expiryCase = `CASE
      WHEN p.expiry_date IS NULL THEN 'no_expiry'
      WHEN DATE(p.expiry_date) < DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) THEN 'expired'
      WHEN DATE(p.expiry_date) = DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) THEN 'expires_today'
      WHEN DATEDIFF(DATE(p.expiry_date), DATE(CONVERT_TZ(NOW(),'+00:00','+07:00'))) = 1 THEN 'near_expiry'
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
      AND DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) BETWEEN p.promo_start AND p.promo_end)`;
    const [promo] = await pool.query(`
      SELECT p.*, c.name AS category_name, ${expiryCase} AS expiry_status, ${promoActiveExpr} AS promo_active
      FROM products p
      LEFT JOIN categories c ON p.category_id=c.id
      WHERE p.is_active=1 AND p.stock>0
        AND (
          (DATEDIFF(DATE(p.expiry_date), DATE(CONVERT_TZ(NOW(),'+00:00','+07:00'))) = 1 AND COALESCE(p.discount_percent,0) > 0)
          OR ${promoActiveExpr}
        )
      ORDER BY promo_active DESC, p.promo_end ASC, p.expiry_date ASC LIMIT 12
    `);
    res.json({ popular, promo });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/products', requireRole('ADMIN'), validateRequest(productValidator), async (req, res) => {
  const { barcode, name, category_id, price, cost = 0, stock = 0, image_url, vendor_id, gp_rate, promo_percent, promo_start, promo_end } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO products (barcode, name, category_id, price, cost, stock, image_url, vendor_id, gp_rate, promo_percent, promo_start, promo_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [barcode || null, name, category_id || null, price, cost || 0, stock, image_url || null, vendor_id || null, gp_rate || 0, promo_percent || 0, promo_start || null, promo_end || null]
    );
    // ⭐️ Task 5 — audit log
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['CREATE_PRODUCT', req.user.id, 'PRODUCT', result.insertId, JSON.stringify({ name, price })]
    );
    res.status(201).json({ id: result.insertId, message: "เพิ่มสินค้าสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: "บาร์โค้ดนี้ซ้ำกับในระบบแล้ว" });
    }
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/products/:id', requireRole('ADMIN'), async (req, res) => {
  const { barcode, name, category_id, price, cost, image_url, vendor_id, gp_rate, expiry_date, discount_percent, promo_percent, promo_start, promo_end } = req.body;
  try {
    // ⭐️ Sprint 2: Validate expiry_date if provided
    if (expiry_date && new Date(expiry_date) < new Date()) {
      return res.status(400).json({ error: 'วันหมดอายุไม่สามารถเป็นวันที่ผ่านมาแล้ว' });
    }

    // ⭐️ Task 5 — เก็บค่าเดิมไว้เทียบใน audit log (รวม cost เผื่อ client ไม่ส่ง cost มา จะได้ไม่ทับเป็น 0)
    const [oldRows] = await pool.query('SELECT barcode, name, category_id, price, cost, image_url, vendor_id, gp_rate, expiry_date, discount_percent FROM products WHERE id = ?', [req.params.id]);
    const finalCost = (cost === undefined || cost === null || cost === '') ? (oldRows[0]?.cost ?? 0) : cost;

    await pool.query(
      'UPDATE products SET barcode=?, name=?, category_id=?, price=?, cost=?, image_url=?, vendor_id=?, gp_rate=?, expiry_date=?, discount_percent=?, promo_percent=?, promo_start=?, promo_end=? WHERE id=?',
      [barcode || null, name, category_id || null, price, finalCost, image_url || null, vendor_id || null, gp_rate || null, expiry_date || null, discount_percent || 40, promo_percent || 0, promo_start || null, promo_end || null, req.params.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['UPDATE_PRODUCT', req.user.id, 'PRODUCT', req.params.id, JSON.stringify({ old: oldRows[0] || null, new: { barcode, name, category_id, price, image_url, vendor_id, gp_rate, expiry_date, discount_percent } })]
    );

    res.json({ message: "อัปเดตข้อมูลสินค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/products/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: "ลบสินค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 1. AUTH & USERS (ระบบเข้าสู่ระบบและพนักงาน)
// =========================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body; // หน้าเว็บส่งช่อง username มา เราจะเอาไปเทียบกับ student_id
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE student_id = ? AND is_active = TRUE', [username]);
    if (users.length === 0) return res.status(401).json({ error: "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง" });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง" });

    // ⭐️ Sprint 2 — B5: Issue both access token (15m) and refresh token (7d)
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      message: "ล็อกอินสำเร็จ",
      accessToken,
      refreshToken,
      user: { id: user.id, student_id: user.student_id, full_name: user.full_name, role: user.role, must_change_password: !!user.must_change_password },
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 2 — B5: Token Refresh Endpoint
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'ไม่พบ refresh token' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Refresh token ไม่ถูกต้องหรือหมดอายุ' });
    }

    // ⭐️ Security remediation — reject refresh with a revoked/blacklisted refresh token
    if (await isTokenRevoked(decoded)) {
      return res.status(401).json({ error: 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่' });
    }

    // Fetch user to get fresh data
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้งาน' });
    }

    // Issue new access token
    const accessToken = generateAccessToken(users[0]);

    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ⭐️ Sprint 2 — B5: Token Logout Endpoint
// ⭐️ Security remediation — actually revoke the access token (and refresh token, if sent) server-side
app.post('/api/auth/logout', requireRole('ADMIN', 'CASHIER', 'MEMBER'), async (req, res) => {
  try {
    if (req.user?.jti && req.user?.exp) {
      await pool.query(
        'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
        [req.user.jti, req.user.id, req.user.exp]
      );
    }
    const refreshToken = req.body?.refreshToken;
    if (refreshToken) {
      const decoded = jwt.decode(refreshToken);
      if (decoded?.jti && decoded?.exp) {
        await pool.query(
          'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
          [decoded.jti, decoded.id, decoded.exp]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/users/search', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "กรุณาระบุคำค้นหา" });

  try {
    // ค้นหาทั้งจาก student_id และ phone_number
    const [rows] = await pool.query(
      'SELECT id, student_id, full_name, phone_number, points, role FROM users WHERE student_id = ? OR phone_number = ?',
      [q, q]
    );
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูลสมาชิก" });

    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 0 — A2: เดิม PreOrder.tsx ใช้ /api/users/search (staff-only) มายืนยันเบอร์โทรตัวเอง
// ก่อนสั่งจอง ทำให้ MEMBER โดน 403 ทุกครั้ง — endpoint นี้เปิดให้ทุก role ที่ login แล้วเรียกได้
// (ไม่จำกัดแค่ MEMBER เพราะ CASHIER/ADMIN ก็อาจสั่งจองแทนตัวเองได้เหมือนกัน) แต่คืนข้อมูลน้อยกว่า
// /users/search มาก: ไม่มีเบอร์โทร ไม่มีแต้มสะสม มีแค่ matched (boolean) + ชื่อ (สำหรับ confirm
// ก่อนสั่งจอง) กันไม่ให้กลายเป็นช่องทาง enumerate เบอร์โทร→แต้ม/ข้อมูลส่วนตัวคนอื่นเหมือน endpoint เดิม
app.post('/api/users/verify-phone', async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'กรุณาระบุเบอร์โทรศัพท์' });

  try {
    const [rows] = await pool.query(
      'SELECT full_name FROM users WHERE phone_number = ?',
      [phone_number]
    );
    res.json({ matched: rows.length > 0, member_name: rows[0]?.full_name || null });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
      'SELECT id, student_id, full_name, phone_number, points, role FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูลผู้ใช้" });
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/users/register', validateRequest(userRegisterValidator), async (req, res) => {
  const { student_id, full_name, phone_number } = req.body;
  if (!student_id || !full_name || !phone_number) {
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  try {
    // ⭐️ Security remediation — เดิมตั้งรหัสผ่านเริ่มต้นเป็นเบอร์โทรศัพท์ (เดาง่าย/รู้กันในหมู่เพื่อน)
    // เปลี่ยนเป็นสุ่มรหัสผ่านชั่วคราว + บังคับเปลี่ยนรหัสผ่านก่อนใช้งานจริง (must_change_password)
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    const [result] = await pool.query(
      'INSERT INTO users (student_id, password, full_name, phone_number, role, points, must_change_password) VALUES (?, ?, ?, ?, ?, 0, TRUE)',
      [student_id, hashedPassword, full_name, phone_number, 'MEMBER']
    );

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ กรุณาเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก",
      user: { id: result.insertId, student_id, full_name, phone_number, points: 0 },
      temp_password: tempPassword
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: "รหัสนักศึกษา หรือ เบอร์โทรศัพท์นี้ มีในระบบแล้ว" });
    }
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
    return res.status(400).json({ error: "กรุณาระบุรหัสนักศึกษาและเบอร์โทรศัพท์" });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/auth/reset-token/:token', async (req, res) => {
  try {
    const [tokens] = await pool.query(
      'SELECT 1 FROM password_resets WHERE reset_token = ? AND expires_at > NOW() AND used_at IS NULL',
      [req.params.token]
    );
    res.json(tokens.length > 0 ? { valid: true } : { valid: false, reason: 'expired or already used' });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { reset_token, new_password } = req.body;

  if (!reset_token) return res.status(400).json({ error: "ไม่พบ token" });

  // ⭐️ Sprint 2 — C4: Validate new password strength
  const passwordCheck = validatePasswordStrength(new_password);
  if (!passwordCheck.valid) {
    return res.status(400).json({
      error: 'Password does not meet strength requirements',
      requirements: passwordCheck.errors
    });
  }

  try {
    const [tokens] = await pool.query(
      'SELECT user_id FROM password_resets WHERE reset_token = ? AND expires_at > NOW() AND used_at IS NULL',
      [reset_token]
    );
    if (tokens.length === 0) return res.status(400).json({ error: "Token ไม่ถูกต้องหรือหมดอายุแล้ว" });

    const userId = tokens[0].user_id;
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update both password and password_hash columns for compatibility
    // ⭐️ Security remediation — clear must_change_password + bump token_valid_after (invalidate stale tokens)
    await pool.query('UPDATE users SET password = ?, password_hash = ?, must_change_password = FALSE, token_valid_after = NOW() WHERE id = ?', [hashedPassword, hashedPassword, userId]);
    // ⭐️ token ใช้ครั้งเดียว — mark used_at กันเอาไปใช้ซ้ำ
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE reset_token = ?', [reset_token]);

    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['PASSWORD_RESET', userId, 'USER', userId, JSON.stringify({ via: 'reset_token' })]
    );

    res.json({ message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/admin/password-resets/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT user_id FROM password_resets WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "ไม่พบคำขอนี้ (อาจถูกใช้งานหรือลบไปแล้ว)" });

    await pool.query('DELETE FROM password_resets WHERE id = ?', [req.params.id]);

    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['REJECT_PASSWORD_RESET', req.user.id, 'USER', existing[0].user_id, JSON.stringify({ password_reset_id: req.params.id })]
    );

    res.json({ message: "ปฏิเสธคำขอรีเซ็ตรหัสผ่านแล้ว ลิงก์นี้ใช้งานไม่ได้อีกต่อไป" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  const userId = req.params.id;
  // ⭐️ SECURITY FIX (#4) — เดิม endpoint นี้เปลี่ยนรหัสผ่านได้โดยไม่ต้องกรอกรหัสเดิม (ถ้า token ค้าง = โดนยึดบัญชี)
  //   ตัด new_password ออก บังคับให้เปลี่ยนรหัสผ่านทางเดียวคือ PUT /api/users/:id/change-password ที่ยืนยันรหัสเดิม
  const { full_name, phone_number } = req.body;

  // ⭐️ Task 1 audit — เดิมไม่มีการเช็ค ownership: user คนไหนก็แก้โปรไฟล์ id อื่นได้แค่เปลี่ยน :id ใน URL
  if (req.user.role !== 'ADMIN' && String(req.user.id) !== String(userId)) {
    return res.status(403).json({ error: "แก้ไขได้เฉพาะโปรไฟล์ของตัวเองเท่านั้น" });
  }

  try {
    const conn = await pool.getConnection();

    // 1. เช็คก่อนว่าเบอร์โทรใหม่นี้ ไปซ้ำกับของคนอื่นในระบบไหม (ถ้ามีการเปลี่ยนเบอร์)
    let phoneChanged = false;
    if (phone_number) {
      const [existing] = await conn.query('SELECT id FROM users WHERE phone_number = ? AND id != ?', [phone_number, userId]);
      if (existing.length > 0) { conn.release(); return res.status(400).json({ error: "เบอร์โทรศัพท์นี้ถูกใช้งานโดยบัญชีอื่นแล้ว" }); }

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
      const [userRow] = await conn.query('SELECT full_name FROM users WHERE id = ?', [userId]);
      const msg = `${userRow[0]?.full_name || 'ผู้ใช้'} เปลี่ยนเบอร์โทรศัพท์เป็น ${phone_number} กรุณาตรวจสอบ/ปรับปรุงฐานข้อมูลรายชื่อ (Sheet) ให้ตรงกัน`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
      req.io.emit('notifications_updated', { message: msg });
    }

    conn.release();

    res.json({ message: "อัปเดตข้อมูลบัญชีสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/users', requireRole('ADMIN'), async (req, res) => {
  try {
    // ⭐️ ทริค: ใช้ AS username เพื่อหลอกหน้าเว็บ React ให้ยังใช้งานได้โดยไม่ต้องไปแก้โค้ดฝั่งหน้าเว็บอีกรอบ
    const [rows] = await pool.query('SELECT id, student_id AS username, full_name, role, is_active FROM users');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/staff-list', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, role FROM users WHERE role IN ('CASHIER', 'ADMIN') AND is_active = TRUE ORDER BY full_name`
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/users', requireRole('ADMIN'), async (req, res) => {
  const { username, password, full_name, role = 'CASHIER' } = req.body;
  try {
    // ⭐️ Sprint 2 — C4: Validate password strength
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'Password does not meet strength requirements',
        requirements: passwordCheck.errors
      });
    }

    // เข้ารหัสผ่านก่อนบันทึกลงฐานข้อมูล
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await pool.query(
      'INSERT INTO users (username, password, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [username, hashedPassword, hashedPassword, full_name, role]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['CREATE_USER', req.user.id, 'USER', result.insertId, JSON.stringify({ username, full_name, role })]
    );

    res.status(201).json({ id: result.insertId, message: "สร้างพนักงานสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "ชื่อผู้ใช้งานนี้มีในระบบแล้ว" });
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/users/:id', requireRole('ADMIN'), async (req, res) => {
  const { full_name, role, is_active } = req.body;
  try {
    await pool.query(
      'UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?',
      [full_name, role, is_active, req.params.id]
    );
    res.json({ message: "อัปเดตข้อมูลพนักงานสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/users/:id/change-password', async (req, res) => {
  const { id } = req.params;
  const { current_password, new_password, confirm_password } = req.body;
  const user_id = req.user?.id;

  try {
    // Verify ownership (user can only change their own password)
    if (!user_id || parseInt(id) !== user_id) {
      return res.status(403).json({ error: 'Cannot change other user passwords' });
    }

    // Get user
    const [users] = await pool.query('SELECT password, password_hash FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password (support both 'password' and 'password_hash' columns for compatibility)
    const userPassword = users[0].password_hash || users[0].password;
    const currentMatch = await bcrypt.compare(current_password, userPassword);
    if (!currentMatch) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    // Validate new password strength
    const passwordCheck = validatePasswordStrength(new_password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'New password does not meet strength requirements',
        requirements: passwordCheck.errors
      });
    }

    // Confirm passwords match
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Hash and update
    const newHash = await bcrypt.hash(new_password, 10);
    // Update both password and password_hash columns for compatibility
    // ⭐️ Security remediation — clear must_change_password + bump token_valid_after (invalidate stale tokens)
    await pool.query('UPDATE users SET password = ?, password_hash = ?, must_change_password = FALSE, token_valid_after = NOW() WHERE id = ?', [newHash, newHash, id]);

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['PASSWORD_CHANGED', user_id, 'USER', id, JSON.stringify({ via: 'change_password_modal' })]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/users/update-role', requireRole('ADMIN'), async (req, res) => {
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
      return res.status(404).json({ error: "ไม่พบรหัสนักศึกษานี้ในระบบ" });
    }

    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['ROLE_CHANGE', req.user.id, 'USER', oldRows[0]?.id || null, JSON.stringify({ student_id, old_role: oldRows[0]?.role || null, new_role: role })]
    );

    res.json({ message: `อัปเดตสิทธิ์ ${student_id} เป็น ${role} สำเร็จ` });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/users/sync-csv', requireRole('ADMIN'), async (req, res) => {
  // ⭐️ DEBUG: ดูว่า server ใหม่รับ request จริงไหม และ body มีอะไร
  console.log('[sync-csv] body keys:', Object.keys(req.body));
  console.log('[sync-csv] rows count:', req.body.rows?.length, '| dry_run:', req.body.dry_run);
  if (req.body.rows?.length > 0) console.log('[sync-csv] first row:', JSON.stringify(req.body.rows[0]));

  const { rows, dry_run } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "รายชื่อจาก CSV ว่างเปล่า ยกเลิกการซิงค์เพื่อความปลอดภัย" });
  }

  const usernames = rows.map(r => r.username).filter(Boolean);
  if (usernames.length === 0) return res.status(400).json({ error: "ไม่พบ username ในไฟล์" });

  try {
    const placeholders = usernames.map(() => '?').join(',');

    // 1. ใครอยู่ใน CSV แต่ไม่มีในระบบ → สร้างใหม่ (รวมทั้ง inactive ด้วย เพราะอาจถูก soft-delete ไปก่อน)
    const [existing] = await pool.query(`SELECT student_id, is_active FROM users WHERE student_id IN (${placeholders})`, usernames);
    const existingSet = new Set(existing.map(u => u.student_id));
    // ⭐️ คนที่มีอยู่แล้วแต่ถูก soft-delete → reactivate แทนสร้างใหม่
    const inactiveInCsv = existing.filter(u => !u.is_active).map(u => u.student_id);
    console.log('[sync-csv] existing:', existingSet.size, '| inactive:', inactiveInCsv.length);
    const toCreate = rows.filter(r => r.username && !existingSet.has(r.username));

    // 2. ใครอยู่ในระบบแต่ไม่มีใน CSV (ไม่ใช่ ADMIN) → ปิดการใช้งาน
    const [toDeactivate] = await pool.query(
      `SELECT id, student_id AS username, full_name, role FROM users WHERE role != 'ADMIN' AND is_active = TRUE AND student_id NOT IN (${placeholders})`,
      usernames
    );

    const toReactivate = existing.filter(u => !u.is_active);

    if (dry_run) return res.json({ to_create: toCreate, to_reactivate: toReactivate, to_deactivate: toDeactivate });

    // ⭐️ Security remediation — เดิม password = เบอร์โทร (เดาง่าย) เปลี่ยนเป็นสุ่มรหัสผ่านชั่วคราว
    // + บังคับเปลี่ยนรหัสผ่านก่อนใช้งานจริง คืนรายการ temp password ให้ ADMIN แจกจ่ายเอง
    let created_count = 0;
    const created_credentials = [];
    for (const row of toCreate) {
      const tempPassword = crypto.randomBytes(9).toString('base64url');
      const hashed = await bcrypt.hash(tempPassword, 10);
      await pool.query(
        'INSERT INTO users (student_id, full_name, phone_number, password, role, is_active, must_change_password) VALUES (?, ?, ?, ?, \'MEMBER\', TRUE, TRUE)',
        [row.username.trim(), (row.full_name || row.username).trim(), row.phone_number?.trim() || null, hashed]
      );
      created_credentials.push({ student_id: row.username.trim(), temp_password: tempPassword });
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
      created_count, reactivated_count, deactivated_count: toDeactivate.length,
      created_credentials
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 2. SHIFT MANAGEMENT (ระบบจัดการกะการขาย)
// =========================================
app.post('/api/shifts/open', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id, opening_cash, cash_breakdown, open_photo } = req.body;
  if (!cashier_id || opening_cash === undefined) {
    return res.status(400).json({ error: "กรุณาระบุรหัสแคชเชียร์และเงินตั้งต้น" });
  }
  if (!open_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนเปิดกะ" });

  try {
    // ⭐️ Sprint 2 — B8: Check no open shift for this cashier today (Bangkok timezone)
    const today = getTodayBangkok();
    const todayStr = dateToString(today);

    const [existing] = await pool.query(
      "SELECT id FROM shifts WHERE cashier_id = ? AND DATE(CONVERT_TZ(opened_at, '+00:00', '+07:00')) = ? AND status = 'OPEN'",
      [cashier_id, todayStr]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "แคชเชียร์คนนี้มีกะที่เปิดอยู่แล้วในวันนี้ (เวลาประเทศไทย) ต้องปิดกะเดิมก่อน" });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย และไม่เช็ค ownership — ใครก็ตามที่ login แล้ว
// (รวม MEMBER) ใส่ cashier_id คนอื่นมาดูยอดเงินสดปิดกะของ cashier คนนั้นได้ ล็อกเป็น CASHIER/ADMIN
// เท่านั้น และ CASHIER ดูได้แค่ของตัวเอง (ADMIN ดูของใครก็ได้ เผื่อใช้ตรวจสอบ)
app.get('/api/shifts/last-closed', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id } = req.query;
  if (!cashier_id) return res.status(400).json({ error: "กรุณาระบุ cashier_id" });
  if (req.user.role !== 'ADMIN' && Number(cashier_id) !== req.user.id) {
    return res.status(403).json({ error: "ดูได้เฉพาะยอดปิดกะของตัวเองเท่านั้น" });
  }
  try {
    const [rows] = await pool.query(
      "SELECT actual_cash, closing_cash_breakdown FROM shifts WHERE cashier_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1",
      [cashier_id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 1 — C1 audit finding: เหตุผลเดียวกับ /api/shifts/last-closed ด้านบน (`SELECT *` ด้วย —
// เผยข้อมูลกะที่กำลังเปิดของ cashier คนอื่นทั้งแถว ถ้าไม่ล็อก)
app.get('/api/shifts/current', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id } = req.query;
  if (req.user.role !== 'ADMIN' && Number(cashier_id) !== req.user.id) {
    return res.status(403).json({ error: "ดูได้เฉพาะกะของตัวเองเท่านั้น" });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});
app.post('/api/shifts/close', requireRole('CASHIER', 'ADMIN'), validateRequest(shiftCloseValidator), async (req, res) => {
  // ⭐️ Sprint 2 — D1: Dual-Control Shift Close: Cashier initiates close request (status → PENDING_CLOSE)
  // Manager must approve via PUT /api/shifts/:id/approve before shift is fully closed
  const { cashier_id, actual_cash, note, cash_breakdown, close_photo, discrepancy_category } = req.body;
  if (!close_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ" });

  try {
    const [shifts] = await pool.query(
      "SELECT id, opening_cash, opened_at FROM shifts WHERE cashier_id = ? AND status = 'OPEN'",
      [cashier_id]
    );

    if (shifts.length === 0) {
      return res.status(404).json({ error: "ไม่พบกะที่กำลังเปิดอยู่สำหรับแคชเชียร์คนนี้" });
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
      return res.status(400).json({ error: `ส่วนต่างเงินสด ${difference > 0 ? 'เกิน' : 'ขาด'} ฿${Math.abs(difference).toFixed(2)} เกินเกณฑ์ปกติ (±${CASH_DIFF_TOLERANCE}) กรุณาระบุหมายเหตุอธิบายก่อนปิดกะ` });
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

    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['CLOSE_SHIFT_PENDING_CLOSE', req.user.id, 'SHIFT', currentShift.id, JSON.stringify({ discrepancy: difference, expected_cash, actual_cash, variance: Math.abs(difference) })]
    );

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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/shifts/:id/approve', requireRole('ADMIN'), async (req, res) => {
  const { approval_notes, password } = req.body;
  const shiftId = req.params.id;
  const approverId = req.user.id;

  if (!approval_notes || !approval_notes.trim()) {
    return res.status(400).json({ error: "กรุณาระบุหมายเหตุการอนุมัติ" });
  }
  if (!password) {
    return res.status(400).json({ error: "กรุณาระบุรหัสผ่านสำหรับยืนยันตัวตน" });
  }

  try {
    // Verify password of approver
    const [users] = await pool.query("SELECT password FROM users WHERE id = ?", [approverId]);
    if (users.length === 0) {
      return res.status(401).json({ error: "ไม่พบผู้ใช้นี้" });
    }

    const passwordMatch = await bcrypt.compare(password, users[0].password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
    }

    // Verify shift exists and is PENDING_CLOSE
    const [shifts] = await pool.query(
      "SELECT id, cashier_id, status FROM shifts WHERE id = ?",
      [shiftId]
    );
    if (shifts.length === 0) {
      return res.status(404).json({ error: "ไม่พบกะนี้" });
    }

    const shift = shifts[0];
    if (shift.status !== 'PENDING_CLOSE') {
      return res.status(400).json({ error: `กะนี้ไม่ได้อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${shift.status})` });
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
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['APPROVE_SHIFT_CLOSE', approverId, 'SHIFT', shiftId, JSON.stringify({ approval_notes })]
    );

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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/shifts/:id/reject', requireRole('ADMIN'), async (req, res) => {
  const { reason } = req.body;
  const shiftId = req.params.id;
  const rejectorId = req.user.id;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: "กรุณาระบุเหตุผลในการปฏิเสธ" });
  }

  try {
    // Verify shift exists and is PENDING_CLOSE
    const [shifts] = await pool.query(
      "SELECT id, cashier_id, status FROM shifts WHERE id = ?",
      [shiftId]
    );
    if (shifts.length === 0) {
      return res.status(404).json({ error: "ไม่พบกะนี้" });
    }

    const shift = shifts[0];
    if (shift.status !== 'PENDING_CLOSE') {
      return res.status(400).json({ error: `กะนี้ไม่ได้อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${shift.status})` });
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
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['REJECT_SHIFT_CLOSE', rejectorId, 'SHIFT', shiftId, JSON.stringify({ reason })]
    );

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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/shifts/pending', requireRole('ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 2.1 SCHEDULES / ATTENDANCE (หมวด 7 — ตารางเวลา + เช็คมาสาย)
// =========================================

app.post('/api/schedules', requireRole('ADMIN'), async (req, res) => {
  const { cashier_id, work_date, expected_start, expected_end } = req.body;
  if (!cashier_id || !work_date || !expected_start || !expected_end) {
    return res.status(400).json({ error: "กรุณาระบุ cashier_id, work_date, expected_start, expected_end ให้ครบ" });
  }
  try {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/schedules/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบตารางเวลานี้' });
    res.json({ message: 'ลบตารางเวลาสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/schedules', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Security remediation — เดิมมีแค่ authenticateToken (global) ไม่มี requireRole เลย ทำให้ MEMBER
// เรียกตรงได้ทั้งที่หน้า Shift (ที่ใช้ endpoint นี้) จำกัดเฉพาะ ADMIN/CASHIER ฝั่ง frontend เท่านั้น
app.post('/api/attendance/upload-photo', requireRole('ADMIN', 'CASHIER'), shiftPhotoUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ไม่พบไฟล์รูปภาพ" });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 0 — A3: เดิม requireRole('ADMIN') เท่านั้น ทั้งที่ query ข้างในใช้ req.user.id (self-scoped)
// และ Shift.tsx (clock-in flow) เรียกใช้จากทั้ง CASHIER และ ADMIN — ทำให้ CASHIER check-in ไม่ได้เลย
app.post('/api/attendance/check-in', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const { check_in_photo } = req.body;
  if (!check_in_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อเข้างาน" });
  try {
    const [openRows] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL`,
      [req.user.id]
    );
    // ⭐️ ถ้าลงชื่อเข้างานวันนี้แล้วและยังไม่ได้ออกงาน ห้ามลงชื่อซ้ำ
    if (openRows.length > 0) return res.status(400).json({ error: "ลงชื่อเข้างานวันนี้ไปแล้ว ยังไม่ได้ลงชื่อออกงาน" });

    const [result] = await pool.query('INSERT INTO attendance (user_id, check_in_photo) VALUES (?, ?)', [req.user.id, check_in_photo]);
    res.status(201).json({ message: "ลงชื่อเข้างานสำเร็จ", id: result.insertId });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 0 — A3: เหตุผลเดียวกับ check-in ด้านบน
app.put('/api/attendance/check-out', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const { check_out_photo } = req.body;
  if (!check_out_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อออกงาน" });
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
    if (rows.length === 0) return res.status(400).json({ error: "ยังไม่ได้ลงชื่อเข้างานวันนี้" });

    await pool.query('UPDATE attendance SET check_out = NOW(), check_out_photo = ? WHERE id = ?', [check_out_photo, rows[0].id]);
    res.json({ message: "ลงชื่อออกงานสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/attendance', requireRole('ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/attendance/:id', requireRole('ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/attendance/:id', requireRole('ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
      `SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE cashier_id = (SELECT cashier_id FROM shifts WHERE id = ?) AND payment_method = 'CASH' AND created_at >= ?`,
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

app.post('/api/attendance/auto-checkout-stale', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await runAutoCheckoutStale(req.io);
    res.json({ message: "ตรวจสอบและตัดออกอัตโนมัติเรียบร้อย", ...result });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/holidays', requireRole('ADMIN'), async (req, res) => {
  const { holiday_date, note } = req.body;
  if (!holiday_date) return res.status(400).json({ error: "กรุณาระบุวันที่" });
  try {
    await pool.query('INSERT INTO holidays (holiday_date, note) VALUES (?, ?)', [holiday_date, note || null]);
    res.status(201).json({ message: "เพิ่มวันหยุดสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "วันที่นี้ถูกตั้งเป็นวันหยุดไปแล้ว" });
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/holidays', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date, note FROM holidays ORDER BY holiday_date DESC");
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/attendance', requireRole('ADMIN'), async (req, res) => {
  try {
    const { month } = req.query; // 'YYYY-MM'
    const monthClause = month ? `AND DATE_FORMAT(work_date, '%Y-%m') = ?` : '';
    const params = month ? [month] : [];

    const [rows] = await pool.query(`
      SELECT user_id, full_name, work_date, expected_start, actual_time,
        CASE WHEN actual_time IS NULL THEN NULL
             ELSE TIMESTAMPDIFF(MINUTE, CONCAT(work_date, ' ', expected_start), actual_time)
        END as late_minutes
      FROM (
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, sh.opened_at as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role = 'CASHIER'
        LEFT JOIN shifts sh ON sh.cashier_id = s.cashier_id AND DATE(sh.opened_at) = s.work_date
        UNION ALL
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, att.check_in as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role = 'ADMIN'
        LEFT JOIN attendance att ON att.user_id = s.cashier_id AND DATE(att.check_in) = s.work_date
      ) combined
      WHERE work_date NOT IN (SELECT holiday_date FROM holidays)
      ${monthClause}
      ORDER BY work_date DESC, user_id
    `, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/orders/:id/assign', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, assigned_to, status FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) { await conn.rollback(); return res.status(404).json({ error: "ไม่พบออเดอร์" }); }

    const order = rows[0];
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) { await conn.rollback(); return res.status(400).json({ error: "ออเดอร์นี้ปิดแล้ว" }); }
    if (order.assigned_to && order.assigned_to !== req.user.id) {
      // ดึงชื่อคนที่ล็อคไปแล้ว
      const [assignee] = await conn.query('SELECT full_name FROM users WHERE id = ?', [order.assigned_to]);
      await conn.rollback();
      return res.status(409).json({ error: `ออเดอร์นี้ถูกรับงานโดย ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว` });
    }

    await conn.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [req.user.id, order.id]);
    await conn.commit();
    res.json({ message: "รับงานสำเร็จ", assigned_to: req.user.id });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally { conn.release(); }
});

// ⭐️ ลูกค้าส่งสลิปใหม่ (หลังโดน SLIP_REJECTED)
app.put('/api/orders/:id/resubmit-slip', authenticateToken, async (req, res) => {
  const { slip_image } = req.body;
  if (!slip_image) return res.status(400).json({ error: "กรุณาแนบสลิปใหม่" });
  try {
    const [orders] = await pool.query('SELECT user_id FROM orders WHERE id = ? AND status = ?', [req.params.id, 'SLIP_REJECTED']);
    if (orders.length === 0) return res.status(404).json({ error: "ไม่พบออเดอร์หรือสถานะไม่ถูกต้อง" });
    if (orders[0].user_id !== req.user.id) return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขออเดอร์นี้" });
    // ⭐️ Task 4 — reset สถานะตรวจสลิปกลับเป็น PENDING ตอนลูกค้าส่งสลิปใหม่
    await pool.query("UPDATE orders SET slip_image = ?, slip_file_path = ?, slip_verification_status = 'PENDING', status = 'PENDING_VERIFY', reject_reason = NULL WHERE id = ?", [slip_image, slip_image, req.params.id]);
    req.io.emit('new_order_received', { message: `ลูกค้าส่งสลิปใหม่ ออเดอร์ #${req.params.id}`, order_id: req.params.id });
    req.io.emit('order_status_changed', { order_id: req.params.id, status: 'PENDING_VERIFY' });
    req.io.emit('payment_slip_received', { order_id: req.params.id, message: `ออเดอร์ #${req.params.id} ส่งสลิปใหม่ รอตรวจสอบ` });
    res.json({ message: "ส่งสลิปใหม่สำเร็จ รอพนักงานตรวจสอบ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/sales/checkout', requireRole('CASHIER', 'ADMIN'), checkoutLimiter, validateRequest(checkoutValidator), async (req, res) => {
  // ⭐️ เพิ่มการรับค่า member_id, promotion_id, redeem_points เข้ามาด้วย
  const { cashier_id, member_id, promotion_id, redeem_points, payment_method, amount_received, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าสินค้าว่างเปล่า" });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    // ⭐️ Sprint 1 — B3: totalAmount สะสมในหน่วยสตางค์ (integer) แทน float บาท กัน drift สะสมข้ามหลาย
    // รายการในตะกร้า (เดิม: product.price * item.quantity เป็น float คูณ+บวกสะสมทีละรายการ)
    let totalAmountSatang = 0;
    const processedItems = [];
    const stockIssues = []; // ⭐️ Sprint 2 — B7: Collect stock validation errors

    // 1. เช็คราคาสินค้าและสต๊อก + ⭐️ Sprint 2: เช็ค expiry status
    for (let item of items) {
      const [productRows] = await conn.query(`
        SELECT id, name, price, stock, expiry_date, discount_percent, promo_percent, promo_start, promo_end,
               GREATEST(
                 CASE WHEN promo_percent > 0 AND promo_start IS NOT NULL AND promo_end IS NOT NULL
                        AND DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) BETWEEN promo_start AND promo_end
                      THEN promo_percent ELSE 0 END,
                 CASE WHEN expiry_date IS NOT NULL
                        AND DATEDIFF(DATE(expiry_date), DATE(CONVERT_TZ(NOW(),'+00:00','+07:00'))) = 1
                      THEN COALESCE(discount_percent,0) ELSE 0 END
               ) AS best_discount_percent
        FROM products WHERE id = ? FOR UPDATE`, [item.product_id]);
      if (productRows.length === 0) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);

      const product = productRows[0];
      // ⭐️ Sprint 2 — B7: Collect insufficient stock issues instead of throwing
      if (product.stock < item.quantity) {
        stockIssues.push({
          product_id: item.product_id,
          product_name: product.name,
          requested: item.quantity,
          available: product.stock
        });
        continue; // Skip this item but continue checking others
      }

      // ⭐️ Sprint 2: Check for expired products — block sale if expired
      const expiryStatus = getProductExpiry(product);
      if (expiryStatus.status === 'expired') {
        throw new Error(`ไม่สามารถขายสินค้าที่หมดอายุแล้ว: ${product.name}`);
      }

      let itemPrice = Number(product.price);
      // ⭐️ Phase 1: ส่วนลดระดับสินค้า (โปรช่วงวันที่ / ใกล้หมดอายุ) — คำนวณใน SQL เวลาไทย ให้ตรงกับที่การ์ดโชว์
      const bestDiscPct = Number(product.best_discount_percent) || 0;
      if (bestDiscPct > 0) {
        itemPrice -= Math.round(itemPrice * bestDiscPct / 100);
        console.log(`[CHECKOUT] -${bestDiscPct}% applied to ${product.name}`);
      }

      const subtotalSatang = toSatang(itemPrice) * item.quantity;
      const subtotal = fromSatang(subtotalSatang);
      totalAmountSatang += subtotalSatang;

      processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: itemPrice, subtotal: subtotal, stock_before: product.stock });
    }

    // ⭐️ Sprint 2 — B7: If any stock issues, return 400 with details
    if (stockIssues.length > 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        error: "สต๊อกไม่เพียงพอสำหรับบางรายการ",
        issues: stockIssues
      });
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

    // ⭐️ 1.6 แลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — คำนวณ/ตรวจสอบใหม่ฝั่ง backend ทั้งหมด ห้ามเชื่อ client
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (member_id && redeem_points > 0) {
      const [memberRows] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [member_id]);
      if (memberRows.length === 0) throw new Error('ไม่พบข้อมูลสมาชิก');
      const availablePoints = memberRows[0].points;

      pointsRedeemed = Math.min(Number(redeem_points), availablePoints, Math.floor(netTotal));
      if (pointsRedeemed < 0) pointsRedeemed = 0;
      pointsDiscount = pointsRedeemed; // อัตรา 1 แต้ม = ฿1 (จำนวนเต็มอยู่แล้ว ไม่มีเศษสตางค์)
      netTotalSatang -= toSatang(pointsDiscount);
      netTotal = fromSatang(netTotalSatang);
    }

    // 2. ตรวจสอบเงินทอน (เทียบกับยอดสุทธิหลังหักส่วนลด+แต้ม) — ⭐️ B3: เทียบ/คำนวณในหน่วยสตางค์
    const amountReceivedSatang = toSatang(amount_received);
    if (amountReceivedSatang < netTotalSatang) throw new Error("รับเงินลูกค้ามาไม่พอ!");
    const changeAmount = fromSatang(amountReceivedSatang - netTotalSatang);

    // ⭐️ หากะที่เปิดอยู่ของแคชเชียร์คนนี้ ผูกเข้าบิล (แม่นกว่าเทียบช่วงเวลา ถ้าเปิดกะซ้อนเวลากันหลายคน)
    const [openShiftRows] = await conn.query(`SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`, [cashier_id]);
    const shiftId = openShiftRows[0]?.id || null;

    // 3. สร้างหัวบิลใบเสร็จ (ผูก member_id, promotion_id, discount_amount, points_redeemed, shift_id ลงไป)
    // ⭐️ Sprint 2 — B6: Store idempotency_key for offline handling
    const idempotencyKey = req.headers['idempotency-key'];
    const [saleResult] = await conn.query(
      'INSERT INTO sales (cashier_id, member_id, promotion_id, total_amount, discount_amount, points_redeemed, points_discount, payment_method, amount_received, change_amount, shift_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cashier_id, member_id || null, promotion_id || null, netTotal, discountAmount, pointsRedeemed, pointsDiscount, payment_method, amount_received, changeAmount, shiftId, idempotencyKey || null]
    );
    const saleId = saleResult.insertId;

    // 4. บันทึกรายละเอียดสินค้าและตัดสต๊อก
    const lowStockMsgs = [];
    const raceConditionItems = []; // ⭐️ Sprint 2 — B7: Collect race condition errors
    for (let item of processedItems) {
      await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)', [saleId, item.product_id, item.quantity, item.unit_price, item.subtotal]);

      // ⭐️ Sprint 2 — B7: Check affectedRows to detect race condition
      const [updateResult] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity]);
      if (updateResult.affectedRows === 0) {
        // Stock was modified by another transaction (race condition)
        raceConditionItems.push(item.product_id);
      }

      const msg = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (msg) lowStockMsgs.push(msg);
    }

    // ⭐️ Sprint 2 — B7: If any race condition detected, return 409
    if (raceConditionItems.length > 0) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        error: "สต๊อกถูกแก้ไขโดยระบบอื่นพร้อมกัน กรุณาลองใหม่",
        conflicted_products: raceConditionItems
      });
    }

    // ⭐️ 5. หักแต้มที่แลกใช้ไป + คำนวณแต้มสะสมใหม่ (ทุก 20 บาท = 1 แต้ม, คิดจากยอดสุทธิหลังหักทุกส่วนลด)
    let earnedPoints = 0;
    if (member_id) {
      if (pointsRedeemed > 0) {
        await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, member_id]);
      }
      earnedPoints = Math.floor(netTotal / 20);
      if (earnedPoints > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [earnedPoints, member_id]);
      }
    }

    // ⭐️ 5.5 นับสิทธิ์การใช้โปรโมชั่น (usage_count รวม + per-user ถ้ามีจำกัด)
    if (appliedPromo && discountAmount > 0) {
      await conn.query('UPDATE promotions SET usage_count = usage_count + 1 WHERE id = ?', [appliedPromo.id]);
      if (member_id) {
        await conn.query('INSERT INTO promotion_usages (promotion_id, member_id) VALUES (?, ?)', [appliedPromo.id, member_id]);
      }
    }

    // ⭐️ Task 5 — audit log (ในทรานแซกชันเดียวกับบิล กันเคส commit สำเร็จแต่ log หาย)
    await conn.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['CHECKOUT', req.user.id, 'SALE', saleId, JSON.stringify({ amount: netTotal, items: processedItems.length, payment_method })]
    );

    await conn.commit();
    req.io.emit('stock_updated', { message: 'มีการตัดสต๊อกสินค้า ให้โหลดข้อมูลใหม่' });
    req.io.emit('dashboard_updated', { message: 'มีบิลขายใหม่' });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));

    res.json({
      message: "ทำรายการสำเร็จ",
      receipt: {
        sale_id: saleId,
        subtotal: totalAmount,
        discount_amount: discountAmount,
        points_redeemed: pointsRedeemed,
        points_discount: pointsDiscount,
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally {
    conn.release();
  }
});

// =========================================
// 5.1 SALES HISTORY, HOLD & VOID (ประวัติ, พักบิล และ ยกเลิกบิล)
// =========================================

app.get('/api/sales/history', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/sales/history/:id', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/sales/:id/void', requireRole('ADMIN'), async (req, res) => {
  const saleId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ ใช้ status ตรวจสอบอย่างเดียว
    const [sales] = await conn.query('SELECT member_id, total_amount, status FROM sales WHERE id = ? FOR UPDATE', [saleId]);
    if (sales.length === 0) throw new Error("ไม่พบข้อมูลบิลนี้");

    const sale = sales[0];
    if (sale.status === 'VOIDED') throw new Error("บิลนี้ถูกยกเลิกไปแล้ว");
    if (sale.status === 'HOLD') throw new Error("บิลนี้เป็นบิลพัก ต้องใช้ API ลบบิลพักแทน");

    // ⭐️ เปลี่ยนสถานะบิลเป็น VOIDED
    await conn.query('UPDATE sales SET status = "VOIDED" WHERE id = ?', [saleId]);

    // ⭐️ บันทึก audit log: ใครสั่ง void บิลไหน มูลค่าเท่าไร (ใช้ req.user.id/role จาก JWT เท่านั้น ห้ามเชื่อ body)
    await conn.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ['VOID_SALE', req.user.id, 'sale', saleId, JSON.stringify({ role: req.user.role, total_amount: sale.total_amount, member_id: sale.member_id })]
    );

    // คืนสต๊อก
    const [items] = await conn.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [saleId]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // คืนแต้ม (หารด้วย 20 ให้ตรงกับตอนได้แต้มใน checkout)
    if (sale.member_id) {
      const points = Math.floor(sale.total_amount / 20);
      await conn.query('UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?', [points, sale.member_id]);
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
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.post('/api/sales/hold', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { cashier_id, member_id, items } = req.body;

  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าว่างเปล่า" });

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
    res.status(400).json({ error: error.message });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

app.post('/api/members/import', requireRole('ADMIN'), csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์ CSV" });

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        // ⭐️ Security remediation — เดิม password = เบอร์โทร/'123456' (เดาง่าย) เปลี่ยนเป็นสุ่มรหัสผ่านชั่วคราว
        // + บังคับเปลี่ยนรหัสผ่านก่อนใช้งานจริง (เฉพาะแถวที่สร้างใหม่ — ON DUPLICATE ไม่แตะรหัสผ่านคนเดิม)
        const created_credentials = [];
        for (const row of results) {
          // สมมติใน CSV มีหัวตาราง: student_id, full_name, phone_number
          const { student_id, full_name, phone_number } = row;
          if (!student_id || !full_name) continue; // ข้ามแถวที่ข้อมูลไม่ครบ

          const tempPassword = crypto.randomBytes(9).toString('base64url');
          const password = await bcrypt.hash(tempPassword, 10);

          // ⭐️ insertId === 0 บน ON DUPLICATE KEY UPDATE ที่ทับแถวเดิม (MySQL ไม่แจก insertId ใหม่) — ใช้แยกว่า insert ใหม่จริงไหม
          const [result] = await pool.query(
            `INSERT INTO users (student_id, password, full_name, phone_number, role, must_change_password)
             VALUES (?, ?, ?, ?, 'MEMBER', TRUE)
             ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone_number = VALUES(phone_number)`,
            [student_id, password, full_name, phone_number || null]
          );
          if (result.insertId) created_credentials.push({ student_id, temp_password: tempPassword });
        }
        fs.unlinkSync(req.file.path); // ลบไฟล์ทิ้งหลัง Import เสร็จ
        res.json({ message: `นำเข้าสมาชิกสำเร็จ ${results.length} รายการ`, created_credentials });
      } catch (error) {
        console.error('[500]', error.message);

        res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
      }
    });
});

// =========================================
// 7. REPORTS & DASHBOARD (ระบบรายงานสรุป)
// =========================================

app.get('/api/reports/dashboard', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    // ⭐️ รวมยอดขายหน้าร้าน (sales) กับบิลจากการจองที่ลูกค้ามารับแล้ว (orders สถานะ COMPLETED)
    // นับ orders เข้าวันที่ "มารับจริง" (completed_at) ไม่ใช่วันที่จอง (created_at)
    const [rows] = await pool.query(`
      SELECT
        COALESCE(SUM(cnt), 0) as total_bills,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(cash), 0) as cash_sales,
        COALESCE(SUM(qr), 0) as qr_sales,
        COALESCE(SUM(mixed), 0) as mixed_sales
      FROM (
        SELECT
          COUNT(id) as cnt,
          SUM(total_amount) as total,
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END) as cash,
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END) as qr,
          SUM(CASE WHEN payment_method = 'MIXED' THEN total_amount ELSE 0 END) as mixed
        FROM sales
        WHERE DATE(created_at) = CURDATE() AND status = 'COMPLETED'
        UNION ALL
        SELECT
          COUNT(id),
          SUM(total_amount),
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END),
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END),
          0
        FROM orders
        WHERE DATE(completed_at) = CURDATE() AND status = 'COMPLETED'
      ) combined
    `);

    res.json({
      date: new Date().toISOString().split('T')[0],
      summary: rows[0]
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/top-selling', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    // ⭐️ รวมรายการจาก sale_items (ขายหน้าร้าน) กับ order_items (บิลจองที่ COMPLETED แล้ว)
    const [rows] = await pool.query(`
      SELECT product_id, name, SUM(quantity) as total_quantity, SUM(revenue) as total_revenue
      FROM (
        SELECT p.id as product_id, p.name as name, si.quantity as quantity, si.subtotal as revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        WHERE s.status = 'COMPLETED'
        UNION ALL
        SELECT p.id, p.name, oi.quantity, oi.subtotal
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status = 'COMPLETED'
      ) combined
      GROUP BY product_id, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});
// 🐛 FIX (round 2) — แก้รอบแรกเปิดแค่ requireRole('ADMIN','MEMBER') โดยลืมไปว่า CASHIER/ADMIN ก็เห็น
// ลิงก์ "ยอดฝากขายของฉัน" ได้เหมือนกันตอนสลับเป็นโหมด "ซื้อของ/จองสินค้า" (sessionMode='shop' ใน
// Layout.tsx ทำให้ isStaff เป็น false แล้วโชว์ /my-sales ให้ CASHIER/ADMIN ด้วย) เจอจาก log จริง:
// role=CASHIER โดน 403 — วิธีแก้ที่ถูกคือเลิก enumerate role เป็นรายตัว เพราะ route นี้ self-scoped
// อยู่แล้ว (ownership check ด้านล่าง) ต้องแค่ authenticateToken (มี global อยู่แล้ว) ก็พอ ไม่ต้องมี
// requireRole เลย — ใครก็ตามที่ login แล้วดูได้เฉพาะของตัวเอง ยกเว้น ADMIN ที่ดูของใครก็ได้
app.get('/api/reports/vendor-sales', async (req, res) => {
  try {
    // ⭐️ ถ้ามี ?vendor_id= ส่งมา ให้กรองเฉพาะของเจ้าของคนนั้น (ใช้กับหน้า "ยอดฝากขายของฉัน")
    // ไม่ส่งมา = ดึงสรุปทุกคน (ใช้กับ ADMIN เท่านั้น)
    const { vendor_id } = req.query;

    if (req.user.role !== 'ADMIN') {
      if (!vendor_id || Number(vendor_id) !== req.user.id) {
        return res.status(403).json({ error: "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น" });
      }
    }

    let query = `
      SELECT 
        u.id as vendor_id,
        u.student_id,
        u.full_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status = 'COMPLETED'
    `;
    const params = [];
    if (vendor_id) {
      query += ` AND u.id = ?`;
      params.push(vendor_id);
    }
    query += ` GROUP BY u.id, u.student_id, u.full_name ORDER BY vendor_earnings DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// 🐛 FIX (round 2) — เหตุผลเดียวกับ /api/reports/vendor-sales ด้านบน: เลิก enumerate role, ใช้
// ownership check แทน (ใครก็ดูของตัวเองได้ ยกเว้น ADMIN ดูของใครก็ได้)
app.get('/api/reports/vendor-sales/detail', async (req, res) => {
  try {
    const { vendor_id } = req.query;
    if (!vendor_id) return res.status(400).json({ error: 'ต้องระบุ vendor_id' });

    if (req.user.role !== 'ADMIN' && Number(vendor_id) !== req.user.id) {
      return res.status(403).json({ error: "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น" });
    }

    const [rows] = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.gp_rate,
        SUM(si.quantity) as quantity_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status = 'COMPLETED' AND p.vendor_id = ?
      GROUP BY p.id, p.name, p.gp_rate
      ORDER BY vendor_earnings DESC
    `, [vendor_id]);

    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});
// =========================================
// REPORTS เพิ่มเติม (หมวด 5 — Dashboard ADMIN) — ทุก endpoint requireRole('ADMIN')
// =========================================

app.get('/api/reports/void-summary', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(id) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
      FROM sales
      WHERE status = 'VOIDED' AND DATE(created_at) = CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/shift-anomalies', requireRole('ADMIN'), async (req, res) => {
  try {
    // tolerance ±20 บาท ถือว่าปกติ เกินกว่านี้ = ผิดปกติ
    const [rows] = await pool.query(`
      SELECT sh.id, sh.difference, sh.closed_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'CLOSED' AND DATE(sh.closed_at) = CURDATE() AND ABS(sh.difference) > 20
      ORDER BY ABS(sh.difference) DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/sales-comparison', requireRole('ADMIN'), async (req, res) => {
  try {
    // ยอดต่อวัน = sales (created_at) + orders COMPLETED (completed_at)
    const dayTotal = async (dateExpr) => {
      const [rows] = await pool.query(`
        SELECT
          (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE status='COMPLETED' AND DATE(created_at) = ${dateExpr})
          +
          (SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE status='COMPLETED' AND DATE(completed_at) = ${dateExpr})
          as total
      `);
      return Number(rows[0].total);
    };

    const today = await dayTotal('CURDATE()');
    const yesterday = await dayTotal('(CURDATE() - INTERVAL 1 DAY)');
    const lastWeek = await dayTotal('(CURDATE() - INTERVAL 7 DAY)');

    const pct = (base) => base > 0 ? Math.round(((today - base) / base) * 1000) / 10 : null;

    res.json({
      today, yesterday, last_week: lastWeek,
      pct_vs_yesterday: pct(yesterday),
      pct_vs_last_week: pct(lastWeek)
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/hourly-sales', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT HOUR(created_at) as hour, COALESCE(SUM(total_amount),0) as total
      FROM sales
      WHERE status='COMPLETED' AND DATE(created_at) = CURDATE()
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC
    `);
    // เติมชั่วโมงที่ไม่มียอดให้เป็น 0 (0-23) เพื่อกราฟต่อเนื่อง
    const map = {};
    rows.forEach(r => { map[r.hour] = Number(r.total); });
    const result = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: map[h] || 0 }));
    res.json(result);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/sales-by-cashier', requireRole('ADMIN'), async (req, res) => {
  try {
    // ⭐️ หมวด 6: JOIN sales.shift_id = shifts.id แม่นกว่าเทียบช่วงเวลา (รองรับเปิดกะซ้อนเวลากันหลายคน)
    // บิลเก่าก่อนมีคอลัมน์ shift_id จะไม่ถูกนับในรายงานนี้ (shift_id เป็น NULL)
    const [rows] = await pool.query(`
      SELECT
        sh.id as shift_id, u.id as cashier_id, u.full_name as cashier_name,
        sh.opened_at, sh.closed_at, sh.status as shift_status,
        COUNT(s.id) as bill_count, COALESCE(SUM(s.total_amount), 0) as total_sales
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      LEFT JOIN sales s ON s.shift_id = sh.id AND s.status = 'COMPLETED'
      WHERE DATE(sh.opened_at) = CURDATE()
      GROUP BY sh.id, u.id, u.full_name, sh.opened_at, sh.closed_at, sh.status
      ORDER BY sh.opened_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/open-shifts', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'OPEN'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/shifts/pending-approval', requireRole('ADMIN'), async (req, res) => {
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/pending-orders', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT status, COUNT(id) as count, COALESCE(SUM(total_amount),0) as total
      FROM orders
      WHERE status NOT IN ('COMPLETED', 'CANCELLED')
      GROUP BY status
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/sales-channel', requireRole('ADMIN'), async (req, res) => {
  try {
    const [walkin] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE status='COMPLETED' AND DATE(created_at)=CURDATE()`);
    const [preorder] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM orders WHERE status='COMPLETED' AND DATE(completed_at)=CURDATE()`);
    res.json({ walkin_sales: Number(walkin[0].total), preorder_sales: Number(preorder[0].total) });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/gross-profit', requireRole('ADMIN'), async (req, res) => {
  try {
    // กำไรขั้นต้น = subtotal - (cost * qty) - GP ที่ต้องคืน vendor (เฉพาะสินค้าฝากขาย)
    // GP สหกรณ์ = subtotal * gp_rate/100 คือส่วนที่สหกรณ์ได้ ส่วน vendor_earnings คืน vendor
    // กำไรจริงของสหกรณ์: สินค้าปกติ = subtotal - cost*qty ; สินค้าฝากขาย = subtotal * gp_rate/100
    const [rows] = await pool.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN p.vendor_id IS NOT NULL THEN si.subtotal * (p.gp_rate / 100)
          ELSE si.subtotal - (p.cost * si.quantity)
        END
      ), 0) as gross_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status='COMPLETED' AND DATE(s.created_at)=CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ สรุปรายได้/กำไร แยกกำไรจาก GP (สินค้าฝากขาย) ออกจากกำไรสินค้าสหกรณ์เอง
// รวมทั้งขายหน้าร้าน (sales) + พรีออเดอร์ที่ COMPLETED (orders) — คืนทั้งรายเดือน + ภาพรวมทั้งหมด
app.get('/api/reports/profit-summary', requireRole('ADMIN'), async (req, res) => {
  try {
    // นิยาม (ต่อรายการสินค้า):
    //   รายได้ (revenue)      = subtotal ที่ขายได้
    //   ต้นทุนสินค้าสหกรณ์     = cost*qty (เฉพาะสินค้าสหกรณ์เอง vendor_id IS NULL)
    //   คืนผู้ฝากขาย          = subtotal - subtotal*gp% (เฉพาะสินค้าฝากขาย)
    //   กำไรสินค้าสหกรณ์เอง    = subtotal - cost*qty (vendor_id IS NULL)
    //   กำไรจาก GP ฝากขาย     = subtotal*gp% (vendor_id IS NOT NULL)
    const lineExpr = `
      it.subtotal AS revenue,
      CASE WHEN p.vendor_id IS NULL THEN p.cost*it.quantity ELSE 0 END AS cogs_own,
      CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal - it.subtotal*p.gp_rate/100 ELSE 0 END AS vendor_payout,
      CASE WHEN p.vendor_id IS NULL THEN it.subtotal - p.cost*it.quantity ELSE 0 END AS profit_own,
      CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal*p.gp_rate/100 ELSE 0 END AS profit_gp`;
    const [rows] = await pool.query(`
      SELECT period,
             SUM(revenue) AS revenue,
             SUM(cogs_own) AS cogs_own,
             SUM(vendor_payout) AS vendor_payout,
             SUM(profit_own) AS profit_own,
             SUM(profit_gp) AS profit_gp,
             SUM(profit_own + profit_gp) AS profit_total
      FROM (
        SELECT DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+07:00'),'%Y-%m') AS period, ${lineExpr}
        FROM sale_items it JOIN sales s ON it.sale_id=s.id JOIN products p ON it.product_id=p.id
        WHERE s.status='COMPLETED'
        UNION ALL
        SELECT DATE_FORMAT(CONVERT_TZ(o.completed_at,'+00:00','+07:00'),'%Y-%m') AS period, ${lineExpr}
        FROM order_items it JOIN orders o ON it.order_id=o.id JOIN products p ON it.product_id=p.id
        WHERE o.status='COMPLETED'
      ) t
      GROUP BY period ORDER BY period DESC
    `);
    const num = (v) => Number(v || 0);
    const monthly = rows.map(r => ({
      period: r.period,
      revenue: num(r.revenue),
      cogs_own: num(r.cogs_own),
      vendor_payout: num(r.vendor_payout),
      profit_own: num(r.profit_own),
      profit_gp: num(r.profit_gp),
      profit_total: num(r.profit_total),
    }));
    const overall = monthly.reduce((a, m) => ({
      revenue: a.revenue + m.revenue,
      cogs_own: a.cogs_own + m.cogs_own,
      vendor_payout: a.vendor_payout + m.vendor_payout,
      profit_own: a.profit_own + m.profit_own,
      profit_gp: a.profit_gp + m.profit_gp,
      profit_total: a.profit_total + m.profit_total,
    }), { revenue: 0, cogs_own: 0, vendor_payout: 0, profit_own: 0, profit_gp: 0, profit_total: 0 });
    res.json({ overall, monthly });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/dead-stock', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.name, p.stock
      FROM products p
      WHERE p.is_active = TRUE AND p.stock > 0
        AND p.id NOT IN (
          SELECT DISTINCT si.product_id
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status='COMPLETED' AND s.created_at >= (CURDATE() - INTERVAL 30 DAY)
        )
      ORDER BY p.stock DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/vendor-summary', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.id as vendor_id, u.full_name as vendor_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status='COMPLETED' AND p.vendor_id IS NOT NULL
      GROUP BY u.id, u.full_name
      ORDER BY vendor_earnings DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// ⭐️ SUMMARY / PAYROLL (หน้า "สรุปข้อมูล" — ADMIN เท่านั้น)
// =========================================

app.get('/api/reports/payroll', requireRole('ADMIN'), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    // พนักงานทั้งหมด (CASHIER + ADMIN) พร้อมอัตราค่าจ้างต่อชั่วโมงปัจจุบัน
    const [staff] = await pool.query(
      `SELECT id, full_name, role, hourly_rate FROM users WHERE role IN ('CASHIER','ADMIN') AND is_active = TRUE ORDER BY full_name`
    );

    // ชั่วโมงทำงาน: CASHIER นับจาก shifts ที่ปิดสมบูรณ์แล้ว (status='CLOSED'), ADMIN นับจาก attendance
    const [shiftMinutes] = await pool.query(
      `SELECT cashier_id as user_id, SUM(TIMESTAMPDIFF(MINUTE, opened_at, closed_at)) as total_minutes
       FROM shifts
       WHERE status = 'CLOSED' AND closed_at IS NOT NULL AND DATE_FORMAT(opened_at, '%Y-%m') = ?
       GROUP BY cashier_id`,
      [month]
    );
    const [attendanceMinutes] = await pool.query(
      `SELECT user_id, SUM(TIMESTAMPDIFF(MINUTE, check_in, check_out)) as total_minutes
       FROM attendance
       WHERE check_out IS NOT NULL AND DATE_FORMAT(check_in, '%Y-%m') = ?
       GROUP BY user_id`,
      [month]
    );

    // มาสาย: ใช้ตรรกะเดียวกับ /api/reports/attendance (เทียบ schedules.expected_start กับเวลาจริง) ยกเว้นวันหยุด
    const [lateRows] = await pool.query(
      `SELECT user_id, work_date, actual_time,
         CASE WHEN actual_time IS NULL THEN NULL
              ELSE TIMESTAMPDIFF(MINUTE, CONCAT(work_date, ' ', expected_start), actual_time)
         END as late_minutes
       FROM (
         SELECT s.cashier_id as user_id, s.work_date, s.expected_start, sh.opened_at as actual_time
         FROM schedules s
         JOIN users u ON s.cashier_id = u.id AND u.role = 'CASHIER'
         LEFT JOIN shifts sh ON sh.cashier_id = s.cashier_id AND DATE(sh.opened_at) = s.work_date
         UNION ALL
         SELECT s.cashier_id as user_id, s.work_date, s.expected_start, att.check_in as actual_time
         FROM schedules s
         JOIN users u ON s.cashier_id = u.id AND u.role = 'ADMIN'
         LEFT JOIN attendance att ON att.user_id = s.cashier_id AND DATE(att.check_in) = s.work_date
       ) combined
       WHERE work_date NOT IN (SELECT holiday_date FROM holidays)
         AND DATE_FORMAT(work_date, '%Y-%m') = ?`,
      [month]
    );

    const minutesByUser = {};
    for (const r of shiftMinutes) minutesByUser[r.user_id] = (minutesByUser[r.user_id] || 0) + Number(r.total_minutes || 0);
    for (const r of attendanceMinutes) minutesByUser[r.user_id] = (minutesByUser[r.user_id] || 0) + Number(r.total_minutes || 0);

    const lateMinutesByUser = {};
    for (const r of lateRows) {
      if (r.late_minutes && r.late_minutes > 0) {
        lateMinutesByUser[r.user_id] = (lateMinutesByUser[r.user_id] || 0) + r.late_minutes;
      }
    }

    const result = staff.map(u => {
      const totalMinutes = minutesByUser[u.id] || 0;
      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const lateMinutes = lateMinutesByUser[u.id] || 0;
      const lateHours = Math.round((lateMinutes / 60) * 100) / 100;
      const hourlyRate = Number(u.hourly_rate) || 0;
      const calculatedPay = Math.round(totalHours * hourlyRate * 100) / 100;
      return {
        user_id: u.id,
        full_name: u.full_name,
        role: u.role,
        hourly_rate: hourlyRate,
        total_hours: totalHours,
        late_minutes: lateMinutes,
        late_hours: lateHours,
        calculated_pay: calculatedPay,
      };
    });

    res.json({ month, staff: result });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/users/:id/hourly-rate', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { hourly_rate } = req.body;
  const rate = Number(hourly_rate);
  if (hourly_rate === undefined || hourly_rate === null || !Number.isFinite(rate) || rate < 0) {
    return res.status(400).json({ error: 'กรุณาระบุอัตราค่าจ้างต่อชั่วโมงที่ถูกต้อง (ตัวเลข ≥ 0)' });
  }
  try {
    const [result] = await pool.query('UPDATE users SET hourly_rate = ? WHERE id = ? AND role IN (\'CASHIER\',\'ADMIN\')', [rate, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบพนักงานนี้' });
    res.json({ message: 'อัปเดตอัตราค่าจ้างสำเร็จ', hourly_rate: rate });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/reports/monthly-overview', requireRole('ADMIN'), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    // ยอดขายรวมเดือนนี้ (sales หน้าร้าน + orders จองที่มารับแล้ว)
    const [salesRows] = await pool.query(
      `SELECT COALESCE(SUM(cnt), 0) as total_bills, COALESCE(SUM(total), 0) as total_sales
       FROM (
         SELECT COUNT(id) as cnt, SUM(total_amount) as total
         FROM sales WHERE status = 'COMPLETED' AND DATE_FORMAT(created_at, '%Y-%m') = ?
         UNION ALL
         SELECT COUNT(id), SUM(total_amount)
         FROM orders WHERE status = 'COMPLETED' AND DATE_FORMAT(completed_at, '%Y-%m') = ?
       ) combined`,
      [month, month]
    );

    // สมาชิก: รวมทั้งหมด + สมัครใหม่เดือนนี้
    const [memberRows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'MEMBER') as total_members,
         (SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND DATE_FORMAT(created_at, '%Y-%m') = ?) as new_members`,
      [month]
    );

    // สต๊อกใกล้หมด (ข้อมูลปัจจุบัน ไม่ผูกกับเดือนที่เลือก)
    const [lowStockRows] = await pool.query(
      `SELECT COUNT(*) as count FROM products WHERE is_active = TRUE AND stock <= 5`
    );

    // ออเดอร์จองที่ยังค้างอยู่ (ข้อมูลปัจจุบัน)
    const [pendingOrderRows] = await pool.query(
      `SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')`
    );

    // บิลยกเลิกเดือนนี้
    const [voidRows] = await pool.query(
      `SELECT COUNT(*) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
       FROM sales WHERE status = 'VOIDED' AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
      [month]
    );

    res.json({
      month,
      total_bills: Number(salesRows[0].total_bills),
      total_sales: Number(salesRows[0].total_sales),
      total_members: Number(memberRows[0].total_members),
      new_members: Number(memberRows[0].new_members),
      low_stock_count: Number(lowStockRows[0].count),
      pending_orders_count: Number(pendingOrderRows[0].count),
      void_count: Number(voidRows[0].void_count),
      void_amount: Number(voidRows[0].void_amount),
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 10. SETTINGS (ตั้งค่าร้านค้า)
// =========================================

app.get('/api/settings/store', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.put('/api/settings/store', requireRole('ADMIN'), async (req, res) => {
  const { store_name, tax_id, address, receipt_footer } = req.body;
  try {
    await pool.query(
      'UPDATE settings SET store_name = ?, tax_id = ?, address = ?, receipt_footer = ? WHERE id = 1',
      [store_name, tax_id, address, receipt_footer]
    );
    res.json({ message: "อัปเดตข้อมูลร้านค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.get('/api/settings/receipt', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT receipt_footer FROM settings WHERE id = 1');
    res.json({ receipt_footer: rows[0].receipt_footer });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 4.1 INVENTORY (ส่วนเสริมของระบบสินค้า)
// =========================================

app.patch('/api/products/:id/stock', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { adjustment, type, note } = req.body;
  if (adjustment === undefined || !type) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี adjustment และ type)" });
  }

  try {
    // ใช้ GREATEST เพื่อป้องกันไม่ให้สต๊อกติดลบในกรณีที่ตัดของเสียมากกว่าที่มี
    const [result] = await pool.query(
      'UPDATE products SET stock = GREATEST(0, stock + ?) WHERE id = ?',
      [adjustment, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "ไม่พบสินค้า" });
    }

    // หมายเหตุ: ในระบบจริง อาจจะมีการบันทึกลงตาราง stock_history (ประวัติการปรับสต๊อก) ด้วย
    res.json({ message: `ปรับสต๊อกสำเร็จ (เหตุผล: ${type})` });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย — เผยระดับสต๊อกภายใน (สินค้าใกล้หมด) ให้ MEMBER
// เห็นได้ด้วย ทั้งที่เป็นข้อมูลปฏิบัติการภายในร้าน (ใช้เติมสต๊อก) ไม่ใช่ข้อมูลสำหรับลูกค้า
app.get('/api/inventory/low-stock', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    // ดึงสินค้าที่เหลือน้อยกว่าหรือเท่ากับ 10 ชิ้น
    const [rows] = await pool.query('SELECT id, barcode, name, stock FROM products WHERE stock <= 10 AND is_active = TRUE ORDER BY stock ASC');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 8. PROMOTIONS (ระบบโปรโมชั่นและส่วนลด)
// =========================================

app.get('/api/promotions', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM promotions WHERE is_active = TRUE AND (end_date IS NULL OR end_date >= CURDATE())');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Phase 2 — โปรโมชั่นที่กำลัง active พร้อมข้อความอ่านง่าย (รวมชื่อสินค้าสำหรับ BOGO) — ไว้โชว์แบนเนอร์
app.get('/api/promotions/active', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.name, p.discount_type, p.discount_value, p.end_date, p.buy_qty, p.free_qty,
             bp.name AS buy_product_name, fp.name AS free_product_name
      FROM promotions p
      LEFT JOIN products bp ON p.buy_product_id = bp.id
      LEFT JOIN products fp ON p.free_product_id = fp.id
      WHERE p.is_active = TRUE
        AND (p.start_date IS NULL OR p.start_date <= CURDATE())
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
      ORDER BY p.end_date ASC
    `);
    const items = rows.map(r => {
      let label;
      if (r.discount_type === 'PERCENT') label = `ลด ${Number(r.discount_value)}% ทั้งบิล`;
      else if (r.discount_type === 'FIXED') label = `ลด ฿${Number(r.discount_value)} ทั้งบิล`;
      else if (r.discount_type === 'BOGO') label = `ซื้อ ${r.buy_product_name || 'สินค้า'} ${r.buy_qty || 1} แถม ${r.free_product_name || 'สินค้า'} ${r.free_qty || 1}`;
      else label = r.name;
      return { id: r.id, name: r.name, type: r.discount_type, label, end_date: r.end_date };
    });
    res.json(items);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/promotions', requireRole('ADMIN'), async (req, res) => {
  const {
    name, discount_type, discount_value, start_date, end_date,
    buy_product_id, buy_qty, free_product_id, free_qty,
    usage_limit, usage_limit_per_user
  } = req.body;

  // ⭐️ BOGO/ซื้อครบแถม ต้องระบุ buy_product_id, buy_qty, free_product_id, free_qty ให้ครบ
  if (discount_type === 'BOGO' && (!buy_product_id || !buy_qty || !free_product_id || !free_qty)) {
    return res.status(400).json({ error: "โปรโมชั่นแบบซื้อครบแถม ต้องระบุสินค้าที่ต้องซื้อ, จำนวนที่ต้องซื้อ, สินค้าที่แถม, จำนวนที่แถม ให้ครบ" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO promotions
        (name, discount_type, discount_value, start_date, end_date, buy_product_id, buy_qty, free_product_id, free_qty, usage_limit, usage_limit_per_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, discount_type, discount_value || 0, start_date || null, end_date || null,
       buy_product_id || null, buy_qty || null, free_product_id || null, free_qty || null,
       usage_limit || null, usage_limit_per_user || null]
    );
    res.status(201).json({ id: result.insertId, message: "สร้างโปรโมชั่นสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});


// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย — endpoint นี้มีแค่ POS.tsx (staff-only page) เรียกใช้
// ล็อกให้ตรงกับผู้ใช้จริงเพื่อความสม่ำเสมอ (severity ต่ำ เพราะ response แค่ preview ไม่ใช่ยอดที่เชื่อถือได้
// จริง — /api/sales/checkout คำนวณส่วนลดใหม่เองเสมอ ไม่เชื่อค่าจาก client)
app.post('/api/promotions/verify', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { promotion_id, grand_total, items, member_id } = req.body;
  try {
    const [promos] = await pool.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE', [promotion_id]);
    if (promos.length === 0) return res.status(404).json({ error: "ไม่พบโปรโมชั่น หรือโปรโมชั่นหมดอายุแล้ว" });

    const promo = promos[0];

    const limitError = await checkPromotionUsageLimit(pool.query.bind(pool), promo, member_id || null);
    if (limitError) return res.status(400).json({ error: limitError });

    const discount_amount = await calculatePromotionDiscount(pool.query.bind(pool), promo, grand_total, items);
    if (promo.discount_type === 'BOGO' && discount_amount === 0) {
      return res.status(400).json({ error: "ตะกร้าไม่ตรงเงื่อนไขโปรโมชั่นนี้ (ซื้อไม่ครบจำนวน หรือไม่มีสินค้าที่แถมในตะกร้า)" });
    }
    const net_total = grand_total - discount_amount;

    res.json({ discount_amount, net_total, promo_name: promo.name });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// 9. SUPPLIERS & PURCHASES (รับของเข้า)
// =========================================

// ⭐️ Sprint 1 — C1 audit finding: ไม่มี guard เลย — `SELECT *` เผยชื่อ+ข้อมูลติดต่อซัพพลายเออร์
// (ข้อมูลธุรกิจภายใน) ให้ MEMBER เห็นได้ด้วย ไม่ใช่ข้อมูลสำหรับลูกค้า
app.get('/api/suppliers', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM suppliers');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/suppliers', requireRole('ADMIN'), async (req, res) => {
  const { name, contact_info } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO suppliers (name, contact_info) VALUES (?, ?)', [name, contact_info]);
    res.status(201).json({ id: result.insertId, message: "เพิ่มซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.delete('/api/suppliers/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    // ลบข้อมูลซัพพลายเออร์ตาม ID
    await pool.query('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบข้อมูลซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    // ดัก Error กรณีที่ซัพพลายเออร์เจ้านี้เคยส่งของให้เราแล้ว (มีบิลผูกอยู่)
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ error: "ไม่สามารถลบได้ เนื่องจากซัพพลายเออร์นี้มีประวัติการรับสินค้าในคลังแล้ว" });
    }
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/purchases', requireRole('CASHIER', 'ADMIN'), async (req, res) => {
  const { supplier_id, user_id, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "ไม่มีรายการสินค้า" });

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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally {
    conn.release();
  }
});

// =========================================
// 11. PRE-ORDER & NOTIFICATIONS (ระบบสั่งจองและแจ้งเตือน)
// =========================================

// ⭐️ Refactor — ลบ endpoint เก่า POST /api/orders/upload-slip (ไม่มี :id) ทิ้ง: ไม่มี frontend
// เรียกใช้แล้ว (PreOrder.tsx เปลี่ยนไปใช้ POST /api/orders/:id/upload-slip ทั้งหมดแล้ว) และของเก่า
// เก็บไฟล์ลง uploads/ ตรงๆ ไม่ได้จัดโฟลเดอร์ตามวันที่แบบระบบใหม่ (slipUpload ใน multer-config.js)

// 2. API สร้างออเดอร์ใหม่
app.post('/api/orders', requireRole('MEMBER', 'CASHIER', 'ADMIN'), validateRequest(orderValidator), async (req, res) => {
  // รับข้อมูลจากหน้าเว็บ (⭐️ เพิ่ม redeem_points สำหรับแลกแต้มเป็นส่วนลด)
  const { items, payment_method, slip_image, use_phone_for_points, redeem_points } = req.body;
  const user_id = req.user.id; // ดึงจากคนที่ล็อกอินอยู่

  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าว่างเปล่า" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ Sprint 1 — B3: สะสมยอดในหน่วยสตางค์ (integer) กัน float drift ข้ามหลายรายการ — pattern เดียวกับ /sales/checkout
    let totalAmountSatang = 0;
    const processedItems = [];

    // คำนวณราคา + เช็คสต๊อกพอจริง (ล็อกแถวสินค้ากันขายเกินตอนมีหลายคนจองพร้อมกัน)
    for (const item of items) {
      const [rows] = await conn.query(`
        SELECT id, name, price, stock,
               GREATEST(
                 CASE WHEN promo_percent > 0 AND promo_start IS NOT NULL AND promo_end IS NOT NULL
                        AND DATE(CONVERT_TZ(NOW(),'+00:00','+07:00')) BETWEEN promo_start AND promo_end
                      THEN promo_percent ELSE 0 END,
                 CASE WHEN expiry_date IS NOT NULL
                        AND DATEDIFF(DATE(expiry_date), DATE(CONVERT_TZ(NOW(),'+00:00','+07:00'))) = 1
                      THEN COALESCE(discount_percent,0) ELSE 0 END
               ) AS best_discount_percent
        FROM products WHERE id = ? FOR UPDATE`, [item.product_id]);
      if (rows.length === 0) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);
      if (rows[0].stock < item.quantity) {
        throw new Error(`สต๊อกไม่พอสำหรับ "${rows[0].name}" (เหลือ ${rows[0].stock}, ต้องการ ${item.quantity})`);
      }
      // ⭐️ Phase 1: pre-order ได้ส่วนลดระดับสินค้าเหมือน POS (คำนวณใน SQL เวลาไทย ให้ตรงกับที่การ์ดโชว์)
      let unitPrice = Number(rows[0].price);
      const discPct = Number(rows[0].best_discount_percent) || 0;
      if (discPct > 0) unitPrice -= Math.round(unitPrice * discPct / 100);
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
    if (redeem_points > 0) {
      const [userRows] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [user_id]);
      if (userRows.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้');
      const availablePoints = userRows[0].points;

      pointsRedeemed = Math.min(Number(redeem_points), availablePoints, Math.floor(totalAmount));
      if (pointsRedeemed < 0) pointsRedeemed = 0;
      pointsDiscount = pointsRedeemed; // อัตรา 1 แต้ม = ฿1
    }
    const netTotal = fromSatang(totalAmountSatang - toSatang(pointsDiscount));

    // คำนวณแต้มสะสมใหม่ที่จะได้รับ ถ้าลูกค้ากรอกเบอร์มา หรือติ๊กว่าจะสะสมแต้ม
    // (ทุก 20 บาท = 1 แต้ม, คิดจากยอดสุทธิ "หลังหักแต้มที่แลกไปแล้ว" เหมือน pattern ใน /sales/checkout)
    const earnPoints = use_phone_for_points ? Math.floor(netTotal / 20) : 0;
    
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
      const msg = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (msg) lowStockMsgs.push(msg);
    }

    // ⭐️ หักแต้มที่แลกใช้ไปทันที (กันแลกแต้มซ้ำ/เกินยอดจริงถ้าลูกค้ามีออเดอร์ค้างหลายใบพร้อมกัน)
    // ถ้าออเดอร์นี้ถูกยกเลิกภายหลัง ระบบจะคืนแต้มให้ที่ PUT /orders/:id/status (CANCELLED) และ /orders/:id/cancel-by-user
    if (pointsRedeemed > 0) {
      await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, user_id]);
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally {
    conn.release();
  }
});

// 3. API ดึงรายการออเดอร์
app.get('/api/orders', async (req, res) => {
  try {
    let query = `
      SELECT o.*, u.full_name as customer_name, u.phone_number,
             DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') as created_at_bkk
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `;
    const params = [];

    // ถ้าเป็นแค่ MEMBER ให้ดูได้แค่ออเดอร์ของตัวเอง
    if (req.user.role === 'MEMBER') {
      query = `
        SELECT o.*, u.full_name as customer_name, u.phone_number,
               DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') as created_at_bkk
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.user_id = ?
        ORDER BY o.created_at DESC
      `;
      params.push(req.user.id);
    }

    const [orders] = await pool.query(query, params);

    // ดึงรายการสินค้าข้างในออเดอร์มาให้ด้วยเลย
    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT oi.*, p.name as product_name, p.image_url 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }

    res.json(orders);
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// 4. API จัดการสถานะออเดอร์ (พนักงานกดยืนยัน / ยกเลิก)
app.put('/api/orders/:id/status', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const orderId = req.params.id;
  // ⭐️ F3 (frontend) — รับ notes เป็น alias ของ reject_reason ด้วย เผื่อ frontend ส่งชื่อ field ต่างกันตามบริบท (ตรวจสลิป vs ยกเลิก)
  const { status, reject_reason: rawRejectReason, notes } = req.body;
  const reject_reason = rawRejectReason || notes || null;
  // status: PENDING_VERIFY → PREPARING → READY → COMPLETED
  //         PENDING_VERIFY → SLIP_REJECTED (สลิปผิด, ขอส่งใหม่)
  //         PENDING_VERIFY → REFUND_REQUESTED (โอนแล้วแต่ไม่เอาแล้ว)
  //         PENDING_VERIFY/any → CANCELLED (สลิปปลอม/ยกเลิก)

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ดึงข้อมูลออเดอร์มาเช็ค
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) throw new Error("ไม่พบออเดอร์นี้");
    const order = orders[0];

    // ⭐️ ตรวจสิทธิ์: ถ้ามี assigned_to แล้ว เฉพาะคนนั้น (หรือ ADMIN) เท่านั้นที่แก้ได้
    if (order.assigned_to && order.assigned_to !== req.user.id && req.user.role !== 'ADMIN') {
      const [assignee] = await conn.query('SELECT full_name FROM users WHERE id = ?', [order.assigned_to]);
      throw new Error(`ออเดอร์นี้อยู่ในความรับผิดชอบของ ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว`);
    }

    // ⭐️ กันยกเลิกซ้ำ (ป้องกันคืนแต้มซ้ำสองรอบถ้ากดยกเลิกออเดอร์ที่ถูกยกเลิกไปแล้ว)
    if (status === 'CANCELLED' && order.status === 'CANCELLED') {
      throw new Error("ออเดอร์นี้ถูกยกเลิกไปแล้ว");
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
    await conn.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);

    // ถ้ายกเลิกออเดอร์ (เช่น สลิปมั่ว) — คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนลูกค้าจอง
    let cancelMsg = null;
    if (status === 'CANCELLED') {
      // ⭐️ FIX: ข้อความแจ้งเตือนปรับให้อ่านเข้าใจง่ายขึ้น ไม่ใช้ศัพท์ทางการ/รูปแบบ log ระบบ
      cancelMsg = `ออเดอร์ #${orderId} ถูกยกเลิกแล้ว สาเหตุ: ${reject_reason || 'สลิปไม่ถูกต้อง'}`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [order.user_id, cancelMsg]);

      const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
      for (const item of items) {
        await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      stockChanged = true;

      // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
      if (order.points_redeemed > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
      }
    }

    // ⭐️ สลิปผิด — คืนสต๊อก แจ้งลูกค้าให้ส่งสลิปใหม่หรือยกเลิก
    if (status === 'SLIP_REJECTED') {
      const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
      for (const item of items) {
        await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      stockChanged = true;

      // ⭐️ Task 4 — บันทึกผลตรวจสลิป (reject) ลง orders โดยตรง แทนการสร้าง endpoint แยกที่จะตัดสต๊อกซ้ำ
      await conn.query(
        `UPDATE orders SET slip_verification_status = 'REJECTED' WHERE id = ?`,
        [orderId]
      );
      await conn.query(
        'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
        ['REJECT_SLIP', req.user.id, 'ORDER', orderId, JSON.stringify({ reason: reject_reason || null })]
      );
    }

    // ⭐️ ขอคืนเงิน (โอนมาแล้วแต่ไม่เอาแล้ว) — แจ้งลูกค้าให้นำสลิปมาที่ร้าน + คืนแต้ม
    if (status === 'REFUND_REQUESTED') {
      if (order.points_redeemed > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
      }
    }

    // ถ้าออเดอร์เสร็จสมบูรณ์ (ลูกค้ามารับของแล้ว) ให้เพิ่มแต้มสะสม (สต๊อกตัดไปแล้วตั้งแต่ตอนจอง)
    if (status === 'COMPLETED') {
      await conn.query('UPDATE orders SET completed_at = NOW() WHERE id = ?', [orderId]);
      if (order.earn_points > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.earn_points, order.user_id]);
      }
    }

    // ⭐️ F3 — จุดที่ "ตรวจสลิปผ่าน" จริงๆ คือ PENDING_VERIFY → PREPARING (ไม่ใช่ตอน COMPLETED ซึ่งคือลูกค้ามารับของ
    // แก้จาก Task 4 เดิมที่ผูก slip_verification_status='VERIFIED' ไว้ผิดจุดที่ COMPLETED)
    if (order.status === 'PENDING_VERIFY' && status === 'PREPARING') {
      await conn.query(
        `UPDATE orders SET slip_verification_status = 'VERIFIED', slip_verified_by = ?, slip_verified_at = NOW() WHERE id = ?`,
        [req.user.id, orderId]
      );
      await conn.query(
        'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
        ['VERIFY_SLIP', req.user.id, 'ORDER', orderId, JSON.stringify({ notes: reject_reason || null })]
      );
    }

    // ⭐️ แจ้งเตือนลูกค้าแบบมีข้อความจริง บันทึกลง notifications ด้วย (ไม่ใช่แค่ socket เฉยๆ กันพลาดถ้าลูกค้าไม่ได้เปิดแอปอยู่ตอนนั้น)
    // ⭐️ FIX: ข้อความแจ้งเตือนลูกค้าเดิมใช้คำทางการ/ระบบเกินไป (เช่น "พนักงานรับเรื่องแล้ว", "เนื่องจาก:")
    // ปรับเป็นภาษาพูดธรรมดาที่คนทั่วไปอ่านแล้วเข้าใจทันที ความหมาย/ตัวแปรเหมือนเดิมทุกจุด
    const statusMessages = {
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

    res.json({ message: "อัปเดตสถานะออเดอร์สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ ทำเครื่องหมายอ่านแจ้งเตือนทั้งหมดแล้ว (เรียกตอนกดกระดิ่ง) — ครอบคลุมทั้งของตัวเองและของระบบที่ role นี้เห็นได้
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ API ดึงจำนวนออเดอร์ที่รอจัดการ (แสดงเลข Badge แดงๆ) — ย้ายมาไว้ก่อน จะได้ลบ route ซ้ำด้านล่างได้สะดวก
app.get('/api/orders/pending-count', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(id) as count FROM orders WHERE status IN ('PENDING_VERIFY', 'WAITING_CASH', 'PREPARING')");
    res.json({ count: rows[0].count || 0 });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    if (!['PENDING_VERIFY', 'WAITING_CASH'].includes(order.status)) {
      throw new Error("ไม่สามารถยกเลิกได้ (ระบบกำลังเตรียมของหรือเสร็จแล้ว) กรุณาติดต่อพนักงาน");
    }

    const cancelReason = order.payment_method === 'QR' 
      ? `ลูกค้ายกเลิกเอง (คืนเงินไปที่: ${refund_info})` 
      : 'ลูกค้ายกเลิกเอง';

    await conn.query('UPDATE orders SET status = ?, reject_reason = ? WHERE id = ?', ['CANCELLED', cancelReason, orderId]);

    // ⭐️ คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนจอง
    const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
    if (order.points_redeemed > 0) {
      await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
app.post('/api/orders/:id/upload-slip', requireRole('MEMBER', 'CASHIER', 'ADMIN'), slipUpload.single('slip'), async (req, res) => {
  const { id } = req.params;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // ⭐️ ตรวจว่า order มีจริงและเป็นของ user ก่อน
    const [orders] = await pool.query(
      'SELECT id, status FROM orders WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found or does not belong to you' });
    }

    const order = orders[0];
    // ⭐️ อนุญาตอัปสลิปเมื่อสถานะ PENDING_VERIFY (สลิปใหม่) หรือ SLIP_REJECTED (ส่งใหม่)
    if (!['PENDING_VERIFY', 'SLIP_REJECTED'].includes(order.status)) {
      return res.status(400).json({ error: `Order must be in PENDING_VERIFY or SLIP_REJECTED status to upload slip. Current status: ${order.status}` });
    }

    // ⭐️ ตรวจ MIME (jpeg, png, gif, webp)
    const allowedPaymentSlipMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedPaymentSlipMimes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `Invalid file type: ${req.file.mimetype}. Only JPEG, PNG, GIF, WebP allowed.` });
    }

    // ตรวจขนาดไฟล์ (สลิป ≤ 5 MB)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 5 MB for payment slip)' });
    }

    // ตรวจ dimensions จาก buffer (สลิป min 400×300, max 4000×3000)
    const dimensions = await validateImageDimensions(req.file.buffer, 400, 300, 4000, 3000);

    // ⭐️ อัปโหลดขึ้น Cloudinary (หรือดิสก์ถ้า dev) → เก็บ URL/พาธเต็มลง slip_image
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const base = `${Date.now()}_${req.user.id}`;
    const slipUrl = await saveImage(req.file.buffer, 'slips', base, ext);

    // อัปเดต slip + reset สถานะเป็น PENDING_VERIFY ถ้าเดิมเป็น SLIP_REJECTED
    const statusUpdate = order.status === 'SLIP_REJECTED' ? ', status = \'PENDING_VERIFY\'' : '';
    const [result] = await pool.query(
      `UPDATE orders SET slip_image = ?${statusUpdate} WHERE id = ? AND user_id = ?`,
      [slipUrl, id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Failed to save payment slip to order' });
    }

    // ⭐️ แจ้ง ADMIN/CASHIER ว่ามีสลิปเข้ามา
    req.io.emit('payment_slip_received', {
      order_id: id,
      message: `ออเดอร์ #${id} ส่งสลิปใหม่ (resubmit)`
    });
    req.io.emit('notifications_updated', {
      message: `ลูกค้าส่งสลิปใหม่สำหรับออเดอร์ #${id}`
    });

    res.json({ success: true, path: slipUrl, dimensions });
  } catch (err) {
    console.error(`[upload-slip] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/shifts/:id/upload-photo — Upload close photo for a shift
 * Only CASHIER/ADMIN can upload
 * Validates: MIME type (jpeg, png only), size (10MB max), dimensions (min 800×600)
 * Returns: { success, filename, path, dimensions }
 */
app.post('/api/shifts/:id/upload-photo', requireRole('CASHIER', 'ADMIN'), shiftPhotoUpload.single('photo'), async (req, res) => {
  const { id } = req.params;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // ⭐️ Sprint 2 — B9: ตรวจ MIME (jpeg, png เท่านั้น)
    const allowedPhotoMimes = ['image/jpeg', 'image/png'];
    if (!allowedPhotoMimes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `Invalid file type: ${req.file.mimetype}. Only JPEG and PNG allowed for shift photos.` });
    }

    // ตรวจขนาดไฟล์ (≤ 10 MB)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 10 MB)' });
    }

    // ตรวจ dimensions จาก buffer (รูปปิดกะ min 800×600)
    const dimensions = await validateImageDimensions(req.file.buffer, 800, 600, 10000, 10000);

    // ⭐️ อัปโหลดขึ้น Cloudinary (หรือดิสก์ถ้า dev) → เก็บ URL/พาธเต็มลง close_photo
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const base = `${Date.now()}_${req.user.id}`;
    const photoUrl = await saveImage(req.file.buffer, 'shift-photos/close', base, ext);

    await pool.query(
      'UPDATE shifts SET close_photo = ? WHERE id = ? AND user_id = ?',
      [photoUrl, id, req.user.id]
    );

    res.json({ success: true, path: photoUrl, dimensions });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    if (!rel) return res.status(400).json({ error: 'ต้องระบุ path' });

    // ตัด prefix '/uploads' ออก (path ใน DB ขึ้นต้นด้วย /uploads/...)
    rel = rel.replace(/^\/+/, '');            // ตัด / นำหน้า
    if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);

    // ป้องกัน directory traversal — resolve แล้วต้องยังอยู่ใต้ UPLOADS_ROOT เท่านั้น
    const abs = path.normalize(path.join(UPLOADS_ROOT, rel));
    if (!abs.startsWith(UPLOADS_ROOT + path.sep)) {
      return res.status(400).json({ error: 'path ไม่ถูกต้อง' });
    }
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'ไม่พบไฟล์' });
    }

    // กันไม่ให้ browser/proxy แคชสลิปไว้แชร์ต่อ (เป็นข้อมูลส่วนตัว)
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(abs);
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// API เวทมนตร์ สร้างตารางฐานข้อมูลอัตโนมัติบน Cloud
// =========================================
app.get('/api/init-db', requireSetupKey, async (req, res) => {
  // ⭐️ Security remediation — bootstrap/dev-only endpoint, must not be reachable in production regardless of SETUP_KEY
  if (IS_PRODUCTION) return res.status(404).end();
  try {
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, password VARCHAR(255), full_name VARCHAR(100), role VARCHAR(20) DEFAULT 'CASHIER', is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100))`,
      `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, barcode VARCHAR(50), name VARCHAR(255), category_id INT, price DECIMAL(10,2), cost DECIMAL(10,2) DEFAULT 0, stock INT DEFAULT 0, image_url TEXT, vendor_id INT NULL, gp_rate DECIMAL(5,2) DEFAULT 0, is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS suppliers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), contact_info TEXT)`,
      `CREATE TABLE IF NOT EXISTS purchases (id INT AUTO_INCREMENT PRIMARY KEY, supplier_id INT, user_id INT, total_amount DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS purchase_items (id INT AUTO_INCREMENT PRIMARY KEY, purchase_id INT, product_id INT, quantity INT, unit_cost DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS shifts (id INT AUTO_INCREMENT PRIMARY KEY, cashier_id INT, opening_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closing_time TIMESTAMP NULL, opening_cash DECIMAL(10,2), expected_cash DECIMAL(10,2), actual_cash DECIMAL(10,2), difference DECIMAL(10,2), status VARCHAR(20) DEFAULT 'OPEN')`,
      `CREATE TABLE IF NOT EXISTS members (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, full_name VARCHAR(100), points INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS sales (id INT AUTO_INCREMENT PRIMARY KEY, cashier_id INT, member_id INT, total_amount DECIMAL(10,2), payment_method VARCHAR(50), amount_received DECIMAL(10,2), change_amount DECIMAL(10,2), status VARCHAR(50) DEFAULT 'COMPLETED', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS sale_items (id INT AUTO_INCREMENT PRIMARY KEY, sale_id INT, product_id INT, quantity INT, price DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, store_name VARCHAR(255) DEFAULT 'ร้านค้าสหกรณ์', tax_id VARCHAR(50), address TEXT, receipt_footer TEXT)`,
      
      // ⭐️ 3 ตารางใหม่สำหรับระบบ Pre-order
      `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, total_amount DECIMAL(10,2), payment_method VARCHAR(50), slip_image TEXT NULL, earn_points INT DEFAULT 0, status VARCHAR(50) DEFAULT 'PENDING_VERIFY', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, product_id INT, quantity INT, price DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, message TEXT, is_read TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];

    for (let q of queries) {
      await pool.query(q);
    }

    // ตั้งค่าชื่อร้านเริ่มต้น
    await pool.query("INSERT IGNORE INTO settings (id, store_name) VALUES (1, 'ร้านค้าสหกรณ์')");

    res.json({ message: "สร้างตารางสำเร็จครบ 11 ตาราง! 🎉 โครงสร้างฐานข้อมูลพร้อมลุยแล้ว" });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
app.post('/api/reports/daily/send', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await sendDailyReport(req.query.date);
    res.json({
      message: result.sent ? "ส่งรายงานสรุปยอดประจำวันสำเร็จ" : "สร้างรายงานสำเร็จ แต่ไม่ได้ส่งอีเมล (ตรวจ ADMIN_EMAIL / SMTP ใน .env)",
      sent: result.sent,
      report: result.data,
    });
  } catch (error) {
    console.error('[500]', error.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// =========================================
// BACKUP & RESTORE (Sprint 2 — C3)
// =========================================

app.get('/api/admin/backups', requireRole('ADMIN'), async (req, res) => {
  try {
    const [backups] = await pool.query(`
      SELECT id, filename, backup_date, file_size_mb, status, created_at, restored_at
      FROM backups
      ORDER BY backup_date DESC
      LIMIT 50
    `);

    res.json(backups);
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/admin/backups/create', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await createBackup(pool);

    if (!result) {
      return res.status(400).json({ error: 'Backup already exists for today' });
    }

    res.json({ success: true, backup: result });
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

app.post('/api/admin/backups/:id/restore', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { confirm } = req.body;

  if (!confirm) {
    return res.status(400).json({ error: 'Restore requires explicit confirmation' });
  }

  try {
    const [backups] = await pool.query(
      'SELECT * FROM backups WHERE id = ? AND status = ?',
      [id, 'SUCCESS']
    );

    if (backups.length === 0) {
      return res.status(404).json({ error: 'Backup not found or not successful' });
    }

    const backup = backups[0];

    // Perform restore
    await restoreBackup(pool, backup.backup_path);

    // Log restore
    await pool.query(
      'UPDATE backups SET restored_at = NOW(), restored_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    res.json({ success: true, message: `Restored from ${backup.filename}` });
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ Sprint 2 — C2: Audit Log Viewer — GET /api/audit-logs
app.get('/api/audit-logs', requireRole('ADMIN', 'CASHIER', 'MEMBER'), async (req, res) => {
  const { page = 1, limit = 50, action, user_id, start_date, end_date, search } = req.query;
  const currentUser = req.user;

  try {
    let query = `
      SELECT
        al.id, al.user_id, u.full_name,
        al.action, al.resource_type, al.resource_id,
        al.description, al.amount_cents, al.status,
        DATE_FORMAT(CONVERT_TZ(al.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') as timestamp_bkk
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
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
      return res.status(404).json({ error: 'Audit log not found' });
    }

    res.json(logs[0]);
  } catch (err) {
    console.error('[500]', err.message);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
        DATE_FORMAT(CONVERT_TZ(al.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') as timestamp_bkk
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
});

// ⭐️ EXPORT รายงานยอดขาย/รายได้เป็น CSV (เปิดใน Google Sheets/Excel คำนวณต่อได้)
// level=item  (รายชิ้น — ละเอียดสุด, ทำ pivot ได้), bill (รายบิล), daily (สรุปรายวัน)
// ครอบทั้งบิลหน้าร้าน (POS) และพรีออเดอร์ที่ COMPLETED แล้ว; ไม่รวมบิลที่ถูก void
app.get('/api/reports/export/sales-csv', requireRole('ADMIN'), async (req, res) => {
  const { start_date, end_date, level = 'item' } = req.query;

  // แปลง array-of-rows -> CSV string (ใส่ " ครอบทุกช่อง กัน , ในข้อมูล)
  const toCsv = (headers, rows) =>
    [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

  // WHERE ช่วงวันที่ (ถ้าไม่ส่งมา = ทั้งหมด)
  const hasRange = !!(start_date && end_date);

  try {
    let headers, dataRows, filenameTag;

    if (level === 'daily') {
      // สรุปรายวัน: รวมทั้ง POS + พรีออเดอร์ต่อวัน
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      const [rows] = await pool.query(`
        SELECT day, SUM(bill_count) AS bills, SUM(total_sales) AS total_sales,
               SUM(cash_sales) AS cash_sales, SUM(qr_sales) AS qr_sales
        FROM (
          SELECT DATE(s.created_at) AS day, COUNT(*) AS bill_count,
                 SUM(s.total_amount) AS total_sales,
                 SUM(CASE WHEN s.payment_method='CASH' THEN s.total_amount ELSE 0 END) AS cash_sales,
                 SUM(CASE WHEN s.payment_method='QR' THEN s.total_amount ELSE 0 END) AS qr_sales
          FROM sales s WHERE ${wSale} GROUP BY DATE(s.created_at)
          UNION ALL
          SELECT DATE(o.completed_at) AS day, COUNT(*) AS bill_count,
                 SUM(o.total_amount) AS total_sales,
                 SUM(CASE WHEN o.payment_method='CASH' THEN o.total_amount ELSE 0 END) AS cash_sales,
                 SUM(CASE WHEN o.payment_method='QR' THEN o.total_amount ELSE 0 END) AS qr_sales
          FROM orders o WHERE ${wOrder} GROUP BY DATE(o.completed_at)
        ) t
        GROUP BY day ORDER BY day DESC
      `, params);
      headers = ['วันที่', 'จำนวนบิล', 'ยอดขายรวม', 'เงินสด', 'โอน/QR'];
      dataRows = rows.map(r => [
        r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
        r.bills, Number(r.total_sales).toFixed(2),
        Number(r.cash_sales).toFixed(2), Number(r.qr_sales).toFixed(2),
      ]);
      filenameTag = 'daily';

    } else if (level === 'bill') {
      // รายบิล
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      const [rows] = await pool.query(`
        SELECT * FROM (
          SELECT DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+07:00'),'%Y-%m-%d %H:%i') AS dt,
                 'POS' AS channel, s.id AS bill_no,
                 (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count,
                 s.discount_amount, s.total_amount, s.payment_method,
                 cs.full_name AS party, s.created_at AS sort_at
          FROM sales s LEFT JOIN users cs ON s.cashier_id=cs.id
          WHERE ${wSale}
          UNION ALL
          SELECT DATE_FORMAT(CONVERT_TZ(o.completed_at,'+00:00','+07:00'),'%Y-%m-%d %H:%i') AS dt,
                 'พรีออเดอร์' AS channel, o.id AS bill_no,
                 (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count,
                 0 AS discount_amount, o.total_amount, o.payment_method,
                 cust.full_name AS party, o.completed_at AS sort_at
          FROM orders o LEFT JOIN users cust ON o.user_id=cust.id
          WHERE ${wOrder}
        ) t ORDER BY sort_at DESC
      `, params);
      headers = ['วันที่-เวลา', 'ช่องทาง', 'เลขบิล', 'จำนวนรายการ', 'ส่วนลด', 'ยอดสุทธิ', 'ชำระโดย', 'แคชเชียร์/ลูกค้า'];
      dataRows = rows.map(r => [
        r.dt, r.channel, r.bill_no, r.item_count,
        Number(r.discount_amount).toFixed(2), Number(r.total_amount).toFixed(2),
        r.payment_method === 'QR' ? 'โอน/QR' : r.payment_method === 'CASH' ? 'เงินสด' : r.payment_method,
        r.party || '-',
      ]);
      filenameTag = 'bill';

    } else {
      // item (ค่าเริ่มต้น) — รายชิ้น ละเอียดสุด พร้อมคอลัมน์ช่วยคำนวณรายได้สหกรณ์
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      // coop_income: สินค้าฝากขาย = subtotal*gp% ; สินค้าสหกรณ์เอง = subtotal - ทุน
      const coopIncome = `CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal * p.gp_rate/100 ELSE it.subtotal - p.cost*it.quantity END`;
      const vendorEarn = `CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal - it.subtotal*p.gp_rate/100 ELSE 0 END`;
      const [rows] = await pool.query(`
        SELECT * FROM (
          SELECT DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+07:00'),'%Y-%m-%d %H:%i') AS dt,
                 'POS' AS channel, s.id AS bill_no, p.name AS product, c.name AS category,
                 it.quantity, it.price, it.subtotal, (p.cost*it.quantity) AS cost_total,
                 p.gp_rate, ${coopIncome} AS coop_income,
                 COALESCE(v.full_name,'สหกรณ์') AS vendor, ${vendorEarn} AS vendor_earn,
                 s.payment_method, s.created_at AS sort_at
          FROM sale_items it
          JOIN sales s ON it.sale_id=s.id
          JOIN products p ON it.product_id=p.id
          LEFT JOIN categories c ON p.category_id=c.id
          LEFT JOIN users v ON p.vendor_id=v.id
          WHERE ${wSale}
          UNION ALL
          SELECT DATE_FORMAT(CONVERT_TZ(o.completed_at,'+00:00','+07:00'),'%Y-%m-%d %H:%i') AS dt,
                 'พรีออเดอร์' AS channel, o.id AS bill_no, p.name AS product, c.name AS category,
                 it.quantity, it.price, it.subtotal, (p.cost*it.quantity) AS cost_total,
                 p.gp_rate, ${coopIncome} AS coop_income,
                 COALESCE(v.full_name,'สหกรณ์') AS vendor, ${vendorEarn} AS vendor_earn,
                 o.payment_method, o.completed_at AS sort_at
          FROM order_items it
          JOIN orders o ON it.order_id=o.id
          JOIN products p ON it.product_id=p.id
          LEFT JOIN categories c ON p.category_id=c.id
          LEFT JOIN users v ON p.vendor_id=v.id
          WHERE ${wOrder}
        ) t ORDER BY sort_at DESC
      `, params);
      headers = ['วันที่-เวลา', 'ช่องทาง', 'เลขบิล', 'สินค้า', 'หมวดหมู่', 'จำนวน', 'ราคา/ชิ้น',
        'ยอดรวมรายการ', 'ทุนรวม', 'GP%', 'รายได้สหกรณ์(ประมาณ)', 'เจ้าของฝากขาย', 'ยอดเจ้าของได้', 'ชำระโดย'];
      dataRows = rows.map(r => [
        r.dt, r.channel, r.bill_no, r.product, r.category || '-', r.quantity,
        Number(r.price).toFixed(2), Number(r.subtotal).toFixed(2), Number(r.cost_total).toFixed(2),
        Number(r.gp_rate).toFixed(2), Number(r.coop_income).toFixed(2), r.vendor,
        Number(r.vendor_earn).toFixed(2),
        r.payment_method === 'QR' ? 'โอน/QR' : r.payment_method === 'CASH' ? 'เงินสด' : r.payment_method,
      ]);
      filenameTag = 'item';
    }

    const csv = toCsv(headers, dataRows);
    const range = hasRange ? `_${start_date}_to_${end_date}` : ''; // ⭐️ HTTP header ต้อง ASCII ห้ามมีไทย
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-${filenameTag}${range}.csv"`);
    res.send('﻿' + csv); // BOM ให้ Excel อ่านภาษาไทยถูก
  } catch (err) {
    console.error('[sales-csv export] ERROR:', err.code || '', err.sqlMessage || err.message); // ⭐️ โชว์ error จริงใน terminal
    res.status(500).json({ error: err.sqlMessage || err.message });
  }
});

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
    pool.query(
      'INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
      ['ERROR', req.user.id, JSON.stringify({ error: err.message, path: req.path, method: req.method, requestId })]
    ).catch(logErr => console.error('audit_logs ERROR insert ล้มเหลว:', logErr.message));
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

const PORT = process.env.PORT || 3000; // ⭐️ DEPLOY — อ่านจาก .env ได้ (default 3000)
// เปลี่ยนจาก app.listen เป็น server.listen
// ⭐️ DEPLOY FIX — bind 0.0.0.0 (IPv4 ทุก interface) ไม่งั้น Node default ไปที่ IPv6 '::'
// แล้ว Render สแกนพอร์ตทาง IPv4 มองไม่เห็น → "No open ports detected" → deploy timeout → คงโค้ดเก่า
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`⚡ WebSocket Server is ready!`);

  // ⭐️ Sprint 2 — C3: Cron backup ทุกวัน 19:00 UTC (ตี 2 เวลาไทย วันถัดไป)
  cron.schedule('0 19 * * *', async () => {
    try {
      console.log('[CRON] Starting daily backup...');
      const result = await createBackup(pool);

      if (result) {
        console.log(`[CRON] ✅ Backup successful: ${result.filename}`);

        // Send email notification if enabled
        if (process.env.ENABLE_BACKUP_EMAIL === 'true') {
          // TODO: implement email sending if needed
          console.log(`[CRON] Email would be sent to ${process.env.ADMIN_EMAIL}`);
        }
      } else {
        console.log('[CRON] ⏭️  Backup skipped (already exists today)');
      }
    } catch (err) {
      console.error('[CRON] ❌ Backup failed:', err.message);

      // Send error email if enabled
      if (process.env.ENABLE_BACKUP_EMAIL === 'true') {
        // TODO: implement email error notification if needed
        console.log(`[CRON] Error email would be sent to ${process.env.ADMIN_EMAIL}`);
      }
    }
  });

  // ⭐️ Cron: ตัดออกงาน/ปิดกะอัตโนมัติทุกเที่ยงคืน (ข้อ 12 — ลืมออกงาน/ลืมปิดกะข้ามวัน)
  cron.schedule('5 0 * * *', async () => {
    try {
      const result = await runAutoCheckoutStale(io);
      console.log(`⏰ ตัดออกงานอัตโนมัติ: attendance ${result.attendance_closed}, shifts ${result.shifts_closed}`);
    } catch (e) { console.error('❌ auto-checkout cron ล้มเหลว:', e.message); }
  });

  // ⭐️ Sprint 1 — D4: รายงานสรุปยอดประจำวันทุกวันตี 6 (ก่อนร้านเปิด) — ส่งอีเมลถึง ADMIN_EMAIL
  cron.schedule('0 6 * * *', async () => {
    console.log('⏰ เริ่มสร้าง/ส่งรายงานสรุปยอดประจำวัน (ตี 6)...');
    try {
      const result = await sendDailyReport();
      console.log(`📧 รายงานประจำวัน ${result.data.date}: ${result.sent ? 'ส่งอีเมลสำเร็จ' : 'สร้างรายงานแล้วแต่ไม่ได้ส่ง (เช็ค ADMIN_EMAIL/SMTP)'}`);
    } catch (e) { console.error('❌ daily report cron ล้มเหลว:', e.message); }
  });

  // ⭐️ Sprint 2 — Expiry Discount: Check for expired products hourly and notify cashiers
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

  // ⭐️ Security remediation — ล้าง revoked_tokens ที่หมดอายุแล้วทุกวัน (กันตารางโตไม่จำกัด)
  cron.schedule('30 19 * * *', async () => {
    try {
      const [result] = await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
      console.log(`🧹 ล้าง revoked_tokens ที่หมดอายุแล้ว: ${result.affectedRows} แถว`);
    } catch (e) { console.error('❌ revoked_tokens cleanup cron ล้มเหลว:', e.message); }
  });

  console.log('🕐 ตั้ง cron: backup (ตี 2), auto-checkout (เที่ยงคืน), รายงานประจำวัน (ตี 6), ตรวจสินค้าหมดอายุ (ทุกชั่วโมง), ล้าง revoked tokens (ตี 2:30) เรียบร้อย');
});