// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/test-components.cjs — รันเทส .tsx (component) ด้วย tsx แบบ cross-platform
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องมี: เทส .tsx รันผ่าน node --test ตรงๆ ไม่ได้ (node strip types ไม่รองรับ JSX)
//   ต้องใช้ tsx; แต่ tsx ข้าม tsconfig แบบ solution (files: []) ที่ root ของโปรเจกต์นี้
//   จึงอ่านค่า jsx: react-jsx ไม่เจอ → transform เป็น React.createElement แล้วพัง (component
//   ไม่ได้ import React) — วิธีแก้คือชี้ TSX_TSCONFIG_PATH ไป tsconfig.app.json; เขียนเป็น
//   wrapper .cjs เพราะ env prefix แบบ bash (VAR=... node ...) ใช้ไม่ได้บน cmd ของ Windows
// ─────────────────────────────────────────────────────────────────────────────────────
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  TSX_TSCONFIG_PATH: path.join(ROOT, 'tsconfig.app.json'),
};

// รายการเทส .tsx — เพิ่มไฟล์ใหม่แค่เติมบรรทัดเดียว
const FILES = [
  'src/components/preorder/cartPanel.test.tsx',
  'src/components/preorder/orderModals.test.tsx',
  'src/components/pos/cartPanel.test.tsx',
];

// --experimental-test-module-mocks: จำเป็นสำหรับ mock.module ใน orderModals.test.tsx
// (OrderDetailModal import api → config.ts อ่าน import.meta.env Vite-only → ต้อง mock ก่อนโหลด)
const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', ...FILES], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
});

process.exit(r.status ?? 1);
