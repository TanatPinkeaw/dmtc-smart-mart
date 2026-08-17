// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/orderRealtime.test.js — source contract: ฟลว realtime ของแถบเตือนสลิปไม่ผ่าน
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องมี: แถบเตือนสลิป (Layout.tsx) อัปเดตผ่าน socket event `order_update_user_${id}`
//   — ถ้า backend หยุดยิง event นี้ (ตอน SLIP_REJECTED หรือตอนส่งสลิปใหม่) แถบจะค้าง/ไม่โผล่
//   จนกว่าจะ refresh หน้า เทสนี้ล็อกสายไฟที่ backend ว่าต้องยิงให้ครบ:
//   1. socket ทุกตัว (รวม staff) ต้อง join ห้องส่วนตัว user_${id} → staff ที่สั่งจองของตัวเอง
//      ได้รับ event ของตัวเองด้วย (staff-shopping)
//   2. PUT /orders/:id/status → ต้องยิง order_update_user_${order.user_id} เสมอ (ทุกสถานะ
//      รวม SLIP_REJECTED) หลัง commit
//   3. POST /orders/:id/upload-slip ตอน resubmit (SLIP_REJECTED → PENDING_VERIFY) → ต้องยิง
//      order_update_user_ กลับเจ้าของ (ปิดแถบเตือนบนเครื่องอื่น) + order_status_changed
//      (รีเฟรชหน้า OrderManagement / badge นับออเดอร์) หลัง commit
// รันด้วย: node --test tests/orderRealtime.test.js (หรือ npm run test:unit — ต่อใน runner แล้ว)
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function handlerWindow(startMarker, endMarker) {
  const start = SERVER_SRC.indexOf(startMarker);
  assert.ok(start >= 0, `หา marker ไม่เจอ: ${startMarker}`);
  const end = SERVER_SRC.indexOf(endMarker, start);
  assert.ok(end >= 0, `หา end marker ไม่เจอ: ${endMarker}`);
  return SERVER_SRC.slice(start, end);
}

describe('A. socket join — ทุก role (รวม staff) เข้าห้องส่วนตัว user_${id}', () => {
  // end marker = socket.on('disconnect' (comment "Task 1A — ตัวอย่าง event" ถูกลบไปพร้อม dead code
  // request_shift_report — ใช้ marker ตัวถัดไปที่ยังอยู่แทน)
  const connSrc = handlerWindow("io.on('connection'", "socket.on('disconnect'");

  test('socket ต้อง join ห้อง user_${socket.user.id} — ฐานของ event ส่วนตัวทุกตัว', () => {
    assert.ok(connSrc.includes('socket.join(`user_${socket.user.id}`)'),
      'ทุก socket ที่ login ต้อง join ห้องตัวเอง (staff ด้วย — staff-shopping ต้องได้ event ของตัวเอง)');
  });

  test('ไม่มีการกรอง role ตอน join (staff ไม่ถูกกันออกจากห้องตัวเอง)', () => {
    const joinLine = connSrc.split('\n').find(l => l.includes('socket.join'));
    assert.ok(joinLine && !/role/.test(joinLine), 'join ต้องไม่ดู role (ทุกคนเข้าห้องตัวเอง)');
  });
});

describe('B. PUT /orders/:id/status — ยิง order_update_user_ เสมอ (รวม SLIP_REJECTED)', () => {
  const src = handlerWindow("app.put('/api/orders/:id/status'", "app.get('/api/orders/pending-count'");

  test('SLIP_REJECTED อยู่ใน statusMessages (ลูกค้าได้แจ้งเตือน + แถบเตือน)', () => {
    assert.ok(src.includes('SLIP_REJECTED:'), 'SLIP_REJECTED ต้องมีข้อความแจ้งลูกค้า');
  });

  test('ยิง order_update_user_${order.user_id} ไปห้องเจ้าของออเดอร์ หลัง commit', () => {
    const emitLine = 'req.io.to(`user_${order.user_id}`).emit(`order_update_user_${order.user_id}`';
    assert.ok(src.includes(emitLine), `ต้องยิง ${emitLine}`);
    const emitIdx = src.indexOf(emitLine);
    const commitIdx = src.indexOf('await conn.commit();');
    assert.ok(commitIdx >= 0 && emitIdx > commitIdx, 'ต้องยิง event หลัง commit (กัน client เห็นข้อมูลเก่า)');
  });

  test('ยิงแบบไม่มีเงื่อนไข (ไม่ฝังใน if เฉพาะบางสถานะ — ทุกสถานะต้องรู้)', () => {
    // บรรทัด emit ต้องไม่ถูกครอบด้วย if — เช็คว่าหน้าบรรทัด emit (trim แล้ว) ไม่อยู่ใน block if
    const lineIdx = src.split('\n').findIndex(l => l.includes('emit(`order_update_user_${order.user_id}`'));
    const line = src.split('\n')[lineIdx];
    assert.ok(/^\s*req\.io\.to/.test(line), 'emit ต้องอยู่ level บนสุดของ handler (ไม่มี if ครอบ)');
  });
});

describe('C. POST /orders/:id/upload-slip — resubmit ต้องยิง realtime กลับ', () => {
  const src = handlerWindow("app.post('/api/orders/:id/upload-slip'", "app.post('/api/shifts/:id/upload-photo'");

  test('resubmit (wasRejected) ยิง order_update_user_${req.user.id} + order_status_changed หลัง commit', () => {
    const ownerEmit = 'req.io.to(`user_${req.user.id}`).emit(`order_update_user_${req.user.id}`';
    assert.ok(src.includes('if (wasRejected) {'), 'ต้องมี branch resubmit (wasRejected) สำหรับยิง event');
    const branch = src.slice(src.indexOf('if (wasRejected) {'));
    assert.ok(branch.includes(ownerEmit), `resubmit ต้องยิง ${ownerEmit} — ไม่งั้นแถบเตือนค้างบนเครื่องอื่น`);
    assert.ok(branch.includes("req.io.emit('order_status_changed'"),
      'resubmit ต้องยิง order_status_changed ด้วย (OrderManagement + badge รีเฟรช)');
    const emitIdx = src.indexOf(ownerEmit);
    const commitIdx = src.indexOf('await conn.commit();');
    const releaseIdx = src.indexOf('conn.release();');
    assert.ok(commitIdx >= 0 && emitIdx > commitIdx, 'event ต้องยิงหลัง commit');
    assert.ok(releaseIdx >= 0 && emitIdx > releaseIdx, 'event ต้องยิงหลังปล่อย connection (นอก transaction)');
  });

  test('การยิง event ต้องไม่อยู่ใน transaction (rollback แล้วต้องไม่ยิง)', () => {
    const ownerEmit = 'req.io.to(`user_${req.user.id}`).emit(`order_update_user_${req.user.id}`';
    const emitIdx = src.indexOf(ownerEmit);
    const rollbackIdx = src.indexOf('await conn.rollback();');
    assert.ok(emitIdx > rollbackIdx, 'emit ต้องอยู่หลังจุด rollback (ยิงเฉพาะตอน commit สำเร็จเท่านั้น)');
  });
});
