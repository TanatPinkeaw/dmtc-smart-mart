// ⭐️ Dev/testing data-reset tools — ADMIN กดล้างข้อมูลทดสอบเองได้ไม่ต้องเข้า DB ตรง
// ⚠️ ทั้ง 3 endpoint บล็อกบน production โดยดีฟอลต์ (คืน 404 เหมือน endpoint bootstrap อื่นๆ เช่น
// /api/seed-data — ดู server.js) ไม่สนแม้ผู้เรียกจะเป็น ADMIN จริงก็ตาม เพราะเป็นปุ่มลบ/ล้างข้อมูล
// สมาชิกจริงแบบกู้คืนไม่ได้ (โดยเฉพาะ resetMembers ที่ DELETE ทิ้งถาวร) กดพลาดบน prod = ข้อมูล
// สมาชิกจริงหายทั้งระบบ — เปิดใช้บน production ได้เฉพาะเมื่อมีคนตั้งค่า env var
// ALLOW_DATA_RESET=true บน deployment นั้นๆ อย่างจงใจเท่านั้น (ไม่ใช่ default ที่เปิดเอง)
const pool = require('../config/db');
const config = require('../config/config');

function isResetAllowed() {
  return process.env.ALLOW_DATA_RESET === 'true' || !config.IS_PRODUCTION;
}

async function logAdminReset(action, adminId, details) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      [action, adminId, 'SYSTEM', null, JSON.stringify(details)]
    );
  } catch (err) {
    console.error('[adminController] เขียน audit_logs ไม่สำเร็จ:', err.message);
  }
}

