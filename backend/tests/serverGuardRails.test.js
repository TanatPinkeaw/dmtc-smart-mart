// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/serverGuardRails.test.js — กันบัคที่ล่าพบ (static contract, ไม่ต้องต่อ DB)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   ล่าบัคพบหลายจุดที่แก้ไปแล้วใน server.js — ไฟล์นี้ล็อกให้ไม่กลับมาเป็น regression:
//     A) MEDIUM — /api/sales/sync-offline ใช้ checkoutLimiter ตัวเดียวกับ /checkout (30 ครั้ง/นาที
//        prod): คิวออฟไลน์ replay บิลค้าง >30 ใบ โดน 429 → queueProcessor ตัดทิ้งถาวร = บิลหลุด.
//        ต้องใช้ limiter แยก (syncOfflineLimiter) + skipFailedRequests + max มากกว่า checkout
//     B) LOW — /api/audit-logs parseInt(page/limit) ไม่มี guard: ?page=abc → offset NaN → 500,
//        ?limit=100000000 → query ยักษ์. ต้อง clamp (page ≥ 1, limit 1–200)
//     C) NIT — socket.on('request_shift_report')  dead code (ไม่มีฝั่งไหน listen) + emit string
//        'error' แทน object — ต้องไม่มีกลับมา
//     D) N+1 — GET /api/orders เดิมยิง query ทีละออเดอร์ในลูป (OrderManagement poll ทุก 5 วิ),
//        cron pickup reminder เดิม UPDATE ทีละออเดอร์ — ต้อง batch (IN + placeholders)
//     E) Index — orders/sales/audit_logs ต้องมี index ใน db.js initDB (runtime) + schema.sql (doc/CI)
//   ไม่ต้องต่อ DB — อ่าน source แล้วเช็ค pattern (แบบเดียวกับ cronTimezone/undefinedIdentifiers)
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

console.log('A) sync-offline ใช้ limiter แยกจาก checkout:');
const syncRouteLine = serverSrc.split('\n').find(l => l.includes("'/api/sales/sync-offline'"));
check("route /api/sales/sync-offline มีอยู่", !!syncRouteLine);
check("ใช้ syncOfflineLimiter (ไม่ใช่ checkoutLimiter)", !!syncRouteLine && syncRouteLine.includes('syncOfflineLimiter') && !syncRouteLine.includes('checkoutLimiter'));
const checkoutRouteLine = serverSrc.split('\n').find(l => l.includes("'/api/sales/checkout'"));
check("route /api/sales/checkout ยังใช้ checkoutLimiter (ไม่เผลอสลับ)", !!checkoutRouteLine && checkoutRouteLine.includes('checkoutLimiter') && !checkoutRouteLine.includes('syncOfflineLimiter'));

const limiterBlock = serverSrc.slice(serverSrc.indexOf('const syncOfflineLimiter'), serverSrc.indexOf('const syncOfflineLimiter') + 900);
check('syncOfflineLimiter มี skipFailedRequests: true (fail แล้วไม่นับซ้ำ)', /skipFailedRequests:\s*true/.test(limiterBlock));
const syncMaxRaw = limiterBlock.match(/max:\s*([^,\r\n]+),/);
const checkoutBlock = serverSrc.slice(serverSrc.indexOf('const checkoutLimiter'), serverSrc.indexOf('const syncOfflineLimiter'));
const checkoutMaxRaw = checkoutBlock.match(/max:\s*([^,\r\n]+),/);
// เอาเลขตัวแรก (prod max) มาเทียบ: sync ต้องมากกว่า checkout (คิวออฟไลน์ replay ทั้งคิวต้องไม่ตัน)
const syncProdMax = syncMaxRaw ? Number((syncMaxRaw[1].match(/\d+/) || [])[0]) : NaN;
const checkoutProdMax = checkoutMaxRaw ? Number((checkoutMaxRaw[1].match(/\d+/) || [])[0]) : NaN;
check('syncOfflineLimiter.max > checkoutLimiter.max (replay ทั้งคิวต้องไม่ตัน)', Number.isFinite(syncProdMax) && Number.isFinite(checkoutProdMax) && syncProdMax > checkoutProdMax);

