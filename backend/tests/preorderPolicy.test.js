// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/preorderPolicy.test.js — เทสหน่วยนโยบายแต้มพรีออเดอร์ (staff จองได้ แต่ไม่มีสิทธิ์แต้ม)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ครอบลอจิกใน src/utils/preorderPolicy.js (ของจริงที่ route ใช้) 4 ชั้น:
//   A. resolveOrderPoints — เมทริกซ์สิทธิ์ตาม role (ใครได้แต้ม/ใครโดนบล็อก)
//   B. resolveRedeemPoints + computeEarnPoints — คณิตแลก/สะสมแต้ม (cap แต้มจริง/ยอดบิล)
//   C. จำลองฟลว POST /orders ด้วย mocked conn — staff แลกแต้ม → 403 ไม่แตะ DB เลย; staff
//      สั่งปกติ → 0 แต้ม ไม่มี REDEEM/EARN; member → ฟลวเต็มยังทำงาน (regression)
//   D. source contract — server.js ใช้ resolveOrderPoints ก่อนเริ่ม transaction + COMPLETED
//      เครดิตแต้มเฉพาะเจ้าของที่ยังเป็น MEMBER (กันใครแก้ route กลับไป bypass นโยบาย)
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const { strict: assert } = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveOrderPoints, resolveRedeemPoints, computeEarnPoints, isMemberRole, resolveSaleMemberPoints } = require('../src/utils/preorderPolicy');
const { toSatang, fromSatang } = require('../src/utils/money');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ─── A. resolveOrderPoints — เมทริกซ์สิทธิ์ ────────────────────────────────────
describe('A. resolveOrderPoints (ใครมีสิทธิ์แต้มสมาชิกในพรีออเดอร์)', () => {
  test('MEMBER: สิทธิ์เต็ม — แลกตามที่ขอ, สะสมได้, ไม่โดนบล็อก', () => {
    const r = resolveOrderPoints({ role: 'MEMBER', usePhoneForPoints: true, redeemPoints: 50 });
    assert.equal(r.isMember, true);
    assert.equal(r.usePhoneForPoints, true);
    assert.equal(r.redeemPoints, 50);
    assert.equal(r.blockedRedeem, false);
  });

  test('MEMBER: redeem_points ส่งเป็น string "50" → แปลงเป็นตัวเลขให้', () => {
    const r = resolveOrderPoints({ role: 'MEMBER', usePhoneForPoints: false, redeemPoints: '50' });
    assert.equal(r.redeemPoints, 50);
  });

  test('MEMBER: redeem_points ติดลบ/NaN → ปัดเป็น 0 (ไม่มีแต้มติดลบ)', () => {
    assert.equal(resolveOrderPoints({ role: 'MEMBER', usePhoneForPoints: false, redeemPoints: -10 }).redeemPoints, 0);
    assert.equal(resolveOrderPoints({ role: 'MEMBER', usePhoneForPoints: false, redeemPoints: NaN }).redeemPoints, 0);
  });

  test('CASHIER: ส่ง redeem_points > 0 → blockedRedeem (route ตอบ 403), แลก = 0, สะสมปิดบังคับ', () => {
    const r = resolveOrderPoints({ role: 'CASHIER', usePhoneForPoints: true, redeemPoints: 50 });
    assert.equal(r.isMember, false);
    assert.equal(r.blockedRedeem, true, 'staff ปลอม payload ขอแลกแต้ม = ต้องโดนปัด block ชัดเจน');
    assert.equal(r.redeemPoints, 0);
    assert.equal(r.usePhoneForPoints, false, 'staff ติ๊กสะสมแต้ม = ปิดให้เงียบๆ (ไม่ใช่สิทธิ์ของพนักงาน)');
  });

  test('MANAGER + ADMIN: นโยบายเดียวกับ CASHIER (ทุก role ที่ไม่ใช่ MEMBER = ไม่มีสิทธิ์แต้ม)', () => {
    for (const role of ['MANAGER', 'ADMIN']) {
      const r = resolveOrderPoints({ role, usePhoneForPoints: true, redeemPoints: 10 });
      assert.equal(r.blockedRedeem, true, `${role} ต้องโดน block เมื่อขอแลกแต้ม`);
      assert.equal(r.redeemPoints, 0);
      assert.equal(r.usePhoneForPoints, false);
    }
  });

  test('staff สั่งปกติ (ไม่ขอแลกแต้ม) → ไม่โดน block สั่งจองได้ตามปกติ', () => {
    for (const role of ['CASHIER', 'MANAGER', 'ADMIN']) {
      const r = resolveOrderPoints({ role, usePhoneForPoints: false, redeemPoints: 0 });
      assert.equal(r.blockedRedeem, false, `${role} สั่งจองสินค้าธรรมดาต้องผ่าน`);
      assert.equal(r.redeemPoints, 0);
    }
  });

  test('redeem_points undefined (client ไม่ส่ง) → ไม่ block, แลก = 0', () => {
    const r = resolveOrderPoints({ role: 'CASHIER', usePhoneForPoints: false, redeemPoints: undefined });
    assert.equal(r.blockedRedeem, false);
    assert.equal(r.redeemPoints, 0);
  });
});

