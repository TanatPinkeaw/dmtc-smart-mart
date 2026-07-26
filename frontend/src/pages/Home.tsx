// ✅ NEW: หน้ากลางหลัง login — ทุก role (ADMIN/CASHIER/MEMBER) เข้าที่นี่ก่อนเสมอ (แทน choice
//   modal เดิมใน Login.tsx) แสดงสรุปยอดสั้นๆ (staff เท่านั้น) + การ์ดโมดูลตาม role กดเข้าใช้งาน
// อ้างอิงดีไซน์จาก Figma Make reference (School Co-op POS UI Design/src/screens) ปรับให้ต่อ API จริง

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, CreditCard, LayoutDashboard, Boxes, Clock, LogOut, ChevronRight, Tag, Lock } from 'lucide-react';
import api from '../api';
import { performLogout } from '../utils/logout';
import Swal from '../swal';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { BRAND } from '../theme';

interface DashboardSummary { total_sales: number; total_bills: number; }
interface MyHours { total_hours: number; hourly_rate: number; calculated_pay: number; }
interface ActivePromo { id: number; name: string; label: string; end_date: string | null; }

export default function Home() {
  const user = getCurrentUserOrRedirect();
  const navigate = useNavigate();
  const isStaff = user.role === 'ADMIN' || user.role === 'CASHIER';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [myHours, setMyHours] = useState<MyHours | null>(null); // ⭐️ Home page feature — ชม.ทำงาน/ค่าจ้างเดือนนี้
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null); // ⭐️ Design-ref — แบนเนอร์โปรฯ สำหรับสมาชิก
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
      api.get('/promotions/active').then(res => setActivePromo((res.data || [])[0] || null)).catch(() => {});
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

      {/* ⭐️ Design-ref — แบนเนอร์โปรโมชั่นวันนี้ (สมาชิกเท่านั้น) ดึงจาก /promotions/active ตัวแรก */}
      {!isStaff && activePromo && (
        <div className="px-5 -mt-16 relative z-10 max-w-lg mx-auto">
          <div className="bg-white border border-brand-border rounded-3xl shadow-md p-4 flex items-center gap-3">
            <div className="w-11 h-11 bg-brand-bg rounded-xl flex items-center justify-center shrink-0">
              <Tag size={20} className="text-brand" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-sm truncate">{activePromo.name}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5 truncate">{activePromo.label}</p>
            </div>
          </div>
        </div>
      )}

      {/* Module list */}
      <div className={`px-5 ${isStaff ? 'mt-5' : (activePromo ? 'mt-5' : '-mt-16 relative z-10')} pb-10 max-w-lg mx-auto`}>
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
    </div>
  );
}
