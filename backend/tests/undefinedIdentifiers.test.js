// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/undefinedIdentifiers.test.js — source contract: ห้ามส่ง identifier ที่ไม่ประกาศ
// ─────────────────────────────────────────────────────────────────────────────────────
// 🐛 ที่มา: POST /api/orders 500 ทุกใบ — handler destructure รับ `use_phone_for_points`
//   (snake_case จาก client) แต่ call site ส่ง `usePhoneForPoints` (camelCase) เปล่าๆ ที่
//   ไม่เคยถูกประกาศ → ReferenceError → 500 ทุกออเดอร์ (commit 6f30e5e แก้ไปแล้ว)
//   เทสเดิมเช็คแค่ข้อความ (pointsPolicy.usePhoneForPoints) ไม่เคยเช็คว่า identifier
//   ใน call site อยู่ใน scope จริงหรือไม่
//
// กฎนี้: ไล่ทุก call site ที่ส่ง object literal เป็น argument (`fn({ ... })`) ใน
//   server.js + src/controllers/*.js — identifier ที่ส่งแบบ bare (ไม่มี `:`) ต้องถูก
//   ประกาศจริง: (ก) เป็น destructure จาก req.body/req.params/req.query/req.headers
//   ใน handler/window เดียวกัน หรือ (ข) ถูกประกาศที่ไหนสักแห่งในไฟล์ (require/const/
//   let/var/function params/callback params/catch/for-of)
//
// รันด้วย: node tests/undefinedIdentifiers.test.js  (node:test — อยู่ใน run-all-tests.js)
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const { strict: assert } = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const CONTROLLER_FILES = fs.readdirSync(path.join(__dirname, '..', 'src', 'controllers'))
  .filter(f => f.endsWith('.js'))
  .map(f => ({ name: f, src: fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', f), 'utf8') }));

// ─── parser (อ่าน source ด้วย regex + scan ตัวอักษร — ไม่มี babel) ────────────────

// ตัด comment (// และ /* */) ออกก่อน parse — ข้างใน comment มี pattern `fn({ x })` หลอกเทสได้
// ⚠️ ห้ามใช้ regex 2 รอบ (`/*...*/` แล้ว `//`) — line comment ที่มี `/api/* proxy` ข้างในจะเปิด
//    block comment ปลอม แล้วกินโค้ดจริงไปเป็นร้อยบรรทัด (เจอจริงตอน dev) — ต้อง scan ตัวอักษร
//    รู้สถานะ code/comment/string กัน `/api/*` ใน line comment กับ `//` ใน string หลอก
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {                 // line comment
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {                 // block comment
      const startLine = out.split('\n').length - 1;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';            // เก็บจำนวนบรรทัดเดิมไว้ line จะได้ตรงไฟล์จริง
        i++;
      }
      i += 2;
      void startLine;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {     // string — คัดลอกทั้งก้อน กัน // หรือ /* ใน string
      const q = ch;
      out += ch; i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') { if (i + 1 < src.length) { out += src[i + 1]; i += 2; continue; } }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

// ชื่อทั้งหมดที่ "ประกาศไว้ที่ไหนสักแห่งในไฟล์" (require/const/let/var/function params/
// callback params/catch/for-of) — เป็น scope กว้างๆ กัน false positive จากชื่อซ้ำ
function collectDeclared(src) {
  src = stripComments(src);
  const names = new Set();

  // destructure object จากทุกแหล่ง (require(...) / offlineSale / rows ฯลฯ) —
  // ยกเว้น req.body/params/query/headers (req.* นับเฉพาะใน window เดียวกัน กัน handler อื่นมานับรวม)
  const destRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^;\n]+)/g;
  for (const m of src.matchAll(destRe)) {
    const rhs = m[2].trim();
    if (/req\.(body|params|query|headers)/.test(rhs)) continue;
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const withoutDefault = t.split('=')[0].trim();      // เอา default ค่าออก
      const name = withoutDefault.split(':').pop().trim(); // alias a: b → ชื่อจริงคือ b
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // array destructure: const [a, b] = ... / const [rows] = await pool.query(...)
  const arrDestRe = /(?:const|let|var)\s*\[([^\]]+)\]\s*=\s*([^;\n]+)/g;
  for (const m of src.matchAll(arrDestRe)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const name = t.split('=')[0].trim(); // เอา default ค่าออก
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // const/let/var เดี่ยว (รวม `const item of items` ใน for-of? — จับแยกด้านล่าง)
  const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  for (const m of src.matchAll(declRe)) names.add(m[1]);

  // function declaration + params (รวม anon function)
  const fnRe = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
  for (const m of src.matchAll(fnRe)) {
    names.add(m[1]);
    for (const p of m[2].split(',')) {
      const t = p.trim();
      if (t && !t.includes('=') && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  const anonFnRe = /\b(?:async\s+)?function\s*\(([^)]*)\)/g;
  for (const m of src.matchAll(anonFnRe)) {
    for (const p of m[1].split(',')) {
      const t = p.trim();
      if (t && !t.includes('=') && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }

  // arrow callback params: (req, res) => / async (err) => — ห้ามใช้ \b ก่อน '(' เพราะ
  // ข้างหน้าเป็น ,/space (non-word) จะไม่ match (socket.on('x', (reason) => ...))
  const cbRe = /(?:^|[^\w$])(?:async\s+)?\(([^)]*)\)\s*=>/g;
  for (const m of src.matchAll(cbRe)) {
    for (const p of m[1].split(',')) {
      const t = p.trim();
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }

  // for (const item of ...) / for (const key in ...)
  const forRe = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g;
  for (const m of src.matchAll(forRe)) names.add(m[1]);

  // catch (err)
  const catchRe = /\bcatch\s*\(([^)]*)\)/g;
  for (const m of src.matchAll(catchRe)) {
    const t = m[1].trim();
    if (t && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
  }

  return names;
}

// destructure จาก req.* — เก็บเฉพาะใน window ที่กำหนด (กันชื่อจาก handler อื่นมานับรวม)
function collectReqDestructureIn(windowSrc) {
  const names = new Set();
  const destRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(body|params|query|headers)/g;
  for (const m of windowSrc.matchAll(destRe)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const withoutDefault = t.split('=')[0].trim();
      const name = withoutDefault.split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

// หา call site `fn({ ... })` ทุกจุด — คืน { fn, start, bare: [identifier เปล่าๆ ที่ไม่มี ':'] }
// scan ตัวอักษรจับ depth ของ {} [] () + ข้าม string — แยก argument ด้วย comma ชั้นนอกสุด
function findObjectLiteralCalls(src) {
  // caller (findUndefined) strip comment ให้แล้ว — index ของ src นี้ต้องตรงกับที่ใช้หา window
  const out = [];
  const re = /([A-Za-z_$][\w$]*)\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const fn = m[1];
    let i = m.index + m[0].length; // หลัง '{' เปิดแรก
    let depth = 1;
    let seg = '';
    const segments = [];
    let inStr = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (inStr) {
        seg += ch;
        if (ch === inStr && src[i - 1] !== '\\') inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; seg += ch; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      if (ch === ',' && depth === 1) { segments.push(seg); seg = ''; continue; }
      seg += ch;
    }
    if (seg.trim()) segments.push(seg);
    // เก็บ identifier ที่ "อ้างอิงค่าตัวแปร" ทุกแบบ:
    //   (ก) shorthand: `{ a, b }` → a/b (บัคเดิม usePhoneForPoints เป็นแบบนี้)
    //   (ข) value หลัง colon: `{ key: value }` → value ถ้าเป็น identifier ล้วน — `{ a: undefinedVar }`
    //       ก็ ReferenceError เหมือนกัน (หลัง colon ไม่ใช่แค่ key เสมอ — ต้องเช็ค value ด้วย)
    const tokens = [];
    for (const seg of segments) {
      const s = seg.trim();
      if (!s || s.startsWith('...')) continue;
      if (!s.includes(':')) {
        if (/^[A-Za-z_$][\w$]*$/.test(s)) tokens.push(s);
      } else {
        const value = s.split(':').slice(1).join(':').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(value)) tokens.push(value);
      }
    }
    if (tokens.length > 0) out.push({ fn, start: m.index, bare: tokens });
  }
  return out;
}

// global/J S builtin ที่ใช้ได้ทุกที่ (ไม่มี declaration ในไฟล์ก็ไม่ใช่บัค)
const GLOBALS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis',
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'URL',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Error', 'RegExp', 'Map', 'Set', 'Symbol', 'BigInt', 'Proxy', 'Reflect',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'structuredClone', 'crypto', 'TextEncoder', 'TextDecoder', 'AbortController', 'fetch',
]);

// marker สำหรับตัด window (handler/ฟังก์ชัน) — destructure req.* นับเฉพาะใน window เดียวกัน
function windowMarkers(src, isServer) {
  const out = [];
  const routeRe = /\bapp\.(get|post|put|delete|patch)\s*\(\s*'/g;
  const fnRe = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const arrowRe = /\b(?:async\s+)?\(([^)]*)\)\s*=>\s*\{/g;
  for (const re of isServer ? [routeRe] : [fnRe, arrowRe]) {
    let m;
    while ((m = re.exec(src)) !== null) out.push(m.index);
  }
  out.sort((a, b) => a - b);
  return out;
}

function findUndefined(fileName, src, isServer) {
  // strip comment ครั้งเดียว — index ของ call/marker/window ต้องมาจาก source ชุดเดียวกัน
  // (ก่อนหน้านี้ strip แยกกันทำให้ index ไม่ตรง → window ผิด → flag จุดที่ประกาศแล้ว)
  const clean = stripComments(src);
  const declared = collectDeclared(clean);
  const markers = windowMarkers(clean, isServer);
  const problems = [];
  for (const call of findObjectLiteralCalls(clean)) {
    // หา window ที่ call นี้อยู่ (marker ล่าสุดที่ index <= call.start)
    let winStart = 0;
    for (const mk of markers) {
      if (mk <= call.start) winStart = mk;
      else break;
    }
    const winEnd = markers.find(mk => mk > call.start) ?? clean.length;
    const inWindow = collectReqDestructureIn(clean.slice(winStart, winEnd));
    for (const id of call.bare) {
      if (!declared.has(id) && !inWindow.has(id) && !GLOBALS.has(id)) {
        const line = clean.slice(0, call.start).split('\n').length;
        problems.push({ file: fileName, line, fn: call.fn, id });
      }
    }
  }
  return problems;
}

// ─── เทส ──────────────────────────────────────────────────────────────────────────

describe('source contract — ห้าม identifier ที่ไม่ได้ประกาศใน object call site (กัน ReferenceError)', () => {
  test('server.js — ทุก route handler ส่ง bare identifier ที่ประกาศจริงเท่านั้น', () => {
    const problems = findUndefined('server.js', SERVER, true);
    assert.deepEqual(problems.map(p => `${p.file}:${p.line} ${p.fn}({ ${p.id} })`), [],
      'เจอ identifier ที่ไม่ได้ประกาศ — จะกลายเป็น ReferenceError 500 ตอน runtime (เช่น usePhoneForPoints รอบก่อน)');
  });

  test('controllers — ทุกไฟล์ ส่ง bare identifier ที่ประกาศจริงเท่านั้น', () => {
    const problems = [];
    for (const { name, src } of CONTROLLER_FILES) {
      problems.push(...findUndefined(`controllers/${name}`, src, false));
    }
    assert.deepEqual(problems.map(p => `${p.file}:${p.line} ${p.fn}({ ${p.id} })`), [],
      'เจอ identifier ที่ไม่ได้ประกาศ — จะกลายเป็น ReferenceError 500 ตอน runtime');
  });
});

// export ฟังก์ชัน parser ไว้ debug/ขยายต่อ (รันเทสเฉยๆ ไม่มีผล)
module.exports = { findUndefined, collectDeclared, collectReqDestructureIn, findObjectLiteralCalls, stripComments };

