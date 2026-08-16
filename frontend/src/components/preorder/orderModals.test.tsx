// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 components/preorder/orderModals.test.tsx — เทสเรนเดอร์ MyOrdersModal + OrderDetailModal
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (ผ่าน scripts/test-components.cjs → tsx + react-dom/server renderToString)
// ทำอะไร: ยืนยันว่า staff ที่สั่งจองของตัวเองเห็นข้อมูลครบและไม่มีฟิลด์แต้มโชว์ผิด:
//   • โชว์แต้ม (ใช้แต้มลด) เฉพาะเมื่อ points_discount > 0 — staff โดน backend บังคับ 0 เสมอ
//     → ถ้ามีใครไปแสดงแต้มแบบไม่เช็คค่า จะโดนเทสจับ
//   • ปุ่มยกเลิกแสดงเฉพาะสถานะที่ backend อนุญาต (PENDING_VERIFY/WAITING_CASH) —
//     SLIP_REJECTED ต้องไม่เห็นปุ่มยกเลิก (backend ตอบ 500 "ติดต่อพนักงาน" → เดิม UI โชว์ปุ่มตาย)
//   • SLIP_REJECTED → เห็นโซน "ส่งสลิปใหม่" + เหตุผลที่ปฏิเสธ (งานที่ผู้ใช้ต้องทำต่อ)
//   • COMPLETED → เห็นปุ่ม "ดูใบเสร็จ" ไม่เห็นปุ่มยกเลิก
// ⚠️ OrderDetailModal import api → config.ts อ่าน import.meta.env (Vite-only) → ต้อง mock.module
//   ../../api + ../../swal ก่อน dynamic import (import แบบ static วิ่งก่อน mock = พัง)
// ═══════════════════════════════════════════════════════════════════════════════════
/// <reference types="node" />
import { describe, test, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MyOrdersModal } from './MyOrdersModal';

// OrderDetailModal ใช้ api/swal เฉพาะใน event handler (render ไม่เรียก) → mock เป็น no-op พอ
// @types/node ที่ติดตั้งยังไม่มี option exports (ตัวใหม่) → ใช้ defaultExport ซึ่งรันจริงได้
// (runtime โชว์ deprecation warning แค่ 1 บรรทัด ไม่กระทบ) — อย่าแก้เป็น exports เพราะ tsc จะแดง
mock.module('../../api', {
  defaultExport: { get: async () => ({ data: [] }), post: async () => ({}) },
});
mock.module('../../swal', {
  defaultExport: { fire: async () => {} },
});

const { OrderDetailModal } = await import('./OrderDetailModal');

type MyOrdersProps = ComponentProps<typeof MyOrdersModal>;
type OrderDetailProps = ComponentProps<typeof OrderDetailModal>;

// ── MyOrdersModal ────────────────────────────────────────────────────────────────
const baseMyOrdersProps: MyOrdersProps = {
  myOrders: [],
  loading: false,
  error: false,
  onRetry: () => {},
  onClose: () => {},
  onSelectOrder: () => {},
  onResubmitSlip: () => {},
};

function renderMyOrders(overrides: Partial<MyOrdersProps> = {}) {
  return renderToString(<MyOrdersModal {...baseMyOrdersProps} {...overrides} />);
}

describe('MyOrdersModal — ข้อมูล/แต้มสำหรับบัญชี staff', () => {
  test('ออเดอร์ staff (points_discount=0): ไม่แสดงบรรทัด "ใช้แต้มลด"', () => {
    const html = renderMyOrders({
      myOrders: [{
        id: 1, status: 'WAITING_CASH', created_at: '2026-08-17T10:00:00',
        items: [{ id: 1, product_name: 'น้ำ', quantity: 2, subtotal: 20 }],
        points_discount: 0, points_redeemed: 0, total_amount: 20,
      }],
    });
    // renderToString ใส่ <!-- --> คั่นรอบ {order.id} → เช็คเฉพาะส่วนที่เสถียร
    assert.ok(html.includes('ออเดอร์ #'), 'ต้องเห็นออเดอร์');
    assert.ok(!html.includes('ใช้แต้มลด'), 'staff ที่ไม่ได้ใช้แต้มต้องไม่เห็นบรรทัดใช้แต้มลด');
  });

  test('ออเดอร์ member ที่ใช้แต้ม (points_discount>0): แสดงบรรทัด "ใช้แต้มลด" ตามปกติ', () => {
    const html = renderMyOrders({
      myOrders: [{
        id: 2, status: 'COMPLETED', created_at: '2026-08-17T10:00:00',
        items: [{ id: 2, product_name: 'น้ำ', quantity: 1, subtotal: 18 }],
        points_discount: 2, points_redeemed: 100, total_amount: 18,
      }],
    });
    assert.ok(html.includes('ใช้แต้มลด'), 'member ที่ใช้แต้มต้องเห็นบรรทัดใช้แต้มลด');
    assert.ok(html.includes('100'), 'ต้องเห็นจำนวนแต้มที่ใช้');
  });

  test('SLIP_REJECTED: เห็นปุ่ม "ส่งสลิปใหม่" ที่การ์ด', () => {
    const html = renderMyOrders({
      myOrders: [{
        id: 3, status: 'SLIP_REJECTED', created_at: '2026-08-17T10:00:00',
        items: [], points_discount: 0, points_redeemed: 0, total_amount: 20,
      }],
    });
    assert.ok(html.includes('ส่งสลิปใหม่'), 'สลิปไม่ผ่านต้องมีปุ่มส่งสลิปใหม่');
    assert.ok(html.includes('สลิปผิด'), 'ต้องแสดงสถานะสลิปผิด');
  });

  test('ไม่มีประวัติ: แสดงข้อความว่าง ไม่พัง', () => {
    const html = renderMyOrders({ myOrders: [], loading: false, error: false });
    assert.ok(html.includes('ยังไม่มีประวัติการสั่งจอง'));
  });
});

