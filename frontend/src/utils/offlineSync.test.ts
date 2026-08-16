// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlineSync.test.ts — เทส flow ซิงค์บิลออฟไลน์เต็มเส้น (core ใน utils/offlineSync.ts)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping)
// ทำอะไร: mock deps ทั้งหมด (getAll/remove/markError/post) แล้วไล่ flow จริงของ runOfflineSync/
//   syncOfflineSales (ตัวเดียวกับที่ wrapper syncOfflineSales.ts ใช้กับ IndexedDB + api จริง):
//     • คิวว่าง → ไม่ยิง post
//     • สำเร็จทุกบิล → ลบออกจากคิว ครบ + payload ถูก whitelist (ฟิลด์แต้ม/สมาชิกไม่รั่ว — ต่อยอด
//       จาก offlinePayload.test.ts)
//     • สำเร็จบางส่วน → ลบตัวสำเร็จ / มาร์ก error ตัวพลาด (ด้วยข้อความจาก server)
//     • batch ยิงไม่ผ่านทั้งก้อน → คิวค้างครบ (ไม่ลบ ไม่มาร์ก) — ลองใหม่รอบหน้า
//     • guard กันเรียกซ้อน → ครั้งที่สองคืน null
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runOfflineSync, syncOfflineSales, type OfflineSyncDeps } from './offlineSync.ts';
import type { OfflineSale } from './offlineSalesDb.ts';

// ── mock deps (บันทึกทุกการเรียก) ──
function makeDeps(overrides: Partial<OfflineSyncDeps> = {}) {
  const calls = { getAll: 0, remove: [] as string[], markError: [] as Array<[string, string]>, post: [] as unknown[] };
  const deps: OfflineSyncDeps = {
    getAll: async () => { calls.getAll++; return []; },
    remove: async (id) => { calls.remove.push(id); },
    markError: async (id, msg) => { calls.markError.push([id, msg]); },
    post: async () => ({ data: { results: [] } }),
    ...overrides,
  };
  return { deps, calls };
}

function sale(id: string): OfflineSale {
  return {
    client_offline_id: id,
    payment_method: 'CASH',
    amount_received: 100,
    total_amount: 55,
    created_at_offline: '2026-08-15T10:00:00.000Z',
    items: [{ product_id: 3, quantity: 1, unit_price: 55 }],
  };
}

