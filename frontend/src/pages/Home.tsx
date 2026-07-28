// ✅ NEW: หน้ากลางหลัง login — ทุก role (ADMIN/CASHIER/MEMBER) เข้าที่นี่ก่อนเสมอ (แทน choice
//   modal เดิมใน Login.tsx) แสดงสรุปยอดสั้นๆ (staff เท่านั้น) + การ์ดโมดูลตาม role กดเข้าใช้งาน
// อ้างอิงดีไซน์จาก Figma Make reference (School Co-op POS UI Design/src/screens) ปรับให้ต่อ API จริง

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, CreditCard, LayoutDashboard, Boxes, Clock, LogOut, ChevronRight, Tag, Lock, ShoppingBag, Receipt, FileCheck, Percent } from 'lucide-react';
import api from '../api';
import { performLogout } from '../utils/logout';
import Swal from '../swal';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { BRAND } from '../theme';
import { UploadSlipModal } from '../components/preorder/UploadSlipModal';

interface DashboardSummary { total_sales: number; total_bills: number; }
interface MyHours { total_hours: number; hourly_rate: number; calculated_pay: number; }
interface ActivePromo { id: number; name: string; label: string; end_date: string | null; }
interface HighlightProduct {
  id: number; name: string; price: string | number; image_url: string | null;
  category_name: string | null; promo_percent: number | null;
  promo_start?: string | null; promo_end?: string | null;
  promo_active?: number | boolean;
}

// ⭐️ สถานะออเดอร์ที่ยัง "ค้างอยู่" — ใช้ตัดสินว่าจะโชว์การ์ดสถานะด่วนบนสุดหรือไม่
// COMPLETED/CANCELLED = จบแล้ว ไม่ต้องเตือน
const OPEN_ORDER_STATUS: Record<string, { label: string; tone: 'warn' | 'info' }> = {
  SLIP_REJECTED:    { label: 'สลิปไม่ผ่าน — ต้องส่งใหม่', tone: 'warn' },
  PENDING_VERIFY:   { label: 'กำลังตรวจสอบสลิป',        tone: 'info' },
  WAITING_CASH:     { label: 'รอชำระเงินสดที่ร้าน',      tone: 'warn' },
  PREPARING:        { label: 'กำลังเตรียมสินค้า',        tone: 'info' },
  READY:            { label: 'พร้อมรับสินค้าแล้ว',        tone: 'info' },
  REFUND_REQUESTED: { label: 'กำลังดำเนินการคืนเงิน',    tone: 'info' },
};

// ⭐️ ราคาหลังลด — โปรระดับสินค้า (promo_percent ในช่วง promo_start..promo_end)
// หมายเหตุ: /products/highlights ส่งฟิลด์ promo_active มาให้เฉพาะลิสต์ "promo" เท่านั้น ลิสต์
// "popular" (ที่หน้านี้ใช้) ไม่มีให้ — แต่มี promo_percent/promo_start/promo_end ครบ จึงคำนวณเองที่นี่
// และเชื่อ promo_active จาก backend ก่อนถ้ามีมา
// ราคานี้ใช้ "แสดงผล" เท่านั้น ราคาจริงตอนคิดเงิน backend คำนวณใหม่เองที่ /sales/checkout อยู่แล้ว
function priceAfterPromo(p: HighlightProduct) {
  const base = Number(p.price);
  const pct = Number(p.promo_percent) || 0;
  const noPromo = { final: base, original: null as number | null, pct: 0 };
  if (pct <= 0) return noPromo;

  let active: boolean;
  if (p.promo_active !== undefined) {
    active = !!p.promo_active;
  } else if (p.promo_start && p.promo_end) {
    // เทียบแบบ "วันที่ตามเวลาเครื่อง" (sv-SE ให้รูปแบบ YYYY-MM-DD พอดี) — ช่วงโปรเป็น DATE ไม่มีเวลา
    const day = (d: string | Date) => new Date(d).toLocaleDateString('sv-SE');
    const today = day(new Date());
    active = today >= day(p.promo_start) && today <= day(p.promo_end);
  } else {
    active = false;
  }
  if (!active) return noPromo;

  return { final: base - Math.round(base * pct / 100), original: base, pct };
}

