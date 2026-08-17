#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/check-docker-node-version.js — กัน Dockerfile หลุด node version
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมมี: 2026-08-17 deploy ล้มจริง — backend/Dockerfile ใช้ node:18-alpine แต่
//   sharp 0.35 ต้อง Node ≥ 20.9 ("Could not load the sharp module ... Found 18.20.8,
//   Requires >=20.9.0") ; CI รัน Node 20 อยู่แล้ว 3 จุด — มีแต่ Dockerfile ที่หลุด
// ทำอะไร: อ่าน engines.node จาก package.json เทียบกับ base image ใน Dockerfile
//   (FROM node:<major>-...) → major ต้อง ≥ floor ของ engines ห้าม node:18 กลับมา
// รัน: node scripts/check-docker-node-version.js (CI + ท้องถิ่น — ไม่ต้อง npm ci)
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
const dockerfile = fs.readFileSync(path.join(backendDir, 'Dockerfile'), 'utf8');

// 1) engines.node — ต้องมี (เป็นข้อกำหนดขั้นต่ำของ node ที่ app ต้องการ)
const enginesNode = pkg.engines && pkg.engines.node;
if (!enginesNode) {
  console.error('❌ backend/package.json ไม่มี engines.node — ใส่เช่น ">=20.9.0" (ข้อกำหนดขั้นต่ำของ node ที่ app ใช้)');
  process.exit(1);
}

// 2) major ขั้นต่ำจาก range — จับเลขตัวแรก (floor) เช่น ">=20.9.0" → 20, "^20.0.0" → 20
const floorMatch = enginesNode.match(/(?:>=|~=|~|\^|=|)\s*v?(\d+)/);
const minMajor = floorMatch ? Number(floorMatch[1]) : NaN;

// 3) base image ใน Dockerfile — ต้องเป็น node:<major>
const fromMatch = dockerfile.match(/^FROM\s+node:(\d+)/m);
if (!fromMatch) {
  console.error('❌ backend/Dockerfile ไม่มี base image node:<major> — ต้องเป็น FROM node:<major>-alpine (เช่น node:20-alpine)');
  process.exit(1);
}
const dockerMajor = Number(fromMatch[1]);

if (!Number.isFinite(minMajor)) {
  console.error(`❌ แปลง engines.node "${enginesNode}" ไม่ได้ — ใช้ range ง่ายๆ เช่น ">=20.9.0"`);
  process.exit(1);
}

if (dockerMajor < minMajor) {
  console.error(`❌ backend/Dockerfile ใช้ node:${dockerMajor} แต่ engines.node = "${enginesNode}" (ต้องการ ≥ ${minMajor}) — sharp/แพ็กเกจอื่นจะโหลดไม่ได้ตอน deploy → แก้ FROM เป็น node:${minMajor}-alpine ขึ้นไป`);
  process.exit(1);
}

console.log(`✓ backend Dockerfile node:${dockerMajor} ≥ engines.node "${enginesNode}" (floor major ${minMajor})`);
