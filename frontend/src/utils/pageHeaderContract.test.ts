// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/pageHeaderContract.test.ts — source contract: แถบหัวหน้าหน้าแบบเดียวทั้งแอป
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — อ่าน source ด้วย fs ไม่ import component)
// ทำอะไร: ล็อก "แถบหัวหน้า" มาตรฐานเดียว (PageHeader) กันใครแก้กลับไปเป็น 2 แบบอีก
//   (เคยมี 2 แบบ: แถบลอยชิดขอบ กับ การ์ดมน rounded-3xl ที่ icon/title ต่างกัน):
//   • PageHeader.tsx ต้องมี anatomy มาตรฐาน (band flush px-4 py-3.5 + icon w-8 + text-lg)
//     และห้ามใส่ rounded-3xl / text-xl ลงไป (band ต้องลอย ไม่ใช่การ์ดมน)
//   • ทั่ว src (pages + components) ห้ามมีลายเซ็น header แบบเก่ากลับมา:
//     — wrapper การ์ดมน: flex items-center + bg-gradient-to-r from-brand + rounded-3xl
//     — icon box ใหญ่กว่า w-8: w-9/10/11/12 + bg-white/20
//     — title ขนาดเก่า: text-xl font-semibold text-white
// ═══════════════════════════════════════════════════════════════════════════════════
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // = src/
const PAGE_HEADER_SRC = readFileSync(resolve(BASE, 'components/layout/PageHeader.tsx'), 'utf8');

// ⭐️ สแกน .ts/.tsx ทั่ว src ยกเว้นไฟล์เทส (test มี pattern เหล่านี้เป็น string ในโค้ด —
// สแกนตัวเองจะ false positive) + ยกเว้น PageHeader เอง (เป็นตัวกำหนดมาตรฐาน ไม่ใช่ผู้ใช้)
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SCAN_FILES = listTsFiles(BASE).filter(f =>
  !/\.test\.tsx?$/.test(f) && !f.endsWith('components/layout/PageHeader.tsx'),
);

describe('PageHeader — แถบหัวหน้ามาตรฐาน (anatomy ตัวเดียว)', () => {
  test('band ต้อง flush (px-4 py-3.5) + gradient แบรนด์ — ห้ามเป็น rounded-3xl', () => {
    assert.ok(PAGE_HEADER_SRC.includes('bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5'),
      'PageHeader ต้องใช้แถบ gradient flush เดียวกับ POS/PreOrder (px-4 py-3.5)');
    assert.ok(!PAGE_HEADER_SRC.includes('rounded-3xl'),
      'PageHeader ห้ามใส่ rounded-3xl — แถบหัวหน้าต้องลอยชิดขอบ ไม่ใช่การ์ดมน');
  });

  test('icon box w-8 + icon size 16 + title text-lg (ไม่ใช่ w-9+/text-xl แบบเก่า)', () => {
    assert.ok(PAGE_HEADER_SRC.includes('w-8 h-8 bg-white/20 rounded-xl'),
      'PageHeader ต้องใช้ icon box w-8 h-8 (มาตรฐานเดียวกับ POS/PreOrder)');
    assert.ok(PAGE_HEADER_SRC.includes('size={16}'), 'icon ต้อง size 16');
    assert.ok(PAGE_HEADER_SRC.includes('text-lg font-semibold text-white truncate'),
      'title ต้อง text-lg font-semibold text-white truncate');
    assert.ok(!PAGE_HEADER_SRC.includes('text-xl'),
      'PageHeader ห้ามใช้ title text-xl — มาตรฐานคือ text-lg');
  });
});

describe('ทุกหน้า/คอมโพเนนต์ — ห้าม header แบบเก่ากลับมา (2 แบบ)', () => {
  // กันใครไปแก้ header หน้าใดหน้าหนึ่งกลับเป็น "การ์ดมน" รูปแบบเดิมโดยไม่รู้ตัว
  test('ไม่มี wrapper header การ์ดมน (flex items-center + gradient + rounded-3xl)', () => {
    const offenders = SCAN_FILES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.split('\n').some(line =>
        line.includes('bg-gradient-to-r from-brand') &&
        line.includes('rounded-3xl') &&
        line.includes('flex items-center'),
      );
    });
    assert.deepEqual(offenders, [],
      `เจอ header แบบการ์ดมนกลับมา (flex items-center + gradient + rounded-3xl) — ต้องใช้ PageHeader หรือแถบ flush:\n${offenders.join('\n')}`);
  });

  // icon box ของ header เดิมใหญ่กว่า w-8 (w-9/10/11/12) — ถ้ากลับมา = แถบเพี้ยน
  test('ไม่มี icon box header ใหญ่กว่า w-8 (w-9/10/11/12 + bg-white/20)', () => {
    const OLD_BOX = /w-(?:9|10|11|12) h-(?:9|10|11|12) bg-white\/20/;
    const offenders = SCAN_FILES.filter(f => OLD_BOX.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, [],
      `เจอ icon box แบบเก่า (w-9 ขึ้นไป + bg-white/20) — มาตรฐานคือ w-8:\n${offenders.join('\n')}`);
  });

  // title ของ header เดิมเป็น text-xl — มาตรฐานคือ text-lg
  test('ไม่มี title header แบบเก่า (text-xl font-semibold text-white)', () => {
    const offenders = SCAN_FILES.filter(f =>
      readFileSync(f, 'utf8').includes('text-xl font-semibold text-white'),
    );
    assert.deepEqual(offenders, [],
      `เจอ title header แบบเก่า (text-xl font-semibold text-white) — มาตรฐานคือ text-lg:\n${offenders.join('\n')}`);
  });
});
