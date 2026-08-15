// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 routes/settingsRoutes.js — จับคู่ /api/settings/* เข้ากับ handler ใน settingsController + สิทธิ์
// ทำอะไร: ประกาศ path (/store, /receipt, /loyalty) → handler ตัวไหน + role ไหน — logic อยู่ใน controller
// จุดสำคัญ: mount ที่ /api/settings ใน server.js ; GET เปิดทุก role ที่ล็อกอิน, PUT เฉพาะ ADMIN/MANAGER
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — ย้ายออกจาก server.js ทีละกลุ่ม ไม่เปลี่ยน path/พฤติกรรม
const express = require('express');
const { requireRole, validateRequest } = require('../middleware/guards');
const { storeSettingsValidator } = require('../validators');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.get('/store', settingsController.getStore);
router.put('/store', requireRole('ADMIN', 'MANAGER'), validateRequest(storeSettingsValidator), settingsController.updateStore);
router.get('/receipt', settingsController.getReceipt);
router.get('/loyalty', settingsController.getLoyalty);
router.put('/loyalty', requireRole('ADMIN', 'MANAGER'), settingsController.updateLoyalty);

module.exports = router;
