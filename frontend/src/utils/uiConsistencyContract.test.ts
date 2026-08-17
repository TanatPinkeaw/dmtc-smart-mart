// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/uiConsistencyContract.test.ts — source contract: UI primitive ต้องใช้มาตรฐานเดียว
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm test (node --test + type stripping — อ่าน source ด้วย fs ไม่ import component)
// ทำอะไร: ล็อกมาตรฐาน UI ที่ "ทุกหน้า" ต้องเหมือนกัน กันใครแก้หน้าใดหน้าหนึ่งหลุด:
//   • พื้นหลังหน้า: ต้อง bg-brand-bg (ห้าม bg-gray-50 กลับมา — เดิม 10 หน้าใช้ gray ต่างจาก
//     PreOrder/POS ที่เป็นชมพูอ่อน brand-bg = หน้าเพี้ยนกัน)
//   • หัวตาราง (thead): ต้อง bg-gray-50 text-gray-600 text-xs (ห้าม bg-brand-bg — เดิมปนกัน)
//   • ช่องกรอก (inputCls): ต้อง import จาก ui/fieldStyles (ห้ามนิยามเองในหน้า —
//     เดิม 3 ไฟล์นิยามซ้ำกันเองโดย padding ต่างกัน: px-4 py-2.5 vs px-3 py-2)
//   • ปุ่มฟอร์ม/เพิ่มใน Settings: ต้องใช้ ui/Button (ตัวอย่าง adoption ของ component กลาง)
// ═══════════════════════════════════════════════════════════════════════════════════
/// <reference types="node" />
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // = src/

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// สแกนเฉพาะ pages + components ที่เป็น UI (ไม่รวม test — มี pattern เป็น string ในโค้ด)
const PAGES = listTsFiles(join(BASE, 'pages')).filter(f => !/\.test\.tsx?$/.test(f));
const ALL_UI = listTsFiles(BASE).filter(f => !/\.test\.tsx?$/.test(f));

describe('พื้นหลังหน้า — ทุกหน้าต้อง bg-brand-bg (ครอบครัวเดียวกับ PreOrder/POS)', () => {
  test('ไม่มีหน้าใดใช้ min-h-screen bg-gray-50', () => {
    const offenders = PAGES.filter(f => readFileSync(f, 'utf8').includes('min-h-screen bg-gray-50'));
    assert.deepEqual(offenders, [],
      `เจอพื้นหลัง gray-50 (ต้องใช้ brand-bg ตามมาตรฐาน) — หน้าไม่เป็นครอบครัวเดียวกัน:\n${offenders.join('\n')}`);
  });

  test('Layout shell (โครงแอป) ต้อง bg-brand-bg ด้วย ไม่ใช่ gray-50', () => {
    const layout = readFileSync(join(BASE, 'components/Layout.tsx'), 'utf8');
    assert.ok(!layout.includes('bg-gray-50'), 'Layout.tsx ห้ามใช้ bg-gray-50 — shell ต้อง brand-bg เหมือนทุกหน้า');
  });
});

describe('ตาราง — หัวตาราง (thead) ต้องเป็น bg-gray-50 text-gray-600 text-xs', () => {
  test('ไม่มี thead ใช้ bg-brand-bg (เดิมปนกัน: gray-50 text-xs vs brand-bg text-sm)', () => {
    const offenders = ALL_UI.filter(f => {
      const src = readFileSync(f, 'utf8');
      return src.includes('<thead className="bg-brand-bg') || src.includes("<thead className='bg-brand-bg");
    });
    assert.deepEqual(offenders, [],
      `เจอ thead แบบ brand-bg — มาตรฐานคือ bg-gray-50 text-gray-600 text-xs:\n${offenders.join('\n')}`);
  });

  test('thead ทุกตารางต้อง bg-gray-50 text-gray-600 text-xs (ห้าม text-sm/p-4 — เดิม OrderManagement ใหญ่กว่า)', () => {
    const offenders = ALL_UI.filter(f => {
      const src = readFileSync(f, 'utf8');
      return /<thead className="/.test(src) && !src.includes('<thead className="bg-gray-50 text-gray-600 text-xs');
    });
    assert.deepEqual(offenders, [],
      `เจอ thead ที่ไม่ใช้มาตรฐาน bg-gray-50 text-gray-600 text-xs (ต้องตรงเป๊ะ — text-sm/p-4 ไม่เอา):\n${offenders.join('\n')}`);
  });

  test('ไม่มี th ใช้ padding p-4 (เดิม OrderManagement p-4 — มาตรฐานคือ p-3)', () => {
    const offenders = ALL_UI.filter(f => {
      const src = readFileSync(f, 'utf8');
      return src.includes('<th className="p-4');
    });
    assert.deepEqual(offenders, [],
      `เจอ th padding p-4 — มาตรฐานหัวตารางคือ p-3 border-b:\n${offenders.join('\n')}`);
  });
});

