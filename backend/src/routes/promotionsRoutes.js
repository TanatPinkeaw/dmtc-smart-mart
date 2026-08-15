// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/promotionsRoutes.js — จับคู่ /api/promotions/* เข้ากับ promotionsController + สิทธิ์
// จุดสำคัญ: GET / และ /active เป็น public (POS/แบนเนอร์ใช้) ; create/verify ต้องมี role
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — mount /api/promotions ใน server.js (path เดิมไม่เปลี่ยน)
const express = require('express');
const { requireRole, validateRequest } = require('../middleware/guards');
const { promotionValidator } = require('../validators');
const c = require('../controllers/promotionsController');

const router = express.Router();

router.get('/', c.list);
router.get('/active', c.active);
router.post('/', requireRole('ADMIN', 'MANAGER'), validateRequest(promotionValidator), c.create);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), c.remove);
router.post('/verify', requireRole('CASHIER', 'ADMIN'), c.verify);

module.exports = router;
