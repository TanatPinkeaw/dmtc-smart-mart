// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/rewardRedemption.test.js — เทส regression โฟลวแลกของรางวัล (POS → checkout)
// ─────────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm run test:reward (node:test ธรรมดา ไม่ต้องใช้ DB)
// ทำอะไร: เทส pure functions ใน utils/rewardRedemption.js ที่ถูกย้ายออกจาก route
//   POST /api/sales/checkout ใน server.js (ลอจิกเดิม 100% — ดู wiring ที่ server.js)
//
// ครอบกรณี (ตามที่ผู้ใช้ขอ):
//   A. evaluateRewardItem  — แต้มที่ต้องใช้ × จำนวน, ราคา 0, ส่ง redeem_reward กับสินค้าธรรมดา
//      (server-side truth กันปลอม payload), ไม่ได้เลือกสมาชิก
//   B. checkItemStock      — ของรางวัลหมดสต๊อก → เก็บ issue (ตอบ 400 เหมือนสินค้าทั่วไป)
//   C. settleRewardPoints  — แต้มไม่พอ = ยกเลิกทั้งบิล, กันใช้แต้มซ้ำ (ของรางวัลหักก่อน
//      เหลือค่อยแลกส่วนลดเงินสด), cap ด้วยยอดบิล/แต้มเหลือ, ปัดสตางค์
//   D. จำลอง flow checkout ทั้งเส้น (จำลองลำดับของ route ด้วยฟังก์ชันของจริง) —
//      บิลผสมสินค้าปกติ+ของรางวัล → หักแต้ม/ตัดสต๊อกถูกต้อง ไม่ใช้แต้มซ้ำ
// ═══════════════════════════════════════════════════════════════════════════════════
const { describe, test } = require('node:test');
const { strict: assert } = require('node:assert');
const { evaluateRewardItem, checkItemStock, settleRewardPoints } = require('../src/utils/rewardRedemption');
const { toSatang } = require('../src/utils/money');

// ── ตัวช่วย: ของรางวัล/สินค้าจำลอง (รูปร่างเดียวกับแถวจาก SELECT ใน checkout) ──
const rewardProduct = { id: 11, name: 'ตุ๊กตาหมี', price: '0.00', stock: 5, is_reward_item: 1, points_required: 80 };
const normalProduct = { id: 3, name: 'ชานมไข่มุก', price: '55.00', stock: 20, is_reward_item: 0, points_required: 0 };

// ── A. evaluateRewardItem ──
describe('A. evaluateRewardItem (ประเมินรายการของรางวัล 1 รายการ)', () => {
  test('ของรางวัลปกติ: ราคา 0, จ่ายด้วยแต้ม, แต้มที่ต้องใช้ = points_required × จำนวน', () => {
    const out = evaluateRewardItem({ item: { product_id: 11, quantity: 1, redeem_reward: true }, product: rewardProduct, memberId: 7 });
    assert.equal(out.need, 80);
    assert.deepEqual(out.processedItem, {
      product_id: 11, quantity: 1, unit_price: 0, subtotal: 0,
      stock_before: 5, redeemed_with_points: true, reward_points: 80,
    });
  });

  test('quantity > 1: แต้มที่ต้องใช้คูณตามจำนวน (2 ชิ้น × 80 = 160)', () => {
    const out = evaluateRewardItem({ item: { product_id: 11, quantity: 2, redeem_reward: true }, product: rewardProduct, memberId: 7 });
    assert.equal(out.need, 160);
    assert.equal(out.processedItem.reward_points, 160);
  });

  test('🚫 ส่ง redeem_reward กับสินค้าธรรมดา → ปฏิเสธทั้งบิล (server-side truth กันปลอม payload)', () => {
    assert.throws(
      () => evaluateRewardItem({ item: { product_id: 3, quantity: 1, redeem_reward: true }, product: normalProduct, memberId: 7 }),
      /สินค้านี้ไม่ใช่ของรางวัล: ชานมไข่มุก/,
    );
  });

  test('🚫 ไม่ได้เลือกสมาชิก → ปฏิเสธ (แลกของรางวัลต้องมีสมาชิกในบิล)', () => {
    assert.throws(
      () => evaluateRewardItem({ item: { product_id: 11, quantity: 1, redeem_reward: true }, product: rewardProduct, memberId: null }),
      /ต้องเลือกสมาชิกก่อนแลกของรางวัล/,
    );
  });
});

