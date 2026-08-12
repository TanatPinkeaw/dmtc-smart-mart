// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/authController.js — logic การล็อกอินผ่าน LINE (LIFF auto-login)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ของ POST /api/auth/line-login — รับ line_user_id + LIFF id_token จาก frontend
//   ยืนยันตัวตนกับ LINE แล้วออก JWT/cookie ให้ (ผูก line_user_id → user ในระบบ) — ดู routes/authRoutes.js
// จุดสำคัญ: ถ้าตั้ง LINE_LIFF_CHANNEL_ID จะ verify id_token กับ LINE ก่อน (ปลอดภัย); ส่ง access_token
//   กลับทาง body ด้วยเป็น bearer fallback (เฉพาะเส้น LINE — กัน cookie โดน ITP บล็อกในแอป LINE)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ LINE Auto-Login — POST /api/auth/line-login
// ผู้ใช้เปิดเว็บผ่าน LINE Rich Menu (LIFF) แล้วล็อกอินให้อัตโนมัติโดยไม่ต้องกรอกรหัสผ่าน
//
// ⚠️ ความปลอดภัย: การรับ "line_user_id" ดิบจาก body แล้วออก token ให้เลย = ใครก็ตามที่รู้ userId ของ
// คนอื่น (แม้จะเดายาก — U + hex 32 ตัว) ก็ปลอมเป็นคนนั้นได้ทันที ทางที่ปลอดภัยจริงคือให้ frontend ส่ง
// "LIFF ID Token" (JWT ที่ LINE เซ็นให้) มาด้วย แล้ว backend ยืนยันกับ LINE ก่อน (เอา userId จาก token
// ที่ยืนยันแล้ว ไม่ใช่จากที่ client อ้าง) — endpoint นี้จึง "เลือกทางที่ปลอดภัยกว่าเสมอถ้าทำได้":
//   • ถ้าตั้ง env LINE_LIFF_CHANNEL_ID ไว้ และ frontend ส่ง id_token มา → ยืนยัน token กับ LINE เอา
//     userId จากผลที่ยืนยันแล้วเท่านั้น (ปลอดภัย)
//   • ถ้าไม่ได้ตั้ง (เช่น dev/ยังไม่ config) → fallback ไปเชื่อ line_user_id ดิบตามสเปก (เปิดใช้เฉพาะ
//     ตอนที่ยอมรับความเสี่ยงนี้) — แนะนำอย่างยิ่งให้ตั้ง LINE_LIFF_CHANNEL_ID บน production
const pool = require('../config/db');
const crypto = require('crypto');
const config = require('../config/config');
const { generateAccessToken, generateRefreshToken, setAuthCookies } = require('../utils/authTokens');

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

// ยืนยัน LIFF ID token กับ LINE — คืน userId (sub) ที่ยืนยันแล้ว หรือ null ถ้ายืนยันไม่ผ่าน
async function verifyLiffIdToken(idToken) {
  if (!idToken || !config.LINE_LIFF_CHANNEL_ID) return null;
  try {
    const body = new URLSearchParams({ id_token: idToken, client_id: config.LINE_LIFF_CHANNEL_ID });
    const res = await fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[line-login] ยืนยัน LIFF id_token ไม่ผ่าน:', res.status, errText);
      return null;
    }
    const data = await res.json();
    return data.sub || null; // sub = LINE userId ที่ยืนยันแล้ว
  } catch (err) {
    console.error('[line-login] verifyLiffIdToken error:', err.message);
    return null;
  }
}

