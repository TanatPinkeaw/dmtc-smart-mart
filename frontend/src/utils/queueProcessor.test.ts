// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueProcessor.test.ts — เทสกันบัค offline queue กลับมาอีก
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — ไม่ต้องติดตั้ง vitest/jest)
// ทำอะไร: เทสลอจิกวนคิว (utils/queueProcessor.ts) ด้วย localStorage จำลอง + sendRequest ปลอม
//   (จำลอง axios) — ใช้ฟังก์ชันคิว "ของจริง" จาก requestQueue.ts (getQueue/removeFromQueue/
//   incrementRetries) ที่ทำงานบน localStorage จำลอง → ตรงกับพฤติกรรมจริงที่เคยเป็นบัค
//
// 🐛 บัคที่เทสนี้กันไว้ (regression): เดิม api.ts วนคิวด้วย array ตัวเดียว + i-- หลัง
//   removeFromQueue แต่ requestQueue อ่าน localStorage ใหม่ทุกครั้ง (array คนละตัว!) → i--
//   วนกลับมาประมวลผล item เดิมซ้ำ = infinite loop + ยิง request ซ้ำ (ออเดอร์/บิลซ้ำ)
//   เทส "สำเร็จทุกตัว" ด้านล่างจะ fail ทันทีถ้าบัคนั้นกลับมา (item จะถูกส่ง >1 ครั้ง)
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { processQueuedRequests, type QueueStorage } from './queueProcessor.ts';
import { getQueue, removeFromQueue, incrementRetries, saveRequestToQueue, MAX_RETRIES } from './requestQueue.ts';

// ── localStorage จำลอง (พฤติกรรมเดียวกับของจริง: อ่าน/เขียน JSON ใหม่ทุกครั้ง) ──
interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createFakeStorage(): FakeStorage {
  const store: Record<string, string> = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
  };
}

// สลับ global localStorage เป็นตัวจำลอง — requestQueue.ts อ่าน global นี้ตอนเรียกใช้
// (node รันเฉยๆ ไม่มี global localStorage ให้ — ต้องสร้างให้เอง)
function freshLocalStorage(): void {
  const storage = createFakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

// storage "ของจริง" จาก requestQueue.ts (ทำงานบน localStorage จำลองด้านบน)
const storageApi: QueueStorage = { getQueue, removeFromQueue, incrementRetries };

type FailedReport = { method: string; url: string };

describe('processQueuedRequests (offline queue)', () => {
  test('regression: success path sends each item exactly once and drains the queue (no infinite loop)', async () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/sales/checkout', { a: 1 }, {});
    saveRequestToQueue('POST', '/orders', { b: 2 }, {});
    saveRequestToQueue('PUT', '/orders/5/status', { status: 'READY' }, {});

    const sent: string[] = [];
    let reported: FailedReport[] = [];
    const failed = await processQueuedRequests(
      storageApi,
      async (config) => { sent.push(`${config.method} ${config.url}`); },
      (f) => { reported = f; },
    );

    assert.deepEqual(sent, ['POST /sales/checkout', 'POST /orders', 'PUT /orders/5/status']);
    assert.deepEqual(getQueue(), []);
    assert.deepEqual(failed, []);
    assert.deepEqual(reported, []);
  });

  test('drops items already over MAX_RETRIES at the start, reports them, still processes the rest', async () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/stale', {}, {});
    incrementRetries(0); incrementRetries(0); incrementRetries(0); // → retries = 3 (เกิน MAX_RETRIES)
    saveRequestToQueue('POST', '/fresh', {}, {});

    const sent: string[] = [];
    let reported: FailedReport[] = [];
    await processQueuedRequests(
      storageApi,
      async (config) => { sent.push(config.url); },
      (f) => { reported = f; },
    );

    assert.deepEqual(sent, ['/fresh']);
    assert.deepEqual(reported.map((r) => r.url), ['/stale']);
    assert.deepEqual(getQueue(), []);
  });

  test('permanent failure: sends exactly MAX_RETRIES times, then removes and reports', async () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/always-fails', {}, {});

    const sent: string[] = [];
    let reported: FailedReport[] = [];
    for (let round = 1; round <= 4; round++) {
      const failed = await processQueuedRequests(
        storageApi,
        async (config) => { sent.push(config.url); throw new Error('network down'); },
        (f) => { reported = f; },
      );
      assert.equal(failed.length, round === 3 ? 1 : 0, `round ${round}`);
    }

    assert.equal(sent.filter((u) => u === '/always-fails').length, MAX_RETRIES);
    assert.deepEqual(getQueue(), []);
    assert.deepEqual(reported.map((r) => r.url), ['/always-fails']);
  });

  test('mixed: failed item stays queued with retries+1, no premature report', async () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/ok', {}, {});
    saveRequestToQueue('POST', '/flaky', {}, {});

    const sent: string[] = [];
    let reported: FailedReport[] = [];
    const failed = await processQueuedRequests(
      storageApi,
      async (config) => {
        sent.push(config.url);
        if (config.url === '/flaky') throw new Error('boom');
      },
      (f) => { reported = f; },
    );

    assert.deepEqual(sent, ['/ok', '/flaky']);
    assert.deepEqual(failed, []);
    assert.deepEqual(reported, []);

    const queue = getQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].url, '/flaky');
    assert.equal(queue[0].retries, 1);
  });

  test('aggregates ALL permanently failed items into one callback', async () => {
    freshLocalStorage();
    saveRequestToQueue('POST', '/a', {}, {});
    incrementRetries(0); incrementRetries(0); incrementRetries(0); // a → เกิน MAX_RETRIES
    saveRequestToQueue('POST', '/b', {}, {});
    incrementRetries(1); incrementRetries(1); incrementRetries(1); // b → เกิน MAX_RETRIES
    saveRequestToQueue('POST', '/c', {}, {}); // c → ยังไม่เกิน

    let reported: FailedReport[] = [];
    await processQueuedRequests(
      storageApi,
      async () => { throw new Error('offline'); }, // c fail 1 ครั้ง → ยังอยู่ในคิว
      (f) => { reported = f; },
    );

    assert.deepEqual(reported.map((r) => r.url), ['/a', '/b']);
    assert.deepEqual(getQueue().map((r) => r.url), ['/c']);
  });

  test('MAX_RETRIES stays 3 (tests assume this value)', () => {
    assert.equal(MAX_RETRIES, 3);
  });
});
