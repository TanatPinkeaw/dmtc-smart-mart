// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/memberGroupsRoutes.js — จับคู่ /api/member-groups/* เข้ากับ memberGroupsController + สิทธิ์
// จุดสำคัญ: ทุก endpoint เป็น ADMIN/MANAGER เท่านั้น (จัดการกลุ่มสมาชิก + rule ส่วนลด)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — mount /api/member-groups ใน server.js (path เดิมไม่เปลี่ยน)
const express = require('express');
const { requireRole } = require('../middleware/guards');
const c = require('../controllers/memberGroupsController');

const router = express.Router();

router.get('/', requireRole('ADMIN', 'MANAGER'), c.list);
router.post('/', requireRole('ADMIN', 'MANAGER'), c.create);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), c.update);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), c.remove);
router.post('/:id/rules', requireRole('ADMIN', 'MANAGER'), c.addRule);
router.delete('/:id/rules/:ruleId', requireRole('ADMIN', 'MANAGER'), c.removeRule);

module.exports = router;
