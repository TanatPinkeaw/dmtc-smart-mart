// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/auditLog.js — เขียน audit_logs ตัวกลาง (เดิม copy INSERT + JSON.stringify 24 จุด)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: logAudit(db, action, userId, details, resourceType, resourceId) — INSERT
//   audit_logs แบบเต็มคอลัมน์เสมอ (resource_type/resource_id = null เมื่อไม่ส่ง) +
//   JSON.stringify(details) ที่เดียว — กัน format สลิป/ลืม stringify
// ใช้ยังไง: await logAudit(pool, 'CREATE_PRODUCT', req.user.id, { name, price }, 'PRODUCT', id)
//   หรือใน transaction: await logAudit(conn, ...) — รับทั้ง pool/conn (มี .query)
// ═══════════════════════════════════════════════════════════════════════════════════
async function logAudit(db, action, userId, details, resourceType = null, resourceId = null) {
  await db.query(
    'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
    [action, userId, resourceType, resourceId, JSON.stringify(details)]
  );
}

module.exports = { logAudit };
