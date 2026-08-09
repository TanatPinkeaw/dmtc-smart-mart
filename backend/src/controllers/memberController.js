// ⭐️ ระบบสมัครสมาชิกผ่าน LINE LIFF — 2 endpoint:
//   GET  /api/members/check-line/:line_user_id  — LIFF page เปิดมาเช็คก่อนว่าบัญชี LINE นี้ผูกกับ
//                                                  สมาชิกในระบบแล้วหรือยัง (ข้ามฟอร์มถ้าผูกแล้ว)
//   POST /api/members/register-line              — สมัครใหม่ หรือ "ผูก" line_user_id เข้ากับสมาชิกเดิม
//                                                  ที่มี student_id/phone_number ตรงกันอยู่แล้ว
//
// endpoint ทั้งคู่อยู่ใน PUBLIC_PATHS (ดู server.js) เพราะเรียกก่อน login เสมอ — LIFF ยังไม่มี JWT
// ของระบบนี้ตอนเปิดหน้ามาครั้งแรก
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { generateAccessToken, generateRefreshToken, setAuthCookies } = require('../utils/authTokens');
const { pushLineMessage } = require('../services/lineService');

// ⭐️ ฟิลด์ผู้ใช้ที่ปลอดภัยจะส่งกลับไปหน้าบ้าน (ไม่มี password/password_hash)
function toSafeUser(row) {
  return {
    id: row.id,
    student_id: row.student_id,
    full_name: row.full_name,
    phone_number: row.phone_number,
    role: row.role,
    points: row.points,
    line_user_id: row.line_user_id,
  };
}

// ⭐️ ใช้ร่วมกันทั้ง checkLineStatus (บัตรสมาชิกใน LIFF — ต้อง refresh ยอดแต้ม/กลุ่มสด) และ
// lookupMember (POS สแกน/พิมพ์ค้นหา) — ทั้งคู่ต้องการข้อมูลกลุ่มสมาชิก (badge ส่วนลด) เหมือนกัน
// เพิ่ม group_rules (ส่วนลดรายหมวดหมู่) ต่อเมื่อมี group_id เท่านั้น กันยิง query เปล่าเสียเวลา
async function attachGroupInfo(row) {
  const member = { ...row };
  let group_rules = [];
  if (member.group_id) {
    const [ruleRows] = await pool.query(
      'SELECT category_id, discount_percent FROM group_discount_rules WHERE group_id = ?',
      [member.group_id]
    );
    group_rules = ruleRows;
  }
  return { ...toSafeUser(member), group_id: member.group_id, group_name: member.group_name, group_code: member.group_code, group_default_discount: member.group_default_discount, group_rules };
}

const MEMBER_WITH_GROUP_SELECT = `
  SELECT u.id, u.student_id, u.full_name, u.phone_number, u.role, u.points, u.line_user_id, u.group_id,
         mg.name AS group_name, mg.code AS group_code, mg.default_discount_percent AS group_default_discount
  FROM users u LEFT JOIN member_groups mg ON u.group_id = mg.id
`;

