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
// เดิม) cross-site cookie (Vercel↔Render) ต้อง SameSite=None+Secure บน production, dev ใช้ Lax ได้
const COOKIE_SECURE = IS_PRODUCTION;
const COOKIE_SAMESITE = IS_PRODUCTION ? 'none' : 'lax';
const ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;   // 8h ตรงกับอายุ access token
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d ตรงกับอายุ refresh token

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
  res.cookie('access_token', accessToken, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, maxAge: ACCESS_TOKEN_MAX_AGE_MS, path: '/',
  });
  // ⭐️ path ต้องกว้างพอให้ /api/auth/logout อ่านคุกกี้นี้ได้ด้วย (ไปเพิกถอน refresh token ตอน logout)
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, maxAge: REFRESH_TOKEN_MAX_AGE_MS, path: '/api/auth',
  });
}

function clearAuthCookies(res) {
  res.clearCookie('access_token', { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/' });
  res.clearCookie('refresh_token', { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/api/auth' });
}

module.exports = {
  generateAccessToken, generateRefreshToken, verifyRefreshToken,
  setAuthCookies, clearAuthCookies,
};
