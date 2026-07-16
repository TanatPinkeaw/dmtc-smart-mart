// ✅ CHANGED: colors → DMTC Mart theme (#F12B6B primary)
// 🔒 UNCHANGED: all handlers (handleCloseShift, handleAdminCheckOut, handleCheckOutPhotoSelected, handleLogout, fetchDashboardData), socket listeners, all state, Section component logic

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Receipt, Banknote, CreditCard, LogOut, Package, ArrowLeft, AlertTriangle, XCircle, Users, Clock, PiggyBank, PackageX, Store, ShoppingBag, Camera, X, ChevronDown } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [voidSummary, setVoidSummary] = useState<any>(null);
  const [shiftAnomalies, setShiftAnomalies] = useState<any[]>([]);
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
  const [closeLoading, setCloseLoading] = useState(false);
  const [closePhoto, setClosePhoto] = useState<File | null>(null);
  const [closePhotoPreview, setClosePhotoPreview] = useState<string | null>(null);
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [checkOutLoading, setCheckOutLoading] = useState(false);
  const actualCash = DENOMINATIONS.reduce((sum, d) => sum + d * (Number(denomCounts[d]) || 0), 0);
  const socket = useSocket();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'ADMIN';

  useEffect(() => {
    const token = localStorage.getItem('token');
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
        get('/reports/hourly-sales', setHourly), get('/reports/sales-by-cashier', setByCashier),
        get('/reports/open-shifts', setOpenShifts), get('/reports/pending-orders', setPendingOrders),
        get('/reports/sales-channel', setChannel), get('/reports/gross-profit', setGrossProfit),
        get('/reports/dead-stock', setDeadStock), get('/reports/vendor-summary', setVendorSummary),
        get(`/reports/attendance?month=${new Date().toISOString().slice(0, 7)}`, setAttendanceReport),
      ]);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const handleLogout = () => { localStorage.clear(); navigate('/login'); };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash <= 0) return Swal.fire({ icon: 'warning', title: 'กรุณานับเงินสดในลิ้นชักก่อน' });
    if (!closePhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ' });
    setCloseLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', closePhoto);
      const uploadRes = await api.post('/attendance/upload-photo', fd);
      const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: actualCash, note: closeNote || undefined, cash_breakdown: denomCounts, close_photo: uploadRes.data.photo_url });
      setShiftSummary(response.data.summary);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setCloseLoading(false); }
  };

  const checkOutFileRef = useRef<HTMLInputElement>(null);
  const handleAdminCheckOut = () => { checkOutFileRef.current?.click(); };
  const handleCheckOutPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    const confirm = await Swal.fire({ title: 'ลงชื่อออกงาน?', icon: 'question', showCancelButton: true, confirmButtonColor: '#F12B6B', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลงชื่อออกงาน', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    setCheckOutLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', file);
      const uploadRes = await api.post('/attendance/upload-photo', fd);
      await api.put('/attendance/check-out', { check_out_photo: uploadRes.data.photo_url });
      Swal.fire({ icon: 'success', title: 'ลงชื่อออกงานสำเร็จ', showConfirmButton: false, timer: 1500 });
      setTimeout(() => { localStorage.clear(); navigate('/login'); }, 1500);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setCheckOutLoading(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-[#F12B6B] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-gray-400">กำลังโหลดข้อมูล...</p>
      </div>
    </div>
  );

  // ── shared card class ────────────────────────────────────────────────────
  const card = "bg-white border border-[#F6C7C7] rounded-2xl shadow-sm";
  const inputCls = "w-full px-3 py-2 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150";

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 pb-24">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-[#F6C7C7] rounded-2xl shadow-sm p-4 mb-5 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl flex items-center justify-center">
            <LayoutDashboard size={16} className="text-[#F12B6B]" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">สรุปยอดขายประจำวัน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => navigate('/pos')} className="flex items-center gap-1.5 text-gray-500 hover:text-[#F12B6B] bg-[#FFF5F7] border border-[#F6C7C7] px-3 py-1.5 rounded-xl text-xs font-medium transition-colors duration-150">
            <ArrowLeft size={14} /> กลับไปหน้า POS
          </button>
          <span className="text-xs text-gray-500 font-medium hidden sm:block">{user.full_name}</span>
          {isAdmin ? (
            <>
              <button onClick={handleAdminCheckOut} disabled={checkOutLoading} className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50">
                <LogOut size={14} /> {checkOutLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อออกงาน'}
              </button>
              <input type="file" accept="image/*" capture="environment" ref={checkOutFileRef} onChange={handleCheckOutPhotoSelected} className="hidden" />
            </>
          ) : (
            <button onClick={() => setShowCloseModal(true)} className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95">
              <LogOut size={14} /> ปิดกะการขาย
            </button>
          )}
        </div>
      </div>

      {/* ── Stat cards + Top products ─────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Total sales */}
          <div className="bg-[#F12B6B] rounded-2xl p-5 text-white shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <p className="text-pink-100 text-xs font-medium">ยอดขายรวมวันนี้</p>
              <div className="bg-white/20 p-2 rounded-xl"><TrendingUp size={18} className="text-white" /></div>
            </div>
            <p className="text-3xl font-bold">฿{Number(summary?.total_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-pink-200 mt-2">* ข้อมูลรีเซ็ตทุกเที่ยงคืน</p>
          </div>

          {/* Bills */}
          <div className={`${card} p-5`}>
            <div className="flex justify-between items-start mb-3">
              <p className="text-xs font-medium text-gray-500">จำนวนบิลทั้งหมด</p>
              <div className="bg-emerald-50 p-2 rounded-xl"><Receipt size={18} className="text-emerald-500" /></div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{summary?.total_bills || 0} <span className="text-base text-gray-400 font-normal">บิล</span></p>
          </div>

          {/* Cash */}
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-3"><Banknote size={16} className="text-emerald-500" /> ยอดรับเงินสด</div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xl font-bold text-gray-900">฿{Number(summary?.cash_sales || 0).toLocaleString()}</p>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: summary?.total_sales ? `${(summary.cash_sales / summary.total_sales) * 100}%` : '0%' }} />
            </div>
          </div>

          {/* QR */}
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-3"><CreditCard size={16} className="text-purple-500" /> ยอดรับโอน (QR)</div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xl font-bold text-gray-900">฿{Number(summary?.qr_sales || 0).toLocaleString()}</p>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-purple-400 rounded-full transition-all duration-500" style={{ width: summary?.total_sales ? `${(summary.qr_sales / summary.total_sales) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>

        {/* Top products */}
        <div className={`${card} p-4 flex flex-col`}>
          <div className="flex items-center gap-2 mb-4">
            <Package size={18} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-gray-900">10 อันดับสินค้าขายดี</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[240px]">
            {topProducts.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ยังไม่มีข้อมูลวันนี้</p> :
              topProducts.map((p, i) => (
                <div key={p.product_id} className="flex items-center justify-between px-2 py-2 hover:bg-[#FFF5F7] rounded-xl transition-colors duration-150">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-[#FFF5F7] text-[#F12B6B]'}`}>{i + 1}</span>
                    <div>
                      <p className="text-xs font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                      <p className="text-[10px] text-gray-400">ขาย {p.total_quantity} ชิ้น</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#F12B6B] shrink-0">฿{Number(p.total_revenue).toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Admin sections ────────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          {/* Alert cards */}
          <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {[
              { type: 'lowstock', title: 'สต๊อกใกล้หมด', value: `${lowStock.length} รายการ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-orange-200 hover:border-orange-400', icon: <AlertTriangle size={16} />, color: 'text-orange-500' },
              { type: 'void', title: 'บิลยกเลิกวันนี้', value: `${voidSummary?.void_count || 0} บิล`, sub: `฿${Number(voidSummary?.void_amount || 0).toLocaleString()}`, border: 'border-red-200 hover:border-red-400', icon: <XCircle size={16} />, color: 'text-red-500' },
              { type: 'anomalies', title: 'กะเงินสดผิดปกติ', value: `${shiftAnomalies.length} กะ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-purple-200 hover:border-purple-400', icon: <AlertTriangle size={16} />, color: 'text-purple-500' },
              { type: 'openshifts', title: 'กะเปิดค้างอยู่', value: `${openShifts.length} กะ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-blue-200 hover:border-blue-400', icon: <Clock size={16} />, color: 'text-blue-500' },
            ].map(a => (
              <div key={a.type} onClick={() => setDetailModal({ type: a.type, title: a.title })} className={`bg-white border ${a.border} rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-150 active:scale-95`}>
                <div className={`flex items-center gap-1.5 ${a.color} mb-2`}>{a.icon}<span className="text-xs font-semibold">{a.title}</span></div>
                <p className="text-lg font-bold text-gray-900">{a.value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{a.sub}</p>
              </div>
            ))}
          </div>

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
                <div className="flex items-center gap-2 mb-3"><ShoppingBag size={16} className="text-[#F12B6B]" /><h3 className="text-xs font-semibold text-gray-700">ช่องทางขายวันนี้</h3></div>
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
                          <div className="w-full bg-[#FD94B4] hover:bg-[#F12B6B] rounded-t transition-all duration-150 relative" style={{ height: `${(Number(h.total) / max) * 100}%` }}>
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 whitespace-nowrap bg-white border border-[#F6C7C7] px-1 rounded">฿{Number(h.total).toLocaleString()}</span>
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
          <Section title="รายละเอียดพนักงาน สินค้า และบุคคล" icon={<Users size={16} className="text-[#F12B6B]" />} open={openDetails} onToggle={() => setOpenDetails(!openDetails)}>
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Cashier */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><Users size={16} className="text-[#F12B6B]" /><h3 className="text-xs font-semibold text-gray-700">ยอดขายต่อพนักงานต่อกะ (วันนี้)</h3></div>
                <div className="space-y-2">
                  {byCashier.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ยังไม่มีข้อมูล</p> :
                    byCashier.map(c => (
                      <div key={c.shift_id} className="flex justify-between items-center px-2 py-2 hover:bg-[#FFF5F7] rounded-xl transition-colors duration-150">
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{c.cashier_name}</p>
                          <p className="text-[10px] text-gray-400">{c.bill_count} บิล • {new Date(c.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}{c.shift_status === 'OPEN' ? ' (ยังไม่ปิดกะ)' : ''}</p>
                        </div>
                        <span className="text-xs font-bold text-[#F12B6B]">฿{Number(c.total_sales).toLocaleString()}</span>
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
                      <div key={v.vendor_id} className="flex justify-between items-center px-2 py-2 hover:bg-[#FFF5F7] rounded-xl transition-colors duration-150">
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{v.vendor_name}</p>
                          <p className="text-[10px] text-gray-400">ขาย {v.total_items_sold} ชิ้น • GP ฿{Number(v.coop_gp_earnings).toLocaleString()}</p>
                        </div>
                        <span className="text-xs font-bold text-[#F12B6B]">฿{Number(v.vendor_earnings).toLocaleString()}</span>
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
                      <div key={o.status} className="flex justify-between items-center px-2 py-2 hover:bg-[#FFF5F7] rounded-xl text-xs transition-colors duration-150">
                        <span className="font-medium text-gray-700">{o.status}</span>
                        <span className="text-gray-500">{o.count} บิล • ฿{Number(o.total).toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Dead stock */}
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 mb-3"><PackageX size={16} className="text-gray-400" /><h3 className="text-xs font-semibold text-gray-700">สินค้าขายไม่ออก (30 วัน)</h3></div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {deadStock.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">ไม่มีสินค้าค้างสต๊อก</p> :
                    deadStock.map(p => (
                      <div key={p.id} className="flex justify-between items-center px-2 py-2 hover:bg-[#FFF5F7] rounded-xl text-xs transition-colors duration-150">
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
                <div className="flex items-center gap-2 mb-3"><Clock size={16} className="text-purple-500" /><h3 className="text-xs font-semibold text-gray-700">สรุปการมาสายเดือนนี้</h3></div>
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
                        <div key={s.name} className="flex justify-between items-center px-2 py-2 hover:bg-[#FFF5F7] rounded-xl text-xs transition-colors duration-150">
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

      {/* ── Close Shift Modal ─────────────────────────────────────────────── */}
      {showCloseModal && (
        <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-md overflow-hidden">
            {!shiftSummary ? (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-[#FFF5F7]">
                  <h3 className="text-sm font-semibold text-gray-900">ปิดกะการขาย</h3>
                  <button onClick={() => setShowCloseModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors duration-150"><X size={18} /></button>
                </div>
                <div className="p-5 max-h-[75vh] overflow-y-auto">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-700">
                    <p className="font-semibold mb-1">📋 วิธีนับเงินปิดกะ</p>
                    <p>• เงินสด: นับแบงก์/เหรียญในลิ้นชักแล้วใส่ด้านล่าง</p>
                    <p>• โอน/QR: ระบบนับจากบิลให้อัตโนมัติ ไม่ต้องนับเอง</p>
                  </div>
                  <form onSubmit={handleCloseShift} className="space-y-4">
                    {/* Denom grid */}
                    <div className="grid grid-cols-2 gap-2">
                      {DENOMINATIONS.map(d => (
                        <div key={d} className="flex items-center gap-2 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl px-3 py-2">
                          <span className="text-xs font-semibold text-gray-600 w-10 shrink-0">฿{d}</span>
                          <input type="number" min="0" value={denomCounts[d] ?? ''} onChange={e => setDenomCounts({ ...denomCounts, [d]: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="0" className="w-full text-center bg-transparent text-sm outline-none" />
                        </div>
                      ))}
                    </div>
                    <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-3 text-center">
                      <p className="text-[10px] text-gray-400 mb-1">เงินสดที่นับได้จริง</p>
                      <p className="text-2xl font-bold text-[#F12B6B]">฿{actualCash.toLocaleString()}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">หมายเหตุ (ถ้าส่วนต่างเกิน ±20 บาท ระบบบังคับให้กรอก)</label>
                      <input type="text" value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder="เช่น ทอนผิดตอนเช้า" className={inputCls} />
                    </div>
                    {/* Photo */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Camera size={12} /> ถ่ายรูปยืนยันสถานที่ <span className="text-red-400">*</span></p>
                      <label className="block cursor-pointer">
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setClosePhoto(f); setClosePhotoPreview(URL.createObjectURL(f)); } }} />
                        {closePhotoPreview
                          ? <img src={closePhotoPreview} alt="preview" className="w-full h-28 object-cover rounded-xl border border-[#F6C7C7]" />
                          : <div className="w-full h-28 rounded-xl border-2 border-dashed border-[#F6C7C7] flex flex-col items-center justify-center gap-2 text-[#FD94B4] hover:bg-[#FFF5F7] transition-colors duration-150"><Camera size={24} /><span className="text-xs font-medium">แตะเพื่อถ่ายรูป</span></div>
                        }
                      </label>
                    </div>
                    <button type="submit" disabled={closeLoading} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
                      {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="p-6 text-center">
                <h3 className="text-lg font-bold text-gray-900 mb-1">สรุปยอดการขาย</h3>
                <p className="text-xs text-gray-400 mb-4">ปิดกะสำเร็จ บันทึกเรียบร้อยแล้ว</p>
                <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-4 text-left space-y-2 mb-5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">จำนวนบิล</span><span className="font-semibold">{Number(shiftSummary.bill_count || 0)} บิล</span></div>
                  <div className="flex justify-between font-bold border-t border-[#F6C7C7] pt-2"><span className="text-gray-800">ยอดรวมทั้งหมด</span><span className="text-[#F12B6B]">฿{Number(shiftSummary.total_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs pl-2"><span className="text-gray-400">• เงินสด</span><span>฿{Number(shiftSummary.cash_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs pl-2"><span className="text-gray-400">• โอน/QR</span><span>฿{Number(shiftSummary.qr_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-[#F6C7C7] pt-2"><span className="font-bold text-gray-800">เงินสดที่ควรมี</span><span className="font-bold text-[#F12B6B]">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="font-bold text-gray-800">นับได้จริง</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-[#F6C7C7] pt-2">
                    <span className="font-bold text-gray-800">ส่วนต่าง</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-emerald-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)} {Number(shiftSummary.difference) === 0 && '✅'}
                    </span>
                  </div>
                </div>
                <button onClick={handleLogout} className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold rounded-xl transition-all duration-150 active:scale-95">ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────────── */}
      {detailModal && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-4 py-3 border-b border-[#F6C7C7]">
              <h3 className="text-sm font-semibold text-gray-900">{detailModal.title}</h3>
              <button onClick={() => setDetailModal(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-[#FFF5F7] transition-colors duration-150"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-4 space-y-2">
              {detailModal.type === 'lowstock' && (lowStock.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีสินค้าสต๊อกใกล้หมด</p> :
                lowStock.map((p: any) => (
                  <div key={p.id} className="flex justify-between items-center p-3 bg-orange-50 border border-orange-100 rounded-xl">
                    <div><p className="text-sm font-semibold text-gray-900">{p.name}</p><p className="text-xs text-gray-400">{p.barcode || '-'}</p></div>
                    <span className={`font-bold text-lg ${p.stock === 0 ? 'text-red-600' : 'text-orange-500'}`}>{p.stock} <span className="text-xs font-normal text-gray-400">ชิ้น</span></span>
                  </div>
                )))}
              {detailModal.type === 'void' && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-5 text-center">
                  <p className="text-3xl font-bold text-red-600 mb-1">{voidSummary?.void_count || 0} บิล</p>
                  <p className="text-sm text-gray-600">มูลค่ารวม <span className="font-bold text-red-500">฿{Number(voidSummary?.void_amount || 0).toLocaleString()}</span></p>
                  <p className="text-xs text-gray-400 mt-2">ดูรายการได้ที่หน้า "ประวัติการขาย" ในตั้งค่า</p>
                </div>
              )}
              {detailModal.type === 'anomalies' && (shiftAnomalies.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีกะที่ผิดปกติ</p> :
                shiftAnomalies.map((s: any) => (
                  <div key={s.id} className="flex justify-between items-center p-3 bg-purple-50 border border-purple-100 rounded-xl">
                    <div><p className="text-sm font-semibold text-gray-900">{s.cashier_name}</p><p className="text-xs text-gray-400">{new Date(s.closed_at).toLocaleString('th-TH')}</p></div>
                    <span className={`font-bold text-lg ${Number(s.difference) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{Number(s.difference) > 0 ? '+' : ''}{Number(s.difference).toFixed(2)}</span>
                  </div>
                )))}
              {detailModal.type === 'openshifts' && (openShifts.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีกะที่ค้างอยู่</p> :
                openShifts.map((s: any) => (
                  <div key={s.id} className="flex justify-between items-center p-3 bg-blue-50 border border-blue-100 rounded-xl">
                    <div><p className="text-sm font-semibold text-gray-900">{s.cashier_name}</p><p className="text-xs text-gray-400">เปิดกะ {new Date(s.opened_at).toLocaleString('th-TH')}</p></div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-lg">เปิดอยู่</span>
                  </div>
                )))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, open, onToggle, children }: { title: string; icon: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto mt-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between bg-white border border-[#F6C7C7] rounded-2xl shadow-sm p-3.5 mb-3 hover:bg-[#FFF5F7] transition-colors duration-150">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">{icon} {title}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  );
}
