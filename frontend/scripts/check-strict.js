// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/check-strict.js — การันตีว่า tsconfig ยังเปิด strict อยู่ กันใครปิดเงียบๆ
//    รันผ่าน `npm run check:strict` (ถูกเรียกใน `npm run build` ก่อน tsc) —
//    ถ้า flags ที่จำเป็นถูกถอด/ปิด จะ fail ทันทีพร้อมบอกว่าตัวไหน
// ═══════════════════════════════════════════════════════════════════════════════════
// หมายเหตุสำหรับ dev: ลอจิกหลัก (stripJsoncComments / checkConfig / readAndCheck)
// เป็น pure function + export ไว้ให้ scripts/check-strict.test.js เทสต์ได้ —
// แก้พฤติกรรมตรงนี้แล้วต้องรัน `npm test` ให้ครอบกรณี comment/string ซ้อนด้วย
// ═══════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ⭐️ flags ที่เราตกลงกันว่าจะเปิดตลอด (แก้ที่นี่ได้ถ้ามีเหตุผลจริง แต่ต้องผ่านเทส/typecheck ครบ)
export const REQUIRED_APP = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
};
export const REQUIRED_NODE = {
  strict: true,
};

// ── ลอจิกบริสุทธิ์ (เทสต์ได้ ไม่แตะ fs/process) ─────────────────────────────────────

// tsconfig เป็น JSONC (มี comment /* */ และ // ฝังอยู่) — strip ทิ้งก่อน parse
// ระวัง: ต้องไม่แตะ comment ปลอมที่อยู่ข้างใน string (เช่น "url": "https://x/*y*/")
// และไม่พังกับ string ที่มี escape (\") หรือ comment ที่ไม่ปิดท้ายไฟล์
export function stripJsoncComments(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    const next = raw[i + 1];
    if (c === '/' && next === '*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else if (c === '/' && next === '/') {
      const end = raw.indexOf('\n', i + 2);
      if (end === -1) {
        i = raw.length; // comment ต่อท้ายไฟล์ ไม่มี newline — ตัดจบเลย
      } else {
        out += '\n'; // คง newline ไว้ ให้บรรทัดถัดไปไม่ขยับ (JSON ไม่สนใจ whitespace อยู่แล้ว)
        i = end + 1;
      }
    } else if (c === '"') {
      // ข้าม string ทั้งก้อน (กัน comment ปลอมใน string) — ระวัง escape \" และ \\ ต่อท้าย
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') {
          j += 2; // ข้าม escape (อาจเป็น \" หรือ \\ หรือ \n ฯลฯ)
        } else if (raw[j] === '"') {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      out += raw.slice(i, j);
      i = j;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ตรวจ compilerOptions กับ flags ที่ต้องมี — คืน [] = ผ่าน, คืนรายการที่ขาด/เพี้ยน
export function checkConfig(compilerOptions, required) {
  return Object.entries(required)
    .filter(([k, v]) => compilerOptions[k] !== v)
    .map(([k, v]) => `${k} ต้องเป็น ${JSON.stringify(v)} (ตอนนี้เป็น ${JSON.stringify(compilerOptions[k])})`);
}

// อ่านไฟล์ tsconfig (รองรับ JSONC) แล้วตรวจ — คืน [] = ผ่าน, throw ถ้า JSON เสีย
export function readAndCheck(filePath, required) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(stripJsoncComments(raw));
  return checkConfig(parsed.compilerOptions || {}, required);
}

// ── CLI entry (รันเฉพาะตอนเรียกตรงๆ ไม่ใช่ตอนโดน import เพื่อเทสต์) ─────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let failed = false;
  const checks = [
    ['tsconfig.app.json', REQUIRED_APP],
    ['tsconfig.node.json', REQUIRED_NODE],
  ];
  for (const [rel, required] of checks) {
    try {
      const missing = readAndCheck(resolve(root, rel), required);
      if (missing.length > 0) {
        console.error(`❌ ${rel} — strict mode ถูกปิด/ผ่อนปรน: ${missing.join(', ')}`);
        failed = true;
      } else {
        console.log(`✅ ${rel} — flags ครบ (${Object.keys(required).join(', ')})`);
      }
    } catch (e) {
      console.error(`❌ ${rel} — อ่านไฟล์ไม่ได้: ${e.message}`);
      failed = true;
    }
  }
  if (failed) {
    console.error('\n🚫 ห้ามปิด strict/flags เหล่านี้โดยไม่มีเหตุผล — ถ้าจำเป็นจริงให้คุยกันก่อน แล้วอัปเดตสคริปต์นี้');
    process.exitCode = 1;
  }
}
