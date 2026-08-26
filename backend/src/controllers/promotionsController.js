// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/promotionsController.js — logic ของโปรโมชั่น (รายการ/สร้าง/ลบ/ตรวจสิทธิ์)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ของ /api/promotions/* — list (ที่ยัง active), active (พร้อม label โชว์แบนเนอร์),
//   create (รองรับ PERCENT/FIXED/BOGO), delete (fallback ปิดใช้งานถ้าเคยถูกใช้), verify (preview ส่วนลด)
// จุดสำคัญ: verify เป็นแค่ preview — /api/sales/checkout คำนวณส่วนลดใหม่เองเสมอ ไม่เชื่อค่าจาก client ;
//   ลบโปรที่เคยถูกใช้ (มีแถวใน promotion_usages) จะโดน RESTRICT → fallback ไป is_active=0 แทน
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — ย้ายออกจาก server.js ตรงๆ (mount /api/promotions) พฤติกรรม/path เดิม
// ⭐️ Multi-tenant: pool removed — use req.db (injected by tenantDB middleware)
const { calculatePromotionDiscount, checkPromotionUsageLimit } = require('../services/promotionEngine');
const { serverError, badRequest, notFound } = require('../utils/http');
// ⭐️ จัดการ request ซ้ำ (idempotency-key) ที่ชน UNIQUE constraint ฝั่ง DB หลัง server restart
const { isIdempotentDuplicate } = require('../utils/idempotency');

// GET /api/promotions — โปรที่ยัง active และยังไม่หมดอายุ (public — POS/frontend ใช้)
async function list(req, res) {
  try {
    const [rows] = await req.db.query('SELECT * FROM promotions WHERE is_active = TRUE AND (end_date IS NULL OR end_date >= CURDATE())');
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/promotions/active — โปรที่กำลัง active พร้อมข้อความอ่านง่าย (รวมชื่อสินค้าสำหรับ BOGO) โชว์แบนเนอร์
async function active(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT p.id, p.name, p.discount_type, p.discount_value, p.end_date, p.buy_qty, p.free_qty,
             bp.name AS buy_product_name, fp.name AS free_product_name
      FROM promotions p
      LEFT JOIN products bp ON p.buy_product_id = bp.id
      LEFT JOIN products fp ON p.free_product_id = fp.id
      WHERE p.is_active = TRUE
        AND (p.start_date IS NULL OR p.start_date <= CURDATE())
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
      ORDER BY p.end_date ASC
    `);
    const items = rows.map(r => {
      let label;
      if (r.discount_type === 'PERCENT') label = `ลด ${Number(r.discount_value)}% ทั้งบิล`;
      else if (r.discount_type === 'FIXED') label = `ลด ฿${Number(r.discount_value)} ทั้งบิล`;
      else if (r.discount_type === 'BOGO') label = `ซื้อ ${r.buy_product_name || 'สินค้า'} ${r.buy_qty || 1} แถม ${r.free_product_name || 'สินค้า'} ${r.free_qty || 1}`;
      else label = r.name;
      return { id: r.id, name: r.name, type: r.discount_type, label, end_date: r.end_date };
    });
    res.json(items);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// POST /api/promotions — สร้างโปร (ADMIN/MANAGER, ผ่าน promotionValidator มาแล้ว)
async function create(req, res) {
  const {
    name, discount_type, discount_value, start_date, end_date,
    buy_product_id, buy_qty, free_product_id, free_qty,
    usage_limit, usage_limit_per_user
  } = req.body;

  // ⭐️ BOGO/ซื้อครบแถม ต้องระบุ buy_product_id, buy_qty, free_product_id, free_qty ให้ครบ
  if (discount_type === 'BOGO' && (!buy_product_id || !buy_qty || !free_product_id || !free_qty)) {
    return badRequest(res, "โปรโมชั่นแบบซื้อครบแถม ต้องระบุสินค้าที่ต้องซื้อ, จำนวนที่ต้องซื้อ, สินค้าที่แถม, จำนวนที่แถม ให้ครบ");
  }

  // ⭐️ เก็บ idempotency_key (กัน offline queue retry แล้วสร้างโปรซ้ำ) — มี UNIQUE ที่คอลัมน์นี้ใน DB
  const idempotencyKey = req.headers['idempotency-key'];
  try {
    const [result] = await req.db.query(
      `INSERT INTO promotions
        (name, discount_type, discount_value, start_date, end_date, buy_product_id, buy_qty, free_product_id, free_qty, usage_limit, usage_limit_per_user, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, discount_type, discount_value || 0, start_date || null, end_date || null,
       buy_product_id || null, buy_qty || null, free_product_id || null, free_qty || null,
       usage_limit || null, usage_limit_per_user || null, idempotencyKey || null]
    );
    res.status(201).json({ id: result.insertId, message: "สร้างโปรโมชั่นสำเร็จ" });
  } catch (error) {
    // 🐛 FIX — retry หลัง server restart: row เดิมยังอยู่ใน DB (UNIQUE idempotency_key) → ตอบ "สำเร็จซ้ำ" แทน error
    if (isIdempotentDuplicate(error)) {
      const [rows] = await req.db.query('SELECT id FROM promotions WHERE idempotency_key = ?', [idempotencyKey]);
      if (rows.length > 0) return res.status(201).json({ id: rows[0].id, message: 'สร้างโปรโมชั่นสำเร็จ (request ซ้ำ — ไม่ได้สร้างซ้ำ)', duplicated: true });
      return res.status(200).json({ message: 'ทำรายการสำเร็จแล้ว (request นี้ถูกส่งซ้ำ)', duplicated: true });
    }
    console.error('[500]', error.message);
    serverError(res);
  }
}