describe('ช่องกรอก — inputCls ต้อง import จาก ui/fieldStyles (ห้ามนิยามเองในหน้า)', () => {
  test('Schedules/Attendance/CloseShiftModal ไม่มี const inputCls = ... ในไฟล์', () => {
    const files = [
      join(BASE, 'pages/Schedules.tsx'),
      join(BASE, 'pages/AttendanceManagement.tsx'),
      join(BASE, 'components/dashboard/CloseShiftModal.tsx'),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      assert.ok(src.includes("import { inputCls } from '../ui/fieldStyles'") ||
                src.includes("import { inputCls } from '../../components/ui/fieldStyles'") ||
                src.includes("import { inputCls } from '../components/ui/fieldStyles'"),
        `${f} ต้อง import inputCls จาก ui/fieldStyles`);
      assert.ok(!/const inputCls\s*=/.test(src),
        `${f} ห้ามนิยาม inputCls เอง — ใช้ตัวกลางจาก ui/fieldStyles (กัน padding เพี้ยนทีละหน้า)`);
    }
  });
});

describe('ปุ่ม — ปุ่ม gradient ต้องใช้ ui/Button (ห้ามเขียน class ซ้ำเองในหน้า)', () => {
  // ⭐️ ไฟล์ที่อพยพเป็น ui/Button แล้ว — ถ้าใครแก้กลับเป็น <button> + gradient เขียนเอง = เทสแดง
  const BUTTON_ADOPTED = [
    'pages/Settings.tsx', 'pages/Register.tsx', 'pages/Home.tsx', 'pages/Login.tsx',
    'pages/ForgotPassword.tsx', 'pages/ResetPassword.tsx', 'pages/Profile.tsx',
    'pages/OrderManagement.tsx', 'pages/Inventory.tsx', 'pages/AttendanceManagement.tsx',
    'components/common/ErrorBoundary.tsx', 'components/settings/LoyaltySettingsPanel.tsx',
    'components/preorder/OrderDetailModal.tsx', 'components/dashboard/DetailModal.tsx',
    'components/dashboard/CloseShiftModal.tsx', 'components/pos/RewardModal.tsx',
  ];

  test('ไม่มีปุ่ม gradient เขียนเอง (<button ... bg-gradient-to-br from-brand) ในไฟล์ที่อพยพแล้ว', () => {
    const offenders = BUTTON_ADOPTED.filter(f => {
      const src = readFileSync(join(BASE, f), 'utf8');
      return src.split('\n').some(line => line.includes('<button') && line.includes('bg-gradient-to-br from-brand'));
    });
    assert.deepEqual(offenders, [],
      `เจอปุ่ม gradient เขียนเองในไฟล์ที่ควรใช้ ui/Button — ต้องใช้ <Button> (variant primary):\n${offenders.join('\n')}`);
  });

  test('Button.tsx ต้องมี variant primary = gradient แบรนด์ (มาตรฐานปุ่มหลัก)', () => {
    const button = readFileSync(join(BASE, 'components/ui/Button.tsx'), 'utf8');
    assert.ok(button.includes("primary: 'bg-gradient-to-br from-brand to-brand-dark text-white font-bold'"),
      'Button variant primary ต้องเป็น gradient แบรนด์ — ปุ่มหลักทั้งแอปต้องหน้าตาเดียวกัน');
  });
});