describe('runOfflineSync — flow ซิงค์บิลออฟไลน์', () => {
  test('คิวว่าง → { 0, 0, 0 } และไม่ยิง post', async () => {
    const { deps, calls } = makeDeps();
    const out = await runOfflineSync(deps);
    assert.deepEqual(out, { attempted: 0, synced: 0, failed: 0 });
    assert.equal(calls.post.length, 0);
  });

  test('✅ สำเร็จทุกบิล → ลบออกจากคิวครบ + payload ถูก whitelist (ฟิลด์แต้ม/สมาชิกไม่รั่ว)', async () => {
    // จำลอง record เสีย/เก่าที่มีฟิลด์เถื่อนปนใน item — ต้องไม่ถึง server
    const dirtySale = sale('off-1');
    (dirtySale.items as unknown[]).push({ product_id: 11, quantity: 1, unit_price: 0, redeem_reward: true, points_required: 80 });
    const { deps, calls } = makeDeps({
      getAll: async () => [dirtySale, sale('off-2')],
      post: async (_url, payload) => {
        calls.post.push(payload);
        return { data: { results: [
          { client_offline_id: 'off-1', success: true },
          { client_offline_id: 'off-2', success: true },
        ] } };
      },
    });

    const out = await runOfflineSync(deps);
    assert.deepEqual(out, { attempted: 2, synced: 2, failed: 0 });
    assert.deepEqual(calls.remove.sort(), ['off-1', 'off-2']);
    assert.equal(calls.markError.length, 0);

    // payload ต้องสะอาด: 2 บิล, item ของ off-1 เหลือ 2 รายการ แต่ทั้งคู่ไม่มี redeem_reward/points_required
    const payload = calls.post[0] as { sales: Array<{ items: Array<Record<string, unknown>>; client_offline_id: string }> };
    assert.equal(payload.sales.length, 2);
    for (const s of payload.sales) {
      for (const it of s.items) {
        assert.ok(!('redeem_reward' in it), 'redeem_reward ต้องไม่รั่วขึ้น server');
        assert.ok(!('points_required' in it), 'points_required ต้องไม่รั่วขึ้น server');
      }
    }
    assert.deepEqual(Object.keys(payload.sales[0]).sort(), [
      'amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount',
    ]);
  });

  test('สำเร็จบางส่วน → ลบตัวสำเร็จ + มาร์ก error ตัวพลาดด้วยข้อความจาก server', async () => {
    const { deps, calls } = makeDeps({
      getAll: async () => [sale('a'), sale('b'), sale('c')],
      post: async () => ({ data: { results: [
        { client_offline_id: 'a', success: true },
        { client_offline_id: 'b', success: false, error: 'สต๊อกไม่เพียงพอ ณ เวลาซิงค์' },
        { client_offline_id: 'c', success: false }, // ไม่มี error → ใช้ข้อความ default
      ] } }),
    });

    const out = await runOfflineSync(deps);
    assert.deepEqual(out, { attempted: 3, synced: 1, failed: 2 });
    assert.deepEqual(calls.remove, ['a']);
    assert.deepEqual(calls.markError, [
      ['b', 'สต๊อกไม่เพียงพอ ณ เวลาซิงค์'],
      ['c', 'ซิงค์ไม่สำเร็จ'],
    ]);
  });

  test('🚫 batch ยิงไม่ผ่านทั้งก้อน (เน็ตหลุดกลางทาง) → คิวค้างครบ ไม่ลบ ไม่มาร์ก', async () => {
    const { deps, calls } = makeDeps({
      getAll: async () => [sale('a'), sale('b')],
      post: async () => { throw new Error('network down'); },
    });

    const out = await runOfflineSync(deps);
    assert.deepEqual(out, { attempted: 2, synced: 0, failed: 2 });
    assert.deepEqual(calls.remove, []);
    assert.deepEqual(calls.markError, []);
  });

  test('server คืน results ว่าง/ไม่มี → นับเป็น 0 สำเร็จ 0 พลาด (attempted ตามคิว)', async () => {
    const { deps } = makeDeps({
      getAll: async () => [sale('a')],
      post: async () => ({ data: {} }),
    });
    const out = await runOfflineSync(deps);
    assert.deepEqual(out, { attempted: 1, synced: 0, failed: 0 });
  });
});

describe('syncOfflineSales — guard กันเรียกซ้อน', () => {
  test('เรียกซ้อน (ครั้งแรกยังไม่จบ) → ครั้งที่สองคืน null', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { deps } = makeDeps({
      getAll: async () => [sale('a')],
      post: async () => { await gate; return { data: { results: [{ client_offline_id: 'a', success: true }] } }; },
    });

    const first = syncOfflineSales(deps); // ยังค้างที่ post (รอ gate)
    const second = syncOfflineSales(deps); // ต้องคืน null ทันที (guard)
    assert.equal(await second, null);

    release();
    const firstResult = await first;
    assert.deepEqual(firstResult, { attempted: 1, synced: 1, failed: 0 });
  });

  test('หลังจบรอบก่อน → เรียกใหม่ได้ปกติ (guard ปลดล็อกใน finally)', async () => {
    const { deps } = makeDeps({ getAll: async () => [] });
    assert.deepEqual(await syncOfflineSales(deps), { attempted: 0, synced: 0, failed: 0 });
    assert.deepEqual(await syncOfflineSales(deps), { attempted: 0, synced: 0, failed: 0 });
  });
});
