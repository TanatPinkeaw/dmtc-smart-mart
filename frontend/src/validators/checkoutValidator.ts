import Joi from 'joi';

// ⭐️ F5 — duplicated from backend/validators.js (checkoutValidator), kept in sync manually.
// Real POST /api/sales/checkout body: cashier_id, member_id, promotion_id, redeem_points,
// payment_method (CASH/QR/MIXED — NOT BANK_TRANSFER/CARD), amount_received, items[].
// If backend/validators.js's checkoutValidator ever changes, mirror the change here too.
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