// ── B. checkItemStock ──
describe('B. checkItemStock (สต๊อกของรางวัล / สินค้าทั่วไป)', () => {
  test('พอ: คืน null (ผ่าน)', () => {
    assert.equal(checkItemStock({ product: rewardProduct, quantity: 1, productId: 11 }), null);
  });

  test('🚫 ของรางวัลหมดสต๊อก: คืน issue (route รวมแล้วตอบ 400 พร้อมรายละเอียด)', () => {
    const issue = checkItemStock({ product: { ...rewardProduct, stock: 0 }, quantity: 1, productId: 11 });
    assert.deepEqual(issue, { product_id: 11, product_name: 'ตุ๊กตาหมี', requested: 1, available: 0 });
  });

  test('สั่งเกินสต๊อก (ขอ 3 มี 2) → issue บอกจำนวนที่มีจริง', () => {
    const issue = checkItemStock({ product: { ...rewardProduct, stock: 2 }, quantity: 3, productId: 11 });
    assert.deepEqual(issue, { product_id: 11, product_name: 'ตุ๊กตาหมี', requested: 3, available: 2 });
  });
});

// ── C. settleRewardPoints ──
describe('C. settleRewardPoints (คิดแต้มตอน settle — กันใช้แต้มซ้ำ/แลกเกิน)', () => {
  test('🚫 แต้มไม่พอสำหรับของรางวัล → ยกเลิกทั้งบิล (error เดียวกับ route เดิม)', () => {
    assert.throws(
      () => settleRewardPoints({ memberPoints: 50, rewardPointsNeeded: 80, redeemPoints: 0, redeemRate: 1, netTotalSatang: 0 }),
      /แต้มสะสมไม่พอสำหรับแลกของรางวัล/,
    );
  });

  test('แต้มพอเป๊ะ: หักของรางวัลหมด → เหลือ 0 แต้ม แลกส่วนลดเงินสดไม่ได้อีก (กันใช้แต้มซ้ำ)', () => {
    const out = settleRewardPoints({ memberPoints: 80, rewardPointsNeeded: 80, redeemPoints: 100, redeemRate: 1, netTotalSatang: 5000 });
    assert.deepEqual(out, { rewardPoints: 80, pointsRedeemed: 0, pointsDiscount: 0, netTotalSatang: 5000 });
  });

  test('⭐️ กันใช้แต้มซ้ำ: ของรางวัลหักก่อน เหลือ 20 แต้ม → แลกส่วนลดเงินสดได้แค่ 20 (ไม่ใช่ 50 ที่ขอ)', () => {
    const out = settleRewardPoints({ memberPoints: 100, rewardPointsNeeded: 80, redeemPoints: 50, redeemRate: 1, netTotalSatang: 10000 });
    assert.equal(out.rewardPoints, 80);
    assert.equal(out.pointsRedeemed, 20); // cap ด้วยแต้มเหลือ ไม่ใช่ตามที่ขอ
    assert.equal(out.pointsDiscount, 20);
    assert.equal(out.netTotalSatang, 10000 - 2000); // ยอดบิลลด 20 บาท
  });

  test('cap ส่วนลดเงินสดด้วยยอดบิล: floor(ยอดบิล/อัตราแลก) — แต้มเหลือเยอะแต่บิลเล็ก', () => {
    // แต้ม 500, ขอแลก 100, อัตรา 1 แต้ม = 1 บาท, บิล 50 บาท → แลกได้แค่ 50
    const out = settleRewardPoints({ memberPoints: 500, rewardPointsNeeded: 0, redeemPoints: 100, redeemRate: 1, netTotalSatang: 5000 });
    assert.equal(out.pointsRedeemed, 50);
    assert.equal(out.pointsDiscount, 50);
    assert.equal(out.netTotalSatang, 0);
  });

  test('อัตราแลกไม่ใช่ 1: 1 แต้ม = 0.5 บาท → แต้มที่ใช้ = ยอดบิล ÷ 0.5', () => {
    const out = settleRewardPoints({ memberPoints: 500, rewardPointsNeeded: 0, redeemPoints: 100, redeemRate: 0.5, netTotalSatang: 4000 });
    assert.equal(out.pointsRedeemed, 80); // floor(40 / 0.5) = 80 แต้ม
    assert.equal(out.pointsDiscount, 40);
    assert.equal(out.netTotalSatang, 0);
  });

  test('ปัดเป็นสตางค์: pointsRedeemed × redeemRate ไม่กลายเป็น float เพี้ยน (0.33 × 3 = 0.99)', () => {
    const out = settleRewardPoints({ memberPoints: 100, rewardPointsNeeded: 0, redeemPoints: 3, redeemRate: 0.33, netTotalSatang: 10000 });
    assert.equal(out.pointsDiscount, 0.99);
    assert.equal(out.netTotalSatang, toSatang(100 - 0.99)); // 9901 สตางค์
  });

  test('ไม่มีของรางวัลและไม่แลกส่วนลด → คืนศูนย์ทั้งหมด ไม่แตะยอดบิล', () => {
    const out = settleRewardPoints({ memberPoints: 100, rewardPointsNeeded: 0, redeemPoints: 0, redeemRate: 1, netTotalSatang: 25000 });
    assert.deepEqual(out, { rewardPoints: 0, pointsRedeemed: 0, pointsDiscount: 0, netTotalSatang: 25000 });
  });
});