// ─── B. resolveRedeemPoints + computeEarnPoints — คณิตแต้ม ─────────────────────
describe('B. resolveRedeemPoints / computeEarnPoints (คณิตแลก + สะสม)', () => {
  test('แลกตามที่ขอ ถ้าแต้มจริงและยอดบิลรองรับ (ขอ 50 มี 100 บิลพอ)', () => {
    assert.equal(resolveRedeemPoints({ requested: 50, availablePoints: 100, totalAmount: 100, redeemRate: 1 }), 50);
  });

  test('cap ด้วยแต้มจริง: ขอ 50 แต่มีแค่ 30 → แลกได้ 30', () => {
    assert.equal(resolveRedeemPoints({ requested: 50, availablePoints: 30, totalAmount: 100, redeemRate: 1 }), 30);
  });

  test('cap ด้วยยอดบิล: ขอ 50 มี 100 แต้ม แต่บิลแค่ 40 บาท → แลกได้ floor(40/1) = 40', () => {
    assert.equal(resolveRedeemPoints({ requested: 50, availablePoints: 100, totalAmount: 40, redeemRate: 1 }), 40);
  });

  test('อัตราแลกไม่ใช่ 1:1 (redeemRate 0.5 → 2 แต้มต่อบาท) — ขอ 100 แต้ม บิล 50 → แลกได้ floor(50/0.5)=100', () => {
    assert.equal(resolveRedeemPoints({ requested: 100, availablePoints: 500, totalAmount: 50, redeemRate: 0.5 }), 100);
  });

  test('ไม่ขอแลก (0/ติดลบ/NaN) → 0 เสมอ ไม่แตะบิล', () => {
    assert.equal(resolveRedeemPoints({ requested: 0, availablePoints: 100, totalAmount: 100, redeemRate: 1 }), 0);
    assert.equal(resolveRedeemPoints({ requested: -5, availablePoints: 100, totalAmount: 100, redeemRate: 1 }), 0);
    assert.equal(resolveRedeemPoints({ requested: NaN, availablePoints: 100, totalAmount: 100, redeemRate: 1 }), 0);
  });

  test('computeEarnPoints: เปิดสะสม → floor(ยอดสุทธิ/earnPer); ปิด → 0', () => {
    assert.equal(computeEarnPoints({ usePhoneForPoints: true, netTotal: 199, earnPer: 20 }), 9); // floor(9.95)
    assert.equal(computeEarnPoints({ usePhoneForPoints: false, netTotal: 199, earnPer: 20 }), 0);
  });
});

