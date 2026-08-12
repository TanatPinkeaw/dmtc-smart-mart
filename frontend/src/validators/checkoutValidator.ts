// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 validators/checkoutValidator.ts — ตรวจข้อมูลตะกร้า/การชำระเงินก่อนยิง checkout (ฝั่ง frontend)
// ทำอะไร: เช็ค payload checkout (cashier_id, items, payment_method, amount_received ฯลฯ) ให้ถูกรูปก่อน
//   ยิง API — กันส่งข้อมูลผิดไป backend + ปิดปุ่มชำระเงินถ้ายังไม่ครบ (สำเนา logic ของ backend validator)
// จุดสำคัญ: เป็นแค่ด่านแรกช่วย UX — backend validate ซ้ำเสมอเป็น authority
// ═══════════════════════════════════════════════════════════════════════════════════
import Joi from 'joi';

// ⭐️ F5 — duplicated from backend/src/validators/index.js (checkoutValidator), kept in sync manually.
// Real POST /api/sales/checkout body: cashier_id, member_id, promotion_id, redeem_points,
// payment_method (CASH/QR/MIXED — NOT BANK_TRANSFER/CARD), amount_received, items[].
// If backend/src/validators/index.js's checkoutValidator ever changes, mirror the change here too.
export const checkoutValidator = Joi.object({
  cashier_id: Joi.number().integer().positive().required(),
  member_id: Joi.number().integer().positive().allow(null).optional(),
  promotion_id: Joi.number().integer().positive().allow(null).optional(),
  redeem_points: Joi.number().integer().min(0).optional(),
  payment_method: Joi.string().valid('CASH', 'QR', 'MIXED').required(),
  amount_received: Joi.number().precision(2).min(0).required(),
  items: Joi.array()
    .items(
      Joi.object({
        product_id: Joi.number().integer().positive().required(),
        quantity: Joi.number().integer().min(1).max(1000).required(),
      })
    )
    .min(1)
    .required(),
});

export interface CheckoutPayload {
  cashier_id: number;
  member_id?: number | null;
  promotion_id?: number | null;
  redeem_points?: number;
  payment_method: 'CASH' | 'QR' | 'MIXED';
  amount_received: number;
  items: { product_id: number; quantity: number }[];
}

// ⭐️ คืนข้อความ error แรกที่เจอ (human-readable) หรือ null ถ้าผ่าน — ใช้ทั้งเช็คก่อนส่งและเช็คแบบ real-time ปิดปุ่ม
export function validateCheckout(payload: CheckoutPayload): string | null {
  const { error } = checkoutValidator.validate(payload, { abortEarly: true });
  return error ? error.details[0].message : null;
}