// GET /api/members/check-line/:line_user_id — public (LIFF, ยังไม่มี JWT ของระบบนี้)
async function checkLineStatus(req, res) {
  const { line_user_id } = req.params;
  if (!line_user_id || !line_user_id.trim()) {
    return res.status(400).json({ error: 'line_user_id ไม่ถูกต้อง' });
  }
  try {
    const [rows] = await pool.query(`${MEMBER_WITH_GROUP_SELECT} WHERE u.line_user_id = ? LIMIT 1`, [line_user_id]);
    if (rows.length === 0) {
      return res.json({ registered: false });
    }
    return res.json({
      registered: true,
      user: { id: rows[0].id, full_name: rows[0].full_name },
    });
  } catch (error) {
    console.error('[500] checkLineStatus', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/members/lookup/:identifier — CASHIER/MANAGER/ADMIN เท่านั้น (requireRole ใน memberRoutes.js)
// ใช้จากหน้า POS ตอนสแกน/พิมพ์บัตรสมาชิก (รหัสนักศึกษา) — ต่างจาก /users/search ตรงที่ค้นหา
// line_user_id ได้ด้วย (เผื่อสแกน QR ที่เข้ารหัสจาก LINE userId แทน student_id ในอนาคต)
async function lookupMember(req, res) {
  const { identifier } = req.params;
  if (!identifier || !identifier.trim()) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสนักศึกษา เบอร์โทร หรือ LINE user id' });
  }
  try {
    const [rows] = await pool.query(
      `${MEMBER_WITH_GROUP_SELECT} WHERE u.student_id = ? OR u.phone_number = ? OR u.line_user_id = ? LIMIT 1`,
      [identifier, identifier, identifier]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลสมาชิก' });
    }
    return res.json(await attachGroupInfo(rows[0]));
  } catch (error) {
    console.error('[500] lookupMember', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// POST /api/members/register-line — body ผ่าน registerLineValidator มาแล้ว (req.body ถูก sanitize แล้ว)
async function registerViaLine(req, res) {
  const { student_id, full_name, phone_number, line_user_id } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ FOR UPDATE กันแข่งกันสมัครพร้อมกัน (เช่นกดสมัครซ้ำจาก LIFF สองแท็บ) ล็อกแถวที่ student_id
    // หรือ phone_number ตรงกันไว้ก่อนตัดสินใจ insert/update
    const [existingRows] = await conn.query(
      'SELECT id, student_id, full_name, phone_number, role, points, line_user_id FROM users WHERE student_id = ? OR phone_number = ? LIMIT 1 FOR UPDATE',
      [student_id, phone_number]
    );

    let user;
    let isNewMember;

    if (existingRows.length > 0) {
      // ⭐️ สมาชิกเดิมมีอยู่แล้ว (สมัครหน้าเคาน์เตอร์มาก่อน) — แค่ผูก line_user_id เข้ากับบัญชีเดิม
      isNewMember = false;
      const existing = existingRows[0];
      await conn.query('UPDATE users SET line_user_id = ? WHERE id = ?', [line_user_id, existing.id]);
      user = { ...existing, line_user_id };
    } else {
      // ⭐️ สมาชิกใหม่ทั้งหมด — รหัสผ่านตั้งต้น = เบอร์โทร (ตาม convention เดียวกับ /api/users/register)
      isNewMember = true;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(phone_number, salt);
      // ⭐️ ระบุ is_active = 1 ตรงๆ (ไม่พึ่ง DEFAULT ของคอลัมน์) กันสมาชิกที่สมัครผ่าน LINE โดนซ่อนจาก
      // หน้า Admin Settings ถ้า schema ใน DB จริงของ deployment ไหนไม่มี DEFAULT ตั้งไว้
      const [result] = await conn.query(
        'INSERT INTO users (student_id, password, full_name, phone_number, role, points, line_user_id, is_active) VALUES (?, ?, ?, ?, ?, 0, ?, 1)',
        [student_id, hashedPassword, full_name, phone_number, 'MEMBER', line_user_id]
      );
      user = {
        id: result.insertId,
        student_id, full_name, phone_number,
        role: 'MEMBER', points: 0, line_user_id, is_active: 1,
      };
    }

    await conn.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        isNewMember ? 'MEMBER_REGISTER_LINE' : 'MEMBER_LINK_LINE',
        user.id, 'USER', user.id,
        JSON.stringify({ via: 'LIFF', line_user_id, new_member: isNewMember }),
      ]
    );

    await conn.commit();

    // ⭐️ ข้อความยืนยันหลังสมัคร/ผูกบัญชีสำเร็จ — ยิงหลัง commit เสมอ (transaction ปิดไปแล้ว) และ
    // ไม่ await/ไม่ throw เข้า response หลัก: ส่ง LINE ไม่ออก (เช่น token หมดอายุ/เน็ตล่ม) ต้องไม่ทำให้
    // การสมัครสมาชิกที่สำเร็จแล้วจริงๆ กลายเป็น error response — pushLineMessage เองก็ fail-soft
    // อยู่แล้ว (คืน false ไม่ throw) แต่กัน unhandled rejection ไว้อีกชั้นด้วย .catch เผื่ออนาคต
    pushLineMessage(line_user_id, [
      { type: 'text', text: '🎉 ลงทะเบียนสมาชิก DMTC Smart Mart เรียบร้อยแล้ว! สามารถเช็กบัตรสมาชิกและแต้มสะสมผ่านเมนูได้เลยครับ' },
    ]).catch(err => console.error('[LINE] ส่งข้อความยืนยันสมัครสมาชิกไม่สำเร็จ:', err.message));

    // ⭐️ เดิม: ห้ามส่ง raw JWT ออกทาง response body เด็ดขาด (ป้องกัน XSS ขโมย token) ใช้ pattern
    // เดียวกับ POST /api/auth/login เสมอ: ออก access/refresh token เป็น httpOnly cookie
    // (setAuthCookies) แล้วส่งแค่ csrfToken กลับไปทาง body ให้ frontend แนบเป็น header ทีหลัง
    //
    // ⭐️ Bearer token fallback (deviation เฉพาะ endpoint นี้ — เหมือน authController.lineLogin)
    // endpoint นี้สมัคร/ผูกบัญชีผ่าน LIFF แล้ว "login เข้าเลย" ทันที (setAuthCookies ด้านล่าง) — ถ้า
    // เปิดจาก LINE in-app browser คุกกี้จะโดน ITP บล็อกเหมือน line-login ทำให้ request หลังสมัครเสร็จ
    // 401 ทันที ส่ง access_token ให้ frontend เก็บเป็น bearer fallback เหมือนกัน (ผลกระทบ XSS จำกัด
    // แค่บัญชี MEMBER ที่เพิ่งสมัคร — /api/auth/login ฝั่ง staff/ADMIN ไม่แตะ)
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const accessToken = generateAccessToken(user, csrfToken);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(isNewMember ? 201 : 200).json({
      success: true,
      message: 'ลงทะเบียนสำเร็จ',
      user: toSafeUser(user),
      csrfToken,
      access_token: accessToken,
    });
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      // ⭐️ เข้าเงื่อนไข dup ได้ 2 ทาง: (1) race condition สมัคร student_id/phone_number ซ้ำพร้อมกัน
      // (2) line_user_id นี้ผูกกับ user คนอื่นอยู่แล้ว (UNIQUE INDEX idx_line_user_id ใน db.js)
      return res.status(400).json({ error: 'ข้อมูลนี้มีอยู่ในระบบแล้ว หรือบัญชี LINE นี้ผูกกับสมาชิกอื่นอยู่แล้ว' });
    }
    console.error('[500] registerViaLine', error.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally {
    conn.release();
  }
}

module.exports = { checkLineStatus, registerViaLine, lookupMember };
