// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/adminController.js — เครื่องมือล้าง/รีเซ็ตข้อมูลทดสอบ (สำหรับ demo/presentation)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ล้างข้อมูล — unlinkAllLine (ปลด LINE ทุกคน), resetMembers (ลบสมาชิกถาวร),
//   resetMemberPoints (ล้างแต้ม), resetProducts (รีเซ็ตสินค้า/หมวด/โปร) — ดู routes/adminRoutes.js
// ⚠️ อันตราย: บล็อกบน production โดยดีฟอลต์ (คืน 404) เปิดได้เฉพาะตั้ง env ALLOW_DATA_RESET=true จงใจ
//   — กดพลาดบน prod = ข้อมูลสมาชิกจริงหายถาวร กู้ไม่ได้
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Dev/testing data-reset tools — ADMIN กดล้างข้อมูลทดสอบเองได้ไม่ต้องเข้า DB ตรง
// ⚠️ ทั้ง 3 endpoint บล็อกบน production โดยดีฟอลต์ (คืน 404 เหมือน endpoint bootstrap อื่นๆ เช่น
// /api/seed-data — ดู server.js) ไม่สนแม้ผู้เรียกจะเป็น ADMIN จริงก็ตาม เพราะเป็นปุ่มลบ/ล้างข้อมูล
// สมาชิกจริงแบบกู้คืนไม่ได้ (โดยเฉพาะ resetMembers ที่ DELETE ทิ้งถาวร) กดพลาดบน prod = ข้อมูล
// สมาชิกจริงหายทั้งระบบ — เปิดใช้บน production ได้เฉพาะเมื่อมีคนตั้งค่า env var
// ALLOW_DATA_RESET=true บน deployment นั้นๆ อย่างจงใจเท่านั้น (ไม่ใช่ default ที่เปิดเอง)
// ⭐️ Multi-tenant: pool removed — use req.db (injected by tenantDB middleware)
const config = require('../config/config');
const { serverError, notFound, conflict } = require('../utils/http');
const { logAudit } = require('../utils/auditLog');

function isResetAllowed() {
  return process.env.ALLOW_DATA_RESET === 'true' || !config.IS_PRODUCTION;
}

async function logAdminReset(action, adminId, details) {
  try {
    await logAudit(pool, action, adminId, details, 'SYSTEM', null);
  } catch (err) {
    console.error('[adminController] เขียน audit_logs ไม่สำเร็จ:', err.message);
  }
}

// ⭐️ Shared FK-cleanup helpers — ใช้ร่วมกันทั้ง resetMembers (ลบทีละยกทั้ง role=MEMBER) และ hard-delete
// ราย user (DELETE /api/users/:id/permanent ใน server.js) ให้ลอจิกตัดสาย FK "เหมือนกันเป๊ะ" ตามสเปก
// ทุกตารางที่ FK ชี้มาที่ users.id แบ่ง 3 กลุ่ม จัดการต่างกัน (ดูรายละเอียดใน resetMembers):
//   กลุ่ม 1 log/ประวัติภายใน → DELETE, กลุ่ม 2 ขาย/ซื้อจริง (nullable) → SET NULL, กลุ่ม 3 ประวัติทำงาน
//   staff (NOT NULL) → DELETE เฉพาะเมื่อ deleteWorkHistory=true

// หาสมาชิก/ผู้ใช้ใน userIds ที่ยังมีประวัติการทำงาน staff (attendance/shifts/schedules) ติดอยู่ —
// ตารางพวกนี้ NOT NULL ตัดสายไม่ได้ ต้องถามก่อนว่าจะลบประวัติทิ้งด้วยไหม คืน [{id, full_name, student_id}]
async function findWorkHistoryBlockers(conn, userIds) {
  if (!userIds || userIds.length === 0) return [];
  const [rows] = await conn.query(
    `SELECT DISTINCT u.id, u.full_name, u.student_id FROM users u
     LEFT JOIN attendance a ON a.user_id = u.id
     LEFT JOIN shifts sh ON sh.cashier_id = u.id
     LEFT JOIN schedules sc ON sc.cashier_id = u.id
     WHERE u.id IN (?) AND (a.id IS NOT NULL OR sh.id IS NOT NULL OR sc.id IS NOT NULL)`,
    [userIds]
  );
  return rows;
}

