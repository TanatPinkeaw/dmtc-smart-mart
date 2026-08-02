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
// เช่นเดียวกับ point_transactions/revoked_tokens/notifications/promotion_usages ที่เป็นแค่ log/ประวัติ
// ภายในของสมาชิก ไม่มีมูลค่าทางธุรกิจอิสระเมื่อตัวสมาชิกถูกลบไปแล้ว จึงลบตามได้อย่างปลอดภัย
// ⭐️ sales.member_id / orders.user_id เป็นประวัติการขาย/ออเดอร์จริง — "ตัดสาย" ด้วยการ SET NULL แทน
// การลบทิ้ง (เหมือน products.vendor_id ON DELETE SET NULL ที่มีอยู่แล้ว) ยอดขาย/ออเดอร์เดิมยังอยู่ครบ
// แค่ไม่มีสมาชิกผูกอยู่แล้ว (กลายเป็นเหมือนขายแบบไม่ระบุตัวลูกค้า) — ตัดสินใจร่วมกับผู้ใช้แล้วว่าจะไม่ลบ
// ยอดขาย/ออเดอร์จริงทิ้งเด็ดขาด เพราะกระทบข้อมูลบัญชี/รายงานย้อนหลัง
// ทั้งหมดอยู่ใน transaction เดียวกับการลบ users เอง กันเคสลบ/ตัดสายไปแล้วแต่ลบ user ไม่สำเร็จ
async function resetMembers(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return res.status(404).json({
      error: 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้',
    });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM point_transactions WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("DELETE FROM revoked_tokens WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("DELETE FROM promotion_usages WHERE member_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("UPDATE sales SET member_id = NULL WHERE member_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    await conn.query("UPDATE orders SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE role = 'MEMBER')");
    const [result] = await conn.query("DELETE FROM users WHERE role = 'MEMBER'");
    await conn.commit();
    await logAdminReset('ADMIN_RESET_MEMBERS', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `ลบสมาชิก MEMBER แล้ว ${result.affectedRows} คน`, affected: result.affectedRows });
  } catch (error) {
    await conn.rollback();
    // ⭐️ FK constraint อื่นที่เหลือ (เช่น shifts/schedules/attendance ถ้าสมาชิกดันมี role เดิมเป็น staff
    // มาก่อน — สำคัญ: ตารางพวกนี้เป็นประวัติเข้า-ออกงาน/เงินเดือนจริง ไม่ auto-clear ให้เหมือนตารางอื่น
    // เพราะ endpoint นี้กวาดตาม role='MEMBER' ปัจจุบัน ถ้ามีคนเคยเป็น staff แล้วถูกลดขั้นกลับเป็น MEMBER
    // (ทำได้จากหน้า Settings) ประวัติเก่าของเขายังอยู่ ไม่ควรถูกลบไปพร้อมสมาชิกทดสอบ)
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
