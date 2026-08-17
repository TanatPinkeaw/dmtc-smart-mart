// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/adminRoutes.js — จับคู่ URL /api/admin/reset/* เข้ากับ handler ล้างข้อมูล (ADMIN)
// ทำอะไร: unlink-line, members, member-points, products → เรียก handler ใน adminController
//   (การบล็อกบน production อยู่ใน controller เอง ผ่าน env ALLOW_DATA_RESET)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Dev/testing data-reset endpoints — ADMIN เท่านั้น, บล็อกทั้งชุดบน production ใน controller เอง
const express = require('express');
const { unlinkAllLine, resetMembers, resetMemberPoints, resetProducts } = require('../controllers/adminController');

const router = express.Router();

// ⭐️ requireRole ใช้ตัวกลางจาก middleware/guards (รวมไว้ที่เดียว — ไม่เขียนซ้ำเอง)
const { requireRole } = require('../middleware/guards');

router.post('/unlink-line', requireRole('ADMIN'), unlinkAllLine);
router.post('/members', requireRole('ADMIN'), resetMembers);
router.post('/member-points', requireRole('ADMIN'), resetMemberPoints);
router.post('/products', requireRole('ADMIN'), resetProducts);

module.exports = router;
