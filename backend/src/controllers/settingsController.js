// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/settingsController.js — logic ของหน้าตั้งค่าร้าน + อัตราแต้มสะสม
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ของ /api/settings/* — ข้อมูลร้าน (ชื่อ/เลขภาษี/ที่อยู่/ท้ายใบเสร็จ) และอัตราแต้ม
//   สะสม (บาทต่อ 1 แต้ม / มูลค่าต่อแต้ม) ที่ POS+PreOrder ดึงไปคำนวณ preview ให้ตรงกับ backend
// จุดสำคัญ: ทุกอย่างเก็บใน settings แถว id=1 แถวเดียว ; points_redeem_value_per_point เป็น
//   DECIMAL(10,4) — ค่าละเอียดเกิน 4 ตำแหน่งจะถูกปัดเงียบๆ จึงปัด+เช็คก่อนบันทึก (เคยเป็นบั๊ก)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — ย้ายออกจาก server.js ตรงๆ ไม่เปลี่ยน path/พฤติกรรม (mount /api/settings)
const pool = require('../config/db');

// GET /api/settings/store — ข้อมูลร้านทั้งแถว (เปิดให้ทุก role ที่ล็อกอิน ใช้โชว์หัวใบเสร็จ ฯลฯ)
async function getStore(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// PUT /api/settings/store — แก้ข้อมูลร้าน (ADMIN/MANAGER, ผ่าน storeSettingsValidator มาแล้ว)
async function updateStore(req, res) {
  const { store_name, tax_id, address, receipt_footer } = req.body;
  try {
    await pool.query(
      'UPDATE settings SET store_name = ?, tax_id = ?, address = ?, receipt_footer = ? WHERE id = 1',
      [store_name, tax_id, address, receipt_footer]
    );
    res.json({ message: "อัปเดตข้อมูลร้านค้าสำเร็จ" });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/settings/receipt — เอาแค่ข้อความท้ายใบเสร็จ (หน้าใบเสร็จเรียกใช้)
async function getReceipt(req, res) {
  try {
    const [rows] = await pool.query('SELECT receipt_footer FROM settings WHERE id = 1');
    res.json({ receipt_footer: rows[0].receipt_footer });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/settings/loyalty — อัตราแต้ม + ส่วนลด default ของกลุ่มสมาชิก
// เปิดให้ทุก role ที่ล็อกอิน เพราะ CASHIER ต้องรู้อัตราตอนคิดเงิน (default 20 บาท/แต้ม, 1 บาท/แต้ม)
async function getLoyalty(req, res) {
  try {
    const [[s]] = await pool.query('SELECT points_earn_amount_per_point, points_redeem_value_per_point FROM settings WHERE id = 1');
    const [groups] = await pool.query('SELECT id, name, code, default_discount_percent FROM member_groups ORDER BY id');
    res.json({
      points_earn_amount_per_point: Number(s?.points_earn_amount_per_point) || 20,
      points_redeem_value_per_point: Number(s?.points_redeem_value_per_point) || 1,
      groups,
    });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// PUT /api/settings/loyalty — ตั้งอัตราแต้มสะสม (ADMIN/MANAGER)
async function updateLoyalty(req, res) {
  const { points_earn_amount_per_point, points_redeem_value_per_point } = req.body;
  const earn = Number(points_earn_amount_per_point);
  const redeem = Number(points_redeem_value_per_point);
  if (!Number.isFinite(earn) || earn <= 0) return res.status(400).json({ error: 'จำนวนบาทต่อ 1 แต้ม ต้องเป็นตัวเลขมากกว่า 0' });
  if (!Number.isFinite(redeem) || redeem <= 0) return res.status(400).json({ error: 'มูลค่าต่อแต้ม ต้องเป็นตัวเลขมากกว่า 0' });
  // 🐛 FIX — column เก็บได้ 4 ตำแหน่งทศนิยม (DECIMAL(10,4)) ค่าที่ละเอียดกว่านั้นจะถูกปัดเหลือ 0 แบบ
  // เงียบๆ ตอน UPDATE (ไม่มี error ใดๆ) ทำให้แอดมินคิดว่าบันทึกค่าหนึ่งไปแต่ระบบใช้จริงเป็นอีกค่า
  // (ตกไปใช้ default 1 บาท/แต้มแทน เพราะ 0 ไม่ผ่านเช็ค >0 ใน getLoyaltyRates) — ปัดเองตรงนี้ก่อน แล้ว
  // เช็คว่าปัดแล้วยังไม่เป็น 0 ถ้าเป็น 0 คือค่าที่กรอกมาละเอียดเกินกว่าระบบรองรับ ให้ error ชัดเจนแทน
  const redeemRounded = Math.round(redeem * 10000) / 10000;
  if (redeemRounded <= 0) return res.status(400).json({ error: 'มูลค่าต่อแต้มละเอียดเกินไป (รองรับสูงสุด 4 ตำแหน่งทศนิยม เช่น 0.0001)' });
  try {
    await pool.query(
      'UPDATE settings SET points_earn_amount_per_point = ?, points_redeem_value_per_point = ? WHERE id = 1',
      [Math.round(earn), redeemRounded]
    );
    res.json({ message: 'อัปเดตอัตราแต้มสะสมสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = { getStore, updateStore, getReceipt, getLoyalty, updateLoyalty };