// POST /api/admin/reset/unlink-line — ปลดผูก LINE ของสมาชิก (MEMBER) เท่านั้น เอาไว้เทสต์ flow
// สมัคร/ผูกบัญชีซ้ำได้เรื่อยๆ — ไม่แตะ line_user_id ของ CASHIER/MANAGER/ADMIN
async function unlinkAllLine(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return res.status(404).json({
      error: 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้',
    });
  }
  try {
    const [result] = await pool.query("UPDATE users SET line_user_id = NULL WHERE role = 'MEMBER'");
    await logAdminReset('ADMIN_RESET_UNLINK_LINE', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `ปลดผูกบัญชี LINE ของสมาชิกแล้ว ${result.affectedRows} รายการ`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] unlinkAllLine', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// POST /api/admin/reset/members — ลบ user ทุกคนที่ role=MEMBER ถาวร (กู้คืนไม่ได้)
// ทุกตารางที่มี FK ชี้มาที่ users.id แบ่งเป็น 3 กลุ่ม จัดการต่างกัน:
//  1) log/ประวัติภายในของสมาชิก (ไม่มีมูลค่าทางธุรกิจอิสระ) → DELETE ตามได้เลย:
//     point_transactions, audit_logs, revoked_tokens, notifications, promotion_usages, password_resets
//     (audit_logs สำคัญมาก: สมาชิก LINE ทุกคนมีแถว MEMBER_REGISTER_LINE ติดตัวเสมอ ดู registerViaLine
//     ถ้าไม่ล้างก่อน DELETE users พัง 100% ทุกครั้ง)
//  2) ประวัติการขาย/ซื้อจริง คอลัมน์ nullable → "ตัดสาย" SET NULL รักษาเรคคอร์ดไว้ ไม่ทิ้งข้อมูลบัญชี:
//     sales.member_id, sales.cashier_id, orders.user_id, purchases.user_id
//     (products.vendor_id เป็น ON DELETE SET NULL อยู่แล้ว ระบบจัดการเอง)
//  3) ประวัติการทำงานของ staff คอลัมน์ NOT NULL (SET NULL ไม่ได้ ลบทิ้งอย่างเดียว) → กัน "เงียบๆ":
//     attendance.user_id, shifts.cashier_id, schedules.cashier_id
//     เกิดได้เพราะหน้า Settings แก้ role คนที่เคยเป็น staff จริงกลับเป็น MEMBER ได้ endpoint นี้กวาดตาม
//     role='MEMBER' ปัจจุบันเลยไปเจอประวัติทำงานเก่าเข้า — จึง "เช็คก่อน" เสมอ ถ้ามีใครติดกลุ่ม 3 และ
//     caller ยังไม่ระบุ (deleteWorkHistory / skipBlocked) จะหยุด ส่งรายชื่อกลับไปให้ frontend เปิด popup
//     ถามก่อน ไม่ลบประวัติเข้างาน/กะ/ตารางเวรของคนที่เคยเป็นพนักงานเงียบๆ เด็ดขาด
async function resetMembers(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return res.status(404).json({
      error: 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้',
    });
  }
  // ⭐️ รับทั้ง deleteWorkHistory (ชื่อใหม่) และ deleteAttendance (ชื่อเดิม เผื่อ frontend รุ่นเก่า cache อยู่)
  const deleteWorkHistory = req.body?.deleteWorkHistory === true || req.body?.deleteAttendance === true;
  const skipBlocked = req.body?.skipBlocked === true;
  const conn = await pool.getConnection();
  try {
    // ⭐️ กลุ่ม 3: หาสมาชิกที่มีประวัติทำงาน staff ติดอยู่ (attendance/shifts/schedules) — ตารางพวกนี้
    // NOT NULL ตัดสายไม่ได้ ต้องถามก่อนว่าจะลบประวัติทิ้งด้วยไหม
    const [blockedRows] = await conn.query(
      `SELECT DISTINCT u.id, u.full_name, u.student_id FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id
       LEFT JOIN shifts sh ON sh.cashier_id = u.id
       LEFT JOIN schedules sc ON sc.cashier_id = u.id
       WHERE u.role = 'MEMBER' AND (a.id IS NOT NULL OR sh.id IS NOT NULL OR sc.id IS NOT NULL)`
    );

    if (blockedRows.length > 0 && !deleteWorkHistory && !skipBlocked) {
      return res.json({
        success: false,
        needsConfirmation: true,
        blockedMembers: blockedRows,
        message: `พบสมาชิก ${blockedRows.length} คนที่มีประวัติการทำงาน (เข้า-ออกงาน/กะ/ตารางเวร) ติดอยู่ (${blockedRows.map(r => r.full_name).join(', ')}) — ต้องการลบประวัติการทำงานไปด้วย หรือข้ามคนเหล่านี้ไว้ก่อน?`,
      });
    }

    const blockedIds = blockedRows.map(r => r.id);
    await conn.beginTransaction();

    let targetSql = "SELECT id FROM users WHERE role = 'MEMBER'";
    const targetParams = [];
    if (skipBlocked && blockedIds.length > 0) {
      targetSql += ' AND id NOT IN (?)';
      targetParams.push(blockedIds);
    }
    const [targetRows] = await conn.query(targetSql, targetParams);
    const targetIds = targetRows.map(r => r.id);

    if (targetIds.length === 0) {
      await conn.commit();
      return res.json({ success: true, message: 'ไม่มีสมาชิกให้ลบ (ทั้งหมดถูกข้ามเพราะมีประวัติการทำงาน)', affected: 0, skipped: blockedIds.length });
    }

    // กลุ่ม 3: ประวัติการทำงาน staff (NOT NULL) — ลบเฉพาะเมื่อผู้ใช้ยืนยันผ่าน popup แล้วเท่านั้น
    if (deleteWorkHistory) {
      await conn.query('DELETE FROM attendance WHERE user_id IN (?)', [targetIds]);
      await conn.query('DELETE FROM shifts WHERE cashier_id IN (?)', [targetIds]);
      await conn.query('DELETE FROM schedules WHERE cashier_id IN (?)', [targetIds]);
    }
    // กลุ่ม 1: log/ประวัติภายใน → ลบทิ้งได้เลย
    await conn.query('DELETE FROM point_transactions WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM audit_logs WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM revoked_tokens WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM notifications WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM promotion_usages WHERE member_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM password_resets WHERE user_id IN (?)', [targetIds]);
    // กลุ่ม 2: ประวัติการขาย/ซื้อจริง (nullable) → ตัดสาย SET NULL รักษาเรคคอร์ดไว้
    await conn.query('UPDATE sales SET member_id = NULL WHERE member_id IN (?)', [targetIds]);
    await conn.query('UPDATE sales SET cashier_id = NULL WHERE cashier_id IN (?)', [targetIds]);
    await conn.query('UPDATE orders SET user_id = NULL WHERE user_id IN (?)', [targetIds]);
    await conn.query('UPDATE purchases SET user_id = NULL WHERE user_id IN (?)', [targetIds]);
    const [result] = await conn.query('DELETE FROM users WHERE id IN (?)', [targetIds]);
    await conn.commit();

    const skippedCount = skipBlocked ? blockedIds.length : 0;
    await logAdminReset('ADMIN_RESET_MEMBERS', req.user.id, { affected: result.affectedRows, deleteWorkHistory, skipped: skippedCount });
    res.json({
      success: true,
      message: skippedCount > 0
        ? `ลบสมาชิก MEMBER แล้ว ${result.affectedRows} คน (ข้าม ${skippedCount} คนที่มีประวัติการทำงาน)`
        : `ลบสมาชิก MEMBER แล้ว ${result.affectedRows} คน`,
      affected: result.affectedRows,
      skipped: skippedCount,
    });
  } catch (error) {
    await conn.rollback();
    // ⭐️ log error.message เต็มๆ ไว้เสมอ (ไม่ใช่แค่ตอน 500) เพราะ MySQL error message บอกชื่อ
    // constraint/ตารางที่ชนอยู่แล้ว — ใช้ไล่ดูใน log ได้ทันทีว่าตารางไหนบล็อกจริง โดยไม่ต้องเดา
    console.error('[resetMembers] FK/DB error:', error.code, error.message);
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({
        error: 'ลบไม่สำเร็จบางส่วน — มีสมาชิกที่มีข้อมูลอ้างอิงอื่นที่ระบบยังจัดการอัตโนมัติไม่ได้ ต้องลบข้อมูลอ้างอิงเหล่านั้นก่อน (หรือใช้ /reset/member-points + /reset/unlink-line แทนถ้าแค่อยากเทสต์ซ้ำ)',
        detail: error.message,
      });
    }
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  } finally {
    conn.release();
  }
}

// POST /api/admin/reset/member-points — รีเซ็ตแต้มสะสมของสมาชิก (MEMBER) เป็น 0 เท่านั้น
// ไม่แตะแต้ม/ยอดของ CASHIER/MANAGER/ADMIN
async function resetMemberPoints(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return res.status(404).json({
      error: 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้',
    });
  }
  try {
    const [result] = await pool.query("UPDATE users SET points = 0 WHERE role = 'MEMBER'");
    await logAdminReset('ADMIN_RESET_MEMBER_POINTS', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `รีเซ็ตแต้มสะสมของสมาชิกแล้ว ${result.affectedRows} บัญชี`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] resetMemberPoints', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = { unlinkAllLine, resetMembers, resetMemberPoints };