describe('โมดัล — shell ต้องใช้ ui/Modal (ห้ามเขียน fixed inset-0 ซ้ำเองในไฟล์ที่อพยพแล้ว)', () => {
  const MODAL_ADOPTED = [
    'pages/Settings.tsx', 'pages/AttendanceManagement.tsx',
    'components/pos/RewardModal.tsx', 'components/dashboard/DetailModal.tsx',
    'components/dashboard/CloseShiftModal.tsx', 'components/auth/ChangePasswordModal.tsx',
  ];

  test('ไฟล์ที่อพยพแล้ว import Modal จาก ui/Modal และไม่มี shell fixed inset-0 เขียนเอง', () => {
    for (const f of MODAL_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { Modal } from '") && src.includes('ui/Modal'),
        `${f} ต้อง import Modal จาก ui/Modal`);
      // shell เก่า: fixed inset-0 ครอบ div เอง — ถ้ากลับไปเขียน = แถบหัว/ปุ่มปิดเพี้ยน
      assert.ok(!src.includes('<div className="fixed inset-0'),
        `${f} ไม่ควรมี shell modal เขียนเอง (fixed inset-0) — ใช้ <Modal> จาก ui/Modal`);
    }
  });
});

describe('badge สถานะ — ต้องใช้ ui/StatusBadge (map สีกลาง เดิม 3 จุดสีต่างกัน)', () => {
  const BADGE_ADOPTED = [
    'pages/OrderManagement.tsx',
    'components/preorder/MyOrdersModal.tsx',
    'components/preorder/OrderDetailModal.tsx',
  ];

  test('3 ไฟล์ต้อง import StatusBadge จาก ui/StatusBadge', () => {
    for (const f of BADGE_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { StatusBadge } from '../ui/StatusBadge'") ||
                src.includes("import { StatusBadge } from '../../components/ui/StatusBadge'") ||
                src.includes("import { StatusBadge } from '../components/ui/StatusBadge'"),
        `${f} ต้องใช้ <StatusBadge> จาก ui/StatusBadge (map สีกลาง)`);
    }
  });

  test('ไม่มี badge สีเขียนเอง (ternary bg-*-100 / map STATUS_BADGE / switch สี) ใน 3 ไฟล์', () => {
    for (const f of BADGE_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(!src.includes('STATUS_BADGE'), `${f} ห้ามมี const STATUS_BADGE เขียนเอง — สีต้องมาจาก ui/StatusBadge`);
      assert.ok(!src.includes("getStatusBadge"), `${f} ห้ามมี getStatusBadge เขียนเอง — ใช้ <StatusBadge>`);
      assert.ok(!/\? 'bg-(blue|yellow|orange|green|red|purple)-100/.test(src),
        `${f} ห้าม ternary กำหนดสี badge เอง — สีสถานะต้องมาจาก ui/StatusBadge ที่เดียว`);
    }
  });
});

describe('label ฟอร์ม — ต้องใช้ ui/FieldLabel (เดิม ~6 แบบ text-xs gray-500/600/bold + sm gray-700)', () => {
  const LABEL_ADOPTED = [
    'pages/Login.tsx', 'pages/ForgotPassword.tsx', 'pages/ResetPassword.tsx', 'pages/Register.tsx',
    'pages/Inventory.tsx', 'pages/AttendanceManagement.tsx',
    'components/auth/ChangePasswordModal.tsx', 'components/dashboard/CloseShiftModal.tsx',
    'components/pos/RegisterMemberModal.tsx', 'components/preorder/CartPanel.tsx',
    'components/settings/LoyaltySettingsPanel.tsx', 'components/preorder/OrderDetailModal.tsx',
  ];

  test('ไฟล์ที่อพยพแล้ว import FieldLabel จาก ui/FieldLabel', () => {
    for (const f of LABEL_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { FieldLabel } from '../ui/FieldLabel'") ||
                src.includes("import { FieldLabel } from '../../components/ui/FieldLabel'") ||
                src.includes("import { FieldLabel } from '../components/ui/FieldLabel'"),
        `${f} ต้อง import FieldLabel จาก ui/FieldLabel`);
    }
  });

  test('ไม่มี label ฟอร์ม class เขียนเอง (block text-xs/sm font ...) ในไฟล์ที่อพยพแล้ว', () => {
    for (const f of LABEL_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      const lines = src.split('\n');
      const offenders = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.includes('<label') && /className=".block text-(xs|sm) font/.test(l))
        .map(({ l, i }) => `  ${i + 1}: ${l.trim()}`);
      assert.deepEqual(offenders, [],
        `${f} ห้ามเขียน label ฟอร์ม class เอง — ใช้ <FieldLabel> (size xs/sm):\n${offenders.join('\n')}`);
    }
  });
});

