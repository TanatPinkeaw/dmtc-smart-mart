// ⭐️ Sprint 1 — B3: shared integer-satang money helpers (frontend mirror of backend/money.js).
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
