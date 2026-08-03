// ⭐️ Dev/testing data-reset endpoints — ADMIN เท่านั้น, บล็อกทั้งชุดบน production ใน controller เอง
const express = require('express');
const { unlinkAllLine, resetMembers, resetMemberPoints, resetProducts } = require('../controllers/adminController');

const router = express.Router();

// ⭐️ requireRole ใน server.js เป็น local function เรียกข้ามไฟล์ไม่ได้ — เขียนซ้ำแบบเดียวกับ
// memberRoutes.js (ไม่ใช่ public path จึงผ่าน authenticateToken/requireCsrf ของ server.js มาก่อนแล้ว)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

router.post('/unlink-line', requireRole('ADMIN'), unlinkAllLine);
router.post('/members', requireRole('ADMIN'), resetMembers);
router.post('/member-points', requireRole('ADMIN'), resetMemberPoints);
router.post('/products', requireRole('ADMIN'), resetProducts);

module.exports = router;
