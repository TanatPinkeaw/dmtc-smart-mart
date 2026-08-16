// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueDrainContract.test.ts — เทส wiring การ replay คิวออฟไลน์ใน api.ts
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — อ่าน source api.ts ด้วย fs ไม่ import)
// ทำอะไร: กัน "จุดเรียก processQueuedRequests" ถูกแก้/ลบ/เพิ่มโดยไม่ตั้งใจ:
//   • ต้องมีจุดเรียกเดียว (เดียวกับที่โค้ดจริงมี — listener 'online')
//   • อยู่ใน listener 'online' + หลัง guard browser (SSR ไม่พัง)
//   • ส่ง storage จริง + api.request + MAX_RETRIES ครบ
//   • ⭐️ onPermanentlyFailed ต้องแจ้งเตือนผู้ใช้จริง (Swal warning "มีรายการที่ส่งไม่สำเร็จ"
//     + บอกให้ตรวจสอบ/ทำรายการใหม่) — ถ้าใครแก้ให้เงียบๆ (callback เปล่า/console เท่านั้น)
//     เทสนี้ fail ทันที
//   • isProcessingQueue ล็อกระหว่าง replay (กัน request ใหม่เข้าคิวซ้ำ)
//   • describeQueuedRequest ถูก import จาก utils/queueLabels (ไม่นิยามซ้ำใน api.ts)
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api.ts'), 'utf8');

describe('api.ts — wiring replay คิวออฟไลน์ (regression)', () => {
  test('เรียก processQueuedRequests แค่จุดเดียว', () => {
    const calls = (apiSrc.match(/processQueuedRequests\(/g) || []).length;
    assert.equal(calls, 1, `ต้องมีจุดเรียกเดียว (ตอนนี้: ${calls}) — เพิ่มจุดเรียกต้องเพิ่มเทสให้ครบ`);
  });

  test('อยู่ใน listener "online" + หลัง guard browser (SSR ปลอดภัย)', () => {
    const guardIdx = apiSrc.indexOf("typeof window !== 'undefined'");
    const listenerIdx = apiSrc.indexOf("window.addEventListener('online'");
    const callIdx = apiSrc.indexOf('processQueuedRequests(');
    assert.ok(guardIdx >= 0 && guardIdx < listenerIdx, 'ต้องมี guard browser ครอบ listener');
    assert.ok(listenerIdx < callIdx, 'จุดเรียกต้องอยู่ใน listener online');
  });

  test('wiring ครบ: storage จริง + api.request + MAX_RETRIES', () => {
    const callStart = apiSrc.indexOf('processQueuedRequests(');
    const callEnd = apiSrc.indexOf('isProcessingQueue = false;', callStart);
    const block = apiSrc.slice(callStart, callEnd);
    for (const token of [
      '{ getQueue, removeFromQueue, incrementRetries }',
      '(config) => api.request(config)',
      'MAX_RETRIES',
      'describeQueuedRequest',
    ]) {
      assert.ok(block.includes(token), `จุดเรียกต้องมี: ${token}`);
    }
  });

  test('⭐️ onPermanentlyFailed แจ้งเตือนผู้ใช้จริง (Swal warning — ห้ามเงียบ)', () => {
    const callStart = apiSrc.indexOf('processQueuedRequests(');
    const callEnd = apiSrc.indexOf('isProcessingQueue = false;', callStart);
    const block = apiSrc.slice(callStart, callEnd);
    assert.ok(block.includes('Swal.fire'), 'ต้องโชว์ Swal เมื่อมีรายการล้มเหลวถาวร');
    assert.ok(block.includes("icon: 'warning'"), 'icon ต้องเป็น warning');
    assert.ok(block.includes('มีรายการที่ส่งไม่สำเร็จ'), 'title แจ้งเตือนต้องมี');
    assert.ok(block.includes('กรุณาตรวจสอบและทำรายการใหม่อีกครั้ง'), 'ต้องบอกผู้ใช้ให้ตรวจสอบ/ทำรายการใหม่');
    assert.ok(block.includes('confirmButtonText'), 'ต้องมีปุ่มยืนยัน (ผู้ใช้รับทราบ)');
  });

  test('isProcessingQueue ล็อกระหว่าง replay (กัน request ใหม่เข้าคิวซ้ำ)', () => {
    const setIdx = apiSrc.indexOf('isProcessingQueue = true;');
    const callIdx = apiSrc.indexOf('processQueuedRequests(');
    // ใช้ fromIndex=callIdx — ไม่งั้นไปเจอ declaration `let isProcessingQueue = false;` (บรรทัดบนสุด)
    const unsetIdx = apiSrc.indexOf('isProcessingQueue = false;', callIdx);
    assert.ok(setIdx >= 0 && setIdx < callIdx, 'ล็อกก่อนเริ่ม replay');
    assert.ok(callIdx < unsetIdx, 'ปลดล็อกหลัง replay จบ');
  });

  test('describeQueuedRequest มาจาก utils/queueLabels (ไม่นิยามซ้ำใน api.ts)', () => {
    assert.ok(apiSrc.includes("import { describeQueuedRequest } from './utils/queueLabels'"), 'ต้อง import จาก utils/queueLabels');
    assert.ok(!/function describeQueuedRequest/.test(apiSrc), 'ห้ามนิยามซ้ำใน api.ts (ย้ายไป utils/queueLabels แล้ว)');
  });

  test('interceptor: เก็บคิวแค่จุดเดียว + เฉพาะ POST/PUT/DELETE + กันคิวซ้ำตอน replay', () => {
    // เก็บคิวต้องมีจุดเดียว (ใน request interceptor ตอน offline)
    const saveCount = (apiSrc.match(/saveRequestToQueue\(/g) || []).length;
    assert.equal(saveCount, 1, 'ต้องมีจุดเก็บคิวเดียว');

    // เฉพาะ mutation เท่านั้นที่เข้าคิว (GET ไม่อยู่ในคิว)
    assert.ok(apiSrc.includes("['POST', 'PUT', 'DELETE'].includes(config.method"), 'ต้องเก็บเฉพาะ POST/PUT/DELETE');

    // เงื่อนไขก่อนเก็บ: offline จริง (navigator.onLine false) และไม่ได้กำลัง replay อยู่
    // (isProcessingQueue — กัน request ที่เกิดระหว่าง replay วิ่งเข้าคิวซ้ำ)
    const saveIdx = apiSrc.indexOf('saveRequestToQueue(');
    const condStart = apiSrc.lastIndexOf('if (', saveIdx);
    const cond = apiSrc.slice(condStart, saveIdx);
    assert.ok(cond.includes('!navigator.onLine'), 'ต้องเช็ค offline ก่อนเก็บคิว');
    assert.ok(cond.includes('!isProcessingQueue'), 'ต้องเช็คกำลัง replay อยู่ไหม (กันคิวซ้ำ)');

    // เก็บเฉพาะเมื่อ request ยังไม่ออกจริง (reject เพื่อไม่ให้ axios ยิงต่อ)
    assert.ok(apiSrc.slice(saveIdx, saveIdx + 400).includes("Offline - request queued"), 'ต้อง reject บอกว่าเก็บคิวแล้ว');
  });
});
