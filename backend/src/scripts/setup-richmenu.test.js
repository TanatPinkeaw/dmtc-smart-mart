// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/setup-richmenu.test.js — เทสหน่วยของสคริปต์ตั้ง Rich Menu LINE (กันพัง/พลาด)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm run test:richmenu (หรือ npm test ซึ่งต่อท้าย smokeTest อยู่แล้ว)
// ทำอะไร: เทส main(argv, deps) ผ่าน DI — ส่ง createRichMenu/log/exit จำลองเข้าไป
//   ไม่ต้องยิง LINE จริง/มีรูปไฟล์จริง ครอบ:
//   1. ไม่ระบุ path รูป → fail + โชว์ usage
//   2. ระบุ path → เรียก createRichMenu ด้วย path นั้น (raw) + log path absolute + สำเร็จ
//   3. service พัง → fail + log error (ไม่เงียบ)
//   4. path สัมพัทธ์ → resolve เป็น absolute ใน log
//   ปิดท้าย: contract ของ richmenu-config.json (schema ที่ LINE ต้องได้) — กันแก้โครงสร้างแล้ว
//   สคริปต์ยิงไปโดน LINE reject
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { main } = require('./setup-richmenu.js');
const richMenuConfig = require('../config/richmenu-config.json');

// ── helpers ─────────────────────────────────────────────────────────────────────────

// สร้าง deps จำลอง — เก็บ log/exit/calls ไว้ตรวจ
function fakeDeps(overrides = {}) {
  const calls = { createRichMenuArgs: [], exitCodes: [] };
  const logs = [];
  const errors = [];
  const deps = {
    createRichMenu: async (imagePath) => {
      calls.createRichMenuArgs.push(imagePath);
      return { richMenuId: 'richmenu-fake-123' };
    },
    log: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    },
    exit: (code) => { calls.exitCodes.push(code); },
    ...overrides,
  };
  return { deps, calls, logs, errors };
}

// ── 1) main() — ฟลว CLI หลัก ───────────────────────────────────────────────────────

describe('setup-richmenu main()', () => {
  test('ไม่ระบุ path รูป → fail + โชว์ usage + exit(1)', async () => {
    const { deps, calls, errors } = fakeDeps();
    const result = await main(['node', 'setup-richmenu.js'], deps);

    assert.deepEqual(result, { ok: false, reason: 'missing-image-path' });
    assert.deepEqual(calls.exitCodes, [1]);
    assert.equal(calls.createRichMenuArgs.length, 0, 'ต้องไม่เรียก LINE service');
    assert.ok(errors.some(e => e.includes('ไม่ได้ระบุ path')), 'ต้องโชว์ข้อความ error');
    assert.ok(errors.some(e => e.includes('Usage:')), 'ต้องโชว์ usage');
  });

  test('ระบุ path → เรียก createRichMenu ด้วย path raw + log path absolute + สำเร็จ', async () => {
    const { deps, calls, logs, errors } = fakeDeps();
    const imagePath = './my-richmenu.png';
    const result = await main(['node', 'setup-richmenu.js', imagePath], deps);

    assert.deepEqual(result, { ok: true, richMenuId: 'richmenu-fake-123' });
    assert.deepEqual(calls.exitCodes, [0]);
    // ส่ง path เดิมตรงๆ (ไม่ resolve) ให้ service — resolve ใช้แค่ตอนโชว์ log
    assert.deepEqual(calls.createRichMenuArgs, [imagePath]);
    assert.ok(logs.some(l => l.includes('✅') && l.includes('richmenu-fake-123')), 'ต้อง log สำเร็จพร้อม id');
    assert.ok(logs.some(l => l.includes('📄 ไฟล์รูป:') && l.includes(path.resolve(imagePath))), 'ต้อง log path absolute');
    assert.equal(errors.length, 0, 'ต้องไม่มี error ใน path สำเร็จ');
  });

  test('path สัมพัทธ์/มีช่องว่าง → resolve absolute ถูกต้องใน log', async () => {
    const { deps, logs } = fakeDeps();
    const rel = './รูป เมนูใหม่.png';
    await main(['node', 'setup-richmenu.js', rel], deps);
    const fileLine = logs.find(l => l.includes('📄 ไฟล์รูป:'));
    assert.ok(fileLine, 'ต้องมีบรรทัดไฟล์รูป');
    assert.equal(fileLine, `📄 ไฟล์รูป: ${path.resolve(rel)}`);
  });

  test('service พัง → fail + log error ไม่เงียบ + exit(1)', async () => {
    const boom = new Error('LINE API 401 Unauthorized');
    const { deps, calls, errors } = fakeDeps({
      createRichMenu: async () => { throw boom; },
    });
    const result = await main(['node', 'setup-richmenu.js', './x.png'], deps);

    assert.deepEqual(result, { ok: false, reason: 'service-error', message: boom.message });
    assert.deepEqual(calls.exitCodes, [1]);
    assert.ok(errors.some(e => e.includes('ไม่สำเร็จ') && e.includes(boom.message)), 'ต้อง log error พร้อม message');
  });

  test('main เรียกได้ซ้ำ (ไม่มี state ค้าง) — path สำเร็จ 2 รอบติด', async () => {
    const { deps, calls } = fakeDeps();
    await main(['node', 'setup-richmenu.js', 'a.png'], deps);
    await main(['node', 'setup-richmenu.js', 'b.png'], deps);
    assert.deepEqual(calls.createRichMenuArgs, ['a.png', 'b.png']);
    assert.deepEqual(calls.exitCodes, [0, 0]);
  });
});

