const Joi = require('joi');

// ⭐️ Task 5A — schemas written against the REAL request bodies in server.js
// (the original prompt's schemas assumed fields that don't exist in this codebase —
//  see deviation notes at the bottom of this file)

module.exports = {
  // POST /api/sales/checkout — body: cashier_id, member_id, promotion_id, redeem_points,
  // payment_method, amount_received, items[] (server.js:1476)
  checkoutValidator: Joi.object({
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
  }),

  // POST /api/products — body: barcode, name, category_id, price, stock, image_url,
  // vendor_id, gp_rate (server.js:347) — no description/cost/reorder_level in this codebase
  productValidator: Joi.object({
    barcode: Joi.string().trim().max(50).allow(null, '').optional(),
    name: Joi.string().trim().min(1).max(200).required(),
    category_id: Joi.number().integer().positive().allow(null).optional(),
    price: Joi.number().precision(2).positive().required(),
    stock: Joi.number().integer().min(0).optional(),
    image_url: Joi.string().trim().max(500).allow(null, '').optional(),
    vendor_id: Joi.number().integer().positive().allow(null).optional(),
    gp_rate: Joi.number().min(0).max(100).allow(null).optional(),
  }),

  // POST /api/orders (pre-order) — body: items[], payment_method, slip_image,
  // use_phone_for_points, redeem_points; member/user comes from req.user.id, NOT the body
  // (server.js:2904) — original prompt assumed a single member_id/product_id, which is wrong
  orderValidator: Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          product_id: Joi.number().integer().positive().required(),
          quantity: Joi.number().integer().min(1).max(1000).required(),
        })
      )
      .min(1)
      .required(),
    payment_method: Joi.string().valid('CASH', 'QR').required(),
    slip_image: Joi.string().trim().max(500).allow(null, '').optional(),
    use_phone_for_points: Joi.boolean().optional(),
    redeem_points: Joi.number().integer().min(0).optional(),
  }),

  // POST /api/shifts/close — body: cashier_id, actual_cash, note (NOT "notes"), cash_breakdown,
  // close_photo (required in handler) (server.js:963)
  shiftCloseValidator: Joi.object({
    cashier_id: Joi.number().integer().positive().required(),
    actual_cash: Joi.number().precision(2).min(0).required(),
    note: Joi.string().trim().max(500).allow(null, '').optional(),
    cash_breakdown: Joi.object().unknown(true).allow(null).optional(),
    close_photo: Joi.string().trim().min(1).required(),
    // ⭐️ Sprint 1 — D3: หมวดหมู่สาเหตุส่วนต่างเงินสด (optional — ส่งมาเฉพาะตอนมีส่วนต่างเกินเกณฑ์)
    discrepancy_category: Joi.string().valid('SHORT_CHANGE', 'FAKE_BILL', 'FORGOT_RECEIPT', 'CUSTOMER_RETURN', 'OTHER').allow(null).optional(),
  }),

  // POST /api/users/register — body: student_id, full_name, phone_number
  // (server.js:500) — this codebase has no email/password/role fields on register;
  // password is auto-set server-side to phone_number, role is always MEMBER.
  userRegisterValidator: Joi.object({
    student_id: Joi.string().trim().min(1).max(50).required(),
    full_name: Joi.string().trim().min(1).max(200).required(),
    phone_number: Joi.string().trim().pattern(/^[0-9+\-() ]{6,20}$/).required()
      .messages({ 'string.pattern.base': 'phone_number must be a valid phone number' }),
  }),
};

/*
 * DEVIATIONS FROM TASK_5A_REVISED_FOR_CLD.md
 * -------------------------------------------
 * 1. orderValidator: spec assumed { member_id, product_id, quantity, notes } (single item).
 *    Real POST /api/orders takes { items: [...], payment_method, slip_image,
 *    use_phone_for_points, redeem_points } — same items[] shape as checkout, and the
 *    member is req.user.id from the JWT, never a body field. Rewrote to match.
 * 2. shiftCloseValidator: spec used field name "notes"; real handler reads "note" (no s),
 *    and requires cashier_id + close_photo which the spec didn't validate at all.
 * 3. userCreateValidator (renamed userRegisterValidator here): spec assumed
 *    { name, email, password, role, student_id } — this app's register endpoint has no
 *    email/password/role fields at all (password defaults to phone_number, role is
 *    always MEMBER server-side). Rewrote against actual { student_id, full_name, phone_number }.
 * 4. productValidator: spec had description/cost/reorder_level fields that don't exist on
 *    this products table; real fields are barcode/image_url/vendor_id/gp_rate/stock. Rewrote.
 * 5. checkoutValidator: kept mostly as TASK_5A_REVISED_FOR_CLD.md specified — that file was
 *    already correct for this route.
 */