describe('empty state — ต้องใช้ ui/EmptyState (ห้ามเขียน py-16 flex-col / text-gray-400 py- เขียนเองในไฟล์ที่อพยพแล้ว)', () => {
  const EMPTY_ADOPTED = [
    'components/preorder/MyOrdersModal.tsx', 'components/preorder/ProductGrid.tsx',
    'components/preorder/CartPanel.tsx', 'pages/Notifications.tsx', 'pages/VendorSales.tsx',
    'pages/AccountingSummary.tsx', 'components/dashboard/DetailModal.tsx',
    'components/dashboard/StatCards.tsx', 'components/dashboard/AdminDashboardHero.tsx',
  ];

  test('ไฟล์ที่อพยพแล้ว import EmptyState จาก ui/EmptyState', () => {
    for (const f of EMPTY_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { EmptyState } from '../ui/EmptyState'") ||
                src.includes("import { EmptyState } from '../../components/ui/EmptyState'") ||
                src.includes("import { EmptyState } from '../components/ui/EmptyState'"),
        `${f} ต้อง import EmptyState จาก ui/EmptyState`);
    }
  });

  test('ไม่มี empty state เขียนเอง (py-16 flex-col / text-gray-400 py- / p-6 text-center text-gray-400)', () => {
    for (const f of EMPTY_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(!/py-16 flex flex-col items-center/.test(src),
        `${f} ห้ามเขียน empty state แบบกล่อง (py-16 flex-col) เอง — ใช้ <EmptyState>`);
      assert.ok(!/text-center text-(sm|xs) text-gray-400 py-/.test(src),
        `${f} ห้ามเขียน empty state แบบข้อความ (text-gray-400 py-) เอง — ใช้ <EmptyState compact>`);
      assert.ok(!src.includes('text-center text-gray-400 text-sm'),
        `${f} ห้ามเขียน empty state แบบข้อความ (text-center text-gray-400 text-sm) เอง — ใช้ <EmptyState compact>`);
    }
  });
});

describe('skeleton — ใช้ ui/Skeleton (SkeletonLine/SkeletonListRow) ห้ามกล่อง animate-pulse เขียนเองในไฟล์ที่อพยพแล้ว', () => {
  const SKELETON_ADOPTED = [
    'pages/BackupManagement.tsx', 'pages/VendorSales.tsx',
    'pages/Dashboard.tsx', 'pages/AttendanceManagement.tsx',
  ];

  test('ไฟล์ที่อพยพแล้ว import Skeleton จาก ui/Skeleton และไม่มีกล่อง loading เขียนเอง', () => {
    for (const f of SKELETON_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("from '../components/ui/Skeleton'") || src.includes("from '../ui/Skeleton'"),
        `${f} ต้อง import SkeletonLine/SkeletonListRow จาก ui/Skeleton`);
      // pattern กล่อง skeleton เขียนเอง (แถบ/บล็อก loading) — structure skeleton เฉพาะ (avatar+line) ไม่นับ
      assert.ok(!/bg-brand-border\/40 rounded/.test(src),
        `${f} ห้ามเขียนกล่อง skeleton เอง (bg-brand-border/40 rounded) — ใช้ SkeletonLine/SkeletonListRow`);
      assert.ok(!/h-(20|24) bg-white border border-brand-border rounded-3xl animate-pulse/.test(src),
        `${f} ห้ามเขียน SkeletonListRow เอง — ใช้ <SkeletonListRow> จาก ui/Skeleton`);
    }
  });
});
