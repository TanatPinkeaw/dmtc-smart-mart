// ⭐️ Dev/testing data-reset tools — ADMIN กดล้างข้อมูลทดสอบเองได้ไม่ต้องเข้า DB ตรง
// ⚠️ ทั้ง 3 endpoint บล็อกบน production เสมอ (คืน 404 เหมือน endpoint bootstrap อื่นๆ เช่น
// /api/seed-data — ดู server.js) ไม่สนแม้ผู้เรียกจะเป็น ADMIN จริงก็ตาม เพราะเป็นปุ่มลบ/ล้างข้อมูล
// สมาชิกจริงแบบกู้คืนไม่ได้ (โดยเฉพาะ resetMembers ที่ DELETE ทิ้งถาวร) กดพลาดบน prod = ข้อมูล
// สมาชิกจริงหายทั้งระบบ ความเสี่ยงสูงเกินกว่าจะเปิดไว้แค่ role check ชั้นเดียว
const pool = require('../config/db');
const config = require('../config/config');

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

// POST /api/admin/reset/unlink-line — ปลดผูก LINE ทั้งระบบ เอาไว้เทสต์ flow สมัคร/ผูกบัญชีซ้ำได้เรื่อยๆ
async function unlinkAllLine(req, res) {
  if (config.IS_PRODUCTION) return res.status(404).end();
  try {
    const [result] = await pool.query('UPDATE users SET line_user_id = NULL');
    await logAdminReset('ADMIN_RESET_UNLINK_LINE', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `ปลดผูกบัญชี LINE แล้ว ${result.affectedRows} รายการ`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] unlinkAllLine', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// POST /api/admin/reset/members — ลบ user ทุกคนที่ role=MEMBER ถาวร (กู้คืนไม่ได้)
async function resetMembers(req, res) {
  if (config.IS_PRODUCTION) return res.status(404).end();
  try {
    const [result] = await pool.query("DELETE FROM users WHERE role = 'MEMBER'");
    await logAdminReset('ADMIN_RESET_MEMBERS', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `ลบสมาชิก MEMBER แล้ว ${result.affectedRows} คน`, affected: result.affectedRows });
  } catch (error) {
    // ⭐️ FK constraint — สมาชิกที่มีประวัติขาย/ออเดอร์/point_transactions อ้างอิงถึง จะลบไม่ได้ตรงๆ
    // (sales.member_id, orders, point_transactions ฯลฯ ผูก FK ไว้กับ users) แจ้งชัดเจนแทนที่จะ 500 เฉยๆ
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({
        error: 'ลบไม่สำเร็จบางส่วน — มีสมาชิกที่มีประวัติการขาย/ออเดอร์/แต้มผูกอยู่ ต้องลบข้อมูลอ้างอิงเหล่านั้นก่อน (หรือใช้ /reset/member-points + /reset/unlink-line แทนถ้าแค่อยากเทสต์ซ้ำ)',
      });
    }
    console.error('[500] resetMembers', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// POST /api/admin/reset/member-points — รีเซ็ตแต้มทุกคนเป็น 0 (รวม CASHIER/ADMIN ที่อาจมีแต้มค้างด้วย
// ตามที่สเปกระบุ UPDATE users SET points = 0 แบบไม่กรอง role)
async function resetMemberPoints(req, res) {
  if (config.IS_PRODUCTION) return res.status(404).end();
  try {
    const [result] = await pool.query('UPDATE users SET points = 0');
    await logAdminReset('ADMIN_RESET_MEMBER_POINTS', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `รีเซ็ตแต้มสะสมแล้ว ${result.affectedRows} บัญชี`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] resetMemberPoints', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = { unlinkAllLine, resetMembers, resetMemberPoints };
