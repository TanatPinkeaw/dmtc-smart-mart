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
// ⭐️ audit_logs มี FK ผูกกับ users.id แบบไม่มี ON DELETE — และสมาชิกทุกคนที่สมัครผ่าน LINE จะมีแถว
// audit_logs (action=MEMBER_REGISTER_LINE) ติดตัวมาด้วยเสมอ (ดู memberController.js registerViaLine)
// เท่ากับ DELETE users ตรงๆ พังทุกครั้งแน่นอน 100% ไม่ใช่แค่บางเคส — ต้องล้าง audit_logs ก่อนด้วย
// เช่นเดียวกับ point_transactions/revoked_tokens/notifications/promotion_usages/password_resets ที่
// เป็นแค่ log/ประวัติภายในของสมาชิก ไม่มีมูลค่าทางธุรกิจอิสระเมื่อตัวสมาชิกถูกลบไปแล้ว จึงลบตามได้เลย
// ⭐️ sales.member_id / orders.user_id เป็นประวัติการขาย/ออเดอร์จริง — "ตัดสาย" ด้วยการ SET NULL แทน
// การลบทิ้ง (เหมือน products.vendor_id ON DELETE SET NULL ที่มีอยู่แล้ว) ยอดขาย/ออเดอร์เดิมยังอยู่ครบ
// แค่ไม่มีสมาชิกผูกอยู่แล้ว — ตัดสินใจร่วมกับผู้ใช้แล้วว่าจะไม่ลบยอดขาย/ออเดอร์จริงทิ้งเด็ดขาด
// ⭐️ attendance.user_id เป็น NOT NULL (SET NULL ไม่ได้) และเป็นประวัติเข้า-ออกงาน/เงินเดือนจริง — เกิดได้
// เพราะหน้า Settings แก้ role คนกลับเป็น MEMBER ได้ (คนที่เคยเป็น staff จริง) endpoint นี้กวาดตาม
// role='MEMBER' ปัจจุบันเลยไปเจอเข้า จึง "เช็คก่อน" เสมอว่ามีใครติด attendance บ้าง ถ้ามีและ caller ยัง
// ไม่ได้ระบุมาชัดๆ ว่าจะเอาแบบไหน (deleteAttendance / skipBlocked) จะหยุดแค่ตรงนี้ ส่งรายชื่อกลับไปให้
// frontend เปิด popup ถามก่อนเสมอ ไม่ลบประวัติเข้า-ออกงานเงียบๆ เด็ดขาด
async function resetMembers(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return res.status(404).json({
      error: 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้',
    });
  }
  const deleteAttendance = req.body?.deleteAttendance === true;
  const skipBlocked = req.body?.skipBlocked === true;
  const conn = await pool.getConnection();
  try {
    const [blockedRows] = await conn.query(
      `SELECT DISTINCT u.id, u.full_name, u.student_id FROM users u
       JOIN attendance a ON a.user_id = u.id WHERE u.role = 'MEMBER'`
    );

    if (blockedRows.length > 0 && !deleteAttendance && !skipBlocked) {
      return res.json({
        success: false,
        needsConfirmation: true,
        blockedMembers: blockedRows,
        message: `พบสมาชิก ${blockedRows.length} คนที่มีประวัติเข้า-ออกงานติดอยู่ (${blockedRows.map(r => r.full_name).join(', ')}) — ต้องการลบประวัติเข้า-ออกงานไปด้วย หรือข้ามคนเหล่านี้ไว้ก่อน?`,
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
      return res.json({ success: true, message: 'ไม่มีสมาชิกให้ลบ (ทั้งหมดถูกข้ามเพราะมีประวัติเข้า-ออกงาน)', affected: 0, skipped: blockedIds.length });
    }

    if (deleteAttendance) {
      await conn.query('DELETE FROM attendance WHERE user_id IN (?)', [targetIds]);
    }
    await conn.query('DELETE FROM point_transactions WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM audit_logs WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM revoked_tokens WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM notifications WHERE user_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM promotion_usages WHERE member_id IN (?)', [targetIds]);
    await conn.query('DELETE FROM password_resets WHERE user_id IN (?)', [targetIds]);
    await conn.query('UPDATE sales SET member_id = NULL WHERE member_id IN (?)', [targetIds]);
    await conn.query('UPDATE orders SET user_id = NULL WHERE user_id IN (?)', [targetIds]);
    const [result] = await conn.query('DELETE FROM users WHERE id IN (?)', [targetIds]);
    await conn.commit();

    const skippedCount = skipBlocked ? blockedIds.length : 0;
    await logAdminReset('ADMIN_RESET_MEMBERS', req.user.id, { affected: result.affectedRows, deleteAttendance, skipped: skippedCount });
    res.json({
      success: true,
      message: skippedCount > 0
        ? `ลบสมาชิก MEMBER แล้ว ${result.affectedRows} คน (ข้าม ${skippedCount} คนที่มีประวัติเข้า-ออกงาน)`
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
