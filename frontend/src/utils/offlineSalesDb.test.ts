// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlineSalesDb.test.ts — เทสที่เก็บบิลออฟไลน์ (IndexedDB) เก็บ/อ่านกลับตรง
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — ไม่ต้องติดตั้ง vitest/jest)
// ทำอะไร: ยืนยัน record ที่ saveOfflineSale เก็บ + getAllOfflineSales อ่านกลับ = ข้อมูลเดิม
//   เป๊ะ (ชั้นเก็บไม่เติม/ไม่ตัด field — การกันฟิลด์เถื่อนอยู่ที่ชั้นสร้าง payload + whitelist
//   ตอน replay: POS.tsx / offlinePayload.ts) ครอบ save/read/remove/markError/count
//
// ไม่มี IndexedDB ใน node — สร้าง fake ขั้นต่ำจำลอง API ที่ offlineSalesDb.ts ใช้
// (open/transaction/objectStore.put/get/getAll/delete + onupgradeneeded/onsuccess/oncomplete)
// สไตล์เดียวกับ createFakeStorage ใน queueProcessor.test.ts (zero dependency)
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  saveOfflineSale,
  getAllOfflineSales,
  removeOfflineSale,
  markOfflineSaleError,
  getOfflineSalesCount,
  type OfflineSale,
} from './offlineSalesDb.ts';

// ── fake IndexedDB ขั้นต่ำ (zero-dep) ───────────────────────────────────────────────
// จำลองเฉพาะ API ที่ offlineSalesDb.ts เรียก: open + onupgradeneeded/onsuccess,
// objectStoreNames.contains, createObjectStore, transaction().objectStore().put/get/getAll/delete,
// req.onsuccess, tx.oncomplete/onerror — event ยิงผ่าน queueMicrotask (async เหมือนของจริง)
class FakeObjectStore {
  private tx: FakeTx;
  private map: Map<string, unknown>;

  constructor(tx: FakeTx, map: Map<string, unknown>) {
    this.tx = tx;
    this.map = map;
  }

  put(value: Record<string, unknown>) {
    this.map.set(String(value.client_offline_id), structuredClone(value));
    const req = makeFakeRequest(undefined);
    this.tx._requestDone(); // oncomplete ต่อจาก onsuccess (markOfflineSaleError ต้อง put ก่อน resolve)
    return req;
  }

  get(key: string) {
    const req = makeFakeRequest(this.map.has(key) ? structuredClone(this.map.get(key)) : undefined);
    this.tx._requestDone();
    return req;
  }

  getAll() {
    const req = makeFakeRequest([...this.map.values()].map(v => structuredClone(v)));
    this.tx._requestDone();
    return req;
  }

  delete(key: string) {
    this.map.delete(key);
    const req = makeFakeRequest(undefined);
    this.tx._requestDone();
    return req;
  }
}

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private store: FakeObjectStore;

  constructor(map: Map<string, unknown>) {
    this.store = new FakeObjectStore(this, map);
  }

  objectStore() { return this.store; }

  // เรียกหลังทุก request — oncomplete ยิงทีละรอบ (พอสำหรับ pattern การใช้งานของ module)
  _requestDone() { queueMicrotask(() => this.oncomplete?.()); }
}

class FakeDb {
  objectStoreNames = { contains: () => true };
  createObjectStore = () => ({});
  private map: Map<string, unknown>;

  constructor(map: Map<string, unknown>) { this.map = map; }

  transaction() { return new FakeTx(this.map); }
}

interface FakeReq<T> {
  result: T;
  error: null;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onupgradeneeded: ((ev: unknown) => void) | null;
}

function makeFakeRequest<T>(result: T): FakeReq<T> {
  const req: FakeReq<T> = { result, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
  queueMicrotask(() => { req.onsuccess?.({ target: req }); });
  return req;
}

// สลับ global indexedDB เป็น fake ใหม่ (store เปล่า) — offlineSalesDb อ่าน global ตอนเรียกใช้
function installFakeIndexedDB(): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const factory = {
    open: () => {
      const req = makeFakeRequest(new FakeDb(map));
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true });
  return map;
}

