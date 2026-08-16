// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/requestQueue.test.ts — เทสความเที่ยงตรงของคิว request ทั่วไป (localStorage)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping)
// ทำอะไร: ต่างจากบิลออฟไลน์ (offlinePayload — ต้อง whitelist ตัดฟิลด์แต้ม/สมาชิกทิ้ง) คิวนี้
//   เก็บ payload **เต็มรูปแบบตามที่ส่ง** เพราะสัญญาของคิวคือ \"replay mutation เดิมทุกอย่าง
//   เป๊ะ\" — ฟิลด์ member_id/redeem_points/redeem_reward เป็นส่วน legit ของ payload checkout
//   ที่ต้องส่งซ้ำตอน replay (backend ตรวจแต้ม/สต๊อกใหม่ตอน replay + idempotency-key กันซ้ำ)
//   ถ้า whitelist ตรงนี้จะทำให้ retry ผิดพลาด (บิลที่ควรมีแต้มถูกตัดทิ้ง) — เทสนี้จึงยืนยัน
//   round-trip **คงข้อมูลเดิม 100%** (ไม่ตัด ไม่เติม ไม่เพี้ยน)
//
// ครอบ: save → getQueue ได้ payload+headers เดิมเป๊ะ, FIFO, retries เริ่ม 0 / increment,
//   remove ตาม index, คิวว่าง → []
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { saveRequestToQueue, getQueue, removeFromQueue, incrementRetries, MAX_RETRIES } from './requestQueue.ts';

// ── localStorage จำลอง (สไตล์เดียวกับ queueProcessor.test.ts) ──
interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function freshLocalStorage(): void {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    } satisfies FakeStorage,
    configurable: true,
    writable: true,
  });
}

// payload checkout ที่มีฟิลด์แต้ม/สมาชิก (legit — ต้องถูกเก็บทั้งชุดเพื่อ replay ให้ตรง)
const checkoutPayload = {
  cashier_id: 1,
  member_id: 7,
  promotion_id: 3,
  redeem_points: 20,
  payment_method: 'CASH',
  amount_received: 100,
  items: [
    { product_id: 3, quantity: 1 },
    { product_id: 11, quantity: 1, redeem_reward: true },
  ],
};

describe('requestQueue (localStorage) — เก็บ payload ครบเพื่อ replay เดิมเป๊ะ', () => {
  test('✅ save → getQueue: payload + headers กลับมาเหมือนเดิม 100% (รวม member_id/redeem_reward)', () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/api/sales/checkout', checkoutPayload, { 'X-CSRF-Token': 'abc', 'idempotency-key': 'key-1' });
    const [q] = getQueue();
    assert.equal(q.method, 'POST');
    assert.equal(q.url, '/api/sales/checkout');
    assert.deepEqual(q.data, checkoutPayload); // ฟิลด์แต้ม/สมาชิกต้องอยู่ครบ (สัญญา replay)
    assert.deepEqual(q.headers, { 'X-CSRF-Token': 'abc', 'idempotency-key': 'key-1' });
    assert.equal(q.retries, 0);
    assert.ok(typeof q.timestamp === 'number');
  });

  test('✅ FIFO: เก็บหลาย request → อ่านกลับตามลำดับที่เก็บ (replay เรียงถูก)', () => {
    freshLocalStorage();
    saveRequestToQueue('PUT', '/api/orders/5/status', { status: 'READY' }, {});
    saveRequestToQueue('POST', '/api/attendance/check-in', { shift_id: 9 }, {});
    saveRequestToQueue('DELETE', '/api/categories/2', undefined, {});
    const queue = getQueue();
    assert.deepEqual(queue.map(q => `${q.method} ${q.url}`), [
      'PUT /api/orders/5/status',
      'POST /api/attendance/check-in',
      'DELETE /api/categories/2',
    ]);
  });

  test('✅ retries: เริ่ม 0 → incrementRetries เพิ่มทีละ 1 (กันยิงซ้ำเกิน MAX_RETRIES)', () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/api/x', {}, {});
    assert.equal(getQueue()[0].retries, 0);
    incrementRetries(0);
    incrementRetries(0);
    assert.equal(getQueue()[0].retries, 2);
    assert.equal(MAX_RETRIES, 3);
  });

  test('✅ removeFromQueue: ลบตาม index (ตัวอื่นอยู่ครบ ลำดับไม่เปลี่ยน)', () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/a', {}, {});
    saveRequestToQueue('POST', '/b', {}, {});
    saveRequestToQueue('POST', '/c', {}, {});
    removeFromQueue(1);
    assert.deepEqual(getQueue().map(q => q.url), ['/a', '/c']);
  });

  test('✅ ข้อมูลผ่าน JSON round-trip จริง (localStorage เก็บ string — กัน encode/parse เพี้ยน)', () => {
    freshLocalStorage();
    const nested = { items: [{ product_id: 11, quantity: 2, redeem_reward: true }], note: 'กดซ้ำ 2 ครั้ง' };
    saveRequestToQueue('POST', '/api/orders', nested, {});
    const parsed = getQueue();
    assert.deepEqual(parsed[0].data, nested);
  });

  test('คิวว่าง → []', () => {
    freshLocalStorage();
    assert.deepEqual(getQueue(), []);
  });
});
