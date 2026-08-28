// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/posAdminContract.test.js — POS Admin routes contract (static, no DB)
// ─────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm run test:unit
// ทำอะไร: ล็อกว่า posAdminRoutes.js มี audit logging + Joi validation ครบ
//   ทุก mutation endpoint (create/update/delete/toggle) + role guard ถูกต้อง
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'posAdminRoutes.js'), 'utf8');
const validatorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'validators', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── Section L: Audit logging ──
console.log('L) audit logging ในทุก mutation endpoint:');
// แต่ละ mutation route ต้องมี logAudit(...) อยู่หลัง query
const mutationRoutes = [
  { name: 'POST /products', method: 'post', path: '/products' },
  { name: 'PUT /products/:id', method: 'put', path: '/products/:id' },
  { name: 'DELETE /products/:id', method: 'delete', path: '/products/:id' },
  { name: 'POST /categories', method: 'post', path: '/categories' },
  { name: 'PUT /categories/:id', method: 'put', path: '/categories/:id' },
  { name: 'DELETE /categories/:id', method: 'delete', path: '/categories/:id' },
  { name: 'POST /users', method: 'post', path: '/users' },
  { name: 'PUT /users/:id', method: 'put', path: '/users/:id' },
  { name: 'PUT /users/:id/toggle', method: 'put', path: '/users/:id/toggle' },
  { name: 'PUT /settings', method: 'put', path: '/settings' },
];

for (const route of mutationRoutes) {
  // Find the router.<method> line for this route
  const pattern = new RegExp(`router\\.${route.method}\\('${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const match = routesSrc.match(pattern);
  check(`${route.name} route exists`, !!match);
  if (match) {
    // Get the handler block (next ~40 lines from match)
    const idx = routesSrc.indexOf(match[0]);
    const window = routesSrc.slice(idx, idx + 800);
    check(`${route.name} has logAudit`, /logAudit\(req\.db,/.test(window));
  }
}

// ── Section M: Joi validation ──
console.log('M) Joi validation ในทุก mutation + login endpoint:');
const validationRoutes = [
  { name: 'POST /login', method: 'post', path: '/login' },
  { name: 'POST /products', method: 'post', path: '/products' },
  { name: 'PUT /products/:id', method: 'put', path: '/products/:id' },
  { name: 'POST /users', method: 'post', path: '/users' },
  { name: 'PUT /users/:id', method: 'put', path: '/users/:id' },
  { name: 'POST /categories', method: 'post', path: '/categories' },
  { name: 'PUT /categories/:id', method: 'put', path: '/categories/:id' },
  { name: 'PUT /settings', method: 'put', path: '/settings' },
];

for (const route of validationRoutes) {
  const pattern = new RegExp(`router\\.${route.method}\\('${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const match = routesSrc.match(pattern);
  check(`${route.name} route exists for validation check`, !!match);
  if (match) {
    const idx = routesSrc.indexOf(match[0]);
    const window = routesSrc.slice(idx, idx + 200);
    check(`${route.name} has validateRequest`, /validateRequest\(/.test(window));
  }
}

// ── Section N: Role guards ──
console.log('N) role guards ในทุก protected endpoint:');
const protectedRoutes = [
  { name: 'GET /stats', method: 'get', path: '/stats' },
  { name: 'GET /products', method: 'get', path: '/products' },
  { name: 'POST /products', method: 'post', path: '/products' },
  { name: 'PUT /products/:id', method: 'put', path: '/products/:id' },
  { name: 'DELETE /products/:id', method: 'delete', path: '/products/:id' },
  { name: 'GET /categories', method: 'get', path: '/categories' },
  { name: 'POST /categories', method: 'post', path: '/categories' },
  { name: 'DELETE /categories/:id', method: 'delete', path: '/categories/:id' },
  { name: 'GET /users', method: 'get', path: '/users' },
  { name: 'GET /settings', method: 'get', path: '/settings' },
  { name: 'PUT /settings', method: 'put', path: '/settings' },
  { name: 'POST /users', method: 'post', path: '/users' },
  { name: 'PUT /users/:id', method: 'put', path: '/users/:id' },
  { name: 'PUT /users/:id/toggle', method: 'put', path: '/users/:id/toggle' },
];

for (const route of protectedRoutes) {
  const pattern = new RegExp(`router\\.${route.method}\\('${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const match = routesSrc.match(pattern);
  if (match) {
    const idx = routesSrc.indexOf(match[0]);
    const window = routesSrc.slice(idx, idx + 100);
    check(`${route.name} has requireRole`, /requireRole\(/.test(window));
  }
}

// ── Section O: Validators exported ──
console.log('O) POS Admin validators exported from validators/index.js:');
const validatorNames = [
  'posAdminLoginValidator',
  'posProductCreateValidator',
  'posProductUpdateValidator',
  'posUserCreateValidator',
  'posUserUpdateValidator',
  'posSettingsValidator',
  'posCategoryCreateValidator',
];
for (const name of validatorNames) {
  check(`${name} exported`, validatorSrc.includes(name));
}

// ── Section P: Audit log events are descriptive ──
console.log('P) audit log events มี action ชัดเจน (ไม่ใช่ generic):');
const auditActions = [
  'POS_CREATE_PRODUCT', 'POS_UPDATE_PRODUCT', 'POS_DELETE_PRODUCT',
  'POS_CREATE_CATEGORY', 'POS_UPDATE_CATEGORY', 'POS_DELETE_CATEGORY',
  'POS_CREATE_USER', 'POS_UPDATE_USER', 'POS_TOGGLE_USER', 'POS_UPDATE_SETTINGS',
];
for (const action of auditActions) {
  check(`action "${action}" exists in routes`, routesSrc.includes(`'${action}'`));
}

// ── Summary ──
console.log(`\n════════ สรุปผล ════════`);
if (fail > 0) {
  console.log(`❌ FAIL ${fail} จาก ${pass + fail} เช็ค`);
  process.exit(1);
} else {
  console.log(`✅ PASS ${pass}/${pass + fail} เช็ค`);
}