// ─── C. จำลองฟลว POST /orders ด้วย mocked conn ─────────────────────────────────
describe('C. จำลองฟลว POST /orders (staff vs member แต้ม)', () => {
  const PRODUCTS = { 3: { id: 3, name: 'น้ำเปล่า', price: 10, stock: 100 } };

  // conn mock — บันทึกทุก query, จำลองผล SELECT/INSERT/UPDATE (ไม่แตะ DB จริง)
  function createMockConn({ productsById, pointsById }) {
    const log = [];
    const state = { inTx: false, rolledBack: false, committed: false, released: false };
    const conn = {
      async beginTransaction() { state.inTx = true; log.push({ op: 'begin' }); },
      async commit() { state.committed = true; state.inTx = false; log.push({ op: 'commit' }); },
      async rollback() { state.rolledBack = true; state.inTx = false; log.push({ op: 'rollback' }); },
      async release() { state.released = true; log.push({ op: 'release' }); },
      async query(sql, params) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        log.push({ op: 'query', sql: s, params });
        if (s.includes('FROM products WHERE id = ?')) {
          const row = productsById[params[0]];
          return [row ? [row] : []];
        }
        if (s.includes('SELECT points FROM users WHERE id = ?')) {
          return [[{ points: pointsById[params[0]] ?? 0 }]];
        }
        if (s.includes('INSERT INTO orders')) return [{ insertId: 5001 }];
        if (s.includes('INSERT INTO order_items')) return [{ affectedRows: 1 }];
        if (s.includes('UPDATE products SET stock')) return [{ affectedRows: 1 }];
        if (s.includes('UPDATE users SET points')) return [{ affectedRows: 1 }];
        if (s.includes('INSERT INTO point_transactions')) return [{ affectedRows: 1 }];
        throw new Error(`mock ไม่รู้จัก query: ${s}`);
      },
    };
    return { conn, log, state };
  }

  // จำลอง route POST /orders ตามลำดับจริง (เรียก resolveOrderPoints/resolveRedeemPoints/
  // computeEarnPoints ตัวจริงจาก utils — orchestration เท่านั้นที่จำลอง)
  async function simulatePreOrder({ role, userId, items, productsById, pointsById, usePhoneForPoints = false, redeemPoints = 0, redeemRate = 1, earnPer = 20, completeOrder = false }) {
    const { conn, log, state } = createMockConn({ productsById, pointsById });
    const policy = resolveOrderPoints({ role, usePhoneForPoints, redeemPoints });

    // route ตอบ 403 ก่อน getConnection/beginTransaction → ไม่ควรมีการติดต่อ DB เลย
    if (policy.blockedRedeem) {
      return { status: 403, log, state, order: null };
    }

    try {
      await conn.beginTransaction();
      let totalAmountSatang = 0;
      const processedItems = [];
      for (const item of items) {
        const [[product]] = await conn.query(
          'SELECT id, name, price, stock FROM products WHERE id = ? FOR UPDATE',
          [item.product_id],
        );
        if (!product) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);
        if (product.stock < item.quantity) throw new Error(`สต๊อกไม่พอสำหรับ "${product.name}"`);
        totalAmountSatang += toSatang(Number(product.price)) * item.quantity;
        processedItems.push({ product_id: item.product_id, quantity: item.quantity });
      }
      const totalAmount = fromSatang(totalAmountSatang);

      // แลกแต้ม (ถ้ามีสิทธิ์)
      let pointsRedeemed = 0;
      let pointsDiscount = 0;
      if (policy.redeemPoints > 0) {
        const [[userRow]] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
        pointsRedeemed = resolveRedeemPoints({ requested: policy.redeemPoints, availablePoints: userRow.points, totalAmount, redeemRate });
        pointsDiscount = fromSatang(toSatang(pointsRedeemed * redeemRate));
      }
      const netTotal = fromSatang(totalAmountSatang - toSatang(pointsDiscount));
      const earnPoints = computeEarnPoints({ usePhoneForPoints: policy.usePhoneForPoints, netTotal, earnPer });

      // INSERT หัวบิล + รายการ + ตัดสต๊อก + หักแต้ม (ถ้ามี)
      await conn.query('INSERT INTO orders (user_id, total_amount, earn_points, points_redeemed, points_discount, status) VALUES (?, ?, ?, ?, ?, ?)', [userId, netTotal, earnPoints, pointsRedeemed, pointsDiscount, 'PENDING_VERIFY']);
      for (const pi of processedItems) {
        await conn.query('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)', [5001, pi.product_id, pi.quantity]);
        await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [pi.quantity, pi.product_id]);
      }
      const redeemedTxn = pointsRedeemed > 0;
      if (redeemedTxn) {
        await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, userId]);
        await conn.query("INSERT INTO point_transactions (user_id, type, points, order_id) VALUES (?, 'REDEEM', ?, ?)", [userId, -pointsRedeemed, 5001]);
      }
      await conn.commit();

      const order = { earn_points: earnPoints, points_redeemed: pointsRedeemed, points_discount: pointsDiscount, total_amount: netTotal };

      // ⭐️ จำลองขั้น COMPLETED (PUT /orders/:id/status) — เครดิตแต้มเฉพาะเจ้าของที่ยังเป็น MEMBER
      if (completeOrder) {
        const ownerRole = role; // จำลองอ่าน role จาก DB (เจ้าของออเดอร์)
        let credited = false;
        if (order.earn_points > 0 && ownerRole === 'MEMBER') {
          await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.earn_points, userId]);
          credited = true;
        }
        return { status: 200, order, earnedCredited: credited, redeemedTxn, log, state };
      }

      return { status: 201, order, earnedCredited: false, redeemedTxn, log, state };
    } catch (e) {
      await conn.rollback();
      return { status: 500, error: e.message, order: null, log, state };
    } finally {
      conn.release();
    }
  }

  function writeQueries(log) {
    return log.filter(e => e.op === 'query' && !/^SELECT/.test(e.sql));
  }

  test('🚫 staff (CASHIER) ปลอม payload ขอแลกแต้ม → 403 ก่อนแตะ DB: ไม่มี begin/เขียน/ตัดสต๊อกเลย', async () => {
    const out = await simulatePreOrder({
      role: 'CASHIER', userId: 7, items: [{ product_id: 3, quantity: 2 }],
      productsById: PRODUCTS, pointsById: { 7: 500 }, redeemPoints: 50,
    });
    assert.equal(out.status, 403);
    assert.equal(out.order, null);
    assert.equal(out.log.length, 0, '403 เกิดก่อน getConnection — ต้องไม่มีการติดต่อ DB สักครั้ง');
    assert.equal(out.state.inTx, false);
    assert.equal(writeQueries(out.log).length, 0);
  });

  test('staff (MANAGER) สั่งปกติ → ออเดอร์สร้างได้, earn=0/redeem=0 (แม้ติ๊กสะสม), ไม่มี REDEEM/EARN แต้มเลย', async () => {
    const out = await simulatePreOrder({
      role: 'MANAGER', userId: 8, items: [{ product_id: 3, quantity: 2 }],
      productsById: PRODUCTS, pointsById: { 8: 999 }, usePhoneForPoints: true, redeemPoints: 0,
    });
    assert.equal(out.status, 201);
    assert.deepEqual(out.order, { earn_points: 0, points_redeemed: 0, points_discount: 0, total_amount: 20 });
    assert.equal(out.redeemedTxn, false);
    const writes = writeQueries(out.log);
    assert.ok(writes.some(q => /INSERT INTO orders/.test(q.sql)), 'ต้อง INSERT ออเดอร์');
    assert.ok(!writes.some(q => /UPDATE users SET points/.test(q.sql)), 'staff ต้องไม่มีการแตะยอดแต้ม');
    assert.ok(!writes.some(q => /point_transactions/.test(q.sql)), 'staff ต้องไม่มี txn แต้ม');
    assert.equal(out.state.committed, true);
    assert.equal(out.state.rolledBack, false);
  });

  test('member สั่งพร้อมแลกแต้ม + สะสม → ฟลวเต็มยังทำงาน (regression: ไม่หักสิทธิ์ member)', async () => {
    const out = await simulatePreOrder({
      role: 'MEMBER', userId: 9, items: [{ product_id: 3, quantity: 2 }],
      productsById: PRODUCTS, pointsById: { 9: 100 }, usePhoneForPoints: true, redeemPoints: 5, redeemRate: 1, earnPer: 20,
    });
    assert.equal(out.status, 201);
    assert.equal(out.order.points_redeemed, 5);
    assert.equal(out.order.earn_points, 0); // netTotal หลังหักแต้ม = 15 → floor(15/20) = 0
    assert.equal(out.redeemedTxn, true);
    const writes = writeQueries(out.log);
    assert.ok(writes.some(q => /UPDATE users SET points = points -/.test(q.sql)), 'member ต้องโดนหักแต้มแลก');
    assert.ok(writes.some(q => /'REDEEM'/.test(q.sql)), 'member ต้องมี txn REDEEM');
    assert.equal(out.state.committed, true);
  });

  test('member แลกแต้มเกินยอดบิล → cap ที่ยอดบิล (ขอ 50 บิล 20 บาท → แลกได้ 20)', async () => {
    const out = await simulatePreOrder({
      role: 'MEMBER', userId: 9, items: [{ product_id: 3, quantity: 2 }],
      productsById: PRODUCTS, pointsById: { 9: 100 }, usePhoneForPoints: false, redeemPoints: 50, redeemRate: 1,
    });
    assert.equal(out.status, 201);
    assert.equal(out.order.points_redeemed, 20);
    assert.equal(out.order.total_amount, 0);
  });

  test('🔒 COMPLETED: เจ้าของเป็น staff (earn_points เผลอ > 0) → ไม่เครดิตแต้ม (defense-in-depth)', async () => {
    // จำลองว่าออเดอร์ staff มี earn_points ติดมา (เช่น legacy) — ขั้น COMPLETED ต้องไม่เครดิต
    const out = await simulatePreOrder({
      role: 'CASHIER', userId: 7, items: [{ product_id: 3, quantity: 2 }],
      productsById: PRODUCTS, pointsById: { 7: 0 }, usePhoneForPoints: true, completeOrder: true,
    });
    // earn_points ของ staff = 0 อยู่แล้ว (policy ตัดตอนสร้าง) → ไม่มีอะไรให้เครดิต
    assert.equal(out.order.earn_points, 0);
    assert.equal(out.earnedCredited, false);
  });

  test('🔒 COMPLETED: เจ้าของเป็น MEMBER → เครดิตแต้ม EARN ให้', async () => {
    const out = await simulatePreOrder({
      role: 'MEMBER', userId: 9, items: [{ product_id: 3, quantity: 3 }], // 30 บาท
      productsById: PRODUCTS, pointsById: { 9: 0 }, usePhoneForPoints: true, earnPer: 20, completeOrder: true,
    });
    assert.equal(out.order.earn_points, 1); // floor(30/20)
    assert.equal(out.earnedCredited, true, 'member ต้องได้เครดิตแต้มตอนรับของ');
    const writes = writeQueries(out.log);
    assert.ok(writes.some(q => /UPDATE users SET points = points \+/.test(q.sql)), 'ต้องมี +points ตอน COMPLETED');
  });
});

