// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 components/preorder/cartPanel.test.tsx — เทสเรนเดอร์ CartPanel ตามสิทธิ์แต้ม
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --import tsx --test — node เปล่าโหลด .tsx ไม่ได้ ต้องใช้ tsx)
// ทำอะไร: เรนเดอร์ CartPanel ของหน้าสั่งจองด้วย react-dom/server (renderToString — ไม่ต้อง jsdom)
//   แล้วยืนยันว่า:
//     • staff (pointsEnabled=false) → ไม่เห็นช่องกรอกเบอร์สะสมแต้ม/ช่องแลกแต้ม/ปุ่มใช้สูงสุด,
//       เห็นหมายเหตุ "บัญชีพนักงาน" + (ถ้าส่งมา) ปุ่มสลับไปบัญชีสมาชิก
//     • member (pointsEnabled=true) → เห็นช่องสะสมแต้ม + แลกแต้ม (ถ้ามีแต้ม) ตามปกติ
//   กัน regression: ใครไปลืมครอบ pointsEnabled ไว้ (staff กลับมาเห็นช่องแลกแต้ม) จะโดนจับ
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { CartPanel } from './CartPanel';

type CartPanelProps = ComponentProps<typeof CartPanel>;

// ค่า prop พื้นฐาน — ใช้ CASH เพื่อไม่เรนเดอร์โซน QR (ไม่ต้องเรียก generatePayload)
const baseProps: CartPanelProps = {
  isCartOpen: true, onCloseCart: () => {}, payOpen: true, onTogglePay: () => {},
  cart: [], onUpdateQuantity: () => {},
  grandTotal: 100, pointsDiscount: 0, redeemPointsUsed: 0, finalTotal: 100,
  phoneNumber: '', onPhoneNumberChange: () => {}, phoneVerified: null, verifying: false, onVerifyPhone: () => {},
  myPoints: 50, maxRedeemable: 50, redeemPoints: '', onRedeemPointsChange: () => {},
  pointsEnabled: true, // ค่า default — เทสแต่ละตัว override ตามกรณี
  paymentMethod: 'CASH' as const, onSetPaymentMethod: () => {},
  promptpayId: '123', slipFile: null, slipPreview: null, slipDimensions: null,
  slipUploadProgress: 0, slipProcessing: false, onSlipChange: () => {}, onClearSlip: () => {},
  onCheckout: () => {}, loading: false,
};

function render(overrides: Partial<CartPanelProps> = {}) {
  return renderToString(<CartPanel {...baseProps} {...overrides} />);
}

describe('CartPanel — สิทธิ์แต้ม (pointsEnabled)', () => {
  test('staff (pointsEnabled=false): ไม่เห็นช่องสะสม/แลกแต้ม เห็นหมายเหตุบัญชีพนักงาน', () => {
    const html = render({ pointsEnabled: false });
    assert.ok(html.includes('บัญชีพนักงาน'), 'staff ต้องเห็นหมายเหตุบัญชีพนักงาน');
    assert.ok(!html.includes('เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)'), 'staff ต้องไม่เห็นช่องกรอกเบอร์สะสมแต้ม');
    assert.ok(!html.includes('แลกแต้มเป็นส่วนลด'), 'staff ต้องไม่เห็นช่องแลกแต้ม');
    assert.ok(!html.includes('ใช้สูงสุด'), 'staff ต้องไม่เห็นปุ่มใช้แต้มสูงสุด');
  });

  test('member (pointsEnabled=true) มีแต้ม: เห็นช่องสะสม + แลกแต้ม, ไม่เห็นหมายเหตุพนักงาน', () => {
    const html = render({ pointsEnabled: true });
    assert.ok(html.includes('เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)'), 'member ต้องเห็นช่องกรอกเบอร์สะสมแต้ม');
    assert.ok(html.includes('แลกแต้มเป็นส่วนลด'), 'member ที่มีแต้มต้องเห็นช่องแลกแต้ม');
    // ⭐️ หมายเหตุ: renderToString ใส่ <!-- --> คั่นระหว่างข้อความกับ expression ทำให้เลขในวงเล็บ
    // ไม่ต่อเนื่องกัน เช็คแค่คำ "ใช้สูงสุด" ที่เสถียร
    assert.ok(html.includes('ใช้สูงสุด'), 'member ต้องเห็นปุ่มใช้แต้มสูงสุด');
    assert.ok(!html.includes('บัญชีพนักงาน'), 'member ต้องไม่เห็นหมายเหตุพนักงาน');
  });

  test('member แต่ไม่มีแต้ม (myPoints=0): เห็นช่องเบอร์สะสม แต่ไม่เห็นช่องแลกแต้ม', () => {
    const html = render({ pointsEnabled: true, myPoints: 0 });
    assert.ok(html.includes('เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)'), 'member ยังเห็นช่องกรอกเบอร์สะสมแต้ม');
    assert.ok(!html.includes('แลกแต้มเป็นส่วนลด'), 'ไม่มีแต้ม = ไม่เห็นช่องแลก');
  });

  test('staff + onSwitchToMember: เห็นปุ่มสลับไปบัญชีสมาชิก (ใช้สิทธิ์แต้ม)', () => {
    const html = render({ pointsEnabled: false, onSwitchToMember: () => {} });
    assert.ok(html.includes('สลับไปใช้บัญชีสมาชิก'), 'staff ต้องเห็นปุ่มสลับไปบัญชีสมาชิก');
  });

  test('staff ไม่ได้ส่ง onSwitchToMember: ไม่เห็นปุ่มสลับ (ฟลวเก่าที่ยังไม่ต่อ)', () => {
    const html = render({ pointsEnabled: false, onSwitchToMember: undefined });
    assert.ok(!html.includes('สลับไปใช้บัญชีสมาชิก'), 'ไม่มี callback = ไม่ควรเห็นปุ่ม');
  });
});
