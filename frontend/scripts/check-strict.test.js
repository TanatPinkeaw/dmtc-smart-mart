// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/check-strict.test.js — เทสหน่วยของ check-strict.js (กันสคริปต์พัง/พลาด)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test)
// ทำอะไร: ครอบ 3 ชั้น
//   1. stripJsoncComments — ต้องตัด comment จริง แต่ห้ามแตะ comment ปลอมใน string
//      (URL ที่มี /* */ หรือ //, string ที่มี escape \" และ \\) และไม่พังกับ comment ไม่ปิดท้าย
//   2. checkConfig — flags ครบ = ผ่าน, ปิด strict/ถอด flag = fail พร้อมข้อความบอกตัวที่ผิด
//   3. readAndCheck — อ่าน tsconfig ตัวอย่างจริง (temp file, แบบ JSONC มี comment)
//      รวมกรณี strict=false ที่ต้อง fail, JSON เสียต้อง throw
//   ปิดท้ายด้วย integration: เรียก CLI จริง (node scripts/check-strict.js) ต้อง exit 0
// ═══════════════════════════════════════════════════════════════════════════════════
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stripJsoncComments,
  checkConfig,
  readAndCheck,
  REQUIRED_APP,
  REQUIRED_NODE,
} from './check-strict.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1) stripJsoncComments ──────────────────────────────────────────────────────────

describe('stripJsoncComments', () => {
  test('ตัด block comment ปกติ', () => {
    assert.equal(stripJsoncComments('{ /* x */ "a": 1 }'), '{  "a": 1 }');
  });

  test('ตัด line comment ปกติ', () => {
    assert.equal(stripJsoncComments('"a": 1 // note\n"b": 2'), '"a": 1 \n"b": 2');
  });

  test('ไม่แตะ comment ปลอมใน string (URL ที่มี /* */)', () => {
    const raw = '{ "url": "https://x/*not*/y" }';
    assert.equal(stripJsoncComments(raw), raw);
  });

  test('ไม่แตะ // ที่อยู่ข้างใน string', () => {
    const raw = '{ "path": "a//b", "c": 1 }';
    assert.equal(stripJsoncComments(raw), raw);
  });

  test('ไม่พังกับ string ที่มี escape \\" และ \\\\ (comment ข้างนอกยังตัด)', () => {
    const raw = '{ "msg": "say \\"hi\\" /* inner */", "n": 2 /* real */ }';
    const out = stripJsoncComments(raw);
    // string ทั้งก้อนต้องคงเดิม รวม /* inner */ ข้างใน
    assert.ok(out.includes('"say \\"hi\\" /* inner */"'), `string ถูกแตะ: ${out}`);
    // comment จริงข้างนอกต้องโดนตัด
    assert.ok(!out.includes('/* real */'), `comment จริงไม่โดนตัด: ${out}`);
    assert.ok(out.includes('"n": 2'), `ฟิลด์ถัดไปเสีย: ${out}`);
  });

  test('comment แบบ block ไม่ปิดท้ายไฟล์ → ตัดตั้งแต่จุดนั้น ไม่ crash', () => {
    const out = stripJsoncComments('{ "a": 1 /* ยังไม่ปิด');
    assert.equal(out, '{ "a": 1 ');
  });

  test('comment แบบ line ต่อท้ายไฟล์ไม่มี newline → ตัด ไม่ crash', () => {
    const out = stripJsoncComments('{ "a": 1 } // end');
    assert.equal(out, '{ "a": 1 } ');
  });

  test('string ไม่ปิด (escape สุดท้าย) → ไม่ crash คืน string ที่เหลือ', () => {
    const out = stripJsoncComments('"a\\"');
    assert.equal(out, '"a\\"');
  });

  test('mixed: comment สลับกับ string หลายก้อน', () => {
    const raw = '{\n  // หัว\n  "x": "a//b", /* กลาง */ "y": "c/*d*/",\n  "z": 3 // ท้าย\n}';
    const out = stripJsoncComments(raw);
    assert.ok(!out.includes('// หัว'));
    assert.ok(!out.includes('/* กลาง */'));
    assert.ok(!out.includes('// ท้าย'));
    assert.ok(out.includes('"x": "a//b"'));
    assert.ok(out.includes('"y": "c/*d*/"'));
    assert.ok(out.includes('"z": 3'));
  });
});