export default function Home() {
  const user = getCurrentUserOrRedirect();
  const navigate = useNavigate();
  const isStaff = user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'CASHIER';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [myHours, setMyHours] = useState<MyHours | null>(null); // ⭐️ Home page feature — ชม.ทำงาน/ค่าจ้างเดือนนี้
  // ⭐️ Member home — โปรทั้งหมด (สไลด์แนวนอน), สินค้าขายดี, ออเดอร์ที่ยังค้าง
  const [promos, setPromos] = useState<ActivePromo[]>([]);
  const [bestSellers, setBestSellers] = useState<HighlightProduct[]>([]);
  const [openOrder, setOpenOrder] = useState<any>(null);
  const [slipOrder, setSlipOrder] = useState<any>(null);
  // แยก loading ต่อ section เพื่อให้ skeleton หายทีละส่วนตามที่โหลดเสร็จ ไม่ต้องรอพร้อมกันทั้งหน้า
  const [loadingPromos, setLoadingPromos] = useState(!isStaff);
  const [loadingBest, setLoadingBest] = useState(!isStaff);
  const [loadingOrder, setLoadingOrder] = useState(!isStaff);
  // ⭐️ CASHIER ที่ยังไม่เปิดกะ ใช้งานได้เท่าสมาชิก — ล็อกการ์ดฝั่งทำงานไว้จนกว่าจะเปิดกะ
  //   (ADMIN ไม่ต้องเช็ค เข้าได้ตลอด) null = ยังโหลดไม่เสร็จ ระหว่างนี้ยังไม่ล็อกเพื่อกันจอกระพริบ
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const isCashier = user.role === 'CASHIER';
  // ล็อกเฉพาะตอนรู้ผลแล้วว่าไม่มีกะเปิดจริงๆ
  const workLocked = isCashier && hasOpenShift === false;

  useEffect(() => {
    if (isStaff) {
      api.get('/reports/dashboard').then(res => setSummary(res.data.summary)).catch(() => {});
      api.get('/inventory/low-stock').then(res => setLowStockCount(res.data.length)).catch(() => {});
      api.get('/reports/my-hours').then(res => setMyHours(res.data)).catch(() => {});
    } else {
      // ⭐️ ทั้ง 3 อย่างนี้เป็นของ "สมาชิก" เท่านั้น และไม่ critical — ถ้าอันใดอันหนึ่งพัง
      // ต้องไม่ทำให้ส่วนอื่นของหน้าหายไปด้วย จึงแยก catch ของใครของมัน
      api.get('/promotions/active')
        .then(res => setPromos(res.data || []))
        .catch(() => {})
        .finally(() => setLoadingPromos(false));

      api.get('/products/highlights')
        .then(res => setBestSellers((res.data?.popular || []).slice(0, 8)))
        .catch(() => {})
        .finally(() => setLoadingBest(false));

      api.get('/orders')
        .then(res => {
          // ออเดอร์ที่ยังค้าง เอาอันล่าสุดมาโชว์ใบเดียว (backend ส่ง created_at DESC มาแล้ว)
          const open = (res.data || []).find((o: any) => OPEN_ORDER_STATUS[o.status]);
          setOpenOrder(open || null);
        })
        .catch(() => {})
        .finally(() => setLoadingOrder(false));
    }
    if (isCashier) {
      api.get(`/shifts/current?cashier_id=${user.id}`)
        .then(res => setHasOpenShift(!!res.data?.id))
        .catch(() => setHasOpenShift(null)); // เรียกไม่ได้ = ไม่ล็อก ปล่อยให้ backend เป็นคนกัน
    }
    api.get('/products').then(res => setProductCount(res.data.length)).catch(() => {});
  }, [isStaff, isCashier, user.id]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'สวัสดีตอนเช้า';
    if (h < 18) return 'สวัสดีตอนบ่าย';
    return 'สวัสดีตอนเย็น';
  };

  const goTo = (mode: 'work' | 'shop', path: string) => {
    localStorage.setItem('session_mode', mode);
    navigate(path);
  };

  const handleLogout = () => {
    Swal.fire({ title: 'ออกจากระบบ?', icon: 'question', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af', confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก' })
      .then(async (r) => {
        if (!r.isConfirmed) return;
        await performLogout();
        navigate('/login');
      });
  };

  // ⭐️ การ์ดโมดูล — filter ตาม role, badge เป็นข้อมูลจริงเท่าที่ดึงมาได้ (ไม่ทำ "Shift active" แบบ
  // mockup เพราะต้องเรียก endpoint เพิ่มอีกจุด ยังไม่คุ้มสำหรับหน้ากลางที่ควรโหลดไว)
  const modules = [
    {
      key: 'pre-order', show: true, icon: ShoppingCart,
      title: 'สั่งจอง/ซื้อสินค้า', subtitle: 'เลือกดูสินค้าและสั่งจอง',
      badge: productCount > 0 ? `${productCount} รายการ` : null,
      onClick: () => goTo('shop', '/pre-order'),
    },
    // ⭐️ 3 การ์ดนี้ล็อกพร้อมกันตอน CASHIER ยังไม่เปิดกะ — ล็อกแค่ POS ใบเดียวไม่พอ เพราะกดใบอื่น
    //   จะตั้ง session_mode เป็น 'work' ทำให้เมนู staff (รวมลิงก์ POS) กลับมาโผล่ = อ้อมกติกาได้
    {
      // ⭐️ POS โชว์เฉพาะ CASHIER — ADMIN ขายหน้าร้านไม่ได้ (เปิดกะไม่ได้ = บิลผูก shift_id ไม่ได้)
      key: 'pos', show: isCashier, icon: CreditCard, locked: workLocked,
      title: 'หน้าขาย (POS)', subtitle: workLocked ? 'ต้องเปิดกะก่อนถึงจะขายได้' : 'ขายสินค้า/รับชำระเงิน',
      badge: null,
      onClick: () => goTo('work', '/pos'),
    },
    {
      key: 'dashboard', show: isStaff, icon: LayoutDashboard, locked: workLocked,
      title: 'สรุปยอดขาย', subtitle: workLocked ? 'ต้องเปิดกะก่อน' : 'รายงาน/สถิติการขาย',
      badge: summary ? `วันนี้ ฿${Number(summary.total_sales).toLocaleString()}` : null,
      onClick: () => goTo('work', '/dashboard'),
    },
    {
      key: 'inventory', show: isStaff, icon: Boxes, locked: workLocked,
      title: 'คลังสินค้า', subtitle: workLocked ? 'ต้องเปิดกะก่อน' : 'จัดการสินค้าและสต๊อก',
      badge: lowStockCount > 0 ? `${lowStockCount} ใกล้หมด` : null,
      onClick: () => goTo('work', '/inventory'),
    },
    {
      key: 'shift', show: isStaff, icon: Clock,
      title: 'จัดการกะการขาย', subtitle: 'ลงชื่อเข้า-ออกงาน/นับเงิน',
      badge: null,
      onClick: () => goTo('work', '/shift'),
    },
  ].filter(m => m.show);

  return (
    <div className="min-h-dvh bg-brand-bg">
      {/* Header — ⭐️ Design-ref: รวมแถวโลโก้/แถวอวตารเดิมเป็นแถวเดียว (อวตาร+ทักทาย ซ้าย, ออกจากระบบ ขวา) */}
      <div className="bg-gradient-to-br from-brand to-brand-dark px-5 pt-16 pb-16 relative overflow-hidden">
        <div className="flex items-start justify-between relative z-10">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={user.profile_image_url || '/Default profile.png'}
              alt={user.full_name}
              className="w-11 h-11 rounded-2xl object-cover border-2 border-white/40 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-white/80 text-sm font-medium">{greeting()}</p>
              <h1 className="text-white text-xl font-extrabold truncate">{user.full_name || user.student_id}</h1>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2.5 bg-white/15 hover:bg-white/25 rounded-xl transition-colors duration-150 shrink-0" title="ออกจากระบบ">
            <LogOut size={18} className="text-white" />
          </button>
        </div>

        <span className="relative z-10 inline-flex items-center gap-1 mt-3 bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-full">
          {user.role}
        </span>
        <p className="relative z-10 text-white/70 text-[11px] mt-2.5">เมนูด้านล่างแสดงตามสิทธิ์การใช้งานของคุณ</p>
      </div>

      {/* Stat card (staff only) — ลอยคาบเส้นขอบล่างของ header ตามดีไซน์อ้างอิง สีต่างกันตามประเภทข้อมูล */}
      {isStaff && summary && (
        <div className="px-5 -mt-16 relative z-10">
          <div className="bg-white border border-brand-border rounded-3xl shadow-md p-4 grid grid-cols-3 divide-x divide-brand-border">
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-brand">฿{Number(summary.total_sales).toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">ยอดขายวันนี้</p>
            </div>
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-blue-500">{summary.total_bills}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">ออเดอร์</p>
            </div>
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-amber-500">{lowStockCount}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">สต๊อกใกล้หมด</p>
            </div>
          </div>
        </div>
      )}

      {/* ⭐️ Home page feature — ชั่วโมงทำงาน + ค่าจ้างประมาณการเดือนนี้ (self-service, staff เท่านั้น) */}
      {isStaff && myHours && (
        <div className="px-5 mt-4 max-w-lg mx-auto">
          <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">เดือนนี้</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">{myHours.total_hours} ชม. ทำงาน</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">รายได้ประมาณการ</p>
              <p className="text-lg font-extrabold text-brand mt-0.5">฿{Number(myHours.calculated_pay).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* ══ MEMBER HOME ═════════════════════════════════════════════════════════
          หน้าเดิมของสมาชิกมีแค่แบนเนอร์โปรใบเดียว + การ์ดเมนูใบเดียว = เหลือที่ว่างเยอะมาก
          เพิ่ม: สถานะออเดอร์ที่ค้าง → ปุ่มลัด 4 ช่อง → สไลด์โปรโมชั่น → สินค้าขายดี */}

      {/* 1. การ์ดสถานะออเดอร์ที่ยังค้าง — ลอยคาบขอบล่าง header */}
      {!isStaff && (loadingOrder || openOrder) && (
        <div className="px-5 -mt-16 relative z-10 max-w-lg mx-auto">
          {loadingOrder ? (
            <div className="bg-white border border-brand-border rounded-2xl shadow-md p-4 animate-pulse">
              <div className="h-3.5 bg-brand-border/40 rounded-lg w-1/3 mb-2.5" />
              <div className="h-3 bg-brand-border/40 rounded-lg w-2/3" />
            </div>
          ) : openOrder && (
            <div className="bg-white border border-brand-border rounded-2xl shadow-md p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-gray-900 text-sm">ออเดอร์ #{openOrder.id}</p>
                  <p className={`text-xs font-semibold mt-1 ${OPEN_ORDER_STATUS[openOrder.status].tone === 'warn' ? 'text-red-600' : 'text-brand'}`}>
                    {OPEN_ORDER_STATUS[openOrder.status].label}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-extrabold text-gray-900">
                  ฿{Number(openOrder.total_amount).toLocaleString()}
                </span>
              </div>
              {openOrder.status === 'SLIP_REJECTED' ? (
                <button
                  onClick={() => setSlipOrder(openOrder)}
                  className="mt-3 w-full py-2.5 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white text-sm font-bold transition-all duration-150 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
                >
                  ส่งสลิปด่วน
                </button>
              ) : (
                <button
                  onClick={() => goTo('shop', '/pre-order?view=orders')}
                  className="mt-3 w-full py-2.5 rounded-full bg-brand-bg text-brand text-sm font-bold transition-all duration-150 active:scale-[0.98] hover:bg-brand-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  ดูรายละเอียด
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. ปุ่มลัด 4 ช่อง */}
      {!isStaff && (
        <div className={`px-5 max-w-lg mx-auto ${(loadingOrder || openOrder) ? 'mt-4' : '-mt-16 relative z-10'}`}>
          <div className="bg-white border border-brand-border rounded-2xl shadow-md p-3 grid grid-cols-4 gap-1">
            {[
              // ⭐️ FIX — ใช้ navigate() ตรงแทน goTo() สำหรับ 4 ปุ่มนี้ goTo() เดิมก็ navigate(path)
              // เหมือนกัน (query string ไม่ได้หายระหว่างทาง) แต่ยังเซ็ต session_mode='shop' ทิ้งไว้ด้วย
              // ซึ่งซ้ำซ้อนอยู่แล้วเพราะกริดนี้โชว์เฉพาะตอน !isStaff (แปลว่า session_mode เป็น 'shop'
              // อยู่ก่อนแล้วสำหรับ CASHIER, ไม่เกี่ยวกับ MEMBER เลย) เปลี่ยนมาเรียก navigate() ตรงๆ
              // ให้ชัดเจนว่าปุ่มพวกนี้แค่พาไปหน้าอื่น ไม่ได้มีผลต่อ session_mode
              { icon: ShoppingBag, label: 'สั่งซื้อสินค้า', onClick: () => navigate('/pre-order') },
              { icon: Receipt, label: 'ประวัติการสั่ง', onClick: () => navigate('/pre-order?view=orders') },
              { icon: FileCheck, label: 'สถานะสลิป', onClick: () => navigate('/pre-order?view=orders&filter=slip') },
              {
                icon: Percent, label: 'โปรโมชัน',
                onClick: () => {
                  const el = document.getElementById('home-promos');
                  // ไม่มีโปรตอนนี้ = section นี้ไม่ render เลย (ดูเงื่อนไข loadingPromos || promos.length > 0
                  // ด้านล่าง) scrollIntoView บน null จะเงียบๆ ไม่ทำอะไร ผู้ใช้กดแล้วไม่เห็นอะไรเกิดขึ้นเลย
                  // จึง fallback ไปหน้าสั่งซื้อพร้อม filter=promo แทน ให้เห็นสินค้าที่มีโปรจริงๆ
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  else navigate('/pre-order?filter=promo');
                },
              },
            ].map(a => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className="flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl transition-colors duration-150 hover:bg-brand-bg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span className="w-11 h-11 bg-brand-bg rounded-xl flex items-center justify-center">
                    <Icon size={20} className="text-brand" />
                  </span>
                  <span className="text-[10px] font-bold text-gray-600 text-center leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. สไลด์โปรโมชั่น — เลื่อนแนวนอน */}
      {!isStaff && (loadingPromos || promos.length > 0) && (
        <div id="home-promos" className="mt-6 max-w-lg mx-auto scroll-mt-6">
          <p className="px-5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">โปรโมชันที่ใช้ได้ตอนนี้</p>
          {/* ⭐️ overflow-x-auto + snap ให้เลื่อนลื่นบนมือถือ; ไม่ใช้ scroll-behavior แบบ JS
              เพื่อให้ WebKit เก่ารองรับได้ตามปกติ */}
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory scrollbar-hide">
            {loadingPromos
              ? [1, 2].map(i => (
                  <div key={i} className="shrink-0 w-64 h-24 bg-white border border-brand-border rounded-2xl shadow-sm animate-pulse" />
                ))
              : promos.map(p => (
                  <div key={p.id} className="snap-start shrink-0 w-64 bg-gradient-to-br from-brand to-brand-dark rounded-2xl shadow-md p-4 text-white">
                    <span className="inline-flex items-center gap-1 bg-white/20 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      <Tag size={10} /> โปรโมชัน
                    </span>
                    <p className="font-extrabold text-sm mt-2 truncate">{p.name}</p>
                    <p className="text-xs text-white/80 mt-0.5 line-clamp-2">{p.label}</p>
                  </div>
                ))}
          </div>
        </div>
      )}

      {/* 4. สินค้าขายดี — เลื่อนแนวนอน */}
      {!isStaff && (loadingBest || bestSellers.length > 0) && (
        <div className="mt-5 max-w-lg mx-auto">
          <div className="px-5 flex items-center justify-between mb-2">
            <p className="text-sm font-extrabold text-gray-900">🔥 สินค้าขายดีประจำสัปดาห์</p>
            <button onClick={() => goTo('shop', '/pre-order')} className="text-xs font-bold text-brand hover:underline shrink-0">
              ดูทั้งหมด
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x scrollbar-hide">
            {loadingBest
              ? [1, 2, 3].map(i => (
                  <div key={i} className="shrink-0 w-36 bg-white border border-brand-border rounded-2xl shadow-sm p-2.5 animate-pulse">
                    <div className="w-full h-24 bg-brand-border/40 rounded-xl mb-2" />
                    <div className="h-3 bg-brand-border/40 rounded w-3/4 mb-1.5" />
                    <div className="h-3 bg-brand-border/40 rounded w-1/2" />
                  </div>
                ))
              : bestSellers.map(p => {
                  const { final, original, pct } = priceAfterPromo(p);
                  return (
                    <div key={p.id} className="snap-start shrink-0 w-36 bg-white border border-brand-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
                      <div className="relative h-24 bg-brand-bg shrink-0">
                        {p.image_url
                          ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                          : <div className="w-full h-full flex items-center justify-center"><ShoppingBag size={22} className="text-brand-mid" /></div>}
                        {pct > 0 && (
                          <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            -{pct}%
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 flex flex-col flex-1">
                        {p.category_name && (
                          <span className="self-start text-[9px] font-bold text-brand bg-brand-bg px-1.5 py-0.5 rounded-full mb-1 truncate max-w-full">
                            {p.category_name}
                          </span>
                        )}
                        <p className="text-xs font-bold text-gray-800 leading-snug line-clamp-2 flex-1">{p.name}</p>
                        <div className="flex items-baseline gap-1.5 mt-1.5">
                          <span className="text-sm font-extrabold text-brand">฿{final.toLocaleString()}</span>
                          {original !== null && (
                            <span className="text-[10px] text-gray-400 line-through">฿{original.toLocaleString()}</span>
                          )}
                        </div>
                        <button
                          onClick={() => goTo('shop', `/pre-order?add=${p.id}`)}
                          className="mt-2 w-full py-1.5 rounded-full bg-gradient-to-br from-brand to-brand-dark text-white text-[11px] font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          + เพิ่มลงตะกร้า
                        </button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {/* Module list */}
      <div className={`px-5 ${isStaff ? 'mt-5' : 'mt-6'} pb-10 max-w-lg mx-auto`}>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">เมนูสำหรับคุณ</p>
        <div className="space-y-3">
          {modules.map(m => {
            const Icon = m.icon;
            // ⭐️ การ์ดที่ถูกล็อก (CASHIER ยังไม่เปิดกะ) — โชว์ไว้แบบจางๆ พร้อมบอกเหตุผล ดีกว่าซ่อนหาย
            //   ให้รู้ว่ามีเมนูนี้อยู่ แค่ต้องเปิดกะก่อน (การ์ด "จัดการกะการขาย" ไม่ถูกล็อกอยู่แล้ว)
            const locked = !!m.locked;
            return (
              <button
                key={m.key}
                onClick={m.onClick}
                disabled={locked}
                aria-disabled={locked}
                title={locked ? 'ต้องเปิดกะการขายก่อนถึงจะใช้เมนูนี้ได้' : undefined}
                className={`w-full flex items-center gap-3 bg-white border rounded-3xl shadow-sm p-4 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  locked
                    ? 'border-brand-border opacity-55 cursor-not-allowed'
                    : 'border-brand-border hover:border-brand-mid hover:shadow-md active:scale-[0.98]'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${locked ? 'bg-gray-100' : 'bg-brand-bg'}`}>
                  {locked ? <Lock size={18} className="text-gray-400" /> : <Icon size={20} className="text-brand" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-bold text-sm truncate ${locked ? 'text-gray-500' : 'text-gray-900'}`}>{m.title}</p>
                    {m.badge && !locked && (
                      <span className="shrink-0 text-[10px] font-bold text-brand bg-brand-bg px-2 py-0.5 rounded-full">{m.badge}</span>
                    )}
                  </div>
                  <p className={`text-xs font-medium truncate ${locked ? 'text-amber-600' : 'text-gray-400'}`}>{m.subtitle}</p>
                </div>
                {!locked && <ChevronRight size={18} className="text-gray-300 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ⭐️ ส่งสลิปด่วนจากการ์ดสถานะออเดอร์ ไม่ต้องเด้งออกไปหน้าอื่น */}
      {slipOrder && (
        <UploadSlipModal
          orderId={slipOrder.id}
          rejectReason={slipOrder.reject_reason}
          onClose={() => setSlipOrder(null)}
          onUploaded={async () => {
            const res = await api.get('/orders').catch(() => null);
            if (res) setOpenOrder((res.data || []).find((o: any) => OPEN_ORDER_STATUS[o.status]) || null);
          }}
        />
      )}

      {/* ⭐️ หน้า Home ไม่ได้อยู่ใต้ Layout จึงไม่ได้ style scrollbar-hide ที่ประกาศไว้ที่นั่น */}
      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
