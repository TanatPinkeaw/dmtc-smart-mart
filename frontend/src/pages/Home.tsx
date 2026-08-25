// 📄 pages/Home.tsx — หน้ากลางหลัง login (ทุก role เข้าก่อนเสมอ) เลือกโมดูลที่จะใช้
//    ทำอะไร: โชว์การ์ดสรุปยอดสั้นๆ (staff) + การ์ดโมดูลตาม role (POS/สั่งจอง/สรุปยอด/ตารางกะ ฯลฯ); การ์ด
//    POS ล็อกถ้ายังไม่เปิดกะ (workLocked)
// ✅ NEW: หน้ากลางหลัง login — ทุก role (ADMIN/CASHIER/MEMBER) เข้าที่นี่ก่อนเสมอ (แทน choice
//   modal เดิมใน Login.tsx) แสดงสรุปยอดสั้นๆ (staff เท่านั้น) + การ์ดโมดูลตาม role กดเข้าใช้งาน
// อ้างอิงดีไซน์จาก Figma Make reference (School Co-op POS UI Design/src/screens) ปรับให้ต่อ API จริง

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, CreditCard, LayoutDashboard, Boxes, Clock, LogOut, ChevronRight, Tag, Lock, ShoppingBag, Receipt, FileCheck, Percent, Calendar, ClipboardList, BarChart3, FileSpreadsheet, Settings, ClipboardCheck, Database, Bell, User, PiggyBank } from 'lucide-react';
import api from '../api';
import { performLogout } from '../utils/logout';
import { Button } from '../components/ui/Button';
import { SectionTitle } from '../components/ui/SectionTitle';
import { ProductImage } from '../components/ui/ProductImage';
import { ProductPrice } from '../components/ui/ProductPrice';
import { SkeletonCard, SkeletonLine, SkeletonListRow } from '../components/ui/Skeleton';
import Swal from '../swal';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { BRAND } from '../theme';
import { UploadSlipModal } from '../components/preorder/UploadSlipModal';