// ── ตัวช่วย: บิลออฟไลน์สะอาด (ฟิลด์ตาม OfflineSale interface เป๊ะ) ──
function cleanSale(overrides: Partial<OfflineSale> = {}): OfflineSale {
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

describe('offlineSalesDb (IndexedDB) — เก็บ/อ่านกลับตรง ไม่เติมไม่ตัด field', () => {
  test('✅ save → getAll: ข้อมูลกลับมาเหมือนเดิมเป๊ะ (ชั้นเก็บไม่เติม/ไม่ตัด field)', async () => {
    installFakeIndexedDB();
    const sale = cleanSale();
    await saveOfflineSale(sale);
    const all = await getAllOfflineSales();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], sale);
  });

  test('✅ record ที่เก็บมีแค่ฟิลด์ของ OfflineSale (ไม่มีการเติม field แปลกโดยชั้นเก็บ)', async () => {
    installFakeIndexedDB();
    await saveOfflineSale(cleanSale());
    const [record] = await getAllOfflineSales();
    assert.deepEqual(Object.keys(record).sort(), [
      'amount_received', 'client_offline_id', 'created_at_offline', 'items', 'payment_method', 'total_amount',
    ]);
    assert.deepEqual(Object.keys(record.items[0]).sort(), ['product_id', 'quantity', 'unit_price']);
  });

  test('✅ DB ว่าง → getAll คืน [] และ count = 0', async () => {
    installFakeIndexedDB();
    assert.deepEqual(await getAllOfflineSales(), []);
    assert.equal(await getOfflineSalesCount(), 0);
  });

  test('✅ บันทึกหลายบิล → อ่านกลับครบ ไม่ปนกัน (dedup ด้วย client_offline_id)', async () => {
    installFakeIndexedDB();
    await saveOfflineSale(cleanSale({ client_offline_id: 'a', total_amount: 10 }));
    await saveOfflineSale(cleanSale({ client_offline_id: 'b', total_amount: 20 }));
    const all = await getAllOfflineSales();
    assert.equal(all.length, 2);
    assert.equal(await getOfflineSalesCount(), 2);
    assert.deepEqual(all.map(s => s.total_amount).sort(), [10, 20]);
  });

  test('✅ remove → บิลหาย + count ลดลง (เฉพาะตัวที่ลบ)', async () => {
    installFakeIndexedDB();
    await saveOfflineSale(cleanSale({ client_offline_id: 'a' }));
    await saveOfflineSale(cleanSale({ client_offline_id: 'b' }));
    await removeOfflineSale('a');
    const all = await getAllOfflineSales();
    assert.equal(all.length, 1);
    assert.equal(all[0].client_offline_id, 'b');
    assert.equal(await getOfflineSalesCount(), 1);
  });

  test('✅ markOfflineSaleError: ใส่ sync_error ให้บิลที่ระบุ โดย field อื่นไม่เปลี่ยน', async () => {
    installFakeIndexedDB();
    await saveOfflineSale(cleanSale({ client_offline_id: 'a' }));
    await markOfflineSaleError('a', 'สต๊อกไม่เพียงพอ ณ เวลาซิงค์');
    const [record] = await getAllOfflineSales();
    assert.equal(record.sync_error, 'สต๊อกไม่เพียงพอ ณ เวลาซิงค์');
    assert.equal(record.client_offline_id, 'a');
    assert.equal(record.total_amount, 55); // field เดิมครบ
    assert.deepEqual(record.items, [{ product_id: 3, quantity: 1, unit_price: 55 }]);
  });

  test('✅ markOfflineSaleError กับบิลที่ไม่มีอยู่ → ไม่พัง ไม่สร้าง record ใหม่', async () => {
    installFakeIndexedDB();
    await markOfflineSaleError('ไม่มีบิลนี้', 'err');
    assert.deepEqual(await getAllOfflineSales(), []);
  });

  test('✅ save ซ้ำ client_offline_id เดิม → เขียนทับ (1 record) — ตรงกับ semantics ของ keyPath', async () => {
    installFakeIndexedDB();
    await saveOfflineSale(cleanSale({ client_offline_id: 'a', total_amount: 10 }));
    await saveOfflineSale(cleanSale({ client_offline_id: 'a', total_amount: 20 }));
    const all = await getAllOfflineSales();
    assert.equal(all.length, 1);
    assert.equal(all[0].total_amount, 20);
  });
});
