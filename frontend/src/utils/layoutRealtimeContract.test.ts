// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/layoutRealtimeContract.test.ts — source contract: แถบเตือนสลิป + socket realtime
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — อ่าน source ด้วย fs ไม่ import component)
// ทำอะไร: ล็อกสายไฟฝั่ง frontend ของแถบเตือนสลิปไม่ผ่าน (Layout.tsx) + การรีเฟรชสดของหน้า
//   สั่งจอง (PreOrder.tsx) กันใครไปแก้ wiring พังโดยไม่รู้ตัว:
//   • Layout ต้อง listen `order_update_user_${user.id}` → fetchRejectedOrders (แถบโผล่/หาย realtime)
//   • fetchRejectedOrders ต้องดึง ?mine=1 สำหรับ staff (เห็นเฉพาะออเดอร์ตัวเอง — ไม่งั้นรั่ว
//     ออเดอร์ลูกค้าทั้งระบบลงแถบเตือน) และต้องไม่ถูกตัด staff ออก (setRejectedOrders([]))
//   • PreOrder ต้อง listen `order_update_user_${user.id}` ด้วย (สถานะ/สลิปเปลี่ยนแล้วรีเฟรชสด)
// ═══════════════════════════════════════════════════════════════════════════════════
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUT_SRC = readFileSync(resolve(BASE, 'components/Layout.tsx'), 'utf8');
const PREORDER_SRC = readFileSync(resolve(BASE, 'pages/PreOrder.tsx'), 'utf8');

function windowBetween(src: string, startMarker: string, endMarker: string) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `หา marker ไม่เจอ: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end >= 0, `หา end marker ไม่เจอ: ${endMarker}`);
  return src.slice(start, end);
}

describe('Layout — แถบเตือนสลิปไม่ผ่าน realtime (รวม staff)', () => {
  const effectSrc = windowBetween(LAYOUT_SRC, 'useEffect(() => {', '// ⭐️ ฟอร์มแก้เบอร์/อัปโหลดรูป');

  test('listen order_update_user_${user.id} → fetchRejectedOrders (แถบโผล่/หายแบบ realtime)', () => {
    assert.ok(effectSrc.includes('socket.on(`order_update_user_${user.id}`, fetchRejectedOrders)'),
      'Layout ต้องฟัง event ส่วนตัวของตัวเองแล้วรีเฟรชแถบเตือน — ถ้าใครถอด listener แถบจะค้าง');
    assert.ok(effectSrc.includes('socket.off(`order_update_user_${user.id}`, fetchRejectedOrders)'),
      'ต้อง off listener ตอน cleanup (กัน leak)');
  });

  test('fetchRejectedOrders: staff ต้องดึง ?mine=1 (เห็นเฉพาะของตัวเอง) และไม่โดนตัดทิ้ง', () => {
    const fnSrc = windowBetween(LAYOUT_SRC, 'const fetchRejectedOrders', 'useEffect(() => {');
    assert.ok(fnSrc.includes("`/orders?${isStaff ? 'mine=1&' : ''}t=${Date.now()}`"),
      'staff ต้องดึง /orders?mine=1 (ไม่งั้นเห็นออเดอร์ลูกค้าทั้งระบบลงแถบเตือน)');
    assert.ok(!fnSrc.includes('setRejectedOrders([])'),
      'ห้ามตัด staff ออกจากแถบเตือน — staff สั่งจองของตัวเองได้แล้วต้องเห็นแถบของตัวเอง');
    assert.ok(fnSrc.includes("o.status === 'SLIP_REJECTED'"), 'ต้องกรองเฉพาะออเดอร์สลิปไม่ผ่าน');
  });

  test('listen order_status_changed → รีเฟรช badge นับออเดอร์ (ฝั่ง staff)', () => {
    assert.ok(effectSrc.includes("socket.on('order_status_changed', () => { if (isStaff) fetchNotificationsAndBadge(); })"),
      'staff ต้องรีเฟรช badge นับออเดอร์ค้างเมื่อสถานะออเดอร์เปลี่ยน (รวมตอน resubmit สลิป)');
  });
});

describe('PreOrder — สถานะออเดอร์ของตัวเองเปลี่ยนแล้วรีเฟรชสด', () => {
  test('listen order_update_user_${user.id} (SLIP_REJECTED เด้งปุ่มส่งสลิปใหม่ / resubmit อัปเดต)', () => {
    assert.ok(PREORDER_SRC.includes('socket.on(`order_update_user_${user.id}`'),
      'PreOrder ต้องฟัง event ส่วนตัว — หน้าแสดงสถานะออเดอร์ต้องอัปเดตสดโดยไม่ต้อง refresh');
  });
});