interface DashboardSummary { total_sales: number; total_bills: number; }
interface MyHours { total_hours: number; hourly_rate: number; calculated_pay: number; }
interface ActivePromo { id: number; name: string; label: string; end_date: string | null; }
interface OpenOrder {
  id: number;
  status: string;
  total_amount: number;
  reject_reason?: string | null;
}
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
  WAITING_ACCEPT:   { label: 'รอพนักงานรับงาน',            tone: 'info' },
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
  // 🐛 FIX — เดิม default 0 + catch กลืน error: ถ้า API ล่ม การ์ดจะโชว์ "0 ใกล้หมด" หลอก (ทั้งที่
  // โหลดไม่สำเร็จ). null = ยังไม่รู้ผล → โชว์ "—" แทนเลข 0 ปลอม
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [myHours, setMyHours] = useState<MyHours | null>(null); // ⭐️ Home page feature — ชม.ทำงาน/ค่าจ้างเดือนนี้
  const [pendingOrders, setPendingOrders] = useState(0); // ⭐️ ออเดอร์รอตรวจ (badge การ์ดจัดการออเดอร์)
  // ⭐️ Member home — โปรทั้งหมด (สไลด์แนวนอน), สินค้าขายดี, ออเดอร์ที่ยังค้าง
  const [promos, setPromos] = useState<ActivePromo[]>([]);
  const [bestSellers, setBestSellers] = useState<HighlightProduct[]>([]);
  const [openOrder, setOpenOrder] = useState<OpenOrder | null>(null);
  // 🐛 FIX — เดิม staff section ไม่มีสถานะโหลด: API ล่ม = การ์ดสรุปยอดหายเงียบๆ (summary null) หรือ
  // โชว์ 0 ปลอม (lowStock) — จริงๆแล้วควรโชว์การ์ดพร้อม "—" เมื่อโหลดเสร็จ (สำเร็จหรือไม่)
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [slipOrder, setSlipOrder] = useState<OpenOrder | null>(null);
  // แยก loading ต่อ section เพื่อให้ skeleton หายทีละส่วนตามที่โหลดเสร็จ ไม่ต้องรอพร้อมกันทั้งหน้า
  const [loadingPromos, setLoadingPromos] = useState(!isStaff);
  const [loadingBest, setLoadingBest] = useState(!isStaff);
  const [loadingOrder, setLoadingOrder] = useState(!isStaff);
  // ⭐️ CASHIER ที่ยังไม่เปิดกะ ใช้งานได้เท่าสมาชิก — ล็อกการ์ดฝั่งทำงานไว้จนกว่าจะเปิดกะ
  //   (ADMIN ไม่ต้องเช็ค เข้าได้ตลอด) null = ยังโหลดไม่เสร็จ ระหว่างนี้ยังไม่ล็อกเพื่อกันจอกระพริบ
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const isCashier = user.role === 'CASHIER';
  const isManager = user.role === 'MANAGER';
  const isAdminRole = user.role === 'ADMIN';
  const isStoreAdmin = isAdminRole || isManager; // ⭐️ ADMIN/MANAGER — เห็นเมนูจัดการร้าน (ตรงกับ sidebar)
  // ล็อกเฉพาะตอนรู้ผลแล้วว่าไม่มีกะเปิดจริงๆ
  const workLocked = isCashier && hasOpenShift === false;

  useEffect(() => {
    if (isStaff) {
      // 🐛 FIX — เดิม .catch(() => {}) กลืน error: summary/lowStock หายเงียบหรือโชว์ 0 หลอก.
      // ตอนนี้ failure = คงค่า null (โชว์ "—") และ staffLoaded ค่อย true เมื่อครบ (allSettled ไม่
      // ตัดตอนเมื่อตัวใดตัวหนึ่ง fail — การ์ดจะโชว์ค่าที่ได้ + "—" ตัวที่ไม่ได้)
      Promise.allSettled([
        api.get('/reports/dashboard'),
        api.get('/inventory/low-stock'),
        api.get('/reports/my-hours'),
        api.get('/orders/pending-count'),
      ]).then(([dash, low, hours, pend]) => {
        if (dash.status === 'fulfilled') setSummary(dash.value.data.summary);
        if (low.status === 'fulfilled') setLowStockCount(low.value.data.length);
        if (hours.status === 'fulfilled') setMyHours(hours.value.data);
        if (pend.status === 'fulfilled') setPendingOrders(pend.value.data?.count || 0);
      }).finally(() => setStaffLoaded(true));
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
          const open = (res.data || []).find((o: OpenOrder) => OPEN_ORDER_STATUS[o.status]);
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

  // ⭐️ เดิมเซ็ต session_mode (work/shop) ก่อน navigate — ตอนนี้ถอด "โหมดซื้อของ" ของ staff ออกแล้ว
  //   จึงเหลือแค่ navigate เฉยๆ (session_mode ไม่มีใครอ่านอีกต่อไป)
  const goTo = (path: string) => navigate(path);

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
  // ✅ UPDATE — เพิ่มการ์ดให้ครบทุกโมดูลตาม role (ตรงกับ sidebar) เพื่อให้หน้ากลางใช้เป็นจุดเข้า
  //   งานหลักได้จริง ไม่ต้องเด้งเข้า Dashboard/Inventory ก่อนถึงจะเห็นเมนูที่เหลือ; และการ์ดสั่งจอง
  //   เปิดให้ staff สั่งจองของตัวเองได้ (backend เปิดแล้ว + /pre-order ไม่บล็อก staff แล้ว)
  const modules = [
    {
      // ⭐️ สั่งจอง/ซื้อสินค้า — เปิดให้ทุก role: staff (CASHIER/MANAGER/ADMIN) ที่กดเข้า LINE ก็จอง
      //   สินค้าเป็นของตัวเองได้เหมือนสมาชิก (ออเดอร์ผูก user_id ของคนสั่ง ดูได้เฉพาะออเดอร์ตัวเอง
      //   ผ่าน ?mine=1 ฝั่ง backend)
      key: 'pre-order', show: true, icon: ShoppingCart,
      title: 'สั่งจอง/ซื้อสินค้า', subtitle: 'เลือกดูสินค้าและสั่งจอง',
      badge: productCount > 0 ? `${productCount} รายการ` : null,
      onClick: () => goTo('/pre-order'),
    },
    // ⭐️ การ์ดงานล็อกพร้อมกันตอน CASHIER ยังไม่เปิดกะ — ล็อกแค่ POS ใบเดียวไม่พอ เพราะกดใบอื่น
    //   จะตั้ง session_mode เป็น 'work' ทำให้เมนู staff (รวมลิงก์ POS) กลับมาโผล่ = อ้อมกติกาได้
    {
      // ⭐️ POS โชว์เฉพาะ CASHIER — ADMIN ขายหน้าร้านไม่ได้ (เปิดกะไม่ได้ = บิลผูก shift_id ไม่ได้)
      key: 'pos', show: isCashier, icon: CreditCard, locked: workLocked,
      title: 'หน้าขาย (POS)', subtitle: workLocked ? 'ต้องเปิดกะก่อนถึงจะขายได้' : 'ขายสินค้า/รับชำระเงิน',
      badge: null,
      onClick: () => goTo('/pos'),
    },
    {
      key: 'orders', show: isStaff, icon: ClipboardList, locked: workLocked,
      title: 'จัดการออเดอร์', subtitle: workLocked ? 'ต้องเปิดกะก่อน' : 'ตรวจสลิป/ยืนยันออเดอร์จอง',
      badge: pendingOrders > 0 ? `${pendingOrders} รอตรวจ` : null,
      onClick: () => goTo('/orders'),
    },
    {
      key: 'dashboard', show: isStaff, icon: LayoutDashboard, locked: workLocked,
      title: 'สรุปยอดขาย', subtitle: workLocked ? 'ต้องเปิดกะก่อน' : 'รายงาน/สถิติการขาย',
      badge: summary ? `วันนี้ ฿${Number(summary.total_sales).toLocaleString()}` : null,
      onClick: () => goTo('/dashboard'),
    },
    {
      // 🐛 FIX — เดิม CASHIER เห็นการ์ดคลังสินค้าด้วย (isStaff ครอบทั้ง ADMIN/MANAGER/CASHIER) ทั้งที่
      // ไม่ใช่งานของแคชเชียร์ (ไม่มีสิทธิ์แก้สต๊อก/ราคา) เหลือแค่ ADMIN/MANAGER — CASHIER เห็นการ์ด
      // "ตารางกะ" แทนด้านล่าง (ดูตารางเวลาทำงานของตัวเอง มีประโยชน์กว่า)
      key: 'inventory', show: isStaff && !isCashier, icon: Boxes, locked: workLocked,
      title: 'คลังสินค้า', subtitle: workLocked ? 'ต้องเปิดกะก่อน' : 'จัดการสินค้าและสต๊อก',
      badge: (lowStockCount ?? 0) > 0 ? `${lowStockCount} ใกล้หมด` : null,
      onClick: () => goTo('/inventory'),
    },
    {
      // ⭐️ แทนที่การ์ดคลังสินค้าสำหรับ CASHIER — ดูตารางกะได้ (Schedules.tsx: canManage=false สำหรับ
      // CASHIER = ดูอย่างเดียว แก้ไม่ได้) ไม่ล็อกด้วย workLocked (ต่างจาก POS/dashboard/inventory
      // ด้านบน) เพราะต้องดูได้ก่อนเปิดกะเสมอ — จะเปิดกะกี่โมงก็ต้องเช็คตารางได้ก่อน ไม่งั้นไก่กับไข่
      key: 'schedule', show: isCashier, icon: Calendar,
      title: 'ตารางกะ', subtitle: 'ดูตารางเวลาทำงานของคุณ',
      badge: null,
      onClick: () => goTo('/schedules'),
    },
    {
      // ⭐️ ลงชื่อเข้า-ออกงาน (clock-in/out) เปิดให้เฉพาะ CASHIER และ MANAGER — ADMIN ไม่ต้องลงชื่อเข้า-ออกงานอีกต่อไป
      key: 'shift', show: isCashier || isManager, icon: Clock,
      title: 'จัดการกะการขาย', subtitle: 'ลงชื่อเข้า-ออกงาน/นับเงิน',
      badge: null,
      onClick: () => goTo('/shift'),
    },
    // ⭐️ กลุ่มจัดการร้าน — ADMIN/MANAGER เท่านั้น (ตรงกับ sidebar: สรุปข้อมูล/สรุปบัญชี/คลัง/ตั้งค่า/เข้า-ออกงาน)
    {
      key: 'summary', show: isStoreAdmin, icon: BarChart3,
      title: 'สรุปข้อมูล', subtitle: 'ชั่วโมงทำงาน/มาสาย/ค่าจ้าง',
      badge: null,
      onClick: () => goTo('/summary'),
    },
    {
      key: 'accounting', show: isStoreAdmin, icon: FileSpreadsheet,
      title: 'สรุปบัญชี', subtitle: 'หมวดหมู่/ยอดจ่ายคืนผู้ฝากขาย/Export',
      badge: null,
      onClick: () => goTo('/accounting-summary'),
    },
    {
      key: 'attendance', show: isStoreAdmin, icon: ClipboardCheck,
      title: 'เข้า-ออกงาน', subtitle: 'จัดการเวลาเข้างาน/ออกงานพนักงาน',
      badge: null,
      onClick: () => goTo('/attendance-management'),
    },
    {
      key: 'settings', show: isStoreAdmin, icon: Settings,
      title: 'ตั้งค่า', subtitle: 'ข้อมูลร้าน/ราคา&แต้ม/กลุ่มสมาชิก',
      badge: null,
      onClick: () => goTo('/settings'),
    },
    {
      // ⭐️ งานระบบ (สำรอง/กู้คืน) — เฉพาะ ADMIN
      key: 'backup', show: isAdminRole, icon: Database,
      title: 'สำรอง & กู้คืนข้อมูล', subtitle: 'งานระบบฐานข้อมูล (ADMIN)',
      badge: null,
      onClick: () => goTo('/backup'),
    },
    // ⭐️ ทั่วไป — ทุก role
    {
      key: 'notifications', show: true, icon: Bell,
      title: 'แจ้งเตือน', subtitle: 'ข่าวสารและสถานะออเดอร์',
      badge: null,
      onClick: () => goTo('/notifications'),
    },
    {
      key: 'profile', show: true, icon: User,
      title: 'บัญชีของฉัน', subtitle: 'แก้ไขข้อมูลส่วนตัว/เปลี่ยนรหัส',
      badge: null,
      onClick: () => goTo('/profile'),
    },
    {
      // ⭐️ ยอดฝากขาย — สมาชิกที่ฝากขายสินค้า (MEMBER เท่านั้น)
      key: 'my-sales', show: !isStaff, icon: PiggyBank,
      title: 'ยอดฝากขาย', subtitle: 'รายได้จากการฝากขายสินค้า',
      badge: null,
      onClick: () => goTo('/my-sales'),
    },
  ].filter(m => m.show);

  return (
    <div className="min-h-dvh bg-brand-bg">
      {/* Header — ⭐️ Design-ref: รวมแถวโลโก้/แถวอวตารเดิมเป็นแถวเดียว (อวตาร+ทักทาย ซ้าย, ออกจากระบบ ขวา) */}
      {/* ⭐️ ชายคาร้าน — ครุยหยักใต้แถบหัว (signature หน้า Home/PreOrder) */}
      <div className="bg-gradient-to-br from-brand to-brand-dark px-5 pt-16 pb-16 relative awning-edge">
        <div className="flex items-start justify-between relative z-10">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={user.profile_image_url || '/Default profile.png'}
              alt={user.full_name}
              className="w-11 h-11 rounded-2xl object-cover border-2 border-white/40 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-white/80 text-sm font-medium">{greeting()}</p>
              <h1 className="text-white text-2xl font-bold font-display truncate">{user.full_name || user.student_id}</h1>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2.5 bg-white/15 hover:bg-white/25 rounded-xl transition-colors duration-150 shrink-0" title="ออกจากระบบ">
            <LogOut size={18} className="text-white" />
          </button>
        </div>

        <span className="relative z-10 inline-flex items-center gap-1 mt-3 bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-full">
          {user.role}
        </span>
        {/* ⭐️ บัญชีพนักงาน (staff) — บอกชัดว่านี่คือบัญชีทำงาน ไม่ใช่บัญชีสมาชิก (ไม่มีสิทธิ์แต้ม)
            กันพนักงานงงว่าทำไมสั่งจองได้แต่ใช้แต้มไม่ได้ */}
        {isStaff && (
          <span title="บัญชีพนักงาน — สั่งจองสินค้าได้ แต่ไม่มีสิทธิ์สะสม/แลกแต้มสมาชิก" className="relative z-10 inline-flex items-center gap-1 mt-3 bg-white text-brand text-xs font-bold px-3 py-1.5 rounded-full">
            💼 บัญชีพนักงาน
          </span>
        )}
        <p className="relative z-10 text-white/70 text-[11px] mt-2.5">เมนูด้านล่างแสดงตามสิทธิ์การใช้งานของคุณ</p>
      </div>

      {/* Stat card (staff only) — ลอยคาบเส้นขอบล่างของ header ตามดีไซน์อ้างอิง สีต่างกันตามประเภทข้อมูล
          โชว์เมื่อโหลดครบ (สำเร็จหรือไม่) — ค่าที่โหลดไม่ได้ = "—" กันโชว์ 0 ปลอม */}
      {isStaff && staffLoaded && (
        <div className="px-5 -mt-16 relative z-10">
          <div className="bg-white border border-brand-border rounded-3xl shadow-md p-4 grid grid-cols-3 divide-x divide-brand-border">
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-brand">{summary ? `฿${Number(summary.total_sales).toLocaleString()}` : '—'}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">ยอดขายวันนี้</p>
            </div>
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-blue-500">{summary ? summary.total_bills : '—'}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">ออเดอร์</p>
            </div>
            <div className="text-center px-1">
              <p className="text-base font-extrabold text-amber-500">{lowStockCount ?? '—'}</p>
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
            <SkeletonCard />
          ) : openOrder && (
            // 🎫 ตั๋วรับของ — แถบหัวตั๋ว + เส้นประตัด เหมือนตั๋วรับของที่เคาน์เตอร์ (signature)
            <div className="bg-white border border-brand-border rounded-3xl shadow-md overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-brand-bg border-b border-dashed border-brand-mid">
                <p className="font-display text-xs font-bold text-brand truncate">🎫 ตั๋วรับของ #{openOrder.id}</p>
                <span className={`shrink-0 text-[11px] font-bold ${OPEN_ORDER_STATUS[openOrder.status].tone === 'warn' ? 'text-red-600' : 'text-brand'}`}>
                  {OPEN_ORDER_STATUS[openOrder.status].label}
                </span>
              </div>
              <div className="p-4">
                <p className="text-[11px] text-gray-400 font-medium">ยอดรวม</p>
                <p className="font-display text-xl font-bold text-ink tabular-nums">฿{Number(openOrder.total_amount).toLocaleString()}</p>
                {openOrder.status === 'SLIP_REJECTED' ? (
                  <Button
                    variant="danger"
                    className="mt-3 w-full"
                    onClick={() => setSlipOrder(openOrder)}
                  >
                    ส่งสลิปด่วน
                  </Button>
                ) : (
                  <button
                    onClick={() => goTo('/pre-order?view=orders')}
                    className="mt-3 w-full py-2.5 rounded-full bg-brand-bg text-brand text-sm font-bold transition-all duration-150 active:scale-[0.98] hover:bg-brand-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    ดูรายละเอียด
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. ปุ่มลัด 4 ช่อง */}
      {!isStaff && (
        <div className={`px-5 max-w-lg mx-auto ${(loadingOrder || openOrder) ? 'mt-4' : '-mt-16 relative z-10'}`}>
          <div className="bg-white border border-brand-border rounded-3xl shadow-md p-3 grid grid-cols-4 gap-1">
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
          <SectionTitle className="px-5">โปรโมชันที่ใช้ได้ตอนนี้</SectionTitle>
          {/* ⭐️ overflow-x-auto + snap ให้เลื่อนลื่นบนมือถือ; ไม่ใช้ scroll-behavior แบบ JS
              เพื่อให้ WebKit เก่ารองรับได้ตามปกติ */}
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory scrollbar-hide">
            {loadingPromos
              ? [1, 2].map(i => (
                  <SkeletonListRow key={i} height="h-24" className="shrink-0 w-64 shadow-sm" />
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
          <SectionTitle
            className="px-5"
            right={
              <button onClick={() => goTo('/pre-order')} className="text-xs font-bold text-brand hover:underline shrink-0">
                ดูทั้งหมด
              </button>
            }
          >
            🔥 สินค้าขายดีประจำสัปดาห์
          </SectionTitle>
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x scrollbar-hide">
            {loadingBest
              ? [1, 2, 3].map(i => (
                  <div key={i} className="shrink-0 w-36 bg-white border border-brand-border rounded-3xl shadow-sm p-2.5 animate-pulse">
                    <div className="mb-2"><SkeletonLine width="w-full" height="h-24" /></div>
                    <SkeletonLine width="w-3/4" height="h-3" className="mb-1.5" />
                    <SkeletonLine width="w-1/2" height="h-3" />
                  </div>
                ))
              : bestSellers.map(p => {
                  const { final, original, pct } = priceAfterPromo(p);
                  return (
                    <div key={p.id} className="snap-start shrink-0 w-36 bg-white border border-brand-border rounded-3xl shadow-sm overflow-hidden flex flex-col">
                      <div className="relative shrink-0">
                        <ProductImage imageUrl={p.image_url} name={p.name} className="h-24 mb-0" iconSize={22} />
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
                        <div className="mt-1.5">
                          <ProductPrice price={final} original={original} />
                        </div>
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => goTo(`/pre-order?add=${p.id}`)}
                        >
                          + เพิ่มลงตะกร้า
                        </Button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {/* Module list */}
      <div className={`px-5 ${isStaff ? 'mt-5' : 'mt-6'} pb-10 max-w-lg mx-auto`}>
        <SectionTitle className="px-1">เมนูสำหรับคุณ</SectionTitle>
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
            if (res) setOpenOrder((res.data || []).find((o: OpenOrder) => OPEN_ORDER_STATUS[o.status]) || null);
          }}
        />
      )}

      {/* ⭐️ หน้า Home ไม่ได้อยู่ใต้ Layout จึงไม่ได้ style scrollbar-hide ที่ประกาศไว้ที่นั่น */}
      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
