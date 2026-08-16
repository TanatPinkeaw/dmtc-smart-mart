// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/syncOfflineContract.test.js — ชั้น 4 (backend): validator ตัดฟิลด์แต้ม/สมาชิกทิ้ง
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ยืนยันว่า syncOfflineValidator + validateRequest (stripUnknown: true) ตัดฟิลด์ที่
//   ไม่ใช่ของบิลออฟไลน์ (redeem_reward / member_id / promotion_id / redeem_points) ออกจาก
//   payload — เป็นเกราะสุดท้าย ต่อจากฝั่ง client (POS สร้าง + buildSyncOfflinePayload whitelist)
//   ครอบกรณี record เก่า/แก้มือที่ฟิลด์เถื่อนหลุดมาถึง server แล้ว
//   (เทสฝั่ง client: frontend/src/utils/offlinePayload.test.ts)
//
// พิสูจน์ด้วย option เดียวกับ middleware จริง: { abortEarly: false, stripUnknown: true }
//   (validateRequest ใน server.js:296) — ถ้าใครแก้ validator ให้รับ/ปล่อยฟิลด์พวกนี้ เทสจะ fail
// รันด้วย: npm run test:sync-offline
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const { strict: assert } = require('node:assert');
const { syncOfflineValidator } = require('../src/validators');

// option เดียวกับ validateRequest ใน server.js
const validate = (body) => syncOfflineValidator.validate(body, { abortEarly: false, stripUnknown: true });

const validSale = {
  client_offline_id: 'uuid-001',
  payment_method: 'CASH',
  amount_received: 100,
  total_amount: 55,
  created_at_offline: '2026-08-15T10:00:00.000Z',
  items: [{ product_id: 3, quantity: 1, unit_price: 55 }],
};

describe('syncOfflineValidator — ป้องกันฟิลด์แต้ม/สมาชิกหลุดเข้าบิลออฟไลน์', () => {
  test('payload ปกติ → ผ่าน และ items มีแค่ product_id/quantity/unit_price', () => {
    const r = validate({ sales: [validSale] });
    assert.ok(!r.error, 'payload ถูกต้องต้องไม่มี error (Joi คืน error=undefined เมื่อผ่าน)');
    assert.deepEqual(Object.keys(r.value.sales[0].items[0]).sort(), ['product_id', 'quantity', 'unit_price']);
  });

  test('🚫 item มี redeem_reward/points_required → strip ทิ้ง (ผ่าน ไม่มี error และ field หาย)', () => {
    const r = validate({
      sales: [{ ...validSale, items: [{ product_id: 11, quantity: 1, unit_price: 0, redeem_reward: true, points_required: 80 }] }],
    });
    assert.ok(!r.error, 'ฟิลด์เถื่อนต้องไม่ทำให้ payload ตก — strip แทน');
    assert.deepEqual(r.value.sales[0].items[0], { product_id: 11, quantity: 1, unit_price: 0 });
    assert.ok(!('redeem_reward' in r.value.sales[0].items[0]));
    assert.ok(!('points_required' in r.value.sales[0].items[0]));
  });

  test('🚫 ระดับ sale มี member_id/promotion_id/redeem_points/cashier_name → strip ทิ้ง', () => {
    const r = validate({
      sales: [{ ...validSale, member_id: 7, promotion_id: 3, redeem_points: 10, cashier_name: 'สมชาย' }],
    });
    assert.ok(!r.error);
    const keys = Object.keys(r.value.sales[0]).sort();
    assert.deepEqual(keys, ['amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount']);
  });

  test('rules พื้นฐานยังเข้ม: quantity=0 / ไม่มี client_offline_id → ไม่ผ่าน', () => {
    assert.ok(validate({ sales: [{ ...validSale, items: [{ product_id: 1, quantity: 0, unit_price: 10 }] }] }).error);
    assert.ok(validate({ sales: [{ ...validSale, client_offline_id: undefined }] }).error);
  });
});