// ล้าง/ตัดสายทุก FK ที่ชี้มาที่ users.id สำหรับ userIds ที่ให้มา (ไม่รวมการ DELETE FROM users เอง —
// ให้ผู้เรียกคุมจังหวะลบ user เองหลังเรียกฟังก์ชันนี้) ต้องรันอยู่ใน transaction (conn) ของผู้เรียก
async function cleanupUserReferences(conn, userIds, { deleteWorkHistory }) {
  if (!userIds || userIds.length === 0) return;
  // กลุ่ม 3: ประวัติการทำงาน staff (NOT NULL) — ลบเฉพาะเมื่อผู้ใช้ยืนยันแล้วเท่านั้น
  if (deleteWorkHistory) {
    await conn.query('DELETE FROM attendance WHERE user_id IN (?)', [userIds]);
    await conn.query('DELETE FROM shifts WHERE cashier_id IN (?)', [userIds]);
    await conn.query('DELETE FROM schedules WHERE cashier_id IN (?)', [userIds]);
  }
  // กลุ่ม 1: log/ประวัติภายใน → ลบทิ้งได้เลย
  await conn.query('DELETE FROM point_transactions WHERE user_id IN (?)', [userIds]);
  await conn.query('DELETE FROM audit_logs WHERE user_id IN (?)', [userIds]);
  await conn.query('DELETE FROM revoked_tokens WHERE user_id IN (?)', [userIds]);
  await conn.query('DELETE FROM notifications WHERE user_id IN (?)', [userIds]);
  await conn.query('DELETE FROM promotion_usages WHERE member_id IN (?)', [userIds]);
  await conn.query('DELETE FROM password_resets WHERE user_id IN (?)', [userIds]);
  // กลุ่ม 2: ประวัติการขาย/ซื้อจริง (nullable) → ตัดสาย SET NULL รักษาเรคคอร์ดไว้
  await conn.query('UPDATE sales SET member_id = NULL WHERE member_id IN (?)', [userIds]);
  await conn.query('UPDATE sales SET cashier_id = NULL WHERE cashier_id IN (?)', [userIds]);
  await conn.query('UPDATE orders SET user_id = NULL WHERE user_id IN (?)', [userIds]);
  await conn.query('UPDATE purchases SET user_id = NULL WHERE user_id IN (?)', [userIds]);
}