// ─── E. resolveSaleMemberPoints — บิลขาย POS (cashier เลือกบัญชี staff เป็นสมาชิก) ──
describe('E. resolveSaleMemberPoints (บิลขาย POS: แต้ม = สิทธิ์ MEMBER เท่านั้น)', () => {
  test('isMemberRole: เฉพาะ MEMBER เท่านั้น', () => {
    assert.equal(isMemberRole('MEMBER'), true);
    for (const r of ['CASHIER', 'MANAGER', 'ADMIN', undefined, null, '']) assert.equal(isMemberRole(r), false);
  });

  test('member เลือกในบิล → canUsePoints, ไม่ block (แลกแต้ม/ของรางวัลได้ตามปกติ)', () => {
    const r = resolveSaleMemberPoints({ role: 'MEMBER', redeemPoints: 50, rewardPointsNeeded: 0 });
    assert.equal(r.canUsePoints, true);
    assert.equal(r.blockedRedeem, false);
    const r2 = resolveSaleMemberPoints({ role: 'MEMBER', redeemPoints: 0, rewardPointsNeeded: 80 });
    assert.equal(r2.canUsePoints, true);
    assert.equal(r2.blockedRedeem, false);
  });

  test('staff account เป็นสมาชิกในบิล + ขอแลกแต้ม/ของรางวัล → blockedRedeem (route ตอบ 400)', () => {
    for (const role of ['CASHIER', 'MANAGER', 'ADMIN']) {
      const r = resolveSaleMemberPoints({ role, redeemPoints: 50, rewardPointsNeeded: 0 });
      assert.equal(r.canUsePoints, false);
      assert.equal(r.blockedRedeem, true, `${role} ขอแลกแต้มต้อง block`);
      const r2 = resolveSaleMemberPoints({ role, redeemPoints: 0, rewardPointsNeeded: 80 });
      assert.equal(r2.blockedRedeem, true, `${role} ขอแลกของรางวัลต้อง block`);
    }
  });

  test('staff account เป็นสมาชิกในบิล แต่ไม่ขอแต้ม → ขายได้ปกติ (แค่ไม่ได้สิทธิ์แต้ม)', () => {
    const r = resolveSaleMemberPoints({ role: 'CASHIER', redeemPoints: 0, rewardPointsNeeded: 0 });
    assert.equal(r.canUsePoints, false);
    assert.equal(r.blockedRedeem, false, 'ไม่ขอแต้ม = ไม่ต้อง block บิล');
  });

  test('redeemPoints เป็น string/undefined → ยังทำงานถูก (Number ครอบไว้)', () => {
    assert.equal(resolveSaleMemberPoints({ role: 'CASHIER', redeemPoints: '10', rewardPointsNeeded: 0 }).blockedRedeem, true);
    assert.equal(resolveSaleMemberPoints({ role: 'CASHIER', redeemPoints: undefined, rewardPointsNeeded: 0 }).blockedRedeem, false);
  });
});

