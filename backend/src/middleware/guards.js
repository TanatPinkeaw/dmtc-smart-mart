// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 middleware/guards.js — middleware กันสิทธิ์/ตรวจ body ที่ใช้ร่วมกันทุก router (Phase B)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: รวม requireRole (เช็ค role ของ req.user) + validateRequest (ตรวจ body ด้วย Joi schema)
//   ไว้ที่เดียว ให้ router ที่แยกออกจาก server.js (settings/promotions/... ) require ไปใช้เหมือนกัน
//   แทนที่จะ copy โค้ดซ้ำในทุกไฟล์ (เดิม reportRoutes/adminRoutes เขียน requireRole ซ้ำกันเอง)
// จุดสำคัญ: ยกมาจาก server.js "เป๊ะ" (พฤติกรรม/ข้อความ error เหมือนเดิม) — server.js ยังมี copy
//   local ของตัวเองไว้ใช้กับ route ที่ยังไม่ย้าย จึงไม่กระทบกัน. router เหล่านี้ mount หลัง
//   authenticateToken (global) แล้ว req.user จึงพร้อมใช้เสมอ
// ═══════════════════════════════════════════════════════════════════════════════════

// เช็คว่า req.user.role อยู่ในลิสต์ที่อนุญาต ไม่งั้น 403 (ต้องผ่าน authenticateToken มาก่อน)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

// ตรวจ req.body ด้วย Joi schema; ผิด → 400 พร้อมรายละเอียด; ผ่าน → เขียนค่าที่ sanitize แล้วกลับ
// ลง req.body ให้ handler เดิม destructure ได้เหมือนเดิม (stripUnknown ตัด field เกินทิ้ง)
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message).join('; ');
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }
    req.validatedBody = value;
    req.body = value;
    next();
  };
}

module.exports = { requireRole, validateRequest };
