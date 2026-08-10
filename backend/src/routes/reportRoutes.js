// ⭐️ Phase A (refactor) — router รวม report endpoints (mount ที่ /api/reports ใน server.js)
// ย้ายออกจาก server.js ทีละ batch เล็ก ไม่เปลี่ยน path/พฤติกรรม — endpoint เดิม /api/reports/xxx
// ยังตอบเหมือนเดิมทุกอย่าง (เพราะ mount prefix /api/reports + path ในนี้เป็น /xxx)
const express = require('express');
const reportController = require('../controllers/reportController');

const router = express.Router();

// ⭐️ requireRole ใน server.js เป็น local function เรียกข้ามไฟล์ไม่ได้ — เขียนซ้ำแบบเดียวกับ
// adminRoutes.js/memberRoutes.js (ไม่ใช่ public path จึงผ่าน authenticateToken/requireCsrf ของ
// server.js มาก่อนแล้ว req.user จึงพร้อมใช้เสมอ)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

router.get('/weekly-sales', requireRole('ADMIN', 'MANAGER'), reportController.weeklySales);
router.get('/hourly-sales', requireRole('ADMIN', 'MANAGER'), reportController.hourlySales);

module.exports = router;