// ─── D. source contract — route ใช้ policy จริง (กัน bypass กลับ) ──────────────
describe('D. source contract — server.js ใช้ preorderPolicy จริง', () => {
  function handlerWindow(startMarker, endMarker) {
    const start = SERVER_SRC.indexOf(startMarker);
    assert.ok(start >= 0, `หา marker ไม่เจอ: ${startMarker}`);
    const end = SERVER_SRC.indexOf(endMarker, start);
    assert.ok(end >= 0, `หา end marker ไม่เจอ: ${endMarker}`);
    return SERVER_SRC.slice(start, end);
  }

  test('POST /orders เรียก resolveOrderPoints + ตอบ 403 ก่อนเริ่ม transaction', () => {
    const src = handlerWindow("app.post('/api/orders',", '// 3. API ดึงรายการออเดอร์');
    assert.ok(src.includes('resolveOrderPoints('), 'handler ต้องใช้ resolveOrderPoints (นโยบายกลาง)');
    assert.ok(src.includes('pointsPolicy.blockedRedeem'), 'ต้องเช็ค blockedRedeem');
    assert.ok(/res\.status\(403\)/.test(src), 'staff ขอแลกแต้มต้องตอบ 403');
    const beginIdx = src.indexOf('beginTransaction');
    const blockIdx = src.indexOf('blockedRedeem');
    assert.ok(beginIdx > 0 && blockIdx > 0 && blockIdx < beginIdx, 'blockedRedeem ต้องถูกเช็คก่อน beginTransaction (ไม่มี side effect)');
    assert.ok(src.includes('pointsPolicy.redeemPoints'), 'แลกแต้มต้องอ่านจาก pointsPolicy (ไม่ใช่ redeem_points ดิบ)');
    assert.ok(src.includes('pointsPolicy.usePhoneForPoints'), 'สะสมแต้มต้องอ่านจาก pointsPolicy (ไม่ใช่ use_phone_for_points ดิบ)');
  });

  test('PUT /orders/:id/status (COMPLETED) เครดิตแต้มเฉพาะเจ้าของที่ยังเป็น MEMBER', () => {
    const src = handlerWindow("app.put('/api/orders/:id/status'", "app.get('/api/orders/pending-count'");
    assert.ok(src.includes('isMemberRole('), 'COMPLETED ต้องเช็ค role เจ้าของออเดอร์ก่อนเครดิตแต้ม (ผ่าน isMemberRole)');
    assert.ok(src.includes("'แต้มสะสมจากพรีออเดอร์'"), 'EARN txn ยังต้องมี (สำหรับ member)');
  });

  test('POST /sales/checkout ใช้ resolveSaleMemberPoints + ตอบ 400 (statusCode) + earn ครอบ memberCanUsePoints', () => {
    const src = handlerWindow("app.post('/api/sales/checkout'", '// ⭐️ Update — Offline POS sales batch sync.');
    assert.ok(src.includes('resolveSaleMemberPoints('), 'checkout ต้องใช้ resolveSaleMemberPoints (นโยบายกลาง)');
    assert.ok(src.includes('salePoints.blockedRedeem'), 'ต้องเช็ค blockedRedeem');
    assert.ok(src.includes('err.statusCode = 400'), 'staff member ขอใช้แต้มต้องตอบ 400 (ไม่ใช่ 500)');
    assert.ok(src.includes('memberCanUsePoints ? Math.floor(netTotal / earnPer) : 0'), 'earn ต้องถูกปิดเมื่อสมาชิกเป็นบัญชี staff');
    assert.ok(src.includes('if (error.statusCode)'), 'catch ต้อง honor statusCode (client error ไม่กลายเป็น 500)');
  });
});

