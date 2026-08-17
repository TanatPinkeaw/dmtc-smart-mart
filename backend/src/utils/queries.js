// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queries.js — query helpers กลาง (รวม SQL ซ้ำที่ copy กันหลายจุด)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: query ที่เดิม copy string ซ้ำ (order_items 6 จุด / full_name 3 จุด / role 3 จุด /
//   points FOR UPDATE 2 จุด) — รวมเป็น helper เดียว กัน query ต่างกันทีละจุดเวลาแก้คอลัมน์
// จุดสำคัญ: รับ db handle (pool หรือ conn) ตามบริบทของฝั่งเรียก — คืน rows ตรงๆ
//   (ฝั่งเรียกเดิมเขียน const [x] = await db.query(...) → เปลี่ยนเป็น x = await helper(...))
//   พฤติกรรม/ผลลัพธ์เหมือนเดิมเป๊ะ
// ═══════════════════════════════════════════════════════════════════════════════════
async function getOrderItems(db, orderId) {
  const [rows] = await db.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
  return rows;
}

async function getUserFullName(db, userId) {
  const [rows] = await db.query('SELECT full_name FROM users WHERE id = ?', [userId]);
  return rows;
}

async function getUserRole(db, userId) {
  const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
  return rows;
}

// ⭐️ FOR UPDATE ต้องเรียกภายใน transaction (withTransaction) เท่านั้น — ล็อกแถวกันใช้แต้มซ้ำ
async function lockUserPoints(db, userId) {
  const [rows] = await db.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
  return rows;
}

module.exports = { getOrderItems, getUserFullName, getUserRole, lockUserPoints };
