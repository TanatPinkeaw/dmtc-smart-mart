// ✅ CHANGED: colors → DMTC Mart theme (#F12B6B primary)
// 🔒 UNCHANGED: all handlers (handleCloseShift, handleAdminCheckOut, handleCheckOutPhotoSelected, handleLogout, fetchDashboardData), socket listeners, all state, Section component logic

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, LogOut, ArrowLeft, Users, PiggyBank, Store, ShoppingBag, Package } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone'; // ⭐️ Sprint 2 — B8
import PendingShiftClosesWidget from '../components/PendingShiftClosesWidget'; // ⭐️ Sprint 2 — D1
import { Section } from '../components/dashboard/Section';
import { StatCards } from '../components/dashboard/StatCards';
import { AlertCardsGrid } from '../components/dashboard/AlertCardsGrid';
import { CloseShiftModal } from '../components/dashboard/CloseShiftModal';
import { SkeletonCard, SkeletonDashboardStat } from '../components/ui/Skeleton';
import { DetailModal } from '../components/dashboard/DetailModal';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

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

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [voidSummary, setVoidSummary] = useState<any>(null);
  const [shiftAnomalies, setShiftAnomalies] = useState<any[]>([]);
  const [pendingApprovalShifts, setPendingApprovalShifts] = useState<any[]>([]); // ⭐️ F2
  const [comparison, setComparison] = useState<any>(null);
  const [hourly, setHourly] = useState<any[]>([]);
  const [byCashier, setByCashier] = useState<any[]>([]);
  const [openShifts, setOpenShifts] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [channel, setChannel] = useState<any>(null);
  const [grossProfit, setGrossProfit] = useState<any>(null);
  const [deadStock, setDeadStock] = useState<any[]>([]);
  const [vendorSummary, setVendorSummary] = useState<any[]>([]);
  const [attendanceReport, setAttendanceReport] = useState<any[]>([]);
  const [openInsights, setOpenInsights] = useState(true);
  const [openDetails, setOpenDetails] = useState(false);
  const [detailModal, setDetailModal] = useState<{ type: string; title: string } | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, number | ''>>({});
  const [closeNote, setCloseNote] = useState('');
  const [discrepancyCategory, setDiscrepancyCategory] = useState(''); // ⭐️ Sprint 1 — D3
  const [closeLoading, setCloseLoading] = useState(false);
  const [closePhoto, setClosePhoto] = useState<File | null>(null);
  const [closePhotoPreview, setClosePhotoPreview] = useState<string | null>(null);
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [checkOutLoading, setCheckOutLoading] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null); // ⭐️ F10 — null = ยังไม่เช็ค, true = ok, false = degraded/เช็คไม่ได้
  const actualCash = DENOMINATIONS.reduce((sum, d) => sum + d * (Number(denomCounts[d]) || 0), 0);
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
  const isAdmin = user.role === 'ADMIN';

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { navigate('/login'); return; }
    if (localStorage.getItem('session_mode') === 'shop') { navigate('/pre-order'); return; }
    fetchDashboardData();
    if (!socket) return;
    socket.on('dashboard_updated', () => { fetchDashboardData(); });
    return () => { socket.off('dashboard_updated'); };
  }, [navigate, socket]);

  const fetchDashboardData = async () => {
    try {
      const [dashRes, topRes] = await Promise.all([api.get('/reports/dashboard'), api.get('/reports/top-selling')]);
      setSummary(dashRes.data.summary); setTopProducts(topRes.data);
      if (!isAdmin) { setLoading(false); return; }
      const get = (url: string, setter: (d: any) => void) => api.get(url).then(r => setter(r.data)).catch(() => {});
      await Promise.all([
        get('/inventory/low-stock', setLowStock), get('/reports/void-summary', setVoidSummary),
        get('/reports/shift-anomalies', setShiftAnomalies), get('/reports/sales-comparison', setComparison),
        get('/shifts/pending-approval', setPendingApprovalShifts), // ⭐️ F2
        get('/reports/hourly-sales', setHourly), get('/reports/sales-by-cashier', setByCashier),
        get('/reports/open-shifts', setOpenShifts), get('/reports/pending-orders', setPendingOrders),
        get('/reports/sales-channel', setChannel), get('/reports/gross-profit', setGrossProfit),
        get('/reports/dead-stock', setDeadStock), get('/reports/vendor-summary', setVendorSummary),
        get(`/reports/attendance?month=${new Date().toISOString().slice(0, 7)}`, setAttendanceReport),
      ]);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const handleLogout = () => { localStorage.clear(); navigate('/login'); };

  // ⭐️ F2 — ADMIN อนุมัติปิดกะที่รออนุมัติ (ส่วนต่างเกิน 100 บาท)
  const handleApproveShift = async (shiftId: number) => {
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
      await api.post(`/shifts/${shiftId}/approve-close`, { admin_approval_notes: notes });
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'อนุมัติปิดกะสำเร็จ', showConfirmButton: false, timer: 2500 });
      setDetailModal(null);
      fetchDashboardData();
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) });
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash <= 0) return Swal.fire({ icon: 'warning', title: 'กรุณานับเงินสดในลิ้นชักก่อน' });
    if (!closePhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ' });
    setCloseLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', closePhoto);
      const uploadRes = await api.post('/attendance/upload-photo?type=clock-out', fd);
      const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: actualCash, note: closeNote || undefined, discrepancy_category: discrepancyCategory || undefined, cash_breakdown: denomCounts, close_photo: uploadRes.data.photo_url }); // ⭐️ D3
      // ⭐️ F2 — status 202 = ส่วนต่างเกิน 100 บาท กะยังไม่ปิดจริง ต้องรอ ADMIN คนอื่นอนุมัติก่อน
      if (response.status === 202) {
        setShowCloseModal(false);
        await Swal.fire({
          icon: 'warning',
          title: 'ส่วนต่างเงินสดเกิน 100 บาท',
          text: `${response.data.message || 'กะนี้ต้องรอ ADMIN อนุมัติก่อนถึงจะปิดกะสำเร็จ'} กรุณาออกจากระบบ`,
          confirmButtonColor: BRAND,
          confirmButtonText: 'ออกจากระบบ',
          allowOutsideClick: false,
        });
        handleLogout();
        return;
      }
      setShiftSummary(response.data.summary);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setCloseLoading(false); }
  };

  const checkOutFileRef = useRef<HTMLInputElement>(null);
  const handleAdminCheckOut = () => { checkOutFileRef.current?.click(); };
  const handleCheckOutPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    const confirm = await Swal.fire({ title: 'ลงชื่อออกงาน?', icon: 'question', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af', confirmButtonText: 'ลงชื่อออกงาน', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    setCheckOutLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', file);
      const uploadRes = await api.post('/attendance/upload-photo', fd);
      await api.put('/attendance/check-out', { check_out_photo: uploadRes.data.photo_url });
      Swal.fire({ icon: 'success', title: 'ลงชื่อออกงานสำเร็จ', showConfirmButton: false, timer: 1500 });
      setTimeout(() => { localStorage.clear(); navigate('/login'); }, 1500);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setCheckOutLoading(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="h-20 bg-brand-border/40 rounded-2xl animate-pulse" />
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
  const card = "bg-white border border-brand-border rounded-2xl shadow-sm";

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 pb-24">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gradient-to-r from-brand to-brand-dark rounded-2xl shadow-md p-4 mb-5 gap-3">
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
          <button onClick={() => navigate('/pos')} className="flex items-center gap-1.5 text-white hover:bg-white/25 bg-white/15 border border-white/20 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <ArrowLeft size={14} /> กลับไปหน้า POS
          </button>
          <span className="text-xs text-white/90 font-medium hidden sm:block">{user.full_name}</span>
          {isAdmin ? (
            <>
              <button onClick={handleAdminCheckOut} disabled={checkOutLoading} className="flex items-center gap-1.5 bg-white text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <LogOut size={14} /> {checkOutLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อออกงาน'}
              </button>
              <input type="file" accept="image/*" capture="environment" ref={checkOutFileRef} onChange={handleCheckOutPhotoSelected} className="hidden" />
            </>
          ) : (
            <button onClick={() => setShowCloseModal(true)} className="flex items-center gap-1.5 bg-white text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <LogOut size={14} /> ปิดกะการขาย
            </button>
          )}
        </div>
      </div>

      {/* ⭐️ Sprint 2 — D1: Pending Shift Closes Widget (for ADMIN) */}
      {isAdmin && (
        <div className="max-w-7xl mx-auto mb-5">
          <PendingShiftClosesWidget />
        </div>
      )}

      <StatCards summary={summary} topProducts={topProducts} />

      {/* ── Admin sections ────────────────────────────────────────────────── */}
      {isAdmin && (
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
                <h3 className="text-xs font-semibold text-gray-700 mb-4">ยอดขายรายชั่วโมง (วันนี้)</h3>
                {(() => {
                  const max = Math.max(1, ...hourly.map(h => Number(h.total)));
                  const active = hourly.filter(h => Number(h.total) > 0);
                  if (active.length === 0) return <p className="text-center text-sm text-gray-400 py-8">ยังไม่มียอดขาย</p>;
                  return (
                    <div className="flex items-end gap-1 h-32">
                      {hourly.map(h => (
                        <div key={h.hour} className="flex-1 flex flex-col items-center justify-end group">
                          <div className="w-full bg-brand-mid hover:bg-brand rounded-t transition-all duration-150 relative" style={{ height: `${(Number(h.total) / max) * 100}%` }}>
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 whitespace-nowrap bg-white border border-brand-border px-1 rounded">฿{Number(h.total).toLocaleString()}</span>
                          </div>
                          <span className="text-[8px] text-gray-400 mt-1">{h.hour}</span>
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

      {showCloseModal && (
        <CloseShiftModal
          denomCounts={denomCounts}
          onDenomChange={(d, value) => setDenomCounts({ ...denomCounts, [d]: value })}
          discrepancyCategory={discrepancyCategory}
          onDiscrepancyCategoryChange={setDiscrepancyCategory}
          closeNote={closeNote}
          onCloseNoteChange={setCloseNote}
          closePhotoPreview={closePhotoPreview}
          onPhotoSelected={(file) => { setClosePhoto(file); setClosePhotoPreview(URL.createObjectURL(file)); }}
          closeLoading={closeLoading}
          actualCash={actualCash}
          shiftSummary={shiftSummary}
          onSubmit={handleCloseShift}
          onClose={() => setShowCloseModal(false)}
          onLogout={handleLogout}
        />
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
  );
}
