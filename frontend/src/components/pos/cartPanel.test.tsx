// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 components/pos/cartPanel.test.tsx — เทสเรนเดอร์ CartPanel (POS) ตาม role ของสมาชิกที่เลือก
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node scripts/test-components.cjs → tsx)
// ทำอะไร: เรนเดอร์ CartPanel ของหน้าขาย (POS) ด้วย react-dom/server แล้วยืนยันว่า:
//     • เลือกบัญชีพนักงาน (role ≠ MEMBER) → เห็น badge "พนักงาน" แทน badge แต้ม 🌟,
//       ไม่เห็นปุ่มแลกของรางวัล, เห็นหมายเหตุไม่มีสิทธิ์แต้ม
//     • เลือกสมาชิกปกติ (MEMBER) → เห็น badge แต้ม 🌟 + ปุ่มแลกของรางวัล, ไม่เห็น badge พนักงาน
//   กัน regression: ใครไปทำให้ badge/เงื่อนไขหลุด (cashier งงว่าทำไมมีแต้มแต่ใช้ไม่ได้) จะโดนจับ
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { CartPanel } from './CartPanel';

type CartPanelProps = ComponentProps<typeof CartPanel>;

const baseProps: CartPanelProps = {
  isCartOpen: true, onCloseCart: () => {}, payOpen: true, onTogglePay: () => {},
  cart: [], products: [], onUpdateQuantity: () => {},
  currentMember: null, onClearMember: () => {},
  searchMemberQuery: '', onSearchMemberQueryChange: () => {}, memberLoading: false, onSearchMember: () => {}, onOpenRegisterModal: () => {},
  promotions: [], selectedPromoId: '', onSelectPromoId: () => {}, appliedPromo: null, promoLoading: false,
  onApplyPromo: () => {}, onRemovePromo: () => {},
  maxRedeemable: 0, redeemPoints: '', onRedeemPointsChange: () => {},
  memberCanUsePoints: true,
  grandTotal: 100, pointsDiscount: 0, finalTotal: 100,
  paymentMethod: 'CASH', onSetPaymentMethod: () => {}, amountReceived: 100, onAmountReceivedChange: () => {},
  promptpayId: '123', onCheckout: () => {}, loading: false, checkoutDisabled: false,
};

const staffMember = { student_id: 'STAFF01', full_name: 'สมชาย พนักงาน', points: 500, role: 'CASHIER' as const };
const member = { student_id: '12345', full_name: 'น้องสมาชิก', points: 50, role: 'MEMBER' as const };

function render(overrides: Partial<CartPanelProps> = {}) {
  return renderToString(<CartPanel {...baseProps} {...overrides} />);
}

describe('POS CartPanel — badge ตาม role ของสมาชิกที่เลือก', () => {
  test('บัญชีพนักงาน: badge "พนักงาน" แทน 🌟, ไม่มีปุ่มของรางวัล, เห็นหมายเหตุไม่มีสิทธิ์แต้ม', () => {
    const html = render({ currentMember: staffMember, memberCanUsePoints: false, onOpenRewardModal: () => {} });
    assert.ok(html.includes('>พนักงาน</span>'), 'ต้องเห็น badge พนักงาน (แทน badge แต้ม)');
    assert.ok(!html.includes('🌟'), 'บัญชีพนักงานต้องไม่เห็น badge แต้ม 🌟 (มีแต้มแต่ใช้ไม่ได้ = งง)');
    assert.ok(!html.includes('แลกของรางวัล'), 'บัญชีพนักงานต้องไม่เห็นปุ่มแลกของรางวัล');
    assert.ok(html.includes('ไม่มีสิทธิ์ใช้แต้ม/ของรางวัลสมาชิก'), 'ต้องเห็นหมายเหตุชัดเจน');
  });

  test('สมาชิกปกติ: เห็น badge แต้ม 🌟 + ปุ่มแลกของรางวัล, ไม่เห็น badge พนักงาน', () => {
    const html = render({ currentMember: member, memberCanUsePoints: true, onOpenRewardModal: () => {} });
    assert.ok(html.includes('🌟'), 'สมาชิกต้องเห็น badge แต้ม 🌟');
    assert.ok(html.includes('แลกของรางวัล'), 'สมาชิกต้องเห็นปุ่มแลกของรางวัล');
    assert.ok(!html.includes('>พนักงาน</span>'), 'สมาชิกต้องไม่เห็น badge พนักงาน');
  });

  test('ยังไม่เลือกสมาชิก: เห็นช่องค้นหา (สแกนบัตร), ไม่มี badge ใดๆ', () => {
    const html = render({ currentMember: null, memberCanUsePoints: true });
    assert.ok(html.includes('สแกนบัตรสมาชิก'), 'ต้องเห็นช่องสแกน/ค้นหาสมาชิก');
    assert.ok(!html.includes('🌟'), 'ยังไม่มีสมาชิก = ไม่มี badge แต้ม');
    assert.ok(!html.includes('>พนักงาน</span>'), 'ยังไม่มีสมาชิก = ไม่มี badge พนักงาน');
  });
});
