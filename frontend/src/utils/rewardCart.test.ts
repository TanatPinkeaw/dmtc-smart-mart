// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/rewardCart.test.ts — เทส regression โฟลวแลกของรางวัลฝั่ง client (POS + RewardModal)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — ไม่ต้องติดตั้ง vitest/jest)
// ทำอะไร: เทส pure functions ใน utils/rewardCart.ts ที่ถูกย้ายออกจาก POS.tsx (addRewardToCart/
//   rewardPointsUsed/availableForCash) และ RewardModal.tsx (canAfford) — กันบัคแลกของรางวัล
//   กลับมา: เพิ่มซ้ำ, ใช้แต้มซ้ำ (ของรางวัล + ส่วนลดเงินสด), แต้มไม่พอ
//
// ฝั่ง backend มีเทสคู่กัน: tests/rewardRedemption.test.js (server.js ยิงลอจิกนั้นจริง) —
//   ตรงนี้คือ UI logic (แสดงผล/ปุ่ม) เท่านั้น ไม่ใช่ source of truth
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  canAffordReward,
  addRewardToCart,
  computeRewardPointsUsed,
  availableForCashDiscount,
  type RewardCartLine,
  type RewardPick,
} from './rewardCart.ts';

// ── ตัวช่วย ──
const rewardA: RewardPick = { id: 11, name: 'ตุ๊กตาหมี', image_url: null, points_required: 80 };
const rewardB: RewardPick = { id: 12, name: 'แก้วน้ำ', image_url: null, points_required: 50 };
const normalLine: RewardCartLine = { id: 3, quantity: 2, redeem_reward: false };

// makeLine เดียวกับ POS.tsx (สร้างบรรทัด CartItem ราคา 0 ติดธง redeem_reward)
function makeLine(r: RewardPick): RewardCartLine {
  return { id: r.id, quantity: 1, redeem_reward: true, points_required: r.points_required };
}

describe('canAffordReward (ปุ่ม "แลก" ใน RewardModal)', () => {
  test('แต้มพอ → กดได้', () => {
    assert.equal(canAffordReward(100, 80), true);
  });

  test('แต้มพอเป๊ะ → กดได้', () => {
    assert.equal(canAffordReward(80, 80), true);
  });

  test('🚫 แต้มไม่พอ → ปุ่ม disabled ("แต้มไม่พอ")', () => {
    assert.equal(canAffordReward(79, 80), false);
  });

  test('⭐️ แต้มเหลือน้อยลงหลังแลกไปแล้ว (POS ส่งแต้มที่เหลือ) → ของที่เกินปิด disabled', () => {
    // สมาชิกมี 120 แต้ม แลก A (80) ไปแล้ว → เหลือ 40 → B (50) แต้มไม่พอ
    assert.equal(canAffordReward(40, 50), false);
  });
});

describe('addRewardToCart (เพิ่มของรางวัลลงตะกร้า — กันเพิ่มซ้ำ)', () => {
  test('เพิ่มของรางวัลใหม่: ได้บรรทัดราคา 0 ติดธง redeem_reward', () => {
    const out = addRewardToCart([], rewardA, makeLine);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { id: 11, quantity: 1, redeem_reward: true, points_required: 80 });
  });

  test('🚫 กันเพิ่มซ้ำ: รายการเดิมที่ติดธงแล้ว → ตะกร้าไม่เปลี่ยน (เดิมเคยเพิ่มซ้ำได้ = แลกของรางวัล 2 ชิ้นคิดแต้ม 2 เท่า)', () => {
    const cart = addRewardToCart([], rewardA, makeLine);
    const again = addRewardToCart(cart, rewardA, makeLine);
    assert.equal(again.length, 1);
  });

  test('ของรางวัลคนละชิ้น → เพิ่มได้ทั้งคู่ (ไม่ใช่ของซ้ำ)', () => {
    const cart = addRewardToCart([], rewardA, makeLine);
    const both = addRewardToCart(cart, rewardB, makeLine);
    assert.equal(both.length, 2);
  });

  test('บรรทัดสินค้าปกติ (ไม่ติดธง) ไม่บล็อกการเพิ่มของรางวัล id เดียวกัน', () => {
    const cart = addRewardToCart([normalLine], rewardA, makeLine);
    assert.equal(cart.length, 2);
  });
});

