// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 services/promotionEngine.js — คำนวณส่วนลดโปรโมชั่น + เช็คสิทธิ์การใช้ (โลจิกกลาง)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: 2 ฟังก์ชันบริสุทธิ์ (pure) ที่รับ queryFn เข้ามา — ใช้ได้ทั้งใน transaction (conn.query)
//   ตอน checkout จริง และแบบ preview (pool.query) ตอน POST /api/promotions/verify
//   - calculatePromotionDiscount: คำนวณจำนวนเงินส่วนลดตามชนิดโปร (PERCENT/FIXED/BOGO)
//   - checkPromotionUsageLimit: เช็คโควตา usage_limit รวม + usage_limit_per_user
// จุดสำคัญ: แยกออกมาเป็น service กลางเพราะทั้ง server.js (checkout/sync-offline) และ
//   promotionsController (verify) ต้องใช้ตัวเดียวกัน — กันคำนวณส่วนลดเพี้ยนไปคนละแบบ 2 ที่
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — ยกมาจาก server.js เป๊ะ ไม่เปลี่ยนสูตร/พฤติกรรม

// ⭐️ คำนวณส่วนลดของโปรโมชั่น รองรับ PERCENT/FIXED/BOGO (BOGO ต้องมี items ของตะกร้าเพื่อเช็คจำนวนจริง)
// queryFn คือ conn.query หรือ pool.query แล้วแต่บริบท (ใน transaction หรือ preview เฉยๆ)
async function calculatePromotionDiscount(queryFn, promo, totalAmount, items) {
  if (promo.discount_type === 'PERCENT') {
    return Math.min((totalAmount * Number(promo.discount_value)) / 100, totalAmount);
  }
  if (promo.discount_type === 'FIXED') {
    return Math.min(Number(promo.discount_value), totalAmount);
  }
  if (promo.discount_type === 'BOGO') {
    if (!promo.buy_product_id || !promo.buy_qty || !promo.free_product_id || !promo.free_qty || !items) return 0;

    const sameProduct = Number(promo.buy_product_id) === Number(promo.free_product_id);
    const buyQty = items.filter(i => Number(i.product_id) === Number(promo.buy_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);
    const freeQtyInCart = items.filter(i => Number(i.product_id) === Number(promo.free_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);

    let freeUnitsGranted;
    if (sameProduct) {
      // ซื้อ X แถม Y ของชิ้นเดียวกัน (เช่น ซื้อ1แถม1 = ต้องมีในตะกร้าครบ buy_qty+free_qty ต่อ 1 เซ็ต)
      const setSize = Number(promo.buy_qty) + Number(promo.free_qty);
      const sets = Math.floor(buyQty / setSize);
      freeUnitsGranted = sets * Number(promo.free_qty);
    } else {
      // ซื้อสินค้า A ครบ แถมสินค้า B (คนละตัว) — B ต้องมีในตะกร้าด้วย
      if (buyQty < promo.buy_qty || freeQtyInCart === 0) return 0;
      const freeSets = Math.floor(buyQty / Number(promo.buy_qty));
      freeUnitsGranted = Math.min(freeSets * Number(promo.free_qty), freeQtyInCart);
    }
    if (freeUnitsGranted <= 0) return 0;

    const [freeProductRows] = await queryFn('SELECT price FROM products WHERE id = ?', [promo.free_product_id]);
    if (freeProductRows.length === 0) return 0;
    return Math.min(freeUnitsGranted * Number(freeProductRows[0].price), totalAmount);
  }
  return 0;
}

// ⭐️ เช็คสิทธิ์การใช้โปรโมชั่น (usage_limit รวม + usage_limit_per_user) คืน error message หรือ null ถ้าใช้ได้
async function checkPromotionUsageLimit(queryFn, promo, memberId) {
  if (promo.usage_limit != null && promo.usage_count >= promo.usage_limit) {
    return "โปรโมชั่นนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว";
  }
  if (promo.usage_limit_per_user != null) {
    if (!memberId) return "โปรโมชั่นนี้จำกัดสิทธิ์ต่อคน กรุณาระบุสมาชิกก่อนใช้สิทธิ์";
    const [rows] = await queryFn('SELECT COUNT(*) as cnt FROM promotion_usages WHERE promotion_id = ? AND member_id = ?', [promo.id, memberId]);
    if (rows[0].cnt >= promo.usage_limit_per_user) return "คุณใช้สิทธิ์โปรโมชั่นนี้ครบจำนวนแล้ว";
  }
  return null;
}

module.exports = { calculatePromotionDiscount, checkPromotionUsageLimit };
