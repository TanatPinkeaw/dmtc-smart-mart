// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlinePayload.test.ts — เทสกันฟิลด์แต้ม/สมาชิก/UI รั่วออกจาก payload บิลออฟไลน์
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping)
// ทำอะไร: ยืนยัน payload ที่ syncOfflineSales.ts ยิงไป /api/sales/sync-offline มีแค่ฟิลด์ที่
//   backend รับ (syncOfflineValidator) — ครอบ 2 จุดที่ผู้ใช้กังวล:
//     - ตอนสร้าง:  POS.tsx (handleOfflineCheckout) map items เหลือ 3 ฟิลด์ ไม่คัด redeem_reward
//     - ตอน replay: buildSyncOfflinePayload (syncOfflineSales.ts ใช้) whitelist + re-map items
//   เทสด้านล่างจำลอง record ที่มีฟิลด์เถื่อนปน (record เก่า/แก้มือ) พิสูจน์ว่าไม่มีทางหลุดขึ้น server
//   (ฝั่ง backend มีเทสคู่กัน: tests/syncOfflineContract.test.js ยืนยัน validator strip ทิ้งเป็นชั้น 2)
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildSyncOfflinePayload } from './offlinePayload.ts';
import type { OfflineSale } from './offlineSalesDb.ts';

// ── ตัวช่วย ──
function makeSale(overrides: Partial<OfflineSale> = {}): OfflineSale {
  return {
    client_offline_id: 'uuid-001',
    payment_method: 'CASH',
    amount_received: 100,
    total_amount: 55,
    created_at_offline: '2026-08-15T10:00:00.000Z',
    items: [{ product_id: 3, quantity: 1, unit_price: 55 }],
    ...overrides,
  };
}

describe('buildSyncOfflinePayload (replay → /api/sales/sync-offline)', () => {
  test('✅ payload ปกติ: มีแค่ 6 ฟิลด์ที่ backend รับ + items 3 ฟิลด์เป๊ะ (ไม่มี field เกิน)', () => {
    const payload = buildSyncOfflinePayload([makeSale()]);
    assert.deepEqual(Object.keys(payload.sales[0]).sort(), [
      'amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount',
    ]);
    assert.deepEqual(Object.keys(payload.sales[0].items[0]).sort(), ['product_id', 'quantity', 'unit_price']);
    assert.deepEqual(payload.sales[0].items[0], { product_id: 3, quantity: 1, unit_price: 55 });
  });

  test('🚫 ฟิลด์แต้ม/สมาชิกที่หลุดมาใน item (record เก่า/แก้มือ) → ถูก re-map ตัดทิ้งก่อนส่ง (เกราะ 2)', () => {
    // จำลอง record ที่มีฟิลด์เถื่อนปน (แม้ POS จะไม่สร้างแบบนี้ ก็ต้องกันไว้)
    const dirty = makeSale({
      items: [
        { product_id: 11, quantity: 1, unit_price: 0, redeem_reward: true, points_required: 80 },
      ] as unknown as OfflineSale['items'],
    });
    const payload = buildSyncOfflinePayload([dirty]);
    assert.deepEqual(payload.sales[0].items, [{ product_id: 11, quantity: 1, unit_price: 0 }]);
    assert.ok(!('redeem_reward' in payload.sales[0].items[0]), 'redeem_reward ต้องไม่มี');
    assert.ok(!('points_required' in payload.sales[0].items[0]), 'points_required ต้องไม่มี');
  });

  test('🚫 ฟิลด์ client-only (cashier_name/item_names/sync_error) + member/promo → ไม่ถูกส่งขึ้น server', () => {
    // จำลอง record เสีย/เก่าที่มี field เกิน (member_id/promotion_id/redeem_points ไม่มีใน OfflineSale
    // type เลย — ต้อง cast ข้าม ตามเจตนาเทสนี้คือ "ฟิลด์เถื่อนหลุดมาใน record จริง")
    const dirtyOverrides: Record<string, unknown> = {
      cashier_name: 'สมชาย',
      item_names: [{ name: 'ชา', quantity: 1, price: 55 }],
      sync_error: 'สต๊อกไม่พอ',
      member_id: 7,
      promotion_id: 3,
      redeem_points: 10,
    };
    const dirty = makeSale(dirtyOverrides as unknown as Partial<OfflineSale>);
    const sale = buildSyncOfflinePayload([dirty]).sales[0];
    assert.deepEqual(Object.keys(sale).sort(), [
      'amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount',
    ]);
  });

  test('batch หลายบิล: ทุกบิลถูก whitelist เหมือนกัน ไม่มีบิลไหนรั่ว', () => {
    const payload = buildSyncOfflinePayload([
      makeSale({ client_offline_id: 'a' }),
      makeSale({ client_offline_id: 'b', items: [{ product_id: 1, quantity: 2, unit_price: 10, redeem_reward: true } as never] }),
    ]);
    assert.equal(payload.sales.length, 2);
    for (const s of payload.sales) {
      assert.deepEqual(Object.keys(s).sort(), [
        'amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount',
      ]);
    }
    assert.deepEqual(payload.sales[1].items, [{ product_id: 1, quantity: 2, unit_price: 10 }]);
  });

  test('ไม่ mutate ตัว input (record เดิมใน IndexedDB ไม่ถูกแก้)', () => {
    const original = makeSale({
      items: [{ product_id: 11, quantity: 1, unit_price: 0, redeem_reward: true } as never],
    });
    const snapshot = JSON.stringify(original);
    buildSyncOfflinePayload([original]);
    assert.equal(JSON.stringify(original), snapshot);
  });

  test('คิวว่าง → payload { sales: [] } (syncOfflineSales ตรวจ pending.length ก่อนแล้ว — กันไว้)', () => {
    assert.deepEqual(buildSyncOfflinePayload([]), { sales: [] });
  });
});
