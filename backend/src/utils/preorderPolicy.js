// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/preorderPolicy.js — นโยบายสิทธิ์ของพรีออเดอร์ (ใครได้แต้มสมาชิกบ้าง)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ตัดสินใจเรื่อง "แต้ม" ในฟลวสั่งจอง (POST /api/orders) ตาม role ของผู้สั่ง
//   นโยบาย: เฉพาะ MEMBER เท่านั้นที่มีสิทธิ์แต้มสมาชิก — staff (CASHIER/MANAGER/ADMIN) สั่งจอง
//   สินค้าได้ (ของตัวเอง เหมือนสมาชิก) แต่ไม่มีสิทธิ์แต้ม: ห้ามแลกแต้มเป็นส่วนลด + ห้ามสะสมแต้ม
//   เพราะ (1) แต้มคือสิทธิพิเศษของสมาชิกสหกรณ์ (2) บัญชีพนักงานเป็นบัญชีทำงาน ไม่ใช่บัญชีสมาชิก
//   (3) กัน staff ใช้บัญชีตัวเองสะสม/แลกแต้มจนพาบัญชียอดแต้มของร้านเพี้ยน
//
// แยกเป็น pure function (ไม่แตะ DB/req/res) เพื่อให้เทสต์ได้ตรงๆ (tests/preorderPolicy.test.js)
// และให้ route (server.js) เรียกใช้ของจริง — ไม่ใช่เขียนนโยบายซ้ำใน route แล้วเทสต์จำลองเอา
// ═══════════════════════════════════════════════════════════════════════════════════

// ⭐️ นโยบายกลาง: resolve สิทธิ์แต้มของออเดอร์ตาม role
//   • MEMBER — สิทธิ์เต็ม: แลกแต้มได้ตามที่ขอ (cap ที่ยอดบิล/แต้มจริงใน resolveRedeemPoints),
//     สะสมได้ถ้าติ๊ก usePhoneForPoints
//   • staff (role อื่น) — ไม่มีสิทธิ์แต้ม: redeemPoints ถูกปัดเป็น 0 เสมอ; ถ้า client ส่ง
//     redeem_points > 0 มาด้วย ให้ blockedRedeem = true → caller ควรตอบ 403 ชัดเจน (ไม่ใช่
//     เงียบๆ ตัดแต้มทิ้ง เพราะผู้ใช้จะเข้าใจผิดว่าลดแล้วทั้งที่ไม่ได้ลด)
function resolveOrderPoints({ role, usePhoneForPoints, redeemPoints }) {
  const isMember = role === 'MEMBER';
  if (isMember) {
    return {
      isMember,
      usePhoneForPoints: !!usePhoneForPoints,
      redeemPoints: Math.max(0, Number(redeemPoints) || 0),
      blockedRedeem: false,
    };
  }
  return {
    isMember,
    usePhoneForPoints: false,
    redeemPoints: 0,
    blockedRedeem: Number(redeemPoints) > 0,
  };
}

// คำนวณแต้มที่แลกจริง (หน่วย: แต้ม) — ใช้จากที่ขอแต่ cap ด้วยยอดแต้มจริง + ยอดบิล (กันขอเกิน)
//   maxByBill = floor(totalAmount / redeemRate) แต้ม (อัตราแลก redeemRate บาท/แต้ม)
function resolveRedeemPoints({ requested, availablePoints, totalAmount, redeemRate }) {
  const requestedNum = Math.max(0, Number(requested) || 0);
  if (requestedNum <= 0) return 0;
  const maxByBill = Math.floor(totalAmount / redeemRate);
  return Math.min(requestedNum, availablePoints, maxByBill);
}

// แต้มสะสมที่จะได้รับ (ทุก earnPer บาท = 1 แต้ม, คิดจากยอดสุทธิหลังหักแต้มที่แลกแล้ว) —
//   ได้เฉพาะเมื่อผู้สั่งมีสิทธิ์ (MEMBER) และติ๊กสะสมแต้ม; เครดิตจริงตอนออเดอร์ COMPLETED
function computeEarnPoints({ usePhoneForPoints, netTotal, earnPer }) {
  return usePhoneForPoints ? Math.floor(netTotal / earnPer) : 0;
}

// ตรวจว่า role นี้เป็น MEMBER (มีสิทธิ์แต้มสมาชิก) หรือไม่ — ใช้เช็คทั้งพรีออเดอร์และบิลขาย POS
function isMemberRole(role) {
  return role === 'MEMBER';
}

// ⭐️ นโยบายเดียวกันสำหรับบิลขายหน้าร้าน (POST /sales/checkout): cashier เลือก "สมาชิก" ในบิลได้
// ผ่าน /members/lookup ซึ่งค้นได้ทุก role (รวมบัญชีพนักงาน) — ถ้าเลือกบัญชี staff มาเป็น "สมาชิก"
// (เช่น cashier คิดเงินให้ตัวเอง/พนักงานคนอื่น) บัญชีนั้นไม่มีสิทธิ์แต้ม: ห้ามแลกแต้ม/แลกของรางวัล
// (blockedRedeem → route ควรตอบ 400 ชัดเจน ไม่ใช่เงียบๆ เพราะลูกค้าจะเข้าใจผิดว่าลดแล้วทั้งที่ไม่ได้ลด)
// และไม่ได้แต้มสะสม (canUsePoints = false → earn = 0)
function resolveSaleMemberPoints({ role, redeemPoints, rewardPointsNeeded }) {
  const canUsePoints = isMemberRole(role);
  return {
    canUsePoints,
    blockedRedeem: !canUsePoints && (Number(redeemPoints) > 0 || Number(rewardPointsNeeded) > 0),
  };
}

module.exports = { resolveOrderPoints, resolveRedeemPoints, computeEarnPoints, isMemberRole, resolveSaleMemberPoints };