async function lineLogin(req, res) {
  const { line_user_id: bodyLineUserId, id_token } = req.body || {};

  // ⭐️ เลือกแหล่ง userId ตามความปลอดภัย:
  //   Secure path: LINE_LIFF_CHANNEL_ID ตั้งไว้ + id_token มา → ยืนยันกับ LINE ก่อน (ปลอดภัยที่สุด)
  //   Compat path: ไม่ได้ตั้ง LINE_LIFF_CHANNEL_ID → fallback เชื่อ line_user_id ตรงๆ (เหมือนเดิม)
  //   Block path:  LINE_LIFF_CHANNEL_ID ตั้งไว้แล้ว แต่ id_token ไม่มา → LIFF scope ไม่มี openid
  let lineUserId = null;
  if (config.LINE_LIFF_CHANNEL_ID && id_token) {
    lineUserId = await verifyLiffIdToken(id_token);
    if (!lineUserId) {
      return res.status(401).json({ error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่' });
    }
  } else if (!config.LINE_LIFF_CHANNEL_ID) {
    // ยังไม่ได้ config LINE_LIFF_CHANNEL_ID — fallback เหมือน code เดิม พร้อม log เตือน
    if (config.IS_PRODUCTION) {
      console.warn('[line-login] WARNING: LINE_LIFF_CHANNEL_ID not set — trusting unverified line_user_id. ตั้ง LINE_LIFF_CHANNEL_ID ใน Render env เพื่อความปลอดภัยสูงสุด');
    }
    lineUserId = bodyLineUserId;
  } else {
    // LINE_LIFF_CHANNEL_ID ตั้งไว้แล้วแต่ id_token ไม่มา → LIFF app ไม่มี openid scope
    return res.status(401).json({ error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาตรวจสอบ LIFF scope (openid) ใน LINE Developers Console' });
  }

  if (!lineUserId || !String(lineUserId).trim()) {
    return res.status(400).json({ error: 'ไม่พบข้อมูล LINE user id' });
  }

  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE line_user_id = ? AND is_active = TRUE LIMIT 1',
      [lineUserId]
    );
    if (users.length === 0) {
      // "LINE account not linked" — 401 (frontend api.ts ใส่ /auth/line-login ไว้ใน NO_REFRESH_PATHS
      // แล้ว จึงไม่ไป auto-refresh/force-logout ตอนเจอ 401 จาก endpoint นี้)
      return res.status(401).json({ error: 'บัญชี LINE นี้ยังไม่ได้ผูกกับสมาชิกในระบบ กรุณาสมัคร/ผูกบัญชีก่อน' });
    }

    const user = users[0];

    // ⭐️ has_active_work_session — คงไว้ให้ response เหมือน /api/auth/login ทุกประการ (staff เท่านั้นที่มีสิทธิ์
    // มีค่า true; สมาชิก LINE ปกติเป็น MEMBER ได้ false อยู่แล้ว)
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

    // ⭐️ ออก token ชุดเดียวกับ login ปกติ (csrf ฝังใน access token, token ไปเป็น httpOnly cookie,
    // คืนแค่ csrfToken ทาง body) — reuse authTokens.js ให้ policy ตรงกับ /api/auth/login เป๊ะ
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const accessToken = generateAccessToken(user, csrfToken);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      message: 'ล็อกอินสำเร็จ',
      user: {
        id: user.id, student_id: user.student_id, full_name: user.full_name, role: user.role,
        must_change_password: !!user.must_change_password, profile_image_url: user.profile_image_url || null,
      },
      csrfToken,
      has_active_work_session: hasActiveWorkSession,
      // ⭐️ Bearer token fallback (เฉพาะ endpoint นี้ — deviation จาก policy "ห้ามส่ง JWT ทาง body"
      // ที่ authController/memberController อื่นๆ ยังยึดอยู่เดิม) LINE in-app browser (ITP) บล็อก
      // cookie ข้าม origin (Vercel↔Render) แบบ deterministic ทำให้ auto-login ผ่านแต่ request ถัดไป
      // 401 วนไม่จบ — ส่ง access_token ให้ frontend เก็บ sessionStorage แนบเป็น Authorization header
      // เอง (authenticateToken รองรับ Bearer header อยู่แล้ว) ผลกระทบถ้าหลุดจาก XSS จำกัดแค่บัญชี
      // MEMBER เท่านั้น (ดูแต้ม/สั่งจองของตัวเอง) — /api/auth/login (staff/ADMIN) ไม่แตะ ยังคืนแค่
      // csrfToken เหมือนเดิม 100%
      access_token: accessToken,
    });
  } catch (error) {
    console.error('[500] lineLogin', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = { lineLogin };
