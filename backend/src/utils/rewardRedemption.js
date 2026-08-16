// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/rewardRedemption.js — ลอจิกแลกของรางวัล/แต้มตอน checkout (pure functions)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องแยกไฟล์: ลอจิกนี้เดิมอยู่กลาง route POST /api/sales/checkout ใน server.js — เทส
//   หน่วยไม่ได้เพราะต้องเปิด DB จริง (pool/connection) แยกเป็น pure function แบบนี้แล้ว
//   (pattern เดียวกับ memberGroupUpdate.js / idempotency.js / queueProcessor) มีเทส
//   regression ครอบทุกกรณี: แต้มไม่พอ / ของรางวัลหมดสต๊อก / ส่ง redeem_reward กับสินค้า
//   ธรรมดา / กันใช้แต้มซ้ำ (ของรางวัลหักก่อน เหลือค่อยแลกส่วนลดเงินสด)
//
// หมายเหตุสำคัญ: ฝั่งนี้คือ "decision logic" เท่านั้น — การล็อกแถว (FOR UPDATE), SELECT สินค้า,
//   UPDATE points/stock ยังอยู่ที่ route ใน server.js (ต้องอยู่ใกล้ transaction เดียวกับบิล)
//   ฟังก์ชันตรงนี้รับค่าที่ route อ่านมาแล้ว คืนผล/โยน Error — route จัดการ rollback เอง
// ═══════════════════════════════════════════════════════════════════════════════════
const { toSatang, fromSatang } = require('./money');

// ── 1. ประเมินรายการแลกของรางวัล 1 รายการ (อยู่ในลูปตรวจรายการสินค้าตอน checkout) ──
//    คืน { need, processedItem } หรือโยน Error ถ้า invalid:
//      - ไม่ได้เลือกสมาชิก          → 'ต้องเลือกสมาชิกก่อนแลกของรางวัล'
//      - สินค้าไม่ใช่ของรางวัลจริง   → 'สินค้านี้ไม่ใช่ของรางวัล: {name}'
//        (server-side truth — กัน client ปลอมส่ง redeem_reward:true กับสินค้าธรรมดา)
//    ราคาเงินสด = 0 เสมอ จ่ายด้วยแต้มเท่านั้น ไม่คิดส่วนลด/ไม่ได้แต้มสะสม
function evaluateRewardItem({ item, product, memberId }) {
  if (!memberId) throw new Error('ต้องเลือกสมาชิกก่อนแลกของรางวัล');
  if (!product.is_reward_item) throw new Error(`สินค้านี้ไม่ใช่ของรางวัล: ${product.name}`);
  const need = (Number(product.points_required) || 0) * item.quantity;
  return {
    need,
    processedItem: {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: 0,
      subtotal: 0,
      stock_before: product.stock,
      redeemed_with_points: true,
      reward_points: need,
    },
  };
}

// ── 2. เช็คสต๊อกรายการ (ครอบของรางวัลด้วย — ของรางวัลหมดสต๊อก = โดน 400 issues เดียวกับสินค้าทั่วไป) ──
//    คืน issue object ถ้าไม่พอ (caller รวมเข้า stockIssues → ตอบ 400 หลังวนครบ) หรือ null ถ้าพอ
function checkItemStock({ product, quantity, productId }) {
  if (product.stock < quantity) {
    return {
      product_id: productId,
      product_name: product.name,
      requested: quantity,
      available: product.stock,
    };
  }
  return null;
}

// ── 3. คำนวณแต้มที่ใช้ตอน settle (route ล็อกแถวสมาชิก FOR UPDATE แล้ว — ตรงนี้เป็น pure) ──
//    คืน { rewardPoints, pointsRedeemed, pointsDiscount, netTotalSatang }
//    ⭐️ กันใช้แต้มซ้ำ: ของรางวัลหักจากยอดแต้มก่อน 100% (ไม่พอ = ยกเลิกทั้งบิลด้วย Error)
//      แล้วค่อยแลกส่วนลดเงินสดจากแต้มที่เหลือ — แต้ม 1 จุดไม่สามารถจ่าย 2 อย่างได้
//    cap ส่วนลดเงินสดด้วย 3 อย่าง: จำนวนที่ขอ (redeemPoints), แต้มเหลือ, floor(ยอดบิล/อัตราแลก)
function settleRewardPoints({ memberPoints, rewardPointsNeeded, redeemPoints, redeemRate, netTotalSatang }) {
  let rewardPoints = 0;
  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  let availablePoints = Number(memberPoints) || 0;

  // ของรางวัลก่อน — ต้องมีแต้มครบเต็มจำนวน ไม่งั้นยกเลิกทั้งบิล
  if (rewardPointsNeeded > 0) {
    if (availablePoints < rewardPointsNeeded) throw new Error('แต้มสะสมไม่พอสำหรับแลกของรางวัล');
    rewardPoints = rewardPointsNeeded;
    availablePoints -= rewardPoints;
  }

  // แลกเป็นส่วนลดเงินสดจากแต้มที่เหลือ — cap ด้วย (แต้มเหลือ) และ (ยอดบิล/อัตราแลก)
  if (redeemPoints > 0) {
    const netTotal = fromSatang(netTotalSatang);
    const maxByBill = Math.floor(netTotal / redeemRate);
    pointsRedeemed = Math.min(Number(redeemPoints), availablePoints, maxByBill);
    if (pointsRedeemed < 0) pointsRedeemed = 0;
    pointsDiscount = fromSatang(toSatang(pointsRedeemed * redeemRate)); // ปัดเป็นสตางค์
    netTotalSatang -= toSatang(pointsDiscount);
  }

  return { rewardPoints, pointsRedeemed, pointsDiscount, netTotalSatang };
}

module.exports = { evaluateRewardItem, checkItemStock, settleRewardPoints };
