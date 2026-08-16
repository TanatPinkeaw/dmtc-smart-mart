// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/memberGroups.test.js — เทสหน่วย buildGroupUpdateSql (partial update ของกลุ่มสมาชิก)
// ─────────────────────────────────────────────────────────────────────────────────────
// กันบัค: เดิม PUT /api/member-groups/:id เขียนทับทุกคอลัมน์ด้วย `description || null`
//   → client ที่ส่งแค่ % ส่วนลด (LoyaltySettingsPanel) ทำให้ description ของกลุ่มหายเงียบๆ
// เทสนี้ยืนยันว่า partial update ไม่แตะ field ที่ไม่ได้ส่ง และ null ชัดๆ ยังล้างได้
// รัน: node tests/memberGroups.test.js (ไม่ต้องใช้ DB — ทดสอบ pure function โดยตรง)
// ⭐️ import จาก utils/memberGroupUpdate.js ตรงๆ (zero dependency) — อย่า require controller
//   เพราะมัน require ../config/db ที่รัน initDB + ค้าง pool ตอน require ไป
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGroupUpdateSql } = require('../src/utils/memberGroupUpdate');

const ID = 7;

test('A. ไม่ส่ง description (กรณีบัคเดิมจาก LoyaltySettingsPanel) → SQL ไม่แตะคอลัมน์ description', () => {
  const upd = buildGroupUpdateSql({ name: 'อาจารย์', default_discount_percent: 10 }, ID);
  assert.ok(upd, 'ต้องมีคำสั่งอัปเดต');
  assert.ok(!upd.sql.includes('description'), 'SQL ต้องไม่มี description เมื่อไม่ส่งมา');
  assert.ok(upd.sql.includes('name = ?') && upd.sql.includes('default_discount_percent = ?'));
  assert.deepEqual(upd.values, ['อาจารย์', 10, ID]);
});

test('B. ส่ง description: null ชัดๆ → ยังล้างได้ (ความตั้งใจเดิมไม่เสีย)', () => {
  const upd = buildGroupUpdateSql({ name: 'อาจารย์', description: null }, ID);
  assert.ok(upd.sql.includes('description = ?'));
  assert.equal(upd.values[1], null);
  assert.equal(upd.values[2], ID);
});

test('C. ส่ง field เดียว (name) → เกิดเฉพาะคอลัมน์นั้น', () => {
  const upd = buildGroupUpdateSql({ name: 'นักเรียน' }, ID);
  assert.equal(upd.sql, 'UPDATE member_groups SET name = ? WHERE id = ?');
  assert.deepEqual(upd.values, ['นักเรียน', ID]);
});

test('D. ส่ง default_discount_percent ตัวเดียว → ไม่แตะ name/description', () => {
  const upd = buildGroupUpdateSql({ default_discount_percent: 15 }, ID);
  assert.ok(!upd.sql.includes('name'));
  assert.ok(!upd.sql.includes('description'));
  assert.deepEqual(upd.values, [15, ID]);
});

test('E. body ว่าง {} → คืน null (caller ตอบ 400)', () => {
  assert.equal(buildGroupUpdateSql({}, ID), null);
});

test('F. body undefined → คืน null', () => {
  assert.equal(buildGroupUpdateSql(undefined, ID), null);
  assert.equal(buildGroupUpdateSql(null, ID), null);
});

test('G. default_discount_percent เป็น string "10" → แปลงเป็น Number', () => {
  const upd = buildGroupUpdateSql({ default_discount_percent: '10' }, ID);
  assert.equal(upd.values[0], 10);
});

test('H. default_discount_percent เป็น 0 → เก็บ 0 (ไม่ fallback เป็นค่า default)', () => {
  const upd = buildGroupUpdateSql({ default_discount_percent: 0 }, ID);
  assert.equal(upd.values[0], 0);
});

test('I. default_discount_percent เป็นค่าบ้า "abc" → fallback 0', () => {
  const upd = buildGroupUpdateSql({ default_discount_percent: 'abc' }, ID);
  assert.equal(upd.values[0], 0);
});

test('J. name เป็น string ว่าง "" → ยังถือว่าส่ง (อัปเดตเป็นค่าว่างได้)', () => {
  const upd = buildGroupUpdateSql({ name: '' }, ID);
  assert.deepEqual(upd.values, ['', ID]);
});

test('K. หลาย field + id → values ต่อท้าย id เสมอ (parameter order ถูก)', () => {
  const upd = buildGroupUpdateSql({ name: 'x', default_discount_percent: 5, description: 'd' }, 99);
  assert.equal(upd.values.length, 4);
  assert.equal(upd.values[3], 99);
  assert.equal(upd.sql, 'UPDATE member_groups SET name = ?, default_discount_percent = ?, description = ? WHERE id = ?');
});
