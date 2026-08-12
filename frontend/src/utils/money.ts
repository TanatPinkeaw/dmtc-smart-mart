// ⭐️ Sprint 1 — B3: shared integer-satang money helpers (frontend mirror of backend/src/utils/money.js).
//
// Context: the DB stores money as exact DECIMAL(10,2) baht — the float-drift bug (0.1+0.2 style)
// only happens in JS once values are pulled out and arithmetic (cart totals, discounts, points
// redemption) is done as plain floats. Fix: convert to integer satang (1 baht = 100 satang) before
// any addition/subtraction/multiplication, only convert back to baht for display or for the final
// value sent to the API. Never chain float baht math across multiple steps.

// Baht (number or numeric string) → integer satang. Math.round guards against input that already
// carries float noise (e.g. price * quantity done elsewhere before this was applied).
export function toSatang(baht: number | string): number {
  const n = typeof baht === 'string' ? parseFloat(baht) : Number(baht);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Integer satang → baht number, safe for display (.toFixed(2)) or to send to the API.
export function fromSatang(satang: number): number {
  return Math.round(satang) / 100;
}

// price × quantity, computed in satang space (avoids "19.90 * 3 = 59.699999999999996").
export function lineTotalSatang(price: number | string, quantity: number): number {
  return toSatang(price) * quantity;
}

// Sum an array of baht values entirely in satang space, return baht.
// Use instead of `arr.reduce((a, b) => a + b, 0)` for money.
export function sumBahtAsSatang(bahtValues: (number | string)[]): number {
  const totalSatang = bahtValues.reduce((sum: number, v) => sum + toSatang(v), 0);
  return fromSatang(totalSatang);
}

// ⭐️ ราคาต่อชิ้นหลังหักส่วนลดระดับสินค้า (โปรช่วงวันที่ หรือ ใกล้หมดอายุ) — mirror ตรรกะฝั่ง backend
// เป๊ะ: best_discount_percent = GREATEST(promo_percent ถ้าโปร active, discount_percent ถ้าใกล้หมดอายุ)
// แล้ว itemPrice -= Math.round(itemPrice * pct/100) (ดู POST /api/sales/checkout + POST /api/orders)
// ใช้ที่เดียวทั้งการ์ดสินค้า (โชว์ราคา) และตอน addToCart (ราคาที่คิดจริง) กันโชว์กับคิดเงินไม่ตรงกัน
// หมายเหตุ: ส่วนลดกลุ่มสมาชิก/แลกแต้ม/โปรทั้งบิล ไม่รวมในนี้ (backend คิดแยกตอน checkout) — นี่แค่
// ส่วนลด "ระดับสินค้า" ที่ทุกคนเห็นเท่ากันบนการ์ด
export function itemLevelDiscountPercent(product: any): number {
  const nearExpiryPct = product?.expiry_status === 'near_expiry' ? (Number(product?.discount_percent) || 0) : 0;
  const promoPct = product?.promo_active ? (Number(product?.promo_percent) || 0) : 0;
  return Math.max(nearExpiryPct, promoPct);
}

export function effectiveUnitPrice(product: any): number {
  const price = Number(product?.price) || 0;
  const pct = itemLevelDiscountPercent(product);
  if (pct <= 0) return price;
  return fromSatang(toSatang(price) - Math.round(toSatang(price) * pct / 100));
}
