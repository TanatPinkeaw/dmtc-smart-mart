// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/rewardCart.ts — ลอจิกแลกของรางวัลฝั่ง client (pure — เทสต์ได้ ไม่ต้อง React)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: เช็คแต้มพอ (RewardModal), เพิ่มของรางวัลลงตะกร้าแบบกันซ้ำ (POS), คำนวณแต้มที่ใช้
//   ไป/เหลือสำหรับแลกส่วนลดเงินสด (กันใช้แต้มซ้ำ 1 จุดจ่าย 2 อย่าง)
//
// ⚠️ ตรงนี้คือ UI logic เท่านั้น — ไม่ใช่ source of truth ฝั่ง server คิดแต้ม/ยอดใหม่เสมอ
//   (backend/src/utils/rewardRedemption.js — เทส regression ครอบกรณีแต้มไม่พอ/ใช้แต้มซ้ำ)
//   ที่แยกออกมาให้เทสต์ได้: เดิม logic นี้ฝังใน POS.tsx (addRewardToCart + rewardPointsUsed +
//   availableForCash) กับ RewardModal.tsx (canAfford) — ย้ายมาอยู่ที่เดียว กันดริฟต์
// ═══════════════════════════════════════════════════════════════════════════════════

// รูปร่างขั้นต่ำของบรรทัดในตะกร้าที่เกี่ยวข้องกับของรางวัล
export interface RewardCartLine {
  id: number;
  quantity: number;
  redeem_reward?: boolean;
  points_required?: number;
}

// ของรางวัลที่ RewardModal คืนให้ (มาจาก GET /products/rewards)
export interface RewardPick {
  id: number;
  name: string;
  image_url: string | null;
  points_required: number;
}

// RewardModal: แต้มพอแลกของรางวัลนี้ไหม (พอ = ปุ่ม "แลก" กดได้)
export function canAffordReward(memberPoints: number, pointsRequired: number): boolean {
  return memberPoints >= pointsRequired;
}

// เพิ่มของรางวัลลงตะกร้า (ราคา 0, ติดธง redeem_reward) — กันเพิ่มรายการเดิมซ้ำเกิน 1
// makeLine เอาไว้ให้ caller สร้างบรรทัดเต็มตาม shape ของตัวเอง (POS สร้าง CartItem)
export function addRewardToCart<T extends RewardCartLine>(
  cart: T[],
  reward: RewardPick,
  makeLine: (r: RewardPick) => T,
): T[] {
  if (cart.some(i => i.id === reward.id && i.redeem_reward)) return cart; // มีอยู่แล้ว
  return [...cart, makeLine(reward)];
}

// แต้มที่ใช้แลกของรางวัลในบิลนี้ (รวมจำนวนชิ้น × points_required)
export function computeRewardPointsUsed(cart: RewardCartLine[]): number {
  return cart.reduce(
    (total, item) => total + (item.redeem_reward ? (Number(item.points_required) || 0) * item.quantity : 0),
    0,
  );
}

// แต้มเหลือที่ใช้แลกส่วนลดเงินสดได้ = ยอดรวม − แต้มที่จองไว้แลกของรางวัล (ไม่ติดลบ)
// ⭐️ กันใช้แต้มซ้ำ: แต้ม 1 จุดไม่สามารถจ่ายทั้งของรางวัลและส่วนลดเงินสด
export function availableForCashDiscount(memberPoints: number, usedForRewards: number): number {
  return Math.max(0, memberPoints - usedForRewards);
}
