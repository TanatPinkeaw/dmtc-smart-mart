// 📄 pages/Dashboard.tsx — หน้าสรุปยอดขาย/ภาพรวมร้าน (staff): กราฟ+การ์ดสรุป+Peak Hours+อนุมัติปิดกะ
//    ทำอะไร: ดึงข้อมูลสรุป (ยอดวันนี้/สัปดาห์/รายชั่วโมง/ต่อพนักงาน/สินค้าขายดี) มาโชว์กราฟ+การ์ด +
//    วิดเจ็ตกะรออนุมัติ; realtime อัปเดต; ประกอบจาก components/dashboard/*
// ✅ CHANGED: colors → DMTC Mart theme (#F12B6B primary)
// ✅ CHANGED: ตัดปุ่ม/flow "ลงชื่อออกงาน" (ADMIN) และ "ปิดกะการขาย" (CASHIER) ออกจากหน้านี้ — รวมไป
//   อยู่ที่หน้า /shift หน้าเดียวแล้ว (ทั้งเข้างานและออกงาน) ตามคำขอผู้ใช้ที่ไม่อยากให้ check-in/out
//   กระจายอยู่คนละหน้า ดู Shift.tsx สำหรับ flow ใหม่
// 🔒 UNCHANGED: handleLogout, fetchDashboardData, socket listeners, all remaining state, Section component logic

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, ArrowLeft, Users, PiggyBank, Store, ShoppingBag, Package } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme';
import { useSocket } from '../hooks/useSocket';
import { getLocalDate } from '../utils/localDate';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone'; // ⭐️ Sprint 2 — B8
import PendingShiftClosesWidget from '../components/dashboard/PendingShiftClosesWidget'; // ⭐️ Sprint 2 — D1
import { Section } from '../components/dashboard/Section';
import { StatCards } from '../components/dashboard/StatCards';
import { AdminDashboardHero } from '../components/dashboard/AdminDashboardHero'; // ⭐️ Design-ref — AdminDashboardScreen.tsx
import { AlertCardsGrid } from '../components/dashboard/AlertCardsGrid';
import { SkeletonCard, SkeletonDashboardStat, SkeletonListRow } from '../components/ui/Skeleton';
import { DetailModal } from '../components/dashboard/DetailModal';

// ⭐️ FIX: แปลงรหัสสถานะ pre-order (PENDING_VERIFY ฯลฯ) เป็นคำไทยที่พนักงานเข้าใจง่าย
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_VERIFY: 'รอตรวจสลิป',
  WAITING_CASH: 'รอรับเงินสด',
  SLIP_REJECTED: 'สลิปไม่ผ่าน รอส่งใหม่',
  PREPARING: 'กำลังเตรียมของ',
  READY: 'พร้อมให้มารับ',
  REFUND_REQUESTED: 'รอคืนเงิน',
};
const orderStatusLabel = (status: string) => ORDER_STATUS_LABELS[status] || status;

// ── Types (state ที่เคยเป็น any — shape ตาม endpoint ที่ดึง + การใช้งานจริง) ──────
interface DashRow { [key: string]: unknown; }
interface LowStockRow { id: number; name: string; barcode?: string; stock: number; }
interface ShiftRow { id: number; cashier_name: string; difference?: number | string; opened_at?: string; closed_at?: string; note?: string; }
interface ComparisonRow { pct_vs_yesterday?: number | null; pct_vs_last_week?: number | null; yesterday?: number | string | null; }
interface HourlyRow { hour: number | string; total: number | string; }
interface CashierRow { shift_id: number; cashier_name: string; bill_count: number; opened_at: string; shift_status: string; total_sales: number | string; }
interface VendorRow { vendor_id: number; vendor_name: string; total_items_sold: number; coop_gp_earnings: number | string; vendor_earnings: number | string; }
interface PendingOrderRow { status: string; count: number; total: number | string; }
interface DeadStockRow { id: number; name: string; stock: number; }
interface AttendanceRow { user_id: number; full_name: string; late_minutes?: number | null; }

