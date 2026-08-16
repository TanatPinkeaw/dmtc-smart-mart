// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/memberGroupUpdate.js — สร้างคำสั่ง UPDATE แบบ partial สำหรับ member_groups (pure function)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องแยกไฟล์: controller require ../config/db ซึ่งรัน initDB + ค้าง pool ตอน require —
//   เทสหน่วยของ logic นี้จึงต้อง import จากไฟล์นี้ (zero dependency) แทน (pattern เดียวกับ idempotency.js)
// ทำอะไร: ส่งเฉพาะ field ที่มีค่าใน body — undefined = ไม่แตะคอลัมน์, null ชัดๆ = ล้างได้
//   คืน { sql, values } หรือ null ถ้าไม่มี field ใดให้อัปเดต (caller ตอบ 400)
function buildGroupUpdateSql(body, id) {
  const { name, default_discount_percent, description } = body || {};
  const sets = [];
  const vals = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
  if (default_discount_percent !== undefined) { sets.push('default_discount_percent = ?'); vals.push(Number(default_discount_percent) || 0); }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description); }
  if (sets.length === 0) return null;
  vals.push(id);
  return { sql: `UPDATE member_groups SET ${sets.join(', ')} WHERE id = ?`, values: vals };
}

module.exports = { buildGroupUpdateSql };