// DELETE /api/promotions/:id — ลบโปร ; ถ้าเคยถูกใช้ (promotion_usages RESTRICT) fallback ไปปิดใช้งานแทน
// เพื่อไม่ให้ประวัติการใช้โปรหาย (sales.promotion_id เป็น ON DELETE SET NULL อยู่แล้วไม่ติดปัญหา)
async function remove(req, res) {
  try {
    const [existing] = await req.db.query('SELECT id FROM promotions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return notFound(res, 'ไม่พบโปรโมชั่นนี้');

    try {
      await req.db.query('DELETE FROM promotions WHERE id = ?', [req.params.id]);
      return res.json({ message: 'ลบโปรโมชั่นสำเร็จ' });
    } catch (deleteErr) {
      if (deleteErr.code !== 'ER_ROW_IS_REFERENCED_2' && deleteErr.code !== 'ER_ROW_IS_REFERENCED') throw deleteErr;
      await req.db.query('UPDATE promotions SET is_active = FALSE WHERE id = ?', [req.params.id]);
      return res.json({ message: 'โปรโมชั่นนี้เคยถูกใช้งานแล้ว ลบถาวรไม่ได้ (กันประวัติการใช้งานหาย) ปิดใช้งานให้แทน' });
    }
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// POST /api/promotions/verify — preview ส่วนลด (CASHIER/ADMIN) — ไม่ใช่ยอดที่เชื่อถือได้จริง
async function verify(req, res) {
  const { promotion_id, grand_total, items, member_id } = req.body;
  try {
    const [promos] = await req.db.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE', [promotion_id]);
    if (promos.length === 0) return notFound(res, "ไม่พบโปรโมชั่น หรือโปรโมชั่นหมดอายุแล้ว");

    const promo = promos[0];

    const limitError = await checkPromotionUsageLimit(pool.query.bind(pool), promo, member_id || null);
    if (limitError) return badRequest(res, limitError);

    const discount_amount = await calculatePromotionDiscount(pool.query.bind(pool), promo, grand_total, items);
    if (promo.discount_type === 'BOGO' && discount_amount === 0) {
      return badRequest(res, "ตะกร้าไม่ตรงเงื่อนไขโปรโมชั่นนี้ (ซื้อไม่ครบจำนวน หรือไม่มีสินค้าที่แถมในตะกร้า)");
    }
    const net_total = grand_total - discount_amount;

    res.json({ discount_amount, net_total, promo_name: promo.name });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

module.exports = { list, active, create, remove, verify };