export default function Dashboard() {
  // 🐛 FIX — เดิม .catch(() => {}) กลืน error ทุก widget: ตัวไหนล่ม โชว์ว่าง/0 เงียบๆ หลอก. 
  // โชว์แบนเนอร์ "บางส่วนโหลดไม่สำเร็จ" แทนการเงียบ
  const [widgetLoadFailed, setWidgetLoadFailed] = useState(false);
  const [summary, setSummary] = useState<{ total_sales?: number | string; total_bills?: number | string } | null>(null);
  const [topProducts, setTopProducts] = useState<{ name: string; total_quantity?: number | string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [voidSummary, setVoidSummary] = useState<{ void_count?: number; void_amount?: number } | null>(null);
  const [shiftAnomalies, setShiftAnomalies] = useState<ShiftRow[]>([]);
  const [pendingApprovalShifts, setPendingApprovalShifts] = useState<ShiftRow[]>([]); // ⭐️ F2
  const [comparison, setComparison] = useState<ComparisonRow | null>(null);
  const [hourly, setHourly] = useState<HourlyRow[]>([]);
  // ⭐️ Peak Hours Analytics — period toggle (วันนี้/7วัน/30วัน) + ชั่วโมงพีคไฮไลต์ในกราฟ
  const [hourlyPeriod, setHourlyPeriod] = useState<'today' | '7d' | '30d'>('today');
  const [peakHour, setPeakHour] = useState<number | null>(null);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [byCashier, setByCashier] = useState<CashierRow[]>([]);
  const [openShifts, setOpenShifts] = useState<ShiftRow[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrderRow[]>([]);
  const [channel, setChannel] = useState<DashRow | null>(null);
  const [grossProfit, setGrossProfit] = useState<DashRow | null>(null);
  const [deadStock, setDeadStock] = useState<DeadStockRow[]>([]);
  const [vendorSummary, setVendorSummary] = useState<VendorRow[]>([]);
  const [attendanceReport, setAttendanceReport] = useState<AttendanceRow[]>([]);
  const [weeklySales, setWeeklySales] = useState<{ day: string; total: number }[]>([]); // ⭐️ Design-ref — กราฟยอดขายรายสัปดาห์
  const [recentOrders, setRecentOrders] = useState<{ id: number; source?: string; cashier_name?: string; created_at?: string; status?: string; total_amount?: number | string }[]>([]); // ⭐️ Design-ref — feed ออเดอร์ล่าสุด
  const [openInsights, setOpenInsights] = useState(true);
  const [openDetails, setOpenDetails] = useState(false);
  const [detailModal, setDetailModal] = useState<{ type: string; title: string } | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null); // ⭐️ F10 — null = ยังไม่เช็ค, true = ok, false = degraded/เช็คไม่ได้
  const socket = useSocket();
  const navigate = useNavigate();

  // ⭐️ F10 — เช็ค GET /api/health ทุก 30 วิ (public route ไม่ต้องมี token)
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await api.get('/health');
        setHealthOk(res.data?.status === 'ok');
      } catch {
        setHealthOk(false); // network error, timeout, หรือ 503 ก็ถือว่า degraded
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  // ⭐️ MANAGER เห็น Executive Dashboard เหมือน ADMIN ทุกอย่าง (ไม่ใช่การ์ดสรุปกะแบบ CASHIER)
  const isManagerOrAdmin = user.role === 'ADMIN' || user.role === 'MANAGER';
  const isCashier = user.role === 'CASHIER';

  // ⭐️ Peak Hours Analytics — แยกจาก generic get() loop เพราะต้อง refetch เดี่ยวๆ ตอนสลับ period
  const fetchHourlySales = async (period: 'today' | '7d' | '30d') => {
    setHourlyLoading(true);
    try {
      const res = await api.get(`/reports/hourly-sales?period=${period}`);
      setHourly(res.data.hourly || []);
      setPeakHour(res.data.peak_hour ?? null);
    } catch { /* เงียบไว้เหมือน get() generic — ไม่ critical พอจะ block หน้าอื่น */ }
    finally { setHourlyLoading(false); }
  };
  const handleHourlyPeriodChange = (period: 'today' | '7d' | '30d') => {
    setHourlyPeriod(period);
    fetchHourlySales(period);
  };

  const fetchDashboardData = async () => {
    try {
      const [dashRes, topRes] = await Promise.all([api.get('/reports/dashboard'), api.get('/reports/top-selling')]);
      setSummary(dashRes.data.summary); setTopProducts(topRes.data);
      if (!isManagerOrAdmin) { setLoading(false); return; }
      const get = <T,>(url: string, setter: (d: T) => void) => api.get(url).then(r => setter(r.data as T)).catch(() => setWidgetLoadFailed(true));
      await Promise.all([
        get('/inventory/low-stock', setLowStock), get('/reports/void-summary', setVoidSummary),
        get('/reports/shift-anomalies', setShiftAnomalies), get('/reports/sales-comparison', setComparison),
        get('/shifts/pending-approval', setPendingApprovalShifts), // ⭐️ F2
        fetchHourlySales(hourlyPeriod), get('/reports/sales-by-cashier', setByCashier),
        get('/reports/open-shifts', setOpenShifts), get('/reports/pending-orders', setPendingOrders),
        get('/reports/sales-channel', setChannel), get('/reports/gross-profit', setGrossProfit),
        get('/reports/dead-stock', setDeadStock), get('/reports/vendor-summary', setVendorSummary),
        // 🐛 FIX — เดิม new Date().toISOString().slice(0,7) เป็นเดือนแบบ UTC: ตอน 00:00–07:00 ไทยจะ
        // ส่งเดือนก่อนหน้าไป (รายงานโชว์เดือนผิด) — ใช้ getLocalDate() แทน
        get(`/reports/attendance?month=${getLocalDate().slice(0, 7)}`, setAttendanceReport),
        get('/reports/weekly-sales', setWeeklySales), get('/sales/history', setRecentOrders),
      ]);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => {
    // ⭐️ Security remediation — token ย้ายไป httpOnly cookie อ่านจาก JS ไม่ได้แล้ว
    // getCurrentUserOrRedirect() ข้างบนเด้งไป /login ให้แล้วถ้าไม่มี user session
    // (เดิมมี logic เด้ง CASHIER ที่อยู่ "โหมดซื้อของ" ไป /pre-order — ถอดออกแล้วพร้อมกับการเลิกใช้
    //  session_mode ทั้งระบบ; staff ไม่มีโหมดซื้อของอีกต่อไป)
    // IIFE: ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation
    void (async () => { await fetchDashboardData(); })();
    if (!socket) return;
    socket.on('dashboard_updated', () => { fetchDashboardData(); });
    return () => { socket.off('dashboard_updated'); };
  }, [navigate, socket]);

  // ⭐️ handleLogout เดิมถูกลบทิ้ง — ไม่มีใครเรียกแล้วหลังย้ายปุ่มลงชื่อออกงาน/ปิดกะไป Shift.tsx
  //   (ออกจากระบบใช้ปุ่มใน Layout sidebar/เมนู ซึ่งเรียก performLogout ให้ถูกต้องอยู่แล้ว)

  // ⭐️ F2 — ADMIN/MANAGER อนุมัติปิดกะที่รออนุมัติ (ส่วนต่างเกิน 100 บาท)
  // 🐛 FIX — เดิมยิง POST /shifts/:id/approve-close (ไม่มี route นี้จริง) ตัว endpoint จริงคือ
  //   PUT /shifts/:id/approve (server.js) ซึ่งต้องมีทั้ง approval_notes และ password ยืนยันตัวตน
  //   (ดู pattern เดียวกันใน PendingShiftClosesWidget.tsx ที่ทำงานถูกต้องอยู่แล้ว) — เดิมไม่เคยขอ
  //   password เลย เลยต้องเพิ่มขั้นตอนนี้เข้ามาด้วย ไม่งั้นแก้แค่ path/method/key จะเปลี่ยนจาก 404 เป็น 400 แทน
  const handleApproveShift = async (shiftId: number) => {
    const { value: password } = await Swal.fire({
      title: 'ยืนยันการอนุมัติ',
      input: 'password',
      inputPlaceholder: 'ระบุรหัสผ่านของคุณ',
      showCancelButton: true,
      confirmButtonText: 'ถัดไป',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: BRAND,
      inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
    });
    if (!password) return;

    const { value: notes } = await Swal.fire({
      title: 'อนุมัติปิดกะ',
      input: 'textarea',
      inputLabel: 'หมายเหตุการอนุมัติ (จำเป็น อย่างน้อย 5 ตัวอักษร)',
      inputPlaceholder: 'เช่น ตรวจสอบแล้ว เงินขาดเพราะ...',
      showCancelButton: true,
      confirmButtonText: 'อนุมัติ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: BRAND,
      inputValidator: (value) => {
        if (!value || value.trim().length < 5) return 'กรุณากรอกหมายเหตุอย่างน้อย 5 ตัวอักษร';
        return undefined;
      },
    });
    if (!notes) return;
    try {
      await api.put(`/shifts/${shiftId}/approve`, { approval_notes: notes, password });
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'อนุมัติปิดกะสำเร็จ', showConfirmButton: false, timer: 2500 });
      setDetailModal(null);
      fetchDashboardData();
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) });
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-brand-bg p-4 md:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-5">
        <SkeletonListRow />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonDashboardStat key={i} />)}
          </div>
          <SkeletonCard />
        </div>
      </div>
    </div>
  );

  // ── shared card class ────────────────────────────────────────────────────
  const card = "bg-white border border-brand-border rounded-3xl shadow-sm";

  return (
    <div className="min-h-screen bg-brand-bg pb-24">

      {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (flush — คง health dot + ปุ่มกลับ POS ไว้) */}
      <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 shadow-md gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <LayoutDashboard size={16} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-white">สรุปยอดขายประจำวัน</h1>
          {/* ⭐️ F10 — Health check status dot: เขียว=ปกติ, แดง=เซิร์ฟเวอร์/DB มีปัญหา, เทา=ยังไม่เช็ค */}
          <span
            title={healthOk === null ? 'กำลังตรวจสอบสถานะระบบ...' : healthOk ? 'ระบบทำงานปกติ' : 'เซิร์ฟเวอร์/ฐานข้อมูลมีปัญหา'}
            className={`w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white/60 ${
              healthOk === null ? 'bg-gray-300' : healthOk ? 'bg-green-400' : 'bg-red-400 animate-pulse'
            }`}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* ⭐️ ปุ่มกลับหน้า POS โชว์เฉพาะ CASHIER — ADMIN/MANAGER เข้าหน้า POS ไม่ได้ (route ก็กันไว้) */}
          {isCashier && (
            <button onClick={() => navigate('/pos')} className="flex items-center gap-1.5 text-white hover:bg-white/25 bg-white/15 border border-white/20 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <ArrowLeft size={14} /> กลับไปหน้า POS
            </button>
          )}
          <span className="text-xs text-white/90 font-medium hidden sm:block">{user.full_name}</span>
        </div>
      </div>

      <div className="p-4 md:p-6">
      {/* 🐛 FIX — เดิม widget ที่ดึงไม่สำเร็จโชว์ว่าง/0 เงียบๆ — แจ้งชัดว่าบางข้อมูลไม่ได้อัปเดต */}
      {widgetLoadFailed && (
        <div className="max-w-7xl mx-auto mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-4 py-2.5 rounded-xl">
          ⚠️ บางข้อมูลโหลดไม่สำเร็จ แสดงค่าว่าง/เก่าชั่วคราว — ลองรีเฟรชหน้านี้อีกครั้ง
        </div>
      )}

      {/* ⭐️ Sprint 2 — D1: Pending Shift Closes Widget (ADMIN + MANAGER) */}
      {isManagerOrAdmin && (
        <div className="max-w-7xl mx-auto mb-5">
          <PendingShiftClosesWidget />
        </div>
      )}

      {isManagerOrAdmin ? (
        <AdminDashboardHero
          summary={summary}
          comparison={comparison}
          lowStockCount={lowStock.length}
          voidSummary={voidSummary}
          weeklySales={weeklySales}
          topProducts={topProducts}
          recentOrders={recentOrders}
        />
      ) : (
        <StatCards summary={summary} topProducts={topProducts} />
      )}

      {/* ── Admin/Manager sections ───────────────────────────────────────────── */}
      {isManagerOrAdmin && (
        <>
          <AlertCardsGrid
            lowStock={lowStock}
            voidSummary={voidSummary}
            shiftAnomalies={shiftAnomalies}
            openShifts={openShifts}
            pendingApprovalShifts={pendingApprovalShifts}
            onOpenDetail={(type, title) => setDetailModal({ type, title })}
          />

          {/* Insights section */}
          <Section title="วิเคราะห์ยอดขายวันนี้" icon={<TrendingUp size={16} className="text-emerald-500" />} open={openInsights} onToggle={() => setOpenInsights(!openInsights)}>
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><TrendingUp size={16} className="text-emerald-500" /><h3 className="text-xs font-semibold text-gray-700">เทียบยอดขาย</h3></div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-gray-500">vs เมื่อวาน</span><span className={`font-bold ${(comparison?.pct_vs_yesterday ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{comparison?.pct_vs_yesterday == null ? '—' : `${comparison.pct_vs_yesterday > 0 ? '+' : ''}${comparison.pct_vs_yesterday}%`}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">vs สัปดาห์ก่อน</span><span className={`font-bold ${(comparison?.pct_vs_last_week ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{comparison?.pct_vs_last_week == null ? '—' : `${comparison.pct_vs_last_week > 0 ? '+' : ''}${comparison.pct_vs_last_week}%`}</span></div>
                </div>
              </div>
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><ShoppingBag size={16} className="text-brand" /><h3 className="text-xs font-semibold text-gray-700">ช่องทางขายวันนี้</h3></div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-gray-500 flex items-center gap-1"><Store size={12}/> หน้าร้าน</span><span className="font-bold text-gray-900">฿{Number(channel?.walkin_sales || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500 flex items-center gap-1"><Package size={12}/> Pre-order</span><span className="font-bold text-gray-900">฿{Number(channel?.preorder_sales || 0).toLocaleString()}</span></div>
                </div>
              </div>
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><PiggyBank size={16} className="text-emerald-600" /><h3 className="text-xs font-semibold text-gray-700">กำไรขั้นต้นวันนี้</h3></div>
                <p className="text-2xl font-bold text-emerald-600">฿{Number(grossProfit?.gross_profit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-gray-400 mt-1">หัก GP สินค้าฝากขายแล้ว</p>
              </div>
            </div>

            <div className="max-w-7xl mx-auto">
              <div className={`${card} p-4`}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h3 className="text-xs font-semibold text-gray-700">
                    Peak Hours — ยอดขายรายชั่วโมง{hourlyPeriod !== 'today' && ' (เฉลี่ยต่อวัน)'}
                  </h3>
                  <div className="flex bg-brand-bg border border-brand-border rounded-full p-0.5">
                    {(['today', '7d', '30d'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => handleHourlyPeriodChange(p)}
                        disabled={hourlyLoading}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition disabled:opacity-50 ${hourlyPeriod === p ? 'bg-brand text-white' : 'text-gray-500'}`}
                      >
                        {p === 'today' ? 'วันนี้' : p === '7d' ? '7 วัน' : '30 วัน'}
                      </button>
                    ))}
                  </div>
                </div>
                {peakHour !== null && hourly.some(h => Number(h.total) > 0) && (
                  <p className="text-[10px] text-brand font-semibold mb-3">
                    ⏰ ช่วงพีค: {String(peakHour).padStart(2, '0')}:00–{String(peakHour).padStart(2, '0')}:59
                  </p>
                )}
                {(() => {
                  const max = Math.max(1, ...hourly.map(h => Number(h.total)));
                  const active = hourly.filter(h => Number(h.total) > 0);
                  if (active.length === 0) return <p className="text-center text-sm text-gray-400 py-8">ยังไม่มียอดขาย</p>;
                  return (
                    <div className="flex items-end gap-1 h-32">
                      {hourly.map(h => (
                        // 🐛 FIX — ต้องมี h-32 ตรงนี้ด้วย (เท่า parent) ไม่งั้น bar ด้านในที่ตั้ง height
                        // เป็น % จะไม่มีความสูงตั้งต้นให้อ้างอิง (parent เดิม auto height เพราะ items-end
                        // ไม่ stretch ลูก) → % คำนวณไม่ได้ กลายเป็น 0 เสมอไม่ว่ายอดขายจะเท่าไหร่
                        // (ข้อความ "ช่วงพีค" ด้านบนยังโชว์ถูกเพราะมาจาก data ตรงๆ ไม่เกี่ยว layout นี้)
                        <div key={h.hour} className="flex-1 h-32 flex flex-col items-center justify-end group">
                          <div
                            className={`w-full rounded-t transition-all duration-150 relative ${h.hour === peakHour ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand-mid hover:bg-brand'}`}
                            style={{ height: `${(Number(h.total) / max) * 100}%` }}
                          >
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 whitespace-nowrap bg-white border border-brand-border px-1 rounded">฿{Number(h.total).toLocaleString()}</span>
                          </div>
                          <span className={`text-[8px] mt-1 ${h.hour === peakHour ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>{h.hour}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </Section>

          {/* Details section */}
          <Section title="รายละเอียดพนักงาน สินค้า และบุคคล" icon={<Users size={16} className="text-brand" />} open={openDetails} onToggle={() => setOpenDetails(!openDetails)}>
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Cashier */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><Users size={16} className="text-brand" /><h3 className="text-xs font-semibold text-gray-700">ยอดขายต่อพนักงานต่อกะ (วันนี้)</h3></div>
                <div className="space-y-2">
                  {byCashier.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ยังไม่มีข้อมูล</p> :
                    byCashier.map(c => (
                      <div key={c.shift_id} className="flex justify-between items-center px-2 py-2 hover:bg-brand-bg rounded-xl transition-colors duration-150">
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{c.cashier_name}</p>
                          <p className="text-[10px] text-gray-400">{c.bill_count} บิล • {formatBangkokTime(c.opened_at).slice(-5)}{c.shift_status === 'OPEN' ? ' (ยังไม่ปิดกะ)' : ''}</p>
                        </div>
                        <span className="text-xs font-bold text-brand">฿{Number(c.total_sales).toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Vendor */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><PiggyBank size={16} className="text-orange-400" /><h3 className="text-xs font-semibold text-gray-700">สินค้าฝากขาย (หัก GP แล้ว)</h3></div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {vendorSummary.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ยังไม่มีข้อมูล</p> :
                    vendorSummary.map(v => (
                      <div key={v.vendor_id} className="flex justify-between items-center px-2 py-2 hover:bg-brand-bg rounded-xl transition-colors duration-150">
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{v.vendor_name}</p>
                          <p className="text-[10px] text-gray-400">ขาย {v.total_items_sold} ชิ้น • GP ฿{Number(v.coop_gp_earnings).toLocaleString()}</p>
                        </div>
                        <span className="text-xs font-bold text-brand">฿{Number(v.vendor_earnings).toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Pending orders */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><Package size={16} className="text-blue-500" /><h3 className="text-xs font-semibold text-gray-700">Pre-order ค้างดำเนินการ</h3></div>
                <div className="space-y-2">
                  {pendingOrders.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ไม่มีออเดอร์ค้าง</p> :
                    pendingOrders.map(o => (
                      <div key={o.status} className="flex justify-between items-center px-2 py-2 hover:bg-brand-bg rounded-xl text-xs transition-colors duration-150">
                        <span className="font-medium text-gray-700">{orderStatusLabel(o.status)}</span>
                        <span className="text-gray-500">{o.count} บิล • ฿{Number(o.total).toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Dead stock */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><Package size={16} className="text-gray-400" /><h3 className="text-xs font-semibold text-gray-700">สินค้าขายไม่ออก (30 วัน)</h3></div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {deadStock.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ไม่มีสินค้าค้างสต๊อก</p> :
                    deadStock.map(p => (
                      <div key={p.id} className="flex justify-between items-center px-2 py-2 hover:bg-brand-bg rounded-xl text-xs transition-colors duration-150">
                        <span className="font-medium text-gray-700 truncate">{p.name}</span>
                        <span className="text-gray-400 shrink-0 ml-2">เหลือ {p.stock}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Attendance */}
            <div className="max-w-7xl mx-auto">
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><Users size={16} className="text-purple-500" /><h3 className="text-xs font-semibold text-gray-700">สรุปการมาสายเดือนนี้</h3></div>
                {(() => {
                  const byUser: Record<number, { name: string; lateCount: number; totalDays: number; lateMinutes: number }> = {};
                  attendanceReport.forEach(r => {
                    if (!byUser[r.user_id]) byUser[r.user_id] = { name: r.full_name, lateCount: 0, totalDays: 0, lateMinutes: 0 };
                    byUser[r.user_id].totalDays += 1;
                    if (r.late_minutes != null && r.late_minutes > 0) { byUser[r.user_id].lateCount += 1; byUser[r.user_id].lateMinutes += r.late_minutes; }
                  });
                  const list = Object.values(byUser);
                  if (list.length === 0) return <p className="text-center text-sm text-gray-400 py-4">ยังไม่มีตารางเวลาที่ตั้งไว้เดือนนี้</p>;
                  return (
                    <div className="space-y-2">
                      {list.map(s => (
                        <div key={s.name} className="flex justify-between items-center px-2 py-2 hover:bg-brand-bg rounded-xl text-xs transition-colors duration-150">
                          <span className="font-semibold text-gray-800">{s.name}</span>
                          <span className={`font-medium ${s.lateCount > 0 ? 'text-red-500' : 'text-emerald-500'}`}>มาสาย {s.lateCount}/{s.totalDays} วัน {s.lateMinutes > 0 && `(รวม ${s.lateMinutes} น.)`}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </Section>
        </>
      )}

      {detailModal && (
        <DetailModal
          detailModal={detailModal}
          lowStock={lowStock}
          voidSummary={voidSummary}
          shiftAnomalies={shiftAnomalies}
          openShifts={openShifts}
          pendingApprovalShifts={pendingApprovalShifts}
          onApproveShift={handleApproveShift}
          onClose={() => setDetailModal(null)}
        />
      )}
      </div>
      </div>
    </div>
  );
}
