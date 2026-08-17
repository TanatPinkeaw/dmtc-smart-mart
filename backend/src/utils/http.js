// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/http.js — response helpers ตัวกลาง (รวม res.status().json ซ้ำทั้งแอป)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: sendError(res, status, message, details) มาตรฐานเดียว + serverError(res) (500
//   ข้อความกลาง) + badRequest/notFound — แทนการเขียน res.status(N).json({ error: ... })
//   ซ้ำ 146 จุด (เดิมข้อความ 500 กลาง copy กันคนละจุด เผลอแก้ทีละจุดได้เพี้ยน)
// จุดสำคัญ: ส่งกลับ JSON เหมือนเดิมเป๊ะ ({ error } + details เฉพาะเมื่อส่ง) — ไม่กระทบ client
// ═══════════════════════════════════════════════════════════════════════════════════
function sendError(res, status, message, details) {
  if (details !== undefined) return res.status(status).json({ error: message, details });
  return res.status(status).json({ error: message });
}

// 500 ข้อความกลาง — ใช้ที่เดียวทั้งแอป (เดิม copy 146 จุด)
function serverError(res, details) {
  return sendError(res, 500, 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง', details);
}

function badRequest(res, message, details) {
  return sendError(res, 400, message, details);
}

function notFound(res, message) {
  return sendError(res, 404, message || 'ไม่พบข้อมูล');
}

module.exports = { sendError, serverError, badRequest, notFound };