// ── D. จำลอง flow checkout ทั้งเส้น (ลำดับเดียวกับ route จริงใน server.js) ──
describe('D. จำลอง flow checkout (สินค้าปกติ + ของรางวัล)', () => {
  // จำลองลูปตรวจรายการใน route: SELECT → stock → expiry → (reward | ราคาปกติ)
  // ใช้ checkItemStock + evaluateRewardItem ของจริง — ตัวเดียวกับที่ server.js เรียก
  function simulateCheckout({ items, productsById, memberId, memberPoints, redeemPoints = 0, redeemRate = 1 }) {
    const stockIssues = [];
    let rewardPointsNeeded = 0;
    let totalAmountSatang = 0;
    const processedItems = [];

    try {
      for (const item of items) {
        const product = productsById[item.product_id];
        assert.ok(product, `สินค้า ID ${item.product_id} ไม่มีในจำลอง`);

        const stockIssue = checkItemStock({ product, quantity: item.quantity, productId: item.product_id });
        if (stockIssue) { stockIssues.push(stockIssue); continue; }

        if (item.redeem_reward) {
          const reward = evaluateRewardItem({ item, product, memberId });
          rewardPointsNeeded += reward.need;
          processedItems.push(reward.processedItem);
          continue;
        }
        totalAmountSatang += toSatang(Number(product.price)) * item.quantity;
        processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), subtotal: Number(product.price) * item.quantity, stock_before: product.stock, redeemed_with_points: false });
      }
    } catch (e) {
      // route จริง: error จากลูป (เช่น สินค้าไม่ใช่ของรางวัล) → rollback + ยกเลิกทั้งบิล
      return { rejected: true, error: e.message, points: null };
    }

    // route: สต๊อกไม่พอบางรายการ → rollback + 400 issues (ทั้งบิลไม่ผ่าน)
    if (stockIssues.length > 0) return { rejected: true, stockIssues, points: null };

    // settle แต้ม — route ล็อก FOR UPDATE แล้วเรียก settleRewardPoints
    let settled = null;
    if (memberId && (redeemPoints > 0 || rewardPointsNeeded > 0)) {
      try {
        settled = settleRewardPoints({ memberPoints, rewardPointsNeeded, redeemPoints, redeemRate, netTotalSatang: totalAmountSatang });
      } catch (e) {
        return { rejected: true, error: e.message, points: null };
      }
    }
    const netTotalSatang = settled ? settled.netTotalSatang : totalAmountSatang;
    const pointsRemaining = memberPoints - (settled ? settled.rewardPoints + settled.pointsRedeemed : 0);
    return { rejected: false, netTotalSatang, pointsUsed: settled ? settled.rewardPoints + settled.pointsRedeemed : 0, pointsRemaining, processedItems };
  }

  test('บิลผสม (ชา 55฿ + ของรางวัล 80 แต้ม): หักแต้ม 80, ยอดบิล = 55, สต๊อก/แต้มถูกต้อง', () => {
    const out = simulateCheckout({
      items: [
        { product_id: 3, quantity: 1 },
        { product_id: 11, quantity: 1, redeem_reward: true },
      ],
      productsById: { 3: normalProduct, 11: rewardProduct },
      memberId: 7, memberPoints: 100,
    });
    assert.equal(out.rejected, false);
    assert.equal(out.pointsUsed, 80);
    assert.equal(out.pointsRemaining, 20);
    assert.equal(out.netTotalSatang, 5500); // ของรางวัลราคา 0 ไม่บวกยอด
    const rewardLine = out.processedItems.find(p => p.redeemed_with_points);
    assert.equal(rewardLine.unit_price, 0);
  });

  test('ของรางวัล 2 ชิ้น × 80 = 160 แต้ม + แต้มสมาชิก 120 → แต้มไม่พอ ยกเลิกทั้งบิล', () => {
    const out = simulateCheckout({
      items: [{ product_id: 11, quantity: 2, redeem_reward: true }],
      productsById: { 11: rewardProduct },
      memberId: 7, memberPoints: 120,
    });
    assert.equal(out.rejected, true);
    assert.match(out.error, /แต้มสะสมไม่พอสำหรับแลกของรางวัล/);
  });

  test('🚫 ของรางวัลหมดสต๊อก (stock 0): โดน 400 issues เหมือนสินค้าทั่วไป — บิลไม่ผ่าน', () => {
    const out = simulateCheckout({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: { 11: { ...rewardProduct, stock: 0 } },
      memberId: 7, memberPoints: 100,
    });
    assert.equal(out.rejected, true);
    assert.deepEqual(out.stockIssues, [{ product_id: 11, product_name: 'ตุ๊กตาหมี', requested: 1, available: 0 }]);
  });

  test('🚫 ปลอม redeem_reward กับสินค้าธรรมดา: ปฏิเสธทั้งบิล ไม่หักแต้ม/ตัดสต๊อก', () => {
    const out = simulateCheckout({
      items: [{ product_id: 3, quantity: 1, redeem_reward: true }],
      productsById: { 3: normalProduct },
      memberId: 7, memberPoints: 100,
    });
    assert.equal(out.rejected, true);
    assert.match(out.error, /สินค้านี้ไม่ใช่ของรางวัล/);
  });

  test('⭐️ กันใช้แต้มซ้ำครบวงจร: แลกของรางวัล 80 แต้ม + ขอแลกส่วนลด 50 แต้ม → หักรวม 100 (ไม่ใช่ 130)', () => {
    const out = simulateCheckout({
      items: [
        { product_id: 3, quantity: 1 }, // 55฿
        { product_id: 11, quantity: 1, redeem_reward: true }, // 80 แต้ม
      ],
      productsById: { 3: normalProduct, 11: rewardProduct },
      memberId: 7, memberPoints: 100, redeemPoints: 50, redeemRate: 1,
    });
    assert.equal(out.rejected, false);
    assert.equal(out.pointsUsed, 100); // 80 (รางวัล) + 20 (ส่วนลดจากแต้มที่เหลือ) — ไม่ใช่ 80+50
    assert.equal(out.pointsRemaining, 0);
    assert.equal(out.netTotalSatang, 5500 - 2000); // บิล 55฿ − ส่วนลด 20฿
  });
});