console.log('B) /api/audit-logs clamp page/limit:');
const auditLine = serverSrc.split('\n').findIndex(l => l.includes("'/api/audit-logs'"));
const auditBlock = serverSrc.split('\n').slice(auditLine, auditLine + 40).join('\n');
check('page clamp อยู่ (Math.max(1, parseInt(req.query.page', /Math\.max\(1,\s*parseInt\(req\.query\.page/.test(auditBlock));
check('limit clamp อยู่ (Math.min(200, Math.max(1, parseInt(req.query.limit', /Math\.min\(200,\s*Math\.max\(1,\s*parseInt\(req\.query\.limit/.test(auditBlock));
check('ไม่เหลือ parseInt(page) แบบเปล่า (NaN ได้)', !/parseInt\(page\)/.test(auditBlock));
check('ไม่เหลือ parseInt(limit) แบบเปล่า (NaN ได้)', !/parseInt\(limit\)/.test(auditBlock));
check('ไม่มี parseInt(limit) ใน params.push', !/params\.push\(parseInt\(limit\)/.test(auditBlock));

console.log('C) dead socket ถูกถอน:');
check("ไม่มี socket.on('request_shift_report')", !/socket\.on\('request_shift_report'/.test(serverSrc));
check("ไม่มี socket.emit('shift_report_ack')", !/socket\.emit\('shift_report_ack'/.test(serverSrc));

console.log('D) N+1 ถูก batch (กัน regression):');
// GET /api/orders — window จาก route ถึง route ถัดไป ต้องดึง items batch IN ไม่ยิงในลูป
const ordersIdx = serverSrc.indexOf("app.get('/api/orders'");
const ordersWindow = serverSrc.slice(ordersIdx, serverSrc.indexOf("app.put('/api/orders/:id/status'", ordersIdx));
check('ดึง items ทุกออเดอร์ batch IN (orderIds.map placeholders)', /oi\.order_id IN \(\$\{orderIds\.map\(\(\) => '\?'\)\.join\(','\)\}\)/.test(ordersWindow));
check('ไม่เหลือ for-loop ยิง query ใน /orders', !/for\s*\([^)]*\)\s*\{[^}]*pool\.query/.test(ordersWindow));
// pickup reminder cron — UPDATE ต้อง batch IN
const cronIdx = serverSrc.indexOf('pickup_reminder_sent = 1');
const cronBlock = serverSrc.slice(cronIdx - 700, cronIdx + 700);
check('cron batch UPDATE IN (sentIds)', /UPDATE orders SET pickup_reminder_sent = 1 WHERE id IN \(\$\{sentIds\.map\(\(\) => '\?'\)\.join\(','\)\}\)/.test(cronBlock));
check('cron ไม่เหลือ UPDATE ทีละ id (= ?)', !/UPDATE orders SET pickup_reminder_sent = 1 WHERE id = \?/.test(cronBlock));

console.log('E) index อยู่ใน db.js initDB (runtime) + schema.sql (doc/CI):');
const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'db.js'), 'utf8');
const schemaSrc = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const idxDefs = [
  ['idx_sales_status_created', 'sales'],
  ['idx_orders_status_created', 'orders'],
  ['idx_orders_ready_at', 'orders'],
  ['idx_audit_user_action_created', 'audit_logs'],
];
for (const [idx, table] of idxDefs) {
  check(`${idx} อยู่ใน db.js (ALTER + ER_DUP_KEYNAME guard)`, new RegExp('ADD INDEX ' + idx + '\\s*\\(').test(dbSrc) && dbSrc.includes("idxErr.code !== 'ER_DUP_KEYNAME'"));
  check(`${idx} อยู่ใน schema.sql (${table})`, new RegExp('KEY `' + idx + '`').test(schemaSrc));
}

console.log('F) requireRole/validateRequest รวมไว้ที่ src/middleware/guards.js (ห้ามนิยามซ้ำ):');
const guardsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'guards.js'), 'utf8');
check('server.js ไม่นิยาม function requireRole เอง (ต้อง import จาก guards)', !/function requireRole\s*\(/.test(serverSrc));
check('server.js ไม่นิยาม function validateRequest เอง (ต้อง import จาก guards)', !/function validateRequest\s*\(/.test(serverSrc));
check('server.js import requireRole/validateRequest จาก src/middleware/guards', /require\('\.\/src\/middleware\/guards'\)/.test(serverSrc) && serverSrc.includes('requireRole, validateRequest'));
check('guards.js ยังมี requireRole อยู่ (ที่เดียวของแอป)', /function requireRole\s*\(\.\.\.roles\)/.test(guardsSrc));
check('guards.js ยังมี validateRequest อยู่ (ที่เดียวของแอป)', /function validateRequest\s*\(schema\)/.test(guardsSrc));
// ทั่ว src/ — ต้องไม่มีไฟล์อื่นนิยาม guards ซ้ำ (นอกจาก guards.js)
const srcRoot = path.join(__dirname, '..', 'src');
function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walkJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}
const guardDup = walkJs(srcRoot).filter(f => !f.endsWith('middleware' + path.sep + 'guards.js')
  && /function requireRole\s*\(|function validateRequest\s*\(/.test(fs.readFileSync(f, 'utf8')));
check('ไม่มีไฟล์อื่นใน src/ นิยาม requireRole/validateRequest ซ้ำ (รวมไว้ที่ guards.js)', guardDup.length === 0);
// router ทุกไฟล์ที่ใช้ guards ต้อง import จาก middleware/guards
const routesDir = path.join(__dirname, '..', 'src', 'routes');
let allRoutesOk = true;
for (const f of fs.readdirSync(routesDir).filter(x => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(routesDir, f), 'utf8');
  if (/requireRole|validateRequest/.test(src) && !/require\('\.\.\/middleware\/guards'\)/.test(src)) {
    allRoutesOk = false;
    console.log('    ✗', f, 'ใช้ guards แต่ไม่ import จาก middleware/guards');
  }
}
check('router ทุกไฟล์ที่ใช้ guards ต้อง import จาก middleware/guards', allRoutesOk);
// พฤติกรรม middleware ล็อก (กันแก้ guards.js แล้วเพี้ยน):
check('requireRole → 403 + ข้อความมาตรฐาน', /res\.status\(403\)\.json\(\{ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' \}\)/.test(guardsSrc));
check('validateRequest → 400 Validation failed + details', /res\.status\(400\)\.json\(\{ error: 'Validation failed', details: messages \}\)/.test(guardsSrc));
check('validateRequest set req.validatedBody + req.body (sanitize)', /req\.validatedBody = value/.test(guardsSrc) && /req\.body = value/.test(guardsSrc));

console.log('G) error response ใช้ utils/http.js ตัวกลาง (serverError — กัน copy 500 ซ้ำ):');
const httpSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'http.js'), 'utf8');
check('http.js มี serverError (500 ข้อความกลาง)', /function serverError\(res/.test(httpSrc));
check('http.js sendError คืน { error } + spread object details (key เดิมคงอยู่) / details primitive', /function sendError\(res/.test(httpSrc) && httpSrc.includes('const body = { error: message }') && httpSrc.includes('Object.assign(body, details)') && httpSrc.includes('body.details = details'));
const raw500 = (serverSrc.match(/res\.status\(500\)\.json\(\{ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง'\}\);/g) || []).length;
check('server.js ไม่เหลือ raw 500 ข้อความกลาง (ต้อง serverError(res))', raw500 === 0);
check('server.js ใช้ serverError(res) แล้ว', serverSrc.includes('serverError(res)'));
check('server.js import serverError จาก utils/http', /require\('\.\/src\/utils\/http'\)/.test(serverSrc));
const ctrlWith500 = ['adminController', 'authController', 'memberController', 'memberGroupsController', 'promotionsController', 'reportController', 'settingsController'];
let ctrl500Ok = true;
for (const c of ctrlWith500) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', c + '.js'), 'utf8');
  const raw = (src.match(/res\.status\(500\)\.json\(\{ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง'\}\);/g) || []).length;
  const imports = /require\('\.\.\/utils\/http'\)/.test(src);
  if (raw > 0 || !imports) { ctrl500Ok = false; console.log('    ✗', c, 'raw500=', raw, 'import=', imports); }
}
check('controllers ทั้ง 7 ไฟล์ใช้ serverError(res) + import utils/http (ไม่เหลือ raw)', ctrl500Ok);

console.log('H) SQL query ซ้ำรวมไว้ที่ utils/queries.js (กัน query ต่างกันทีละจุด):');
const queriesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'queries.js'), 'utf8');
check('queries.js มี getOrderItems (order_items เดิม 6 จุด)', queriesSrc.includes('SELECT product_id, quantity FROM order_items WHERE order_id = ?'));
check('queries.js มี getUserFullName', queriesSrc.includes('SELECT full_name FROM users WHERE id = ?'));
check('queries.js มี getUserRole', queriesSrc.includes('SELECT role FROM users WHERE id = ?'));
check('queries.js มี lockUserPoints (FOR UPDATE)', queriesSrc.includes('SELECT points FROM users WHERE id = ? FOR UPDATE'));
check('server.js ไม่เหลือ order_items query raw (ต้อง getOrderItems)', !/conn\.query\('SELECT product_id, quantity FROM order_items WHERE order_id = \?'/.test(serverSrc));
check('server.js ไม่เหลือ full_name query raw (ต้อง getUserFullName)', !/conn\.query\('SELECT full_name FROM users WHERE id = \?'/.test(serverSrc));
check('server.js ไม่เหลือ role query raw (ต้อง getUserRole)', !/(?:pool|conn)\.query\('SELECT role FROM users WHERE id = \?'/.test(serverSrc));
check('server.js ไม่เหลือ points FOR UPDATE raw (ต้อง lockUserPoints)', !/conn\.query\('SELECT points FROM users WHERE id = \?' FOR UPDATE'/.test(serverSrc));
check('server.js import queries จาก utils/queries', /require\('\.\/src\/utils\/queries'\)/.test(serverSrc));

console.log('I) 4xx response ใช้ utils/http.js ตัวกลาง (badRequest/unauthorized/forbidden/notFound/conflict/gone):');
check('http.js มี unauthorized (401)', /function unauthorized\(res/.test(httpSrc));
check('http.js มี forbidden (403)', /function forbidden\(res/.test(httpSrc));
check('http.js มี conflict (409)', /function conflict\(res/.test(httpSrc));
check('http.js มี gone (410)', /function gone\(res/.test(httpSrc));
// helper ต้องถูกใช้จริง (ไม่ใช่ของตาย):
const ctrl4xxSrcs = ctrlWith500.map(c => fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', c + '.js'), 'utf8')).join('\n');
check('badRequest ถูกใช้จริง (server.js + controllers)', /badRequest\(/.test(serverSrc) && /badRequest\(/.test(ctrl4xxSrcs));
check('notFound ถูกใช้จริง (server.js + controllers)', /notFound\(/.test(serverSrc) && /notFound\(/.test(ctrl4xxSrcs));
check('unauthorized/forbidden/conflict/gone ถูกใช้จริงใน server.js', ['unauthorized(', 'forbidden(', 'conflict(', 'gone('].every(h => serverSrc.includes(h)));
// ห้าม raw 4xx json เขียนเอง (guards.js = ตำแหน่งนิยามกลาง + lineWebhook .end() = LINE protocol — ข้อยกเว้น):
const raw4xx = (serverSrc.match(/res\.status\(4[0-9][0-9]\)\.json/g) || []).length;
check('server.js ไม่เหลือ raw res.status(4xx).json (ต้องผ่าน helper)', raw4xx === 0);
let ctrlNoRaw4xx = true;
for (const c of ctrlWith500) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', c + '.js'), 'utf8');
  const raw = (src.match(/res\.status\(4[0-9][0-9]\)\.json/g) || []).length;
  if (raw > 0) { ctrlNoRaw4xx = false; console.log('    ✗', c, 'raw4xx=', raw); }
}
check('controllers ทั้ง 7 ไฟล์ไม่เหลือ raw res.status(4xx).json (ต้องผ่าน helper)', ctrlNoRaw4xx);
check('lineWebhook res.status(401).end() ยังอยู่ (LINE webhook ต้องตอบ raw status)', /res\.status\(401\)\.end\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'lineWebhookController.js'), 'utf8')));

console.log('J) audit_logs INSERT ใช้ utils/auditLog.logAudit กลาง (เดิม copy 24 จุด):');
const auditSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'auditLog.js'), 'utf8');
check('auditLog.js มี logAudit (INSERT + JSON.stringify ที่เดียว)', /async function logAudit/.test(auditSrc) && auditSrc.includes('JSON.stringify(details)') && auditSrc.includes('INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details)'));
check('server.js import logAudit จาก utils/auditLog', /require\('\.\/src\/utils\/auditLog'\)/.test(serverSrc) && serverSrc.includes('logAudit'));
check('server.js ไม่เหลือ INSERT INTO audit_logs raw (ต้อง logAudit)', (serverSrc.match(/INSERT INTO audit_logs/g) || []).length === 0);
let ctrlAuditOk = true;
for (const c of ctrlWith500) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', c + '.js'), 'utf8');
  const raw = (src.match(/INSERT INTO audit_logs/g) || []).length;
  if (raw > 0) { ctrlAuditOk = false; console.log('    ✗', c, 'rawAudit=', raw); }
}
check('controllers ทั้ง 7 ไฟล์ไม่เหลือ INSERT INTO audit_logs raw (ต้อง logAudit)', ctrlAuditOk);
const reportSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'reportController.js'), 'utf8');
check('reportController ใช้ resolveMonth (ห้าม copy req.query.month || bangkokDateStr().slice(0, 7))', !/req\.query\.month \|\| bangkokDateStr\(\)\.slice\(0, 7\)/.test(reportSrc) && /function resolveMonth\(query\)/.test(reportSrc) && /resolveMonth\(req\.query\)/.test(reportSrc));
check('withTransaction helper ยังอยู่ (ที่เดียวของแอป — legacy tx มี early-rollback ต่างกัน ข้ามตั้งใจ)', /async function withTransaction\(pool, callback\)/.test(serverSrc));

console.log('K) backend/Dockerfile node version ตรงกับ engines.node (กัน Dockerfile หลุดแบบ sharp):');
const backendPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const dockerSrc = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
const engNode = backendPkg.engines && backendPkg.engines.node;
check('backend/package.json มี engines.node', !!engNode);
const engFloor = engNode ? Number(((engNode.match(/(?:>=|~=|~|\^|=|)\s*v?(\d+)/) || [])[1])) : NaN;
const dockerMajor = Number(((dockerSrc.match(/^FROM\s+node:(\d+)/m) || [])[1]));
check(`Dockerfile node major (${dockerMajor}) ≥ engines floor (${engFloor})`, Number.isFinite(dockerMajor) && Number.isFinite(engFloor) && dockerMajor >= engFloor);
check('มี scripts/check-docker-node-version.js (ตัว CI รัน)', fs.existsSync(path.join(__dirname, '..', 'scripts', 'check-docker-node-version.js')));

console.log(`\n${fail === 0 ? '✅' : '❌'} serverGuardRails: ${pass} ผ่าน, ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