// ── OrderDetailModal ─────────────────────────────────────────────────────────────
const baseOrder: OrderDetailProps['selectedOrder'] = {
  id: 10,
  status: 'WAITING_CASH',
  created_at: '2026-08-17T10:00:00',
  payment_method: 'QR',
  slip_image: null,
  items: [{ id: 1, product_name: 'น้ำ', quantity: 2, subtotal: 20 }],
  points_discount: 0,
  points_redeemed: 0,
  total_amount: 20,
  reject_reason: null,
};

const baseDetailProps: OrderDetailProps = {
  selectedOrder: baseOrder,
  storeInfo: undefined,
  refundReason: '',
  onRefundReasonChange: () => {},
  onClose: () => {},
  onCancelOrder: () => {},
  cancelling: false,
  fetchMyOrders: async () => {},
};

function renderDetail(overrides: Partial<OrderDetailProps> = {}) {
  return renderToString(
    <MemoryRouter>
      <OrderDetailModal {...baseDetailProps} {...overrides} />
    </MemoryRouter>,
  );
}

describe('OrderDetailModal — ปุ่มยกเลิกตามสถานะ + แต้ม', () => {
  test('WAITING_CASH: เห็นปุ่มยกเลิกออเดอร์ + ช่องเหตุผล', () => {
    const html = renderDetail();
    assert.ok(html.includes('ยกเลิกออเดอร์'), 'WAITING_CASH ต้องยกเลิกได้');
    assert.ok(html.includes('เหตุผลในการยกเลิก'), 'ต้องมีช่องกรอกเหตุผล');
  });

  test('SLIP_REJECTED: ไม่เห็นปุ่มยกเลิก (backend ไม่อนุญาต) แต่เห็นโซนส่งสลิปใหม่ + เหตุผล', () => {
    const html = renderDetail({
      selectedOrder: { ...baseOrder, status: 'SLIP_REJECTED', reject_reason: 'สลิปมืดไป อ่านไม่ได้' },
    });
    assert.ok(!html.includes('ยกเลิกออเดอร์'), 'SLIP_REJECTED ต้องไม่เห็นปุ่มยกเลิก (เดิมเป็นปุ่มตาย 500)');
    assert.ok(!html.includes('เหตุผลในการยกเลิก'), 'SLIP_REJECTED ต้องไม่เห็นช่องเหตุผลยกเลิก');
    assert.ok(html.includes('แตะเพื่อส่งสลิปใหม่'), 'ต้องเห็นโซนส่งสลิปใหม่');
    assert.ok(html.includes('สลิปของท่านไม่ถูกต้อง'), 'ต้องเห็นคำเตือนสลิปไม่ถูกต้อง');
    assert.ok(html.includes('สลิปมืดไป อ่านไม่ได้'), 'ต้องเห็นเหตุผลที่ปฏิเสธ');
  });

  test('COMPLETED: เห็นปุ่ม "ดูใบเสร็จ" ไม่เห็นปุ่มยกเลิก', () => {
    const html = renderDetail({ selectedOrder: { ...baseOrder, status: 'COMPLETED' } });
    assert.ok(html.includes('ดูใบเสร็จ'), 'COMPLETED ต้องดูใบเสร็จได้');
    assert.ok(!html.includes('ยกเลิกออเดอร์'), 'COMPLETED ต้องไม่เห็นปุ่มยกเลิก');
  });

  test('staff (points_discount=0): ไม่เห็นกล่อง "ใช้แต้มลด"', () => {
    const html = renderDetail();
    assert.ok(!html.includes('ใช้แต้มลด'), 'staff ที่ไม่ได้ใช้แต้มต้องไม่เห็นกล่องแต้ม');
  });

  test('member ที่ใช้แต้ม (points_discount>0): เห็นกล่อง "ใช้แต้มลด"', () => {
    const html = renderDetail({
      selectedOrder: { ...baseOrder, points_discount: 2, points_redeemed: 100, total_amount: 18 },
    });
    assert.ok(html.includes('ใช้แต้มลด'), 'member ที่ใช้แต้มต้องเห็นกล่องแต้ม');
  });
});
