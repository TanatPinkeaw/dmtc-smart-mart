// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueLabelsCoverage.test.ts — เทส coverage: ทุก mutation endpoint มีป้ายไทยครบ
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — อ่าน source ด้วย fs ไม่ import หน้าเว็บ)
// ทำอะไร: สแกนไฟล์ .ts/.tsx ทั่ว frontend/src หา api.post/put/patch/delete(...) ทุกจุด แล้ว
//   เช็คว่า path ของ endpoint แต่ละอัน match ป้ายไทยใน queueLabels.ts (LABELS) — ถ้าเพิ่ม
//   mutation endpoint ใหม่แล้วลืมเติมป้ายใน LABELS เทสนี้ fail ทันที (ระบุไฟล์+URL ให้)
//
// วิธีจัดการ URL:
//   - string ตรง (เช่น '/sales/checkout') → เช็คเต็ม
//   - template literal (เช่น `/orders/${id}/status`) → เอา static prefix ก่อน ${ แรก (='/orders/')
//     — ถ้า dynamic ตั้งแต่ segment แรก (เช่น `/${entity}/import`) ตรวจ statically ไม่ได้ → ข้าม
//     (endpoint นั้นมี label อยู่แล้วใน LABELS — ดูรายการที่ static แทน)
//   - query string ตัดออกก่อน match (idempotency-key ฯลฯ)
// ═══════════════════════════════════════════════════════════════════════════════════
// tsconfig.app.json จำกัด types ไว้แค่ "vite/client" — ดึง types ของ node เข้าเฉพาะไฟล์นี้ (เทสต้องใช้ node:test)
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS } from './queueLabels.ts';

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// ดึง URL argument (string/template) ของ api.post/put/patch/delete — คืน static prefix ของแต่ละจุด
function extractStaticUrls(src: string): string[] {
  const urls: string[] = [];
  const re = /api\.(?:post|put|patch|delete)\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const raw = m[1];
    if (raw.startsWith('`')) {
      const inner = raw.slice(1, -1);
      const dynIdx = inner.indexOf('${');
      if (dynIdx === 0) continue; // dynamic ตั้งแต่ segment แรก — ตรวจ statically ไม่ได้
      urls.push(dynIdx === -1 ? inner : inner.slice(0, dynIdx));
    } else {
      urls.push(raw.slice(1, -1));
    }
  }
  return urls;
}

function labelFor(url: string): string | null {
  const p = url.split('?')[0];
  const found = LABELS.find(([prefix]) => p === prefix || p.startsWith(prefix + '/'));
  return found ? found[1] : null;
}

describe('coverage: ทุก mutation endpoint (api.post/put/patch/delete) มีป้ายไทยใน LABELS', () => {
  test('ไม่มี endpoint ไหนตกหล่น (เพิ่ม API แล้วลืมเติมป้าย = fail พร้อมบอกไฟล์+URL)', () => {
    const missing: Array<[string, string]> = [];
    for (const file of walk(srcRoot)) {
      const src = readFileSync(file, 'utf8');
      for (const url of extractStaticUrls(src)) {
        if (!url.startsWith('/') || url === '/') continue; // relative/ว่าง — ไม่ใช่ path หลัก
        if (!labelFor(url)) missing.push([file.replace(srcRoot + path.sep, ''), url]);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `endpoint ที่ยังไม่มีป้ายไทยใน queueLabels.ts:\n${JSON.stringify(missing, null, 2)}\n→ เพิ่ม entry ใน LABELS (ระวังลำดับ prefix ทับกัน)`,
    );
  });

  test('LABELS ครอบ prefix หลักครบ (smoke — กันเทสบนโดนแก้จนไม่ตรวจอะไร)', () => {
    for (const p of ['/sales', '/orders', '/attendance', '/shifts', '/members', '/users', '/products', '/categories', '/suppliers', '/promotions', '/purchases', '/member-groups', '/settings', '/notifications', '/schedules', '/holidays', '/admin', '/auth']) {
      assert.ok(labelFor(p), `LABELS ต้องครอบ ${p}`);
    }
  });
});
