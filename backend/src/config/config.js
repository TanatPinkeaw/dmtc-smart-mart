// ⭐️ Single source of truth for backend config — replaces scattered process.env.X reads
// across server.js/db.js/config/cloudinary.js/mailer.js/scripts/dailyReport.js.
//
// This is the ONLY file in the backend that should read raw process.env. Everything else
// requires('./config') and uses the exported values instead. Benefits over the old scattered
// version: one place to see every setting the app needs, .env loaded exactly once (previously
// server.js AND db.js each called dotenv.config() themselves), and the required-vars check that
// used to be duplicated almost verbatim in both server.js and db.js now lives in one place.
//
// Node caches modules, so it doesn't matter which file requires('./config') first — the
// validation below runs exactly once no matter how many files import this.

// ⭐️ quiet:true — dotenv (v17+) prints a random promo "tip" line to console on every boot
// otherwise; harmless but clutters Render's boot logs with unrelated ad text
require('dotenv').config({ quiet: true });

// ⭐️ Task 6 — no fallback for these; a missing value must stop boot, not silently run with a
// weak default (e.g. the old hardcoded 'rootpassword' DB fallback this replaced).
const REQUIRED = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = REQUIRED.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ config.js: ไม่พบ environment variable ที่จำเป็น: ${missing.join(', ')} — ห้ามรันระบบโดยไม่มีค่านี้`);
  process.exit(1);
}
console.log('✓ All required environment variables loaded');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// ⭐️ Security remediation — production (Render → Aiven) ต้องเข้ารหัสเสมอ ห้ามบูทแบบ plaintext เงียบๆ
if (IS_PRODUCTION && process.env.DB_SSL !== 'true') {
  console.error('❌ config.js: NODE_ENV=production ต้องตั้ง DB_SSL=true (เข้ารหัสการเชื่อมต่อไป Aiven/MySQL เสมอ)');
  process.exit(1);
}

if (IS_PRODUCTION && process.env.DB_SSL === 'true' && !process.env.DB_SSL_CA) {
  console.error('⚠️⚠️⚠️ [BOOT WARNING] DB_SSL=true แต่ไม่ได้ตั้ง DB_SSL_CA — การเชื่อมต่อจะเข้ารหัสแต่ไม่ verify cert (เสี่ยง MITM) ตั้ง DB_SSL_CA ด้วย CA cert จาก cloud provider ด่วน ⚠️⚠️⚠️');
}

// ⭐️ Render ตั้ง process.env.RENDER ให้อัตโนมัติ ถ้าเจอว่ารันบน Render แต่ NODE_ENV ดันไม่ใช่
// 'production' (ลืมตั้งใน dashboard) trust proxy ใน server.js จะไม่ทำงาน — เตือนดังๆ ให้เห็นใน log
const IS_RENDER = !!process.env.RENDER;
if (IS_RENDER && !IS_PRODUCTION) {
  console.error('⚠️⚠️⚠️ [BOOT WARNING] รันบน Render แต่ NODE_ENV != production — trust proxy ไม่ถูกเปิด! rate limiter (login/forgot-password) จะเห็น IP ผิดทั้งหมด ตั้ง NODE_ENV=production ใน Render dashboard ด่วน ⚠️⚠️⚠️');
  // ⭐️ อาการที่ผู้ใช้เจอจริงจากกรณีนี้คือ "ล็อกอินแล้วเด้งกลับหน้า login วนไม่จบ" — อธิบายไว้ตรงนี้
  // เลยเพราะ debug จากอาการอย่างเดียวหาต้นตอยาก (ดูเหมือนบั๊ก auth แต่จริงๆ คือ env ตั้งไม่ครบ):
  //   NODE_ENV != production  →  COOKIE_SECURE=false, COOKIE_SAMESITE='lax' (server.js)
  //   SameSite=Lax = browser "ไม่ส่ง" cookie ไปกับ XHR ข้ามเว็บ (Vercel → Render)
  //   ⇒ login สำเร็จ (200) แต่ทุก request หลังจากนั้นไม่มี cookie ติดไป → 401 → refresh 401
  //   ⇒ เด้งกลับ /login → ผู้ใช้ล็อกอินใหม่ → วนซ้ำ
  // cross-site cookie ต้องเป็น SameSite=None + Secure=true เท่านั้น ซึ่งผูกกับ NODE_ENV=production
  console.error('⚠️⚠️⚠️ [BOOT WARNING] ผลข้างเคียงที่สำคัญกว่า: cookie จะถูกตั้งเป็น SameSite=Lax + Secure=false ซึ่ง browser จะไม่ส่ง cookie ข้ามโดเมน (Vercel→Render) ⇒ ล็อกอินผ่านแต่ทุก request หลังจากนั้น 401 แล้วเด้งกลับหน้า login วนไม่จบ — ต้องตั้ง NODE_ENV=production เท่านั้นถึงจะหาย ⚠️⚠️⚠️');
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ⭐️ Cookie policy — auth ใช้ httpOnly cookie. ปัจจุบัน frontend (Vercel) กับ backend (Render) อยู่คนละ
// registrable domain = "cross-site" จึงบังคับต้อง SameSite=None + Secure ซึ่ง LINE in-app browser (ITP)
// จัดเป็น third-party แล้ว "บล็อก" → LINE auto-login ผ่านแต่ request ถัดไป 401 วน ping-pong (ดู
// Login.tsx liff_loop_breaker). ทางแก้ราก: ย้าย frontend+backend ให้อยู่โดเมนเดียวกัน (same-site เช่น
// coop.dmtc.ac.th + api.coop.dmtc.ac.th) แล้วตั้ง COOKIE_SAMESITE=lax → cookie เป็น first-party → ITP
// ไม่บล็อก. ถ้าใช้ subdomain ต่างกันให้ตั้ง COOKIE_DOMAIN=.dmtc.ac.th เพื่อแชร์ cookie ข้าม subdomain
// ค่า default คงพฤติกรรมเดิมเป๊ะ (prod=none, dev=lax) จึงไม่กระทบระบบที่รันอยู่จนกว่าจะตั้ง env ใหม่
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || (IS_PRODUCTION ? 'none' : 'lax')).toLowerCase();
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || null;
const VALID_SAMESITE = ['lax', 'none', 'strict'];
if (!VALID_SAMESITE.includes(COOKIE_SAMESITE)) {
  console.error(`❌ config.js: COOKIE_SAMESITE ต้องเป็นหนึ่งใน ${VALID_SAMESITE.join('/')} (ค่าปัจจุบัน: ${COOKIE_SAMESITE})`);
  process.exit(1);
}
// SameSite=None บังคับต้อง Secure=true (สเปก browser) — บน production Secure=true อยู่แล้ว แต่ถ้าตั้ง
// none บน dev (http) browser จะไม่ยอมเซ็ต cookie เลย ล็อกอินไม่ติด — เตือนดังๆ
if (COOKIE_SAMESITE === 'none' && !IS_PRODUCTION) {
  console.error('⚠️⚠️⚠️ [BOOT WARNING] COOKIE_SAMESITE=none บน dev (http) — browser จะไม่ยอมเซ็ต cookie (ต้องมาคู่ Secure=true/https) ล็อกอินจะไม่ติด ใช้ lax บน dev ⚠️⚠️⚠️');
}

// ⭐️ FRONTEND_URL ผิด/ลืมตั้งบน Render = CORS/Socket.io ล็อกเป็น localhost เงียบๆ (fail closed
// อยู่แล้ว ไม่ใช่ช่องโหว่ แต่ debug ยาก เพราะ error ที่ผู้ใช้เห็นคือ CORS ทั่วไป ไม่บอกสาเหตุจริง)
if (IS_PRODUCTION && (!process.env.FRONTEND_URL || FRONTEND_URL === 'http://localhost:5173' || !FRONTEND_URL.startsWith('https://'))) {
  console.error(`⚠️⚠️⚠️ [BOOT WARNING] NODE_ENV=production แต่ FRONTEND_URL ${!process.env.FRONTEND_URL ? 'ไม่ได้ตั้งค่า (fallback เป็น localhost)' : `ดูผิดปกติ (ค่าปัจจุบัน: ${FRONTEND_URL})`} — CORS/Socket.io จะปฏิเสธ origin จริงของเว็บทั้งหมด (fail closed แต่ผู้ใช้จริงจะเจอ CORS error งงๆ) ตั้ง FRONTEND_URL=https://<โดเมน Vercel จริง> ใน Render dashboard ด่วน ⚠️⚠️⚠️`);
}

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  IS_RENDER,
  PORT: process.env.PORT || 3000,

  JWT_SECRET: process.env.JWT_SECRET,
  SETUP_KEY: process.env.SETUP_KEY || null, // null = bootstrap endpoints stay disabled (503)
  FRONTEND_URL,

  // ⭐️ Cookie policy (ดูคำอธิบาย + วิธีย้าย same-site ด้านบน) — authTokens.js อ่านจากตรงนี้ที่เดียว
  COOKIE_SAMESITE,
  COOKIE_DOMAIN,
  COOKIE_SECURE: IS_PRODUCTION, // https เท่านั้นบน prod (SameSite=None บังคับต้อง Secure ด้วย)

  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  DB_PORT: process.env.DB_PORT || 3306,
  DB_SSL: process.env.DB_SSL === 'true',
  DB_SSL_CA: process.env.DB_SSL_CA || null, // null = encrypted but cert not verified, see db.js

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || null,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || null,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || null,

  SMTP_HOST: process.env.SMTP_HOST || null,
  SMTP_PORT: process.env.SMTP_PORT || null,
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_PASS: process.env.SMTP_PASS || null,
  SMTP_FROM: process.env.SMTP_FROM || null,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,
  ENABLE_BACKUP_EMAIL: process.env.ENABLE_BACKUP_EMAIL === 'true',

  // ⭐️ Day 3 — LINE Messaging API (push only, no webhook receiver in this app yet, so
  // CHANNEL_SECRET isn't used for anything today — read here anyway per spec, kept available
  // for a future webhook-signature-verification feature). Optional: null = lineService.js logs
  // instead of sending, same fail-soft pattern as mailer.js/Cloudinary above.
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || null,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || null,
  LINE_MANAGER_GROUP_ID: process.env.LINE_MANAGER_GROUP_ID || null,
  // ⭐️ LINE Login channel id ของ LIFF app (เลขหน้าขีดใน LIFF ID เช่น "2010928001") — ตั้งไว้เพื่อให้
  // POST /api/auth/line-login ยืนยัน LIFF id_token กับ LINE ได้ (ปลอดภัยกว่าเชื่อ line_user_id ดิบ)
  // ไม่ตั้ง = line-login จะ fallback ไปเชื่อ line_user_id ดิบ (ดู authController.js)
  LINE_LIFF_CHANNEL_ID: process.env.LINE_LIFF_CHANNEL_ID || null,

  GIT_HASH: process.env.GIT_HASH || 'dev-local',
};
