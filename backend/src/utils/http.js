// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/http.js — response helpers ตัวกลาง (รวม res.status().json ซ้ำทั้งแอป)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: sendError(res, status, message, details) มาตรฐานเดียว + serverError(res) (500
//   ข้อความกลาง) + badRequest/notFound — แทนการเขียน res.status(N).json({ error: ... })
//   ซ้ำ 146 จุด (เดิมข้อความ 500 กลาง copy กันคนละจุด เผลอแก้ทีละจุดได้เพี้ยน)
// จุดสำคัญ: ส่งกลับ JSON เหมือนเดิมเป๊ะ ({ error } + details เฉพาะเมื่อส่ง) — ไม่กระทบ client
// ═══════════════════════════════════════════════════════════════════════════════════
function sendError(res, status, message, details) {
  const body = { error: message };
  if (details !== undefined && typeof details === 'object' && details !== null && !Array.isArray(details)) {
    // object → spread ไว้ที่ top-level (key เดิมคงอยู่ — เช่น { code }, { detail }, { requirements })
    Object.assign(body, details);
  } else if (details !== undefined) {
    body.details = details;
  }
  return res.status(status).json(body);
}

// 500 ข้อความกลาง — ใช้ที่เดียวทั้งแอป (เดิม copy 146 จุด)
function serverError(res, details) {
  return sendError(res, 500, 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง', details);
}

function badRequest(res, message, details) {
  return sendError(res, 400, message, details);
}

function unauthorized(res, message) {
  return sendError(res, 401, message);
}

function forbidden(res, message, details) {
  return sendError(res, 403, message, details);
}

function notFound(res, message) {
  return sendError(res, 404, message || 'ไม่พบข้อมูล');
}

function conflict(res, message, details) {
  return sendError(res, 409, message, details);
}

function gone(res, message, details) {
  return sendError(res, 410, message, details);
}

module.exports = { sendError, serverError, badRequest, unauthorized, forbidden, notFound, conflict, gone };