// ─── F. source contract — /members/lookup ต้องคืนทุก role (POS ใช้โชว์ badge staff) ──
describe('F. source contract — /members/lookup คืนทุก role (POS เห็น badge พนักงาน)', () => {
  const MEMBER_CTRL = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'memberController.js'), 'utf8');
  const MEMBER_ROUTES = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'memberRoutes.js'), 'utf8');

  function lookupFnSource() {
    const start = MEMBER_CTRL.indexOf('async function lookupMember');
    const end = MEMBER_CTRL.indexOf('// POST /api/members/register-line');
    assert.ok(start >= 0 && end > start, 'หา body ของ lookupMember ไม่เจอ');
    return MEMBER_CTRL.slice(start, end);
  }

  test('query ค้นหาต้องไม่กรอง role (ยังคืนบัญชี staff ให้ POS เห็น badge + ตัดสิทธิ์แต้ม)', () => {
    const fn = lookupFnSource();
    assert.ok(fn.includes('u.student_id = ? OR u.phone_number = ? OR u.line_user_id = ?'), 'ค้นได้ 3 ช่องทาง (student_id/เบอร์/line_user_id)');
    assert.ok(!/u\.role\s*=\s*'MEMBER'/.test(fn), 'ห้ามกรอง WHERE role = MEMBER — ถ้ากรอง POS จะเจอบัญชี staff ไม่ได้ และ badge พนักงานจะไม่โชว์');
  });

  test('SELECT (MEMBER_WITH_GROUP_SELECT) ต้องคืน u.role — POS อ่านเพื่อโชว์ badge/ปิดสิทธิ์แต้ม', () => {
    const start = MEMBER_CTRL.indexOf('MEMBER_WITH_GROUP_SELECT =');
    assert.ok(start >= 0, 'หา MEMBER_WITH_GROUP_SELECT ไม่เจอ');
    const selectSrc = MEMBER_CTRL.slice(start, start + 500);
    assert.ok(selectSrc.includes('u.role'), 'SELECT ต้องคืน u.role (POS ใช้แยก member/staff)');
    assert.ok(selectSrc.includes('u.points'), 'SELECT ต้องคืน u.points ด้วย (โชว์ badge แต้มของ member)');
  });

  test('route: /lookup/:identifier เปิดให้ CASHIER/MANAGER/ADMIN (หน้า POS ใช้)', () => {
    assert.ok(/router\.get\('\/lookup\/:identifier', requireRole\('CASHIER', 'MANAGER', 'ADMIN'\)/.test(MEMBER_ROUTES), 'lookup ต้องเปิดให้ staff (POS ใช้สแกน/ค้นหาสมาชิก)');
  });
});