describe('computeRewardPointsUsed (แต้มที่จองไว้แลกของรางวัลในบิลนี้)', () => {
  test('ของรางวัล 1 ชิ้น 80 แต้ม → 80', () => {
    assert.equal(computeRewardPointsUsed([makeLine(rewardA)]), 80);
  });

  test('quantity > 1: 2 ชิ้น × 80 = 160', () => {
    assert.equal(computeRewardPointsUsed([{ ...makeLine(rewardA), quantity: 2 }]), 160);
  });

  test('ของรางวัลหลายชิ้นรวมกัน: 80 + 50×2 = 180', () => {
    assert.equal(computeRewardPointsUsed([makeLine(rewardA), { ...makeLine(rewardB), quantity: 2 }]), 180);
  });

  test('สินค้าปกติไม่นับ: ตะกร้าผสมชา 2 ชิ้น + ของรางวัล 80 → 80 เท่านั้น', () => {
    assert.equal(computeRewardPointsUsed([normalLine, makeLine(rewardA)]), 80);
  });

  test('ตะกร้าว่าง / ไม่มีของรางวัล → 0', () => {
    assert.equal(computeRewardPointsUsed([]), 0);
    assert.equal(computeRewardPointsUsed([normalLine]), 0);
  });
});

describe('availableForCashDiscount (กันใช้แต้มซ้ำ — เหลือค่อยแลกส่วนลดเงินสด)', () => {
  test('ไม่มีของรางวัล: ใช้แลกส่วนลดได้เต็มยอด', () => {
    assert.equal(availableForCashDiscount(120, 0), 120);
  });

  test('หักของรางวัลออกก่อน: 120 แต้ม − 80 (ของรางวัล) = เหลือ 40', () => {
    assert.equal(availableForCashDiscount(120, 80), 40);
  });

  test('🚫 แต้มไม่ติดลบ: ของรางวัล > ยอดแต้ม → เหลือ 0 (ไม่ใช่เลขลบที่แลกส่วนลดเงินสดไม่ได้)', () => {
    assert.equal(availableForCashDiscount(60, 80), 0);
  });
});

describe('จำลอง flow หน้า POS (RewardModal + ตะกร้า) — แต้ม 120', () => {
  test('⭐️ แลก A ไปแล้ว เหลือ 40 → B (50 แต้ม) โดน disable + แลกส่วนลดเงินสดได้แค่ 40 แต้ม', () => {
    // สมาชิกมี 120 แต้ม
    let remaining = availableForCashDiscount(120, computeRewardPointsUsed([]));
    assert.equal(remaining, 120);

    // RewardModal: A ราคา 80 → พอ แลกได้
    assert.equal(canAffordReward(remaining, rewardA.points_required), true);

    // เพิ่ม A ลงตะกร้า
    const cart = addRewardToCart([], rewardA, makeLine);

    // แต้มเหลือ = 120 − 80 = 40
    remaining = availableForCashDiscount(120, computeRewardPointsUsed(cart));
    assert.equal(remaining, 40);

    // RewardModal เปิดใหม่: B (50 แต้ม) ไม่พอ → ปุ่ม disabled (กัน cashier เพิ่มจน checkout พัง)
    assert.equal(canAffordReward(remaining, rewardB.points_required), false);

    // แต้มที่ใช้แลกส่วนลดเงินสดได้สูงสุด = 40 (ไม่ใช่ 120 — กันใช้แต้มซ้ำ)
    assert.equal(remaining, 40);
  });

  test('🚫 แต้มสมาชิกน้อยกว่าของรางวัลรวม: เปิด modal ตั้งแต่แรกก็ disabled (แต้มไม่พอกรณีเดี่ยว)', () => {
    const remaining = availableForCashDiscount(40, computeRewardPointsUsed([]));
    assert.equal(canAffordReward(remaining, rewardA.points_required), false);
  });
});
