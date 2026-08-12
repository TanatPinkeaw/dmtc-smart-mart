// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/authTokens.js — ออก/ตรวจ JWT token + ตั้ง/ล้าง cookie สำหรับระบบ login
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: รวม logic การออก token ไว้ที่เดียว (server.js กับ memberController.js เรียกใช้ร่วมกัน)
//   • generateAccessToken(user, csrf) — JWT อายุ 8 ชม. ฝัง role/csrf/jti ไว้ในตัว
//   • generateRefreshToken(user) — JWT อายุ 7 วัน (type:'refresh') ไว้ต่ออายุ session
//   • setAuthCookies/clearAuthCookies — เซ็ต/ลบ cookie httpOnly (access_token + refresh_token)
//   • verifyRefreshToken — ตรวจ refresh token ตอนขอ token ใหม่
// จุดสำคัญ: token เป็น httpOnly cookie (JS อ่านไม่ได้ กัน XSS ขโมย); cookie policy (secure/sameSite/
//   domain) อ่านจาก config.js — ดู setAuthCookies
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ ดึงออกจาก server.js — เดิม generateAccessToken/generateRefreshToken/setAuthCookies/
// clearAuthCookies/verifyRefreshToken เป็น local function ฝังอยู่ใน server.js เอง เรียกใช้ได้แค่
// ภายในไฟล์เดียวกัน พอต้องออก token ให้ endpoint สมัครสมาชิกผ่าน LINE (memberController.js ใหม่)
// ก็ต้องแชร์ logic เดียวกัน แยกออกมาเป็น module กลางแทนที่จะ copy-paste ซ้ำ — ทั้ง server.js และ
// memberController.js require มาจากที่นี่ที่เดียว กัน token/cookie policy เพี้ยนไปคนละแบบระหว่าง
// endpoint login ปกติกับ endpoint สมัครผ่าน LINE
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/config');

const JWT_SECRET = config.JWT_SECRET;
const IS_PRODUCTION = config.IS_PRODUCTION;

// ⭐️ Security remediation — ย้าย JWT จาก localStorage ไป httpOnly cookie (ดูคำอธิบายเต็มที่ server.js
// เดิม). cookie policy อ่านจาก config ที่เดียว (config.js): cross-site (Vercel↔Render) default
// SameSite=None+Secure; ถ้าย้าย same-site (โดเมนเดียวกัน) ตั้ง COOKIE_SAMESITE=lax [+COOKIE_DOMAIN]
// เพื่อให้ cookie เป็น first-party กัน LINE in-app browser (ITP) บล็อก — ดูคำอธิบายเต็มใน config.js
const COOKIE_SECURE = config.COOKIE_SECURE;
const COOKIE_SAMESITE = config.COOKIE_SAMESITE;
const COOKIE_DOMAIN = config.COOKIE_DOMAIN;
const ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;   // 8h ตรงกับอายุ access token
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d ตรงกับอายุ refresh token

// ⭐️ รวม option ของ cookie ไว้ที่เดียว — set กับ clear ต้องใช้ค่า (secure/sameSite/domain/path) ตรงกัน
// เป๊ะ ไม่งั้น clearCookie จะไม่ลบ cookie จริง (browser จับคู่ด้วย attribute เหล่านี้)
function cookieOptions(path, maxAge) {
  const opts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path };
  if (maxAge != null) opts.maxAge = maxAge;
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  return opts;
}

// ⭐️ csrfToken ฝังเป็น claim ในนี้ (เซ็นแล้ว ปลอมไม่ได้) แทนการเก็บใน cookie แยก — เรียกด้วย
// generateAccessToken(user, csrfToken) เสมอ, csrfToken สุ่มไว้ที่ผู้เรียก แล้วส่งค่าเดียวกันกลับไป
// ทาง JSON response body ให้ frontend เก็บไว้แนบเป็น header ทีหลัง
function generateAccessToken(user, csrfToken) {
  return jwt.sign(
    { id: user.id, role: user.role, full_name: user.full_name, must_change_password: !!user.must_change_password, csrf: csrfToken, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
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

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('access_token', accessToken, cookieOptions('/', ACCESS_TOKEN_MAX_AGE_MS));
  // ⭐️ path ต้องกว้างพอให้ /api/auth/logout อ่านคุกกี้นี้ได้ด้วย (ไปเพิกถอน refresh token ตอน logout)
  res.cookie('refresh_token', refreshToken, cookieOptions('/api/auth', REFRESH_TOKEN_MAX_AGE_MS));
}

function clearAuthCookies(res) {
  res.clearCookie('access_token', cookieOptions('/'));
  res.clearCookie('refresh_token', cookieOptions('/api/auth'));
}

module.exports = {
  generateAccessToken, generateRefreshToken, verifyRefreshToken,
  setAuthCookies, clearAuthCookies,
};
