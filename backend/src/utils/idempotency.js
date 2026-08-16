// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/idempotency.js — จัดการ request ซ้ำ (idempotency-key) ที่ชน UNIQUE constraint ฝั่ง DB
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องมี: idempotencyMiddleware (server.js) แคชคำตอบในหน่วยความจำ (in-process, TTL 24 ชม.)
//   พอ server restart (เช่น Render restart บ่อย) แคชหาย → request ที่ client ส่งซ้ำ (retry จาก
//   offline queue) จะวิ่งเข้า route จริงอีกรอบ → INSERT ชน UNIQUE key บนคอลัมน์ idempotency_key
//   → ER_DUP_ENTRY. ตรงนี้แปลว่า "operation นี้เคยสำเร็จแล้ว" (key ถูก INSERT ใน transaction เดียว
//   กับข้อมูลเสมอ — ถ้า rollback คีย์จะไม่เหลือใน DB) จึงควรตอบเป็น "สำเร็จ" แทน error — ไม่งั้น
//   client เข้าใจผิดว่าล้มเหลว แล้วอาจทำรายการซ้ำ (เช่น ขายซ้ำ/รับของซ้ำ) หรือแจ้งเตือนผู้ใช้ไม่จำเป็น
//
// ใช้คู่กับ: ตารางที่มีคอลัมน์ idempotency_key + UNIQUE (sales, orders, shifts, purchases,
//   categories, suppliers, promotions) — ดู schema.sql + migration ใน src/config/db.js

// เช็คว่า error นี้คือ "request ซ้ำ" จริงๆ (ชน UNIQUE บนคอลัมน์ idempotency_key เท่านั้น)
// ใช้ String(err.message).includes('idempotency_key') เพื่อไม่ให้ไปกลืน ER_DUP_ENTRY อื่น
// (เช่น student_id/barcode ซ้ำ ที่ควรเป็น error validation ปกติของ endpoint นั้น)
function isIdempotentDuplicate(err) {
  return !!(err && err.code === 'ER_DUP_ENTRY' && String(err.message).includes('idempotency_key'));
}

// ตอบ "สำเร็จซ้ำ" ไปให้ client (200) แล้วคืน true — ใช้ใน catch:
//   if (respondIdempotentDuplicate(error, res, { id: 123 })) return;
// (ต้องเรียกหลัง rollback/release ตามรูปแบบของ endpoint นั้นๆ)
function respondIdempotentDuplicate(err, res, extra = {}) {
  if (!isIdempotentDuplicate(err)) return false;
  res.status(200).json({
    message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ — ระบบไม่ได้ทำซ้ำให้)',
    duplicated: true,
    ...extra,
  });
  return true;
}

module.exports = { isIdempotentDuplicate, respondIdempotentDuplicate };