// ── 2) richmenu-config.json — schema ที่ LINE API บังคับ (กันแก้แล้วยิงไม่ผ่าน) ──────

describe('richmenu-config.json contract', () => {
  test('มีฟิลด์บังคับครบ (size/selected/name/chatBarText/areas)', () => {
    assert.ok(richMenuConfig.size, 'ต้องมี size');
    assert.equal(typeof richMenuConfig.size.width, 'number');
    assert.equal(typeof richMenuConfig.size.height, 'number');
    assert.equal(typeof richMenuConfig.selected, 'boolean');
    assert.ok(typeof richMenuConfig.name === 'string' && richMenuConfig.name.length > 0, 'name ต้องไม่ว่าง');
    assert.ok(typeof richMenuConfig.chatBarText === 'string' && richMenuConfig.chatBarText.length > 0, 'chatBarText ต้องไม่ว่าง');
    assert.ok(Array.isArray(richMenuConfig.areas) && richMenuConfig.areas.length > 0, 'ต้องมี areas อย่างน้อย 1 ปุ่ม');
  });

  test('ทุก area อยู่ในกรอบ 2500×1686 (LINE บังคับ) + action มี type ถูกต้อง', () => {
    const { width, height } = richMenuConfig.size;
    assert.equal(width, 2500, 'LINE กำหนดกว้าง 2500px อย่างเดียว');
    assert.equal(height, 1686, 'LINE กำหนดสูง 1686px อย่างเดียว');

    const ALLOWED_ACTIONS = new Set(['postback', 'message', 'uri', 'datetimepicker', 'camera', 'cameraRoll', 'location', 'richmenuswitch']);
    for (const [i, area] of richMenuConfig.areas.entries()) {
      const { bounds, action } = area;
      assert.ok(bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y), `area[${i}] bounds ต้องมี x/y`);
      assert.ok(Number.isFinite(bounds.width) && Number.isFinite(bounds.height), `area[${i}] bounds ต้องมี width/height`);
      assert.ok(bounds.x >= 0 && bounds.y >= 0, `area[${i}] ต้องไม่ติดลบ`);
      assert.ok(bounds.x + bounds.width <= width, `area[${i}] ล้นขอบขวา (x+width > ${width})`);
      assert.ok(bounds.y + bounds.height <= height, `area[${i}] ล้นขอบล่าง (y+height > ${height})`);
      assert.ok(action && typeof action.type === 'string' && ALLOWED_ACTIONS.has(action.type),
        `area[${i}] action.type ต้องเป็นหนึ่งใน LINE schema (ได้ ${action && action.type})`);
      if (action.type === 'message') {
        assert.ok(action.text && action.text.length > 0, `area[${i}] message action ต้องมี text`);
      }
      if (action.type === 'uri') {
        assert.ok(/^https?:\/\//.test(action.uri || ''), `area[${i}] uri action ต้องเป็น http(s)://`);
      }
    }
  });
});
