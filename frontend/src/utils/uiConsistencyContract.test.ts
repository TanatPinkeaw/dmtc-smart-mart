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
    'pages/Shift.tsx', 'pages/Notifications.tsx',
    'components/common/ErrorBoundary.tsx', 'components/settings/LoyaltySettingsPanel.tsx',
    'components/preorder/OrderDetailModal.tsx', 'components/dashboard/DetailModal.tsx',
    'components/dashboard/CloseShiftModal.tsx', 'components/pos/RewardModal.tsx',
    'components/pos/CartPanel.tsx', 'components/preorder/CartPanel.tsx',
    'components/auth/ChangePasswordModal.tsx', 'components/dashboard/PendingShiftClosesWidget.tsx',
    'components/Layout.tsx', 'components/preorder/MyOrdersModal.tsx', 'pages/Schedules.tsx',
    'pages/AccountingSummary.tsx', 'components/settings/MemberGroupsPanel.tsx',
  ];

  test('ไม่มีปุ่ม gradient เขียนเอง (<button ... bg-gradient-to-br) ในไฟล์ที่อพยพแล้ว', () => {
    // ⭐️ ไล่ทุก <button> (รวม tag หลายบรรทัด — className อยู่คนละบรรทัดกับ <button>) ดู 400 ตัวอักษรถัดไป
    // ว่ามี bg-gradient-to-br ไหม — ต้องใช้ <Button> variant (primary/secondary/danger/ghost/
    // warning/success/purple/orange/info) หรือปุ่มสีทึบ/ไม่มี gradient
    const offenders: string[] = [];
    for (const f of BUTTON_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') { // ข้าม </button>
          const win = src.slice(idx, idx + 400);
          if (win.includes('bg-gradient-to-br')) {
            offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}`);
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอปุ่ม gradient เขียนเองในไฟล์ที่ควรใช้ ui/Button — ต้องใช้ <Button> (variant กลาง):\n${offenders.join('\n')}`);
  });

  test('ไม่มีปุ่มสีทึบเขียนเอง (bg-{สี}-50 + border) ในไฟล์ที่อพยพแล้ว', () => {
    // ⭐️ กฎ gradient จับแค่ bg-gradient-to-br — ปุ่มสีทึบ (ฟ้าอ่อน/แดงอ่อน/เขียวอ่อน + ขอบ) หลุดได้
    //   (เจอจริง: OrderManagement "ดูสลิป" ×2 + pos CartPanel "พอดี") — ไล่ className ของทุก <button>
    //   ว่ามี bg-{color}-50 ตามด้วย border (สีพื้นอ่อน + ขอบ = signature ปุ่มสีทึบเขียนเอง)
    const SOLID_BTN = /bg-(red|blue|amber|emerald|purple|orange|green|yellow|gray|sky)-50\s+border/;
    const offenders: string[] = [];
    for (const f of BUTTON_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') { // ข้าม </button>
          const win = src.slice(idx, idx + 400);
          const cm = win.match(/className=(["'`])([^"'`]*)\1/);
          if (cm && SOLID_BTN.test(cm[2])) {
            offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}`);
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอปุ่มสีทึบเขียนเอง (bg-*-50 + border) — ต้องใช้ <Button> variant (success/info/danger/warning ฯลฯ):\n${offenders.join('\n')}`);
  });

  test('ไม่มีปุ่ม outline ขาวเขียนเอง (bg-white border) ในไฟล์ที่อพยพแล้ว', () => {
    // ⭐️ กฎสีทึบจับ bg-{สี}-50 — ปุ่ม outline ขาว (bg-white border border-{สี}-*) หลุดได้
    //   (เจอจริง: Settings ปฏิเสธรีเซ็ต ×1 + export ×2, pos CartPanel เงินลัด ×5, preorder สลับบัญชี)
    //   ต้องใช้ <Button variant="secondary"> (แบรนด์) / variant="outline-danger" (แดง quiet)
    const offenders: string[] = [];
    for (const f of BUTTON_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') { // ข้าม </button>
          const win = src.slice(idx, idx + 400);
          const cm = win.match(/className=(["'`])([^"'`]*)\1/);
          if (cm && /(^| )bg-white border/.test(cm[2])) {
            offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}`);
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอปุ่ม outline เขียนเอง (bg-white border) — ใช้ <Button variant="secondary"> หรือ variant="outline-danger":\n${offenders.join('\n')}`);
  });

  test('Button ต้องมี variant outline-danger (แดง outline — ปฏิเสธ/ปิดการ์ดแบบ quiet)', () => {
    const button = readFileSync(join(BASE, 'components/ui/Button.tsx'), 'utf8');
    assert.ok(button.includes("'outline-danger': 'bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold'"),
      'Button ต้องมี outline-danger (bg-white border-red-200 text-red-600 hover:bg-red-50) — ปุ่มอันตรายแบบไม่ทึบ');
  });

  test('ไม่มีปุ่ม bg-brand ทึบ (flat) เขียนเองในไฟล์ที่อพยพแล้ว (primary ต้อง gradient ผ่าน Button)', () => {
    // ⭐️ กฎ gradient/สีทึบ/outline จับ bg-brand ทึบไม่ถึง (สี custom ไม่ในรายการ) — เจอจริง:
    //   pos CartPanel "ค้นหา"/"ใช้โค้ด", Settings "ค้นหา", MemberGroupsPanel "เพิ่มกฎ"
    //   primary (พื้นแบรนด์) ต้องใช้ <Button variant="primary"> (gradient) — ยกเว้น FAB ลอย (fixed)
    const FLAT_BRAND = /(^| )bg-brand(?=[ \n])/;
    const offenders: string[] = [];
    for (const f of BUTTON_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') { // ข้าม </button>
          const win = src.slice(idx, idx + 400);
          const cm = win.match(/className=(["'`])([^"'`]*)\1/);
          if (cm) {
            const c = cm[2];
            if (FLAT_BRAND.test(c) && c.includes('text-white') && !c.includes('fixed')) {
              offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}`);
            }
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอปุ่ม bg-brand ทึบเขียนเอง (flat แทน gradient primary) — ใช้ <Button variant="primary"> (ยกเว้น FAB ลอย fixed):\n${offenders.join('\n')}`);
  });

  test('Button.tsx ต้องมี variant primary = gradient แบรนด์ (มาตรฐานปุ่มหลัก)', () => {
    const button = readFileSync(join(BASE, 'components/ui/Button.tsx'), 'utf8');
    assert.ok(button.includes("primary: 'bg-gradient-to-br from-brand to-brand-dark text-white font-bold'"),
      'Button variant primary ต้องเป็น gradient แบรนด์ — ปุ่มหลักทั้งแอปต้องหน้าตาเดียวกัน');
  });

  test('Button ต้องมี variant payment-cash/payment-qr (ชำระเงินสีตามวิธีจ่าย) + reward (แลกของรางวัล)', () => {
    const button = readFileSync(join(BASE, 'components/ui/Button.tsx'), 'utf8');
    assert.ok(button.includes("'payment-cash': 'bg-gradient-to-br from-brand to-brand-dark text-white font-bold'"),
      'Button ต้องมี payment-cash — เงินสด = ชมพูแบรนด์ (ปุ่มชำระเงิน POS/PreOrder)');
    assert.ok(button.includes("'payment-qr': 'bg-gradient-to-br from-blue-600 to-blue-700 text-white font-bold'"),
      'Button ต้องมี payment-qr — QR = น้ำเงิน (ปุ่มชำระเงิน POS/PreOrder)');
    assert.ok(button.includes("reward: 'bg-gradient-to-br from-amber-400 to-amber-500 text-white font-bold'"),
      'Button ต้องมี reward (amber) — ปุ่มแลกของรางวัล');
  });

  // ⭐️ ไล่ <button> gradient ทั้งแอป — เหลือได้เฉพาะ FAB กลมลอยที่เป็นมาตรฐานเดียวเท่านั้น:
  //   w-14 h-14 bg-gradient-to-br from-brand to-brand-dark text-white rounded-full shadow-lg
  //   flex items-center justify-center (POS/PreOrder/MobileBottomNav — ยกเว้นโดยตั้งใจ)
  //   ปุ่ม gradient อื่น (สี/ขนาด/ลำดับ class ต่าง) = ต้องใช้ <Button> variant
  const FAB_CORE = 'w-14 h-14 bg-gradient-to-br from-brand to-brand-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90';

  test('ทั้งแอป — <button> gradient เหลือได้เฉพาะ FAB กลมมาตรฐานเดียว (ตรง FAB_CORE เป๊ะ)', () => {
    const offenders: string[] = [];
    for (const f of ALL_UI) {
      const src = readFileSync(f, 'utf8');
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') { // ข้าม </button>
          const win = src.slice(idx, idx + 400);
          if (win.includes('bg-gradient-to-br') && !win.includes(FAB_CORE)) {
            offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}`);
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอ <button> gradient ที่ไม่ใช่ FAB กลมมาตรฐานเดียว (ต้องตรง FAB_CORE: w-14 h-14 + gradient แบรนด์ + rounded-full) — ปุ่มอื่นต้องใช้ <Button> variant:\n${offenders.join('\n')}`);
  });

  // ⭐️ FAB ทั้ง 3 จุดต้องมี signature มาตรฐานอยู่จริง — กันแก้ FAB หน้าใดหน้าเป็นสี/ขนาด/ลำดับเพี้ยน
  // แล้วหลุดเงื่อนไขบน (ไล่ FAB ที่ยังใช้ gradient อยู่ได้เฉพาะ 3 ไฟล์นี้)
  test('FAB กลมมาตรฐานต้องอยู่ครบ 3 จุด (POS/PreOrder/MobileBottomNav) — ตรง FAB_CORE เป๊ะ', () => {
    for (const f of ['pages/POS.tsx', 'pages/PreOrder.tsx', 'components/layout/MobileBottomNav.tsx']) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes(FAB_CORE),
        `${f} ต้องมี FAB กลมมาตรฐานเดียว (w-14 h-14 + bg-gradient-to-br from-brand to-brand-dark + text-white + rounded-full + shadow-lg) — กัน FAB เพี้ยน`);
    }
  });
});

describe('โมดัล — shell ต้องใช้ ui/Modal (ห้ามเขียน fixed inset-0 ซ้ำเองในไฟล์ที่อพยพแล้ว)', () => {
  const MODAL_ADOPTED = [
    'pages/Settings.tsx', 'pages/AttendanceManagement.tsx',
    'components/pos/RewardModal.tsx', 'components/dashboard/DetailModal.tsx',
    'components/dashboard/CloseShiftModal.tsx', 'components/auth/ChangePasswordModal.tsx',
    'components/preorder/MyOrdersModal.tsx', 'components/preorder/OrderDetailModal.tsx',
    'components/preorder/UploadSlipModal.tsx',
  ];

  test('Modal title ต้องเป็น font-display (Prompt — หัวข้อโมดัลภาษาเดียวทั้งแอป)', () => {
    const modal = readFileSync(join(BASE, 'components/ui/Modal.tsx'), 'utf8');
    assert.ok(/<h3 className="[^"]*font-display/.test(modal),
      'Modal title (h3) ต้องมี font-display — หัวข้อโมดัลทั้งหมดต้องเป็น Prompt ตามภาษาแบรนด์');
  });

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

describe('ช่องกรองวันที่/ค้นหา — ต้องใช้ filterCls จาก ui/fieldStyles (พื้นขาว + เงา — ต่างจาก inputCls ฟอร์ม)', () => {
  const FILTER_ADOPTED = ['pages/Summary.tsx', 'pages/AccountingSummary.tsx'];

  test('ไฟล์ที่อพยพแล้ว import filterCls จาก ui/fieldStyles', () => {
    for (const f of FILTER_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { filterCls } from '../components/ui/fieldStyles'"),
        `${f} ต้อง import filterCls จาก ui/fieldStyles`);
    }
  });

  test('ไม่มีช่องกรองวันที่เขียนเอง (bg-white border border-brand-border rounded-full px-3 py-2 text-sm font-medium shadow-sm)', () => {
    const pattern = 'bg-white border border-brand-border rounded-full px-3 py-2 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-brand';
    for (const f of FILTER_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(!src.includes(pattern),
        `${f} ห้ามเขียนช่องกรองวันที่เอง — ใช้ className={filterCls} จาก ui/fieldStyles`);
    }
  });
});

describe('label ฟอร์ม — ต้องใช้ ui/FieldLabel (เดิม ~6 แบบ text-xs gray-500/600/bold + sm gray-700)', () => {
  const LABEL_ADOPTED = [
    'pages/Login.tsx', 'pages/ForgotPassword.tsx', 'pages/ResetPassword.tsx', 'pages/Register.tsx',
    'pages/Inventory.tsx', 'pages/AttendanceManagement.tsx', 'pages/Settings.tsx',
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
    'pages/OrderManagement.tsx', 'pages/Summary.tsx', 'pages/Inventory.tsx',
    'components/pos/RewardModal.tsx',
    'pages/Dashboard.tsx', 'pages/AttendanceManagement.tsx', 'pages/Settings.tsx',
    'pages/Register.tsx', 'pages/Schedules.tsx',
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

describe('fetch error — ตอนโหลดข้อมูลพัง ต้องโชว์ผ่าน <EmptyState tone="error"> (ห้ามเขียนกล่อง error เอง / ห้ามกลืนแล้วโชว์ว่าง)', () => {
  // ⭐️ ไฟล์ที่อพยพแล้ว: error path ของการ fetch ข้อมูลต้องใช้ EmptyState tone="error"
  //   (เดิมบางจุดเขียนกล่อง error เอง — Register stage==='error' / บางจุดกลืน error แล้วโชว์
  //   "ไม่มีข้อมูล" หลอกผู้ใช้ — Notifications/VendorSales/Inventory/Schedules เคยเป็นแบบนั้น)
  const FETCH_ERROR_ADOPTED = [
    'components/pos/RewardModal.tsx', 'components/preorder/MyOrdersModal.tsx',
    'pages/Register.tsx', 'pages/Notifications.tsx', 'pages/VendorSales.tsx',
    'pages/Inventory.tsx', 'pages/Schedules.tsx',
  ];

  test('ไฟล์ที่อพยพแล้วต้องมี <EmptyState tone="error"> อยู่จริง (render ตอน fetch พัง)', () => {
    for (const f of FETCH_ERROR_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes('tone="error"'),
        `${f} ต้องมี <EmptyState tone="error"> — ตอน fetch พังห้ามโชว์ "ไม่มีข้อมูล" หรือกล่อง error เขียนเอง`);
    }
  });

  test('ไฟล์ที่ fetch เองต้องมี error state (setError ใน catch) — ห้ามกลืน error แล้วโชว์ว่างเงียบๆ', () => {
    // MyOrdersModal รับ error ผ่าน prop จาก PreOrder (ไม่ fetch เอง) — ข้ามได้
    for (const f of ['components/pos/RewardModal.tsx', 'pages/Register.tsx', 'pages/Notifications.tsx',
                      'pages/VendorSales.tsx', 'pages/Inventory.tsx', 'pages/Schedules.tsx']) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(/setError(?:Msg)?\(/.test(src),
        `${f} ต้องมี state error (setError/setErrorMsg ใน catch) — ห้ามกลืน fetch error แล้วโชว์ "ไม่มีข้อมูล" แทน`);
    }
  });
});

describe('inline alert — กล่องแจ้งเตือนเล็กในฟอร์ม/หน้า ต้องใช้ ui/InlineAlert (ห้าม bg-red-50/amber-50 border เขียนเองในไฟล์ที่อพยพแล้ว)', () => {
  // ⭐️ ไฟล์ที่อพยพแล้ว: กล่อง error/เตือนเล็กๆ ที่อยู่กับฟอร์มหรือเนื้อหา (ข้อความ submit, rate limit,
  //   แบนเนอร์เตือนใต้แถบหัว) ต้องใช้ <InlineAlert> — ต่างจาก EmptyState (กล่องใหญ่กลางหน้า)
  const INLINE_ALERT_ADOPTED = ['pages/Login.tsx', 'pages/Register.tsx', 'pages/Dashboard.tsx',
    'components/auth/ChangePasswordModal.tsx', 'components/dashboard/CloseShiftModal.tsx'];

  test('ไฟล์ที่อพยพแล้ว import InlineAlert จาก ui/InlineAlert', () => {
    for (const f of INLINE_ALERT_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { InlineAlert } from '../components/ui/InlineAlert'") ||
                src.includes("import { InlineAlert } from '../ui/InlineAlert'"),
        `${f} ต้อง import InlineAlert จาก ui/InlineAlert`);
    }
  });

  test('ไม่มีกล่อง alert เขียนเอง (bg-red-50 border / bg-amber-50 border) ในไฟล์ที่อพยพแล้ว', () => {
    for (const f of INLINE_ALERT_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(!src.includes('bg-red-50 border'),
        `${f} ห้ามเขียนกล่อง error เอง (bg-red-50 border) — ใช้ <InlineAlert tone="error">`);
      assert.ok(!src.includes('bg-amber-50 border'),
        `${f} ห้ามเขียนกล่องเตือนเอง (bg-amber-50 border) — ใช้ <InlineAlert tone="warning">`);
      assert.ok(!src.includes('bg-amber-50 border-b'),
        `${f} ห้ามเขียนแถบ strip เอง (bg-amber-50 border-b) — ใช้ <InlineAlert variant="strip">`);
    }
  });

  test('InlineAlert ต้องมี variant strip (border-b เต็มความกว้าง — แถบใต้หัวโมดัล)', () => {
    const src = readFileSync(join(BASE, 'components/ui/InlineAlert.tsx'), 'utf8');
    assert.ok(src.includes("variant = 'box'") && src.includes("'strip'"),
      'InlineAlert ต้องมี variant box + strip (strip = border-b เต็มความกว้าง ไม่มน)'
    );
  });

  test('InlineAlert ต้องมี tone info (น้ำเงิน — ข้อมูล/วิธีใช้ เช่น "วิธีนับเงินปิดกะ")', () => {
    const src = readFileSync(join(BASE, 'components/ui/InlineAlert.tsx'), 'utf8');
    assert.ok(src.includes("info: 'bg-blue-50 border-blue-200 text-blue-700'"),
      'InlineAlert ต้องมี tone info (bg-blue-50 border-blue-200 text-blue-700) — แบนเนอร์ข้อมูล/วิธีใช้');
  });
});

describe('skeleton — ใช้ ui/Skeleton (SkeletonLine/SkeletonListRow) ห้ามกล่อง animate-pulse เขียนเองในไฟล์ที่อพยพแล้ว', () => {
  const SKELETON_ADOPTED = [
    'pages/BackupManagement.tsx', 'pages/VendorSales.tsx',
    'pages/Dashboard.tsx', 'pages/AttendanceManagement.tsx', 'pages/Summary.tsx',
    'components/pos/RewardModal.tsx',
    'components/settings/LoyaltySettingsPanel.tsx', 'components/settings/MemberGroupsPanel.tsx',
    'pages/Home.tsx',
  ];

  test('SkeletonLine ต้องรับ className (ต่อท้ายได้ — กัน margin/ความกว้างตามบริบทเขียนเอง)', () => {
    const skeleton = readFileSync(join(BASE, 'components/ui/Skeleton.tsx'), 'utf8');
    assert.ok(/className = ''/.test(skeleton),
      'SkeletonLine ต้องมี prop className — กันเขียนกล่อง bg-brand-border/40 เองในหน้า');
  });

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

describe('การ์ดสินค้า — ต้องใช้ ui/ProductCard + ui/ProductImage + ui/ProductPrice (กลาง)', () => {
  const CARD_FILES = [
    'components/preorder/ProductGrid.tsx',
    'components/pos/ProductGrid.tsx',
  ];
  const IMG_FILES = [
    'components/preorder/PromoPopularRow.tsx',
    'components/preorder/ProductGrid.tsx',
    'components/pos/ProductGrid.tsx',
    'pages/Home.tsx',
  ];

  test('ProductGrid ทั้ง 2 (preorder/POS) ต้อง import ProductCard จาก ui/ProductCard', () => {
    for (const f of CARD_FILES) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes("import { ProductCard } from '../ui/ProductCard'"),
        `${f} ต้องใช้ ui/ProductCard (การ์ดกริด 2 หน้าต้องเป็นตัวเดียวกัน — เดิมเขียนซ้ำ ~150 บรรทัด)`);
      assert.ok(!src.includes('aspect-square bg-brand-bg rounded-lg'),
        `${f} ห้ามเขียนกล่องรูปสินค้าเอง — ใช้ <ProductImage> จาก ui/ProductImage`);
    }
  });

  test('Home/PromoPopularRow ต้อง import ProductImage + ProductPrice (ห้ามเขียนกล่องรูป/ราคาเอง)', () => {
    for (const f of ['pages/Home.tsx', 'components/preorder/PromoPopularRow.tsx']) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(src.includes('ProductImage'), `${f} ต้องใช้ <ProductImage> จาก ui/ProductImage`);
      assert.ok(src.includes('ProductPrice'), `${f} ต้องใช้ <ProductPrice> จาก ui/ProductPrice`);
    }
  });

  test('ไม่มีกล่องรูปสินค้า <img ... object-cover> เขียนเองในไฟล์ที่อพยพแล้ว (ยกเว้น avatar Home)', () => {
    for (const f of IMG_FILES) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(!/<img[^>]*w-full h-full object-cover/.test(src),
        `${f} ห้ามเขียน <img> กล่องรูปสินค้าเอง — ใช้ <ProductImage> (รองรับ placeholder ตอนไม่มีรูป)`);
    }
  });

  test('Home ไม่มีราคาเขียนเอง (font-display text-* font-bold text-brand tabular-nums)', () => {
    const src = readFileSync(join(BASE, 'pages/Home.tsx'), 'utf8');
    assert.ok(!/font-display text-(sm|xs|base) font-bold text-brand tabular-nums/.test(src),
      'Home ห้ามเขียน span ราคาเอง — ใช้ <ProductPrice> (ขีดฆ่า/สีตามสถานะมาตรฐานเดียว)');
  });
});

describe('segmented control — ปุ่มกลุ่มเลือกต้องใช้ ui/SegmentedControl (ห้ามเขียนเอง)', () => {
  // ปุ่มวิธีจ่ายเงิน (pos + preorder — เดิม copy กัน 2 ไฟล์) + ปุ่ม pill ช่วงเวลา/มุมมอง
  const SEGMENTED_ADOPTED = [
    'components/pos/CartPanel.tsx',
    'components/preorder/CartPanel.tsx',
    'pages/Dashboard.tsx',
    'pages/Summary.tsx',
  ];

  test('SEGMENTED_ADOPTED — ทุกไฟล์ต้อง import ui/SegmentedControl', () => {
    for (const f of SEGMENTED_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      assert.ok(/from ['"].*ui\/SegmentedControl['"]/.test(src),
        `${f} ต้องใช้ <SegmentedControl> จาก ui/SegmentedControl (เดิมปุ่มวิธีจ่าย copy กัน 2 ไฟล์)`);
    }
  });

  test('ไม่มีปุ่ม segmented เขียนเองในไฟล์ที่อพยพแล้ว (selected QR / container pill / ปุ่ม border-2)', () => {
    const offenders: string[] = [];
    for (const f of SEGMENTED_ADOPTED) {
      const src = readFileSync(join(BASE, f), 'utf8');
      if (/\? 'border-blue-600 bg-blue-50/.test(src)) {
        offenders.push(`  ${f}: selected QR เขียนเองใน ternary (border-blue-600 bg-blue-50) — ใช้ selectedClassName ของ option`);
      }
      if (/bg-brand-bg border border-brand-border rounded-full p-0\.5/.test(src)) {
        offenders.push(`  ${f}: container pill เขียนเอง (bg-brand-bg ... rounded-full p-0.5) — ใช้ variant="pill"`);
      }
      let idx = 0;
      while ((idx = src.indexOf('<button', idx)) !== -1) {
        if (src[idx + 7] !== '/') {
          const win = src.slice(idx, idx + 300);
          if (win.includes('border-2')) {
            offenders.push(`  ${f}:${src.slice(0, idx).split('\n').length}: ปุ่ม border-2 เขียนเอง — ใช้ variant="box"`);
          }
        }
        idx += 7;
      }
    }
    assert.deepEqual(offenders, [],
      `เจอ segmented control เขียนเองในไฟล์ที่ควรใช้ ui/SegmentedControl:\n${offenders.join('\n')}`);
  });

  test('SegmentedControl — มี variant box + pill และ semantic radio/radiogroup', () => {
    const src = readFileSync(join(BASE, 'components/ui/SegmentedControl.tsx'), 'utf8');
    assert.ok(/variant\?: 'box' \| 'pill'/.test(src), 'ต้องมี variant box + pill');
    assert.ok(src.includes('role="radiogroup"'), 'container ต้องเป็น radiogroup');
    assert.ok(src.includes('role="radio"'), 'ปุ่มต้องเป็น radio');
    assert.ok(src.includes('aria-checked'), 'ต้องมี aria-checked');
  });
});
