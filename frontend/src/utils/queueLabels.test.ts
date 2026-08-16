// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueLabels.test.ts — เทสป้ายไทยที่ใช้แจ้งเตือนรายการในคิวออฟไลน์ล้มเหลวถาวร
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping)
// ทำอะไร: ยืนยัน describeQueuedRequest (utils/queueLabels.ts) แปลง request ในคิวเป็นชื่อที่
//   ผู้ใช้ "อ่านแล้วรู้เรื่อง" ถูกต้องครบทุก mutation endpoint ที่ offline queue เก็บได้ —
//   ใช้ใน Swal "มีรายการที่ส่งไม่สำเร็จ" ตอน replay คิวล้มเหลวถาวร (api.ts เรียก — มี
//   queueDrainContract.test.ts คอยเช็คว่า wiring ยังอยู่ครบ)
//   ⚠️ มีเทสยืนยัน "prefix ทับกัน" (member-groups vs members) — ถ้าใครเรียง LABELS ผิด เทส fail
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { describeQueuedRequest } from './queueLabels.ts';

describe('describeQueuedRequest — ป้ายไทยสำหรับรายการที่ล้มเหลวถาวร', () => {
  test('บิลขาย: /sales/checkout (exact) และ /sales/:id/void (prefix)', () => {
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/sales/checkout' }), 'บิลขาย (POS) (POST /sales/checkout)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/sales/12/void' }), 'บิลขาย (POST /sales/12/void)');
  });

  test('endpoint หลักที่ครอบเดิม: orders/shifts/attendance/members', () => {
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/orders/5/status' }), 'ออเดอร์จอง (PUT /orders/5/status)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/orders' }), 'ออเดอร์จอง (POST /orders)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/shifts/close' }), 'กะการขาย (POST /shifts/close)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/attendance/check-in' }), 'การลงเวลางาน (POST /attendance/check-in)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/members/import' }), 'ข้อมูลสมาชิก (POST /members/import)');
  });

  test('🔒 prefix ทับกัน: /member-groups ต้องได้ "กลุ่มสมาชิก" ไม่ใช่โดน /members กลืนเป็น "ข้อมูลสมาชิก"', () => {
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/member-groups/3/rules' }), 'กลุ่มสมาชิก (POST /member-groups/3/rules)');
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/member-groups/3' }), 'กลุ่มสมาชิก (PUT /member-groups/3)');
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/member-groups/3/rules/7' }), 'กลุ่มสมาชิก (DELETE /member-groups/3/rules/7)');
  });

  test('สินค้า/หมวดหมู่/ซัพพลายเออร์/โปรโมชั่น/ใบรับสินค้า (เดิมไม่มีป้าย → ตอนนี้มี)', () => {
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/products' }), 'สินค้า (POST /products)');
    assert.equal(describeQueuedRequest({ method: 'PATCH', url: '/products/1/stock' }), 'สินค้า (PATCH /products/1/stock)');
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/products/2' }), 'สินค้า (DELETE /products/2)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/categories' }), 'หมวดหมู่ (POST /categories)');
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/categories/2' }), 'หมวดหมู่ (DELETE /categories/2)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/suppliers' }), 'ซัพพลายเออร์ (POST /suppliers)');
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/suppliers/2' }), 'ซัพพลายเออร์ (DELETE /suppliers/2)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/promotions' }), 'โปรโมชั่น (POST /promotions)');
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/promotions/4' }), 'โปรโมชั่น (DELETE /promotions/4)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/purchases' }), 'ใบรับสินค้า (POST /purchases)');
  });

  test('พนักงาน/ตั้งค่า/แจ้งเตือน/ตารางกะ/วันหยุด/จัดการระบบ/เข้าสู่ระบบ (เดิมไม่มีป้าย → ตอนนี้มี)', () => {
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/users/5/profile' }), 'ข้อมูลพนักงาน (PUT /users/5/profile)');
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/users/5/change-password' }), 'ข้อมูลพนักงาน (PUT /users/5/change-password)');
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/settings/loyalty' }), 'ตั้งค่าร้าน (PUT /settings/loyalty)');
    assert.equal(describeQueuedRequest({ method: 'PUT', url: '/notifications/3/read' }), 'การแจ้งเตือน (PUT /notifications/3/read)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/schedules' }), 'ตารางกะ (POST /schedules)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/holidays' }), 'วันหยุด (POST /holidays)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/admin/backups/create' }), 'จัดการระบบ (POST /admin/backups/create)');
    assert.equal(describeQueuedRequest({ method: 'POST', url: '/auth/login' }), 'เข้าสู่ระบบ (POST /auth/login)');
  });

  test('query string ถูกตัดก่อน match (idempotency-key ฯลฯ) แต่ url เต็มยังแสดง', () => {
    const out = describeQueuedRequest({ method: 'POST', url: '/sales/checkout?idempotency-key=abc-123' });
    assert.equal(out, 'บิลขาย (POS) (POST /sales/checkout?idempotency-key=abc-123)');
  });

  test('path ที่ขึ้นต้นคล้ายแต่ไม่ใช่ endpoint จริง (เช่น /ordersx) → ไม่โดนจับผิด', () => {
    assert.equal(describeQueuedRequest({ method: 'GET', url: '/ordersx' }), 'GET /ordersx');
    assert.equal(describeQueuedRequest({ method: 'GET', url: '/sales-report' }), 'GET /sales-report');
  });

  test('path ที่ไม่รู้จัก / มี /api นำหน้า → แสดง METHOD + url เต็ม (กันข้อมูลหาย)', () => {
    assert.equal(describeQueuedRequest({ method: 'DELETE', url: '/api/categories/2' }), 'DELETE /api/categories/2');
    assert.equal(describeQueuedRequest({ method: 'PATCH', url: '/unknown-path' }), 'PATCH /unknown-path');
  });

  test('url ว่าง → ไม่พัง คืน METHOD เปล่า', () => {
    assert.equal(describeQueuedRequest({ method: 'GET', url: '' }), 'GET ');
  });
});