// ── E. จำลอง transaction จริงด้วย mocked conn (ล็อก FOR UPDATE / rollback / commit / release) ──
//    จำลองโครงสร้าง transaction ของ route POST /api/sales/checkout ใน server.js เป๊ะ:
//      beginTransaction → [validation] → settle แต้ม → [INSERT บิล+รายการ+ตัดสต๊อก+หักแต้ม] → commit
//      catch → rollback, finally → release — โดย conn เป็น mock ที่บันทึกทุก query ที่ยิง
//    เป้าหมาย: พิสูจน์ว่ากรณีลบ (แต้มไม่พอ / ของรางวัลหมดสต๊อก / ปลอม redeem_reward) ไม่ทิ้งบิลค้าง
//    ใน DB — validation ล้มเหลว = rollback + ไม่มี INSERT/UPDATE เลยสักตัว + release คืน pool
//    (ลอจิกตรวจ/คิดแต้ม = evaluateRewardItem/checkItemStock/settleRewardPoints ของจริงที่ server.js ใช้
//    ส่วน conn ที่ SELECT ผ่าน = mock บันทึกคำสั่ง — ความหมายตรงกับ mysql2 ที่ route เรียกจริง)
describe('E. จำลอง transaction ด้วย mocked conn (ไม่ทิ้งบิลค้างเมื่อ validation ล้มเหลว)', () => {
  // conn mock: บันทึกทุก query (normalize whitespace), จำลองผลของ SELECT/INSERT/UPDATE
  function createMockConn({ productsById, memberPointsById }) {
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
          return [[{ points: memberPointsById[params[0]] ?? 0 }]];
        }
        if (s.includes('INSERT INTO sales')) return [{ insertId: 9001 }];
        if (s.includes('INSERT INTO sale_items')) return [{ affectedRows: 1 }];
        if (s.includes('UPDATE products SET stock')) return [{ affectedRows: 1 }];
        if (s.includes('UPDATE users SET points')) return [{ affectedRows: 1 }];
        throw new Error(`mock ไม่รู้จัก query: ${s}`);
      },
    };
    return { conn, log, state };
  }

  // validation phase = ลำดับเดียวกับ route จริง: SELECT สินค้า FOR UPDATE → stock → reward eval → ราคา
  async function validationPhase({ conn, items, memberId }) {
    const processedItems = [];
    const stockIssues = [];
    let rewardPointsNeeded = 0;
    let totalAmountSatang = 0;
    for (const item of items) {
      const [[product]] = await conn.query(
        'SELECT id, name, price, stock, is_reward_item, points_required FROM products WHERE id = ? FOR UPDATE',
        [item.product_id],
      );
      if (!product) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);
      const stockIssue = checkItemStock({ product, quantity: item.quantity, productId: item.product_id });
      if (stockIssue) { stockIssues.push(stockIssue); continue; }
      if (item.redeem_reward) {
        const reward = evaluateRewardItem({ item, product, memberId });
        rewardPointsNeeded += reward.need;
        processedItems.push(reward.processedItem);
        continue;
      }
      totalAmountSatang += toSatang(Number(product.price)) * item.quantity;
      processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), redeemed_with_points: false });
    }
    if (stockIssues.length > 0) {
      return { status: 400, body: { error: 'สต๊อกไม่เพียงพอสำหรับบางรายการ', issues: stockIssues } };
    }
    return { status: 200, processedItems, rewardPointsNeeded, totalAmountSatang };
  }

  // จำลอง route ทั้งเส้น (transaction + INSERT + commit / catch rollback / finally release)
  async function simulateRoute({ items, productsById, memberPointsById, memberId, redeemPoints = 0, redeemRate = 1 }) {
    const { conn, log, state } = createMockConn({ productsById, memberPointsById });
    let outcome;
    try {
      await conn.beginTransaction();
      const v = await validationPhase({ conn, items, memberId });
      if (v.status === 400) {
        await conn.rollback();
        outcome = { status: 400, body: v.body };
      } else {
        // settle แต้ม — route ล็อกสมาชิก FOR UPDATE แล้วเรียก settleRewardPoints (ของจริง)
        const [[member]] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [memberId]);
        const settled = settleRewardPoints({
          memberPoints: member.points, rewardPointsNeeded: v.rewardPointsNeeded,
          redeemPoints, redeemRate, netTotalSatang: v.totalAmountSatang,
        });
        // INSERT phase — ถึงตรงนี้ได้ = validation ผ่านทั้งหมด (บิลจะถูกเขียนจริง)
        await conn.query('INSERT INTO sales (cashier_id, member_id, total_amount) VALUES (?, ?, ?)', [1, memberId, 0]);
        for (const pi of v.processedItems) {
          await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)', [9001, pi.product_id, pi.quantity, pi.unit_price, pi.subtotal]);
          await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [pi.quantity, pi.product_id, pi.quantity]);
        }
        const totalDeduct = settled.rewardPoints + settled.pointsRedeemed;
        if (totalDeduct > 0) await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [totalDeduct, memberId]);
        await conn.commit();
        outcome = { status: 200, rewardPointsUsed: totalDeduct, netTotalSatang: settled.netTotalSatang };
      }
    } catch (e) {
      await conn.rollback(); // route: catch → rollback ก่อนตอบ 500
      outcome = { status: 500, error: e.message };
    } finally {
      conn.release(); // route: finally → คืน connection ให้ pool เสมอ
    }
    return { ...outcome, log, state };
  }

  // query ที่เป็นการเขียน (INSERT/UPDATE/DELETE) — SELECT ไม่นับ
  function writeQueries(log) {
    return log.filter(e => e.op === 'query' && !/^SELECT/.test(e.sql));
  }
  function forUpdateQueries(log) {
    return log.filter(e => e.op === 'query' && /FOR UPDATE/.test(e.sql));
  }
  const products = { 3: normalProduct, 11: rewardProduct };

  test('✅ control (สำเร็จ): commit ถูกเรียก, เขียนบิล/ตัดสต๊อก/หักแต้มครบ, ไม่มี rollback — พิสูจน์ว่า harness ทำงานทั้ง 2 ทิศ', async () => {
    const out = await simulateRoute({
      items: [
        { product_id: 3, quantity: 1 },
        { product_id: 11, quantity: 1, redeem_reward: true },
      ],
      productsById: products, memberPointsById: { 7: 100 }, memberId: 7,
    });
    assert.equal(out.status, 200);
    assert.equal(out.state.committed, true);
    assert.equal(out.state.rolledBack, false);
    assert.equal(out.state.released, true);
    const writes = writeQueries(out.log);
    assert.ok(writes.some(q => /INSERT INTO sales/.test(q.sql)), 'INSERT sales ต้องมี');
    assert.ok(writes.some(q => /INSERT INTO sale_items/.test(q.sql)), 'INSERT sale_items ต้องมี');
    assert.ok(writes.some(q => /UPDATE products SET stock/.test(q.sql)), 'ตัดสต๊อกต้องมี');
    assert.ok(writes.some(q => /UPDATE users SET points/.test(q.sql)), 'หักแต้มต้องมี');
    assert.equal(out.rewardPointsUsed, 80);
    assert.equal(out.netTotalSatang, 5500);
  });

  test('🔒 ล็อก FOR UPDATE ครอบทั้ง SELECT สินค้าและ SELECT สมาชิก (กันแลกแต้มซ้อน 2 terminal พร้อมกัน)', async () => {
    const out = await simulateRoute({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: products, memberPointsById: { 7: 100 }, memberId: 7,
    });
    const locks = forUpdateQueries(out.log);
    assert.ok(locks.some(q => /FROM products WHERE id/.test(q.sql)), 'สินค้าต้องล็อก FOR UPDATE');
    assert.ok(locks.some(q => /SELECT points FROM users/.test(q.sql)), 'สมาชิกต้องล็อก FOR UPDATE (กันแต้มติดลบ/ใช้ซ้ำพร้อมกัน)');
  });

  test('🚫 ของรางวัลหมดสต๊อก: ตอบ 400 issues + rollback + ไม่มี INSERT/UPDATE สักตัว = ไม่ทิ้งบิลค้าง', async () => {
    const out = await simulateRoute({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: { 11: { ...rewardProduct, stock: 0 } }, memberPointsById: { 7: 100 }, memberId: 7,
    });
    assert.equal(out.status, 400);
    assert.deepEqual(out.body.issues, [{ product_id: 11, product_name: 'ตุ๊กตาหมี', requested: 1, available: 0 }]);
    assert.equal(out.state.rolledBack, true, 'ต้อง rollback');
    assert.equal(out.state.committed, false, 'ห้าม commit');
    assert.equal(writeQueries(out.log).length, 0, 'validation ล้มเหลว = ยังไม่มีคำสั่งเขียนถึง DB เลย');
    assert.equal(out.state.released, true, 'คืน connection ให้ pool');
    // protocol: rollback เกิดก่อน release เสมอ
    const ops = out.log.map(e => e.op);
    assert.ok(ops.indexOf('rollback') < ops.indexOf('release'), 'rollback ต้องมาก่อน release');
  });

  test('🚫 แต้มไม่พอสำหรับของรางวัล: rollback + ไม่มีบิล/รายการเขียนค้าง (ยกเลิกทั้งบิล)', async () => {
    const out = await simulateRoute({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: products, memberPointsById: { 7: 50 }, memberId: 7, // มี 50 แต้ม แต่ของรางวัลต้องใช้ 80
    });
    assert.equal(out.status, 500);
    assert.match(out.error, /แต้มสะสมไม่พอสำหรับแลกของรางวัล/);
    assert.equal(out.state.rolledBack, true);
    assert.equal(out.state.committed, false);
    assert.equal(writeQueries(out.log).length, 0, 'แต้มไม่พอ = ไม่ถึงขั้น INSERT บิลเลย');
    assert.equal(out.state.released, true);
  });

  test('🚫 ปลอม redeem_reward กับสินค้าธรรมดา: rollback + ไม่เขียนอะไรค้าง (กันบิลปลอม)', async () => {
    const out = await simulateRoute({
      items: [{ product_id: 3, quantity: 1, redeem_reward: true }],
      productsById: products, memberPointsById: { 7: 100 }, memberId: 7,
    });
    assert.equal(out.status, 500);
    assert.match(out.error, /สินค้านี้ไม่ใช่ของรางวัล/);
    assert.equal(out.state.rolledBack, true);
    assert.equal(out.state.committed, false);
    assert.equal(writeQueries(out.log).length, 0);
    assert.equal(out.state.released, true);
  });

  test('⭐️ protocol ครบวงจร: สำเร็จ = commit→release (ไม่มี rollback), ล้มเหลว = rollback→release (ไม่มี commit)', async () => {
    const ok = await simulateRoute({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: products, memberPointsById: { 7: 100 }, memberId: 7,
    });
    const okOps = ok.log.map(e => e.op);
    assert.equal(okOps.indexOf('commit') < okOps.indexOf('release'), true);
    assert.equal(okOps.includes('rollback'), false);

    const fail = await simulateRoute({
      items: [{ product_id: 11, quantity: 1, redeem_reward: true }],
      productsById: products, memberPointsById: { 7: 40 }, memberId: 7,
    });
    const failOps = fail.log.map(e => e.op);
    assert.equal(failOps.indexOf('rollback') < failOps.indexOf('release'), true);
    assert.equal(failOps.includes('commit'), false);
  });
});