// ── 2) checkConfig ─────────────────────────────────────────────────────────────────

describe('checkConfig', () => {
  test('flags ครบตามที่กำหนด → คืน [] (ผ่าน)', () => {
    assert.deepEqual(
      checkConfig({ strict: true, noUnusedLocals: true, noUnusedParameters: true }, REQUIRED_APP),
      []
    );
  });

  test('ปิด strict → fail พร้อมข้อความบอกค่า', () => {
    const missing = checkConfig({ strict: false, noUnusedLocals: true, noUnusedParameters: true }, REQUIRED_APP);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /strict ต้องเป็น true/);
    assert.match(missing[0], /ตอนนี้เป็น false/);
  });

  test('ถอด flag ทิ้ง (undefined) → fail', () => {
    const missing = checkConfig({ strict: true }, REQUIRED_APP);
    assert.equal(missing.length, 2); // noUnusedLocals + noUnusedParameters
    assert.ok(missing.every(m => m.includes('ต้องเป็น true')));
  });

  test('node config: เช็คแค่ strict (มี flag อื่นเกินไม่เป็นไร)', () => {
    assert.deepEqual(checkConfig({ strict: true, noUnusedLocals: true }, REQUIRED_NODE), []);
    assert.equal(checkConfig({ strict: false }, REQUIRED_NODE).length, 1);
  });

  test('compilerOptions ว่าง → fail ครบทุก flag ที่กำหนด', () => {
    assert.equal(checkConfig({}, REQUIRED_APP).length, Object.keys(REQUIRED_APP).length);
  });
});

// ── 3) readAndCheck กับ tsconfig ตัวอย่างจริง (temp file) ──────────────────────────

describe('readAndCheck', () => {
  let dir;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'check-strict-')); });
  test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const write = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };

  test('tsconfig JSONC ที่ผ่าน (มี comment + string ที่มีเครื่องหมายทับ) → []', () => {
    const p = write('ok.jsonc', `{
  "compilerOptions": {
    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client"], // หมายเหตุ
    "lib": ["ES2023", "DOM"], // https://example.com/a//b
    "path": "a/*b*/c"
  },
  "include": ["src"]
}`);
    assert.deepEqual(readAndCheck(p, REQUIRED_APP), []);
  });

  test('tsconfig ที่ปิด strict (มี comment) → fail บอกตัวที่ผิด', () => {
    const p = write('bad.jsonc', `{
  "compilerOptions": {
    "strict": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}`);
    const missing = readAndCheck(p, REQUIRED_APP);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /strict/);
  });

  test('tsconfig ที่ถอด noUnusedLocals ทิ้ง → fail (app ต้องมีครบ)', () => {
    const p = write('partial.jsonc', '{ "compilerOptions": { "strict": true } }');
    assert.equal(readAndCheck(p, REQUIRED_APP).length, 2);
  });

  test('node config ตัวอย่าง: แค่ strict ก็ผ่านได้', () => {
    const p = write('node.jsonc', '{ "compilerOptions": { "strict": true } }');
    assert.deepEqual(readAndCheck(p, REQUIRED_NODE), []);
  });

  test('JSON เสีย (comment ซ้อนพัง) → throw ไม่เงียบ', () => {
    const p = write('broken.jsonc', '{ "compilerOptions": { "strict": true, }'); // trailing comma + ไม่ปิด
    assert.throws(() => readAndCheck(p, REQUIRED_APP));
  });
});

// ── 4) integration: CLI จริงยังรันผ่าน (guard isMain ทำงาน) ─────────────────────────

describe('CLI', () => {
  test('node scripts/check-strict.js → exit 0 + ✅ ทั้ง 2 config', () => {
    const out = execFileSync(process.execPath, ['scripts/check-strict.js'], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /✅ tsconfig\.app\.json/);
    assert.match(out, /✅ tsconfig\.node\.json/);
  });
});
