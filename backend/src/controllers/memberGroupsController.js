// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/memberGroupsController.js — logic กลุ่มสมาชิก + rule ส่วนลดรายหมวดหมู่
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ของ /api/member-groups/* — CRUD กลุ่มสมาชิก (ชื่อ/รหัส/ส่วนลด default) และ
//   rule ส่วนลดรายหมวดหมู่ต่อกลุ่ม (upsert ด้วย UNIQUE (group_id, category_id))
// จุดสำคัญ: ลบกลุ่มปลอดภัย — users.group_id เป็น ON DELETE SET NULL, rules เป็น ON DELETE CASCADE
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase B (refactor) — ย้ายออกจาก server.js ตรงๆ (mount /api/member-groups) พฤติกรรม/path เดิม
const pool = require('../config/db');
const { buildGroupUpdateSql } = require('../utils/memberGroupUpdate');
const { serverError, badRequest } = require('../utils/http');

// GET /api/member-groups — กลุ่มทั้งหมดพร้อม rules (nest rules เข้าใต้แต่ละกลุ่ม)
async function list(req, res) {
  try {
    const [groups] = await pool.query('SELECT * FROM member_groups ORDER BY id');
    const [rules] = await pool.query(
      `SELECT r.id, r.group_id, r.category_id, r.discount_percent, c.name AS category_name
       FROM group_discount_rules r LEFT JOIN categories c ON r.category_id = c.id ORDER BY r.group_id, c.name`
    );
    const byGroup = new Map(groups.map(g => [g.id, { ...g, rules: [] }]));
    for (const r of rules) byGroup.get(r.group_id)?.rules.push(r);
    res.json([...byGroup.values()]);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// POST /api/member-groups — เพิ่มกลุ่ม (code ต้องไม่ซ้ำ — UNIQUE)
async function create(req, res) {
  const { name, code, default_discount_percent, description } = req.body;
  if (!name || !code) return badRequest(res, 'ต้องระบุชื่อและรหัสกลุ่ม');
  try {
    const [result] = await pool.query(
      'INSERT INTO member_groups (name, code, default_discount_percent, description) VALUES (?, ?, ?, ?)',
      [name, String(code).toUpperCase().trim(), Number(default_discount_percent) || 0, description || null]
    );
    res.status(201).json({ id: result.insertId, message: 'เพิ่มกลุ่มสมาชิกสำเร็จ' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return badRequest(res, 'รหัสกลุ่มนี้ซ้ำกับที่มีอยู่แล้ว');
    console.error('[500]', error.message);
    serverError(res);
  }
}

// PUT /api/member-groups/:id — แก้กลุ่ม (code แก้ไม่ได้ที่นี่ — ล็อกไว้)
// ⭐️ Partial update: ส่งเฉพาะ field ที่ต้องการแก้ — field ที่ไม่ส่ง (undefined) คงค่าเดิมไว้
//   (เดิมเขียนทับทุกคอลัมน์ด้วย `description || null` → client ที่ส่งแค่ % ส่วนลดทำให้ description หายเงียบๆ)
//   ตั้งใจล้าง description ให้ส่ง null มาชัดๆ
async function update(req, res) {
  try {
    const upd = buildGroupUpdateSql(req.body, req.params.id);
    if (!upd) return badRequest(res, 'ไม่มีข้อมูลที่ต้องการอัปเดต');
    await pool.query(upd.sql, upd.values);
    res.json({ message: 'อัปเดตกลุ่มสมาชิกสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// DELETE /api/member-groups/:id — ลบกลุ่ม (users.group_id SET NULL, rules CASCADE)
async function remove(req, res) {
  try {
    await pool.query('DELETE FROM member_groups WHERE id = ?', [req.params.id]);
    res.json({ message: 'ลบกลุ่มสมาชิกสำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// POST /api/member-groups/:id/rules — เพิ่ม/อัปเดต rule รายหมวดหมู่ (upsert)
async function addRule(req, res) {
  const { category_id, discount_percent } = req.body;
  if (!category_id) return badRequest(res, 'ต้องเลือกหมวดหมู่');
  try {
    await pool.query(
      `INSERT INTO group_discount_rules (group_id, category_id, discount_percent) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent)`,
      [req.params.id, category_id, Number(discount_percent) || 0]
    );
    res.status(201).json({ message: 'บันทึกส่วนลดรายหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// DELETE /api/member-groups/:id/rules/:ruleId — ลบ rule รายหมวดหมู่
async function removeRule(req, res) {
  try {
    await pool.query('DELETE FROM group_discount_rules WHERE id = ? AND group_id = ?', [req.params.ruleId, req.params.id]);
    res.json({ message: 'ลบส่วนลดรายหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

module.exports = { list, create, update, remove, addRule, removeRule };