// ── F. sync-offline (บิลออฟไลน์): guard สต๊อก/rollback เทียบเท่า checkout + ไม่มีแต้มให้ guard ──
//    จำลอง route POST /api/sales/sync-offline ใน server.js (3200-3295) เป๊ะ:
//      dedup (client_offline_id) → beginTransaction → เช็คกะ → ลูปสินค้า (SELECT FOR UPDATE + สต๊อก)
//      → INSERT บิล/รายการ/ตัดสต๊อก/audit → commit — rollback ต่อบิล, แต่ละบิล = transaction ของตัวเอง
//    สรุปจากการตรวจ: guard เทียบเท่า checkout — สต๊อกล็อก FOR UPDATE + rollback + release ครบ
//      (ลูปเช็คสต๊อกใช้ checkItemStock เดียวกับ checkout แล้ว — แก้ wiring ไว้)
//      ส่วนแต้ม: ไม่มี และถูกต้องที่ไม่มี — POS บล็อกขายออฟไลน์แบบสมาชิก/แต้ม/ของรางวัล (POS.tsx)
//      + syncOfflineValidator รับแค่ { product_id, quantity, unit_price } (Joi strip ฟิลด์อื่น)
//      → บิลออฟไลน์ไม่มีทางมีแต้ม เทสด้านล่างพิสูจน์ว่าไม่มี query แต้ม/สมาชิกโผล่ใน flow เลย
describe('F. sync-offline: guard สต๊อก/rollback เทียบเท่า checkout + แต้มไม่เกี่ยวข้อง', () => {
  // conn mock เฉพาะ sync-offline — บันทึกทุก query, จำลอง dedup/กะ/สินค้า/เขียน
  // ⭐️ ถ้าใครเผลอเพิ่ม query แต้ม/สมาชิกลงใน flow นี้ mock จะไม่รู้จัก → เทส fail ทันที (guard อัตโนมัติ)
  function createOfflineMock({ productsById, shiftOpen = true, initialSynced = [] }) {
    const syncedIds = new Set(initialSynced);
    const log = [];
    const state = { committed: false, rolledBack: false, released: false };
    const conn = {
      async beginTransaction() { log.push({ op: 'begin' }); },
      async commit() { state.committed = true; log.push({ op: 'commit' }); },
      async rollback() { state.rolledBack = true; log.push({ op: 'rollback' }); },
      async release() { state.released = true; log.push({ op: 'release' }); },
      async query(sql, params) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        log.push({ op: 'query', sql: s, params });
        if (s.includes('SELECT id FROM sales WHERE client_offline_id = ?')) return [syncedIds.has(params[0]) ? [{ id: 1 }] : []];
        if (s.includes("FROM shifts WHERE cashier_id = ? AND status = 'OPEN'")) return [shiftOpen ? [{ id: 5 }] : []];
        if (s.includes('FROM products WHERE id = ?')) {
          const row = productsById[params[0]];
          return [row ? [row] : []];
        }
        if (s.includes('INSERT INTO sales')) { syncedIds.add(params[6]); return [{ insertId: 9001 }]; }
        if (s.includes('INSERT INTO sale_items')) return [{ affectedRows: 1 }];
        if (s.includes('UPDATE products SET stock')) return [{ affectedRows: 1 }];
        if (s.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
        throw new Error(`mock ไม่รู้จัก query: ${s}`);
      },
    };
    return { conn, log, state };
  }

  // จำลอง 1 บิลใน batch (ลำดับเดียวกับ route จริง) — ใช้ checkItemStock ของจริงตัวเดียวกับ checkout
  async function syncOneSale({ productsById, shiftOpen, initialSynced, sale }) {
    const { conn, log, state } = createOfflineMock({ productsById, shiftOpen, initialSynced });
    let inTransaction = false;
    let result;
    try {
      const [existing] = await conn.query('SELECT id FROM sales WHERE client_offline_id = ?', [sale.client_offline_id]);
      if (existing.length > 0) { result = { already_synced: true, sale_id: existing[0].id }; }
      else {
        await conn.beginTransaction();
        inTransaction = true;
        const [openShiftRows] = await conn.query("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", [1]);
        if (openShiftRows.length === 0) {
          await conn.rollback(); inTransaction = false;
          result = { code: 'NO_OPEN_SHIFT' };
        } else {
          const stockIssues = [];
          const processedItems = [];
          for (const item of sale.items) {
            const [productRows] = await conn.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
            if (productRows.length === 0) {
              stockIssues.push({ product_id: item.product_id, product_name: '(ไม่พบสินค้านี้แล้ว)', requested: item.quantity, available: 0 });
              continue;
            }
            const stockIssue = checkItemStock({ product: productRows[0], quantity: item.quantity, productId: item.product_id });
            if (stockIssue) { stockIssues.push(stockIssue); continue; }
            processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price });
          }
          if (stockIssues.length > 0) {
            await conn.rollback(); inTransaction = false;
            result = { code: 'STOCK_ISSUE', issues: stockIssues };
          } else {
            await conn.query('INSERT INTO sales (cashier_id, total_amount, amount_received, change_amount, payment_method, shift_id, client_offline_id, is_offline_sale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [1, 100, 100, 0, 'CASH', 5, sale.client_offline_id, new Date()]);
            for (const pi of processedItems) {
              await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)', [9001, pi.product_id, pi.quantity, pi.unit_price, 0]);
              await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [pi.quantity, pi.product_id]);
            }
            await conn.query('INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)', ['CHECKOUT_OFFLINE_SYNC', 1, 'SALE', 9001, '{}']);
            await conn.commit();
            inTransaction = false;
            result = { success: true, sale_id: 9001 };
          }
        }
      }
    } catch (err) {
      if (inTransaction) { try { await conn.rollback(); } catch (_) { /* connection may already be dead */ } }
      result = { success: false, error: err.message };
    } finally {
      conn.release();
    }
    return { ...result, log, state };
  }

  function writeQueries(log) {
    return log.filter(e => e.op === 'query' && !/^SELECT/.test(e.sql));
  }
  const products = { 3: normalProduct, 11: rewardProduct };
  const offlineSale = (id, items) => ({
    client_offline_id: id, payment_method: 'CASH', amount_received: 100,
    total_amount: 55, created_at_offline: '2026-08-15T10:00:00.000Z', items,
  });

  test('✅ control (สำเร็จ): commit + เขียนบิล/รายการ/ตัดสต๊อก/audit ครบ + FOR UPDATE (เหมือน checkout)', async () => {
    const out = await syncOneSale({
      productsById: products, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-001', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    assert.equal(out.success, true);
    assert.equal(out.state.committed, true);
    assert.equal(out.state.rolledBack, false);
    assert.equal(out.state.released, true);
    const writes = writeQueries(out.log);
    assert.ok(writes.some(q => /INSERT INTO sales/.test(q.sql)));
    assert.ok(writes.some(q => /INSERT INTO sale_items/.test(q.sql)));
    assert.ok(writes.some(q => /UPDATE products SET stock/.test(q.sql)));
    assert.ok(writes.some(q => /INSERT INTO audit_logs/.test(q.sql)));
    assert.ok(out.log.some(q => q.op === 'query' && /FOR UPDATE/.test(q.sql)), 'ต้องล็อกสินค้า FOR UPDATE เหมือน checkout');
  });

  test('♻️ dedup: client_offline_id ซ้ำ → already_synced, ไม่เริ่ม transaction, ไม่เขียนอะไรซ้ำ', async () => {
    const out = await syncOneSale({
      productsById: products, shiftOpen: true, initialSynced: ['off-001'],
      sale: offlineSale('off-001', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    assert.equal(out.already_synced, true);
    assert.equal(out.sale_id, 1);
    assert.equal(out.log.some(e => e.op === 'begin'), false, 'ห้ามเริ่ม transaction ใหม่');
    assert.equal(writeQueries(out.log).length, 0, 'ห้ามเขียนซ้ำ (กันบิลซ้ำตอน sync ซ้ำ)');
    assert.equal(out.state.released, true);
  });

  test('🚫 ไม่มีกะเปิด: NO_OPEN_SHIFT + rollback + ไม่เขียนอะไร (บิลนี้ fail แต่ batch ต่อได้)', async () => {
    const out = await syncOneSale({
      productsById: products, shiftOpen: false, initialSynced: [],
      sale: offlineSale('off-002', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    assert.equal(out.code, 'NO_OPEN_SHIFT');
    assert.equal(out.state.rolledBack, true);
    assert.equal(out.state.committed, false);
    assert.equal(writeQueries(out.log).length, 0);
    assert.equal(out.state.released, true);
  });

  test('🚫 ของรางวัลหมดสต๊อกตอนซิงค์: STOCK_ISSUE + rollback + ไม่เขียนค้าง (guard เดียวกับ checkout)', async () => {
    const out = await syncOneSale({
      productsById: { 11: { ...rewardProduct, stock: 0 } }, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-003', [{ product_id: 11, quantity: 1, unit_price: 0 }]),
    });
    assert.equal(out.code, 'STOCK_ISSUE');
    assert.deepEqual(out.issues, [{ product_id: 11, product_name: 'ตุ๊กตาหมี', requested: 1, available: 0 }]);
    assert.equal(out.state.rolledBack, true);
    assert.equal(out.state.committed, false);
    assert.equal(writeQueries(out.log).length, 0, 'ไม่ทิ้งบิลค้าง');
    assert.equal(out.state.released, true);
  });

  test('🧩 batch semantics: บิลแรก STOCK_ISSUE ไม่บล็อกบิลถัดไป (แต่ละบิล = transaction ของตัวเอง)', async () => {
    const first = await syncOneSale({
      productsById: { 11: { ...rewardProduct, stock: 0 } }, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-bad', [{ product_id: 11, quantity: 1, unit_price: 0 }]),
    });
    const second = await syncOneSale({
      productsById: products, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-ok', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    assert.equal(first.code, 'STOCK_ISSUE');
    assert.equal(second.success, true);
    assert.equal(second.state.committed, true);
  });

  test('⭐️ ไม่มี query แต้ม/สมาชิกใน flow ออฟไลน์เลย (แต้มไม่เกี่ยวข้อง — validator strip + POS บล็อกแล้ว)', async () => {
    const out = await syncOneSale({
      productsById: products, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-004', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    assert.equal(out.success, true);
    const pointsQueries = out.log.filter(e => e.op === 'query' && /(^|\W)(users|points)(\W|$)/i.test(e.sql));
    assert.equal(pointsQueries.length, 0, 'บิลออฟไลน์ต้องไม่แตะแต้ม/ยอดสมาชิก — ถ้ามี เทส fail');
  });

  test('⭐️ protocol: สำเร็จ = commit→release, ล้มเหลว = rollback→release (เหมือน checkout)', async () => {
    const ok = await syncOneSale({
      productsById: products, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-005', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    const okOps = ok.log.map(e => e.op);
    assert.equal(okOps.indexOf('commit') < okOps.indexOf('release'), true);
    assert.equal(okOps.includes('rollback'), false);

    const fail = await syncOneSale({
      productsById: { 3: { ...normalProduct, stock: 0 } }, shiftOpen: true, initialSynced: [],
      sale: offlineSale('off-006', [{ product_id: 3, quantity: 1, unit_price: 55 }]),
    });
    const failOps = fail.log.map(e => e.op);
    assert.equal(failOps.indexOf('rollback') < failOps.indexOf('release'), true);
    assert.equal(failOps.includes('commit'), false);
  });
});
