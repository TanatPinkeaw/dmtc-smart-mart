// ⭐️ Sprint 1 — B3: shared integer-satang money helpers.
//
// Context (read before touching money math elsewhere in this repo): the DB already stores every
// money column as MySQL DECIMAL(10,2), which is exact fixed-point — SUM()/+/- on DECIMAL columns
// in SQL never has the classic 0.1+0.2 floating point problem. The bug lives entirely on the JS
// side: mysql2 returns DECIMAL columns as JS strings by default, and any subsequent `Number(x)`
// or implicit string coercion (`"19.90" * 3`) re-enters IEEE-754 float land, where repeated +/-
// across many cart items or aggregates CAN drift by fractions of a satang.
//
// Fix: never do money arithmetic in float baht. Convert to integer satang (1 baht = 100 satang)
// immediately, do all addition/subtraction/multiplication in that integer space, and only divide
// back to baht at the very last step — for display or for writing into a DECIMAL column (MySQL
// accepts a JS number/string baht value for DECIMAL columns either way).
//
// This does NOT touch the DB schema. Columns stay DECIMAL(10,2) baht. Only the JS calculation
// layer changes to avoid ever doing float arithmetic on money.

// Baht (number or numeric string, e.g. from mysql2 DECIMAL) → integer satang.
// Math.round guards against the input itself already carrying float noise (e.g. 59.699999999999996).
function toSatang(baht) {
  const n = typeof baht === 'string' ? parseFloat(baht) : Number(baht);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Integer satang → baht number, safe to pass straight into a DECIMAL(10,2) column or JSON response.
function fromSatang(satang) {
  return Math.round(satang) / 100;
}

// Sum an array of baht values entirely in satang space, return baht. Use this instead of
// `arr.reduce((a,b) => a + b, 0)` on money values.
function sumSatangFromBaht(bahtValues) {
  const totalSatang = bahtValues.reduce((sum, v) => sum + toSatang(v), 0);
  return fromSatang(totalSatang);
}

module.exports = { toSatang, fromSatang, sumSatangFromBaht };