// POST /api/admin/reset/unlink-line — ปลดผูก LINE ของสมาชิก (MEMBER) เท่านั้น เอาไว้เทสต์ flow
// สมัคร/ผูกบัญชีซ้ำได้เรื่อยๆ — ไม่แตะ line_user_id ของ CASHIER/MANAGER/ADMIN
async function unlinkAllLine(req, res) {
  // ⭐️ ต้องส่ง field "error" (ไม่ใช่ "message") — getErrorMessage() ฝั่ง frontend (utils/errorMessage.ts)
  // อ่านเฉพาะ err.response.data.error เหมือน route อื่นทั้งระบบ ผิด field แล้วจะ fallback เป็นข้อความ
  // ทั่วไปที่ไม่บอกสาเหตุจริง ทำให้ดูเหมือนปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
  if (!isResetAllowed()) {
    return notFound(res, 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้');
  }
  try {
    const [result] = await req.db.query("UPDATE users SET line_user_id = NULL WHERE role = 'MEMBER'");
    await logAdminReset('ADMIN_RESET_UNLINK_LINE', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `ปลดผูกบัญชี LINE ของสมาชิกแล้ว ${result.affectedRows} รายการ`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] unlinkAllLine', error.message);
    serverError(res);
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
    return notFound(res, 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้');
  }
  // ⭐️ รับทั้ง deleteWorkHistory (ชื่อใหม่) และ deleteAttendance (ชื่อเดิม เผื่อ frontend รุ่นเก่า cache อยู่)
  const deleteWorkHistory = req.body?.deleteWorkHistory === true || req.body?.deleteAttendance === true;
  const skipBlocked = req.body?.skipBlocked === true;
  const conn = await req.db.getConnection();
  try {
    // ⭐️ กลุ่ม 3: หาสมาชิกที่มีประวัติทำงาน staff ติดอยู่ (attendance/shifts/schedules) ก่อน — ถ้ามีและ
    // caller ยังไม่ระบุจะเอาแบบไหน ให้หยุดถามผ่าน popup ก่อน
    const [memberRows] = await conn.query("SELECT id FROM users WHERE role = 'MEMBER'");
    const allMemberIds = memberRows.map(r => r.id);
    const blockedRows = await findWorkHistoryBlockers(conn, allMemberIds);

    if (blockedRows.length > 0 && !deleteWorkHistory && !skipBlocked) {
      return res.json({
        success: false,
        needsConfirmation: true,
        blockedMembers: blockedRows,
        message: `พบสมาชิก ${blockedRows.length} คนที่มีประวัติการทำงาน (เข้า-ออกงาน/กะ/ตารางเวร) ติดอยู่ (${blockedRows.map(r => r.full_name).join(', ')}) — ต้องการลบประวัติการทำงานไปด้วย หรือข้ามคนเหล่านี้ไว้ก่อน?`,
      });
    }

    const blockedIds = blockedRows.map(r => r.id);
    // ถ้าเลือก skip → ตัด blockedIds ออกจากรายชื่อที่จะลบ
    const targetIds = skipBlocked
      ? allMemberIds.filter(id => !blockedIds.includes(id))
      : allMemberIds;

    if (targetIds.length === 0) {
      return res.json({ success: true, message: 'ไม่มีสมาชิกให้ลบ (ทั้งหมดถูกข้ามเพราะมีประวัติการทำงาน)', affected: 0, skipped: blockedIds.length });
    }

    await conn.beginTransaction();
    await cleanupUserReferences(conn, targetIds, { deleteWorkHistory });
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
      return conflict(res, 'ลบไม่สำเร็จบางส่วน — มีสมาชิกที่มีข้อมูลอ้างอิงอื่นที่ระบบยังจัดการอัตโนมัติไม่ได้ ต้องลบข้อมูลอ้างอิงเหล่านั้นก่อน (หรือใช้ /reset/member-points + /reset/unlink-line แทนถ้าแค่อยากเทสต์ซ้ำ)', { detail: error.message });
    }
    serverError(res);
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
    return notFound(res, 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้');
  }
  try {
    const [result] = await req.db.query("UPDATE users SET points = 0 WHERE role = 'MEMBER'");
    await logAdminReset('ADMIN_RESET_MEMBER_POINTS', req.user.id, { affected: result.affectedRows });
    res.json({ success: true, message: `รีเซ็ตแต้มสะสมของสมาชิกแล้ว ${result.affectedRows} บัญชี`, affected: result.affectedRows });
  } catch (error) {
    console.error('[500] resetMemberPoints', error.message);
    serverError(res);
  }
}

// POST /api/admin/reset/products — Phase 5 (presentation readiness): ลบสินค้า+หมวดหมู่+โปรโมชั่น
// "ทั้งหมด" ถาวร (กู้คืนไม่ได้) แล้วไปเรียก GET /api/seed-data ต่อเองเพื่อใส่ข้อมูลตัวอย่างสวยๆ กลับเข้าไป
// ⚠️ นี่คือการ "ล้างชุดข้อมูลร้านทั้งหมด" ไม่ใช่แค่ "ลบสินค้าขยะบางชิ้น" — ต่างจาก resetMembers ตรงที่
// ผู้ใช้ (เจ้าของโปรเจกต์) ยืนยันชัดเจนแล้วว่าต้องการล้างประวัติการขาย/ออเดอร์/ใบสั่งซื้อทดสอบไปด้วย
// ไม่ใช่แค่สินค้า จึงออกแบบให้กว้างกว่า resetMembers (ซึ่งสงวนประวัติการขายจริงไว้เสมอ)
//
// ตารางที่เกี่ยวข้องแบ่งเป็น:
//  1) product_id ใน sale_items/order_items/purchase_items เป็น NOT NULL ไม่มี ON DELETE — สินค้าที่มี
//     ประวัติขาย/สั่งจอง/รับสินค้าจริงติดอยู่จะลบไม่ออกตรงๆ (กลุ่ม "blocked") ต้อง "เช็คก่อน" เสมอ ถ้ามี
//     และ caller ยังไม่ระบุ (deleteTransactionHistory / skipBlocked) จะหยุด ถามก่อนเหมือน resetMembers
//  2) ยืนยัน deleteTransactionHistory=true → ลบ sales/orders/purchases ที่อ้างอิงสินค้ากลุ่ม blocked ทิ้ง
//     ก่อน (sale_items/order_items/purchase_items เป็น ON DELETE CASCADE จากตารางแม่พวกนี้ ลบแม่แล้วลูก
//     หายเองอัตโนมัติ ไม่ต้องลบทีละแถว)
//  3) promotion_usages ไม่มี ON DELETE จาก promotions — ต้องลบก่อนเสมอ (แค่ log การใช้โปร ไม่มีมูลค่า
//     อิสระ) แล้วค่อยลบ promotions (buy_product_id/free_product_id ไม่มี FK constraint จริง แค่เลขลอย
//     จะกลายเป็นค่าที่ไม่มีอยู่จริงหลังลบสินค้า แต่ตัว promotions เองไม่ได้ถูกบล็อกโดย FK นี้)
//  4) categories.id ถูกอ้างจาก products.category_id (ON DELETE SET NULL) และ group_discount_rules
//     (ON DELETE CASCADE) — ปลอดภัยเสมอ ลบได้เลยไม่ต้องเช็ค
async function findProductHistoryBlockers(conn) {
  const [rows] = await conn.query(
    `SELECT p.id, p.name,
       (SELECT COUNT(*) FROM sale_items si WHERE si.product_id = p.id) AS sale_count,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id) AS order_count,
       (SELECT COUNT(*) FROM purchase_items pi WHERE pi.product_id = p.id) AS purchase_count
     FROM products p
     HAVING sale_count > 0 OR order_count > 0 OR purchase_count > 0`
  );
  return rows;
}

async function resetProducts(req, res) {
  if (!isResetAllowed()) {
    return notFound(res, 'ปิดใช้งานเครื่องมือรีเซ็ตข้อมูลบน production — ตั้งค่า environment variable ALLOW_DATA_RESET=true บน deployment นี้ก่อนถึงจะใช้ได้');
  }
  const deleteTransactionHistory = req.body?.deleteTransactionHistory === true;
  const skipBlocked = req.body?.skipBlocked === true;
  const conn = await req.db.getConnection();
  try {
    const blockedRows = await findProductHistoryBlockers(conn);

    if (blockedRows.length > 0 && !deleteTransactionHistory && !skipBlocked) {
      return res.json({
        success: false,
        needsConfirmation: true,
        blockedProducts: blockedRows,
        message: `พบสินค้า ${blockedRows.length} รายการที่มีประวัติการขาย/สั่งจอง/รับสินค้าจริงติดอยู่ (${blockedRows.map(r => r.name).join(', ')}) — ต้องการลบประวัติการขาย/ออเดอร์/ใบสั่งซื้อที่เกี่ยวข้องไปด้วย หรือข้ามสินค้าเหล่านี้ไว้ก่อน?`,
      });
    }

    const blockedIds = blockedRows.map(r => r.id);
    await conn.beginTransaction();

    if (deleteTransactionHistory && blockedIds.length > 0) {
      // ⭐️ ลบตารางแม่ (sales/orders/purchases) ที่มี item อ้างอิงสินค้ากลุ่ม blocked — ลูก (sale_items/
      // order_items/purchase_items) หายเองผ่าน ON DELETE CASCADE ไม่ต้องลบแยก
      await conn.query('DELETE FROM sales WHERE id IN (SELECT DISTINCT sale_id FROM sale_items WHERE product_id IN (?))', [blockedIds]);
      await conn.query('DELETE FROM orders WHERE id IN (SELECT DISTINCT order_id FROM order_items WHERE product_id IN (?))', [blockedIds]);
      await conn.query('DELETE FROM purchases WHERE id IN (SELECT DISTINCT purchase_id FROM purchase_items WHERE product_id IN (?))', [blockedIds]);
    }

    // promotion_usages ต้องเคลียร์ก่อน promotions เสมอ (กัน FK บล็อก) — ไม่มีมูลค่าอิสระ ลบได้เลย
    await conn.query('DELETE FROM promotion_usages');
    await conn.query('DELETE FROM promotions');

    let targetSql = 'SELECT id FROM products';
    const targetParams = [];
    if (skipBlocked && blockedIds.length > 0) {
      targetSql += ' WHERE id NOT IN (?)';
      targetParams.push(blockedIds);
    }
    const [targetRows] = await conn.query(targetSql, targetParams);
    const targetIds = targetRows.map(r => r.id);

    let deletedProducts = 0;
    if (targetIds.length > 0) {
      const [result] = await conn.query('DELETE FROM products WHERE id IN (?)', [targetIds]);
      deletedProducts = result.affectedRows;
    }
    // categories ปลอดภัยเสมอ (ON DELETE SET NULL จาก products, ON DELETE CASCADE จาก group_discount_rules)
    const [catResult] = await conn.query('DELETE FROM categories');

    await conn.commit();

    const skippedCount = skipBlocked ? blockedIds.length : 0;
    await logAdminReset('ADMIN_RESET_PRODUCTS', req.user.id, {
      deletedProducts, deletedCategories: catResult.affectedRows, deleteTransactionHistory, skipped: skippedCount,
    });
    res.json({
      success: true,
      message: skippedCount > 0
        ? `ลบสินค้าแล้ว ${deletedProducts} รายการ + หมวดหมู่ ${catResult.affectedRows} รายการ (ข้าม ${skippedCount} รายการที่มีประวัติการขาย/สั่งจอง) — เรียก GET /api/seed-data ต่อเพื่อใส่ข้อมูลตัวอย่างใหม่`
        : `ลบสินค้าแล้ว ${deletedProducts} รายการ + หมวดหมู่ ${catResult.affectedRows} รายการ — เรียก GET /api/seed-data ต่อเพื่อใส่ข้อมูลตัวอย่างใหม่`,
      deletedProducts,
      deletedCategories: catResult.affectedRows,
      skipped: skippedCount,
    });
  } catch (error) {
    await conn.rollback();
    console.error('[resetProducts] FK/DB error:', error.code, error.message);
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
      return conflict(res, 'ลบไม่สำเร็จบางส่วน — มีข้อมูลอ้างอิงอื่นที่ระบบยังจัดการอัตโนมัติไม่ได้', { detail: error.message });
    }
    serverError(res);
  } finally {
    conn.release();
  }
}

module.exports = {
  unlinkAllLine, resetMembers, resetMemberPoints, resetProducts,
  // ⭐️ export helpers ให้ server.js เอาไป reuse ใน DELETE /api/users/:id/permanent (hard-delete ราย user)
  findWorkHistoryBlockers, cleanupUserReferences,
};
