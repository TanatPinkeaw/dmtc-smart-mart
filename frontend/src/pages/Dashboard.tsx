import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Receipt, Banknote, CreditCard, LogOut, Package, ArrowLeft, AlertTriangle, XCircle, Users, Clock, PiggyBank, PackageX, Store, ShoppingBag } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext'; // 👈 นำเข้า Socket

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ⭐️ หมวด 5: state การ์ด/กราฟใหม่
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
  const [attendanceReport, setAttendanceReport] = useState<any[]>([]); // ⭐️ หมวด C: สรุปมาสายเดือนนี้

  // ⭐️ จัดกลุ่มการ์ดตามความสำคัญ + พับเก็บได้ (มือถือ/แท็บเล็ตดูง่ายขึ้น)
  const [openInsights, setOpenInsights] = useState(true);
  const [openDetails, setOpenDetails] = useState(false);
  const [detailModal, setDetailModal] = useState<{ type: string; title: string } | null>(null);

  // ⭐️ หมวด 11: ปิดกะ (CASHIER) / ลงชื่อออกงาน (ADMIN) — ย้ายมาอยู่หน้านี้แทน Layout.tsx
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
    // ⭐️ พนักงานที่ล็อกอินมาโหมด "ซื้อของ" ไม่ควรเข้าหน้า Dashboard (กันพิมพ์ URL ตรงเข้ามา)
    if (localStorage.getItem('session_mode') === 'shop') { navigate('/pre-order'); return; }
    fetchDashboardData();

    if (!socket) return;

    // ⭐️ เวลามีบิลใหม่ หรือบิลโดนยกเลิก ให้โหลดกราฟและยอดขายใหม่ทันที!
    socket.on('dashboard_updated', () => {
      fetchDashboardData();
    });

    return () => {
      socket.off('dashboard_updated');
    };
  }, [navigate, socket]);

  const fetchDashboardData = async () => {
    try {
      const [dashRes, topRes] = await Promise.all([ api.get('/reports/dashboard'), api.get('/reports/top-selling') ]);
      setSummary(dashRes.data.summary);
      setTopProducts(topRes.data);

      // ⭐️ การ์ดวิเคราะห์เชิงลึกทั้งหมดเป็นของ ADMIN เท่านั้น (backend เป็น requireRole('ADMIN') อยู่แล้ว)
      // CASHIER เห็นแค่สรุปยอดขาย/สินค้าขายดีด้านบน กับปุ่มปิดกะด้านล่าง ไม่ยิง fetch ที่รู้อยู่แล้วว่าโดน 403
      if (!isAdmin) { setLoading(false); return; }

      // ⭐️ หมวด 5: ดึงรายงานเพิ่มเติมแบบทนต่อ error ทีละอัน (อันไหนพังไม่ทำให้ทั้งหน้าล่ม)
      const get = (url: string, setter: (d: any) => void) => api.get(url).then(r => setter(r.data)).catch(() => {});
      await Promise.all([
        get('/inventory/low-stock', setLowStock),
        get('/reports/void-summary', setVoidSummary),
        get('/reports/shift-anomalies', setShiftAnomalies),
        get('/reports/sales-comparison', setComparison),
        get('/reports/hourly-sales', setHourly),
        get('/reports/sales-by-cashier', setByCashier),
        get('/reports/open-shifts', setOpenShifts),
        get('/reports/pending-orders', setPendingOrders),
        get('/reports/sales-channel', setChannel),
        get('/reports/gross-profit', setGrossProfit),
        get('/reports/dead-stock', setDeadStock),
        get('/reports/vendor-summary', setVendorSummary),
        get(`/reports/attendance?month=${new Date().toISOString().slice(0, 7)}`, setAttendanceReport),
      ]);
    } catch (error) { console.error("Error fetching dashboard data:", error); } 
    finally { setLoading(false); }
  };

  const handleLogout = () => { localStorage.clear(); navigate('/login'); };

  // ⭐️ ปิดกะ (CASHIER) — ย้ายมาจาก Layout.tsx
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash <= 0) return Swal.fire({ icon: 'warning', title: 'กรุณานับเงินสดในลิ้นชักก่อน' });
    if (!closePhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ' });
    setCloseLoading(true);
    try {
      const formData = new FormData();
      formData.append('photo', closePhoto);
      const uploadRes = await api.post('/attendance/upload-photo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: actualCash, note: closeNote || undefined, cash_breakdown: denomCounts, close_photo: uploadRes.data.photo_url });
      setShiftSummary(response.data.summary);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); } finally { setCloseLoading(false); }
  };

  // ⭐️ ลงชื่อออกงาน (ADMIN) — คู่กับ check-in ที่ Shift.tsx, ต้องถ่ายรูปยืนยันสถานที่ก่อน
  const checkOutFileRef = useRef<HTMLInputElement>(null);
  const handleAdminCheckOut = () => { checkOutFileRef.current?.click(); };

  const handleCheckOutPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const confirm = await Swal.fire({ title: 'ลงชื่อออกงาน?', icon: 'question', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลงชื่อออกงาน', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    setCheckOutLoading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const uploadRes = await api.post('/attendance/upload-photo', formData);
      await api.put('/attendance/check-out', { check_out_photo: uploadRes.data.photo_url });
      Swal.fire({ icon: 'success', title: 'ลงชื่อออกงานสำเร็จ กำลังออกจากระบบ...', showConfirmButton: false, timer: 1500 });
      setTimeout(() => { localStorage.clear(); navigate('/login'); }, 1500);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); } finally { setCheckOutLoading(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-pink-50 font-sans text-lg font-bold text-gray-500">กำลังโหลดข้อมูล...</div>;

  return (
    // ปรับ Padding ในมือถือให้เล็กลง (p-4 md:p-6)
    <div className="min-h-screen bg-pink-50 font-sans p-4 md:p-6">
      
      {/* Header (เรียงเป็นแนวตั้งในมือถือ, แนวนอนในคอม) */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-2xl shadow-sm mb-6 gap-4">
        <div className="flex items-center gap-2 md:gap-3 text-pink-600">
          <LayoutDashboard size={24} className="md:w-7 md:h-7" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">สรุปยอดขายประจำวัน</h1>
        </div>
        
        {/* แผงปุ่มด้านขวา */}
        <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full md:w-auto justify-between md:justify-end">
          <button onClick={() => navigate('/pos')} className="flex items-center gap-1 md:gap-2 text-gray-600 hover:text-pink-600 font-medium bg-pink-50 hover:bg-pink-50 px-3 py-2 rounded-xl transition text-sm md:text-base">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">กลับไปหน้า POS</span><span className="sm:hidden">ไป POS</span>
          </button>
          
          <div className="hidden md:block border-l h-8 border-pink-200 mx-2"></div>

          <span className="font-medium text-gray-600 text-sm md:text-base truncate max-w-[120px] sm:max-w-none">{user.full_name}</span>

          <div className="hidden md:block border-l h-8 border-pink-200 mx-2"></div>

          {isAdmin ? (
            <>
              <button onClick={handleAdminCheckOut} disabled={checkOutLoading} className="flex items-center justify-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 font-bold px-4 py-2 rounded-xl transition text-sm md:text-base">
                <LogOut size={16} /> {checkOutLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อออกงาน'}
              </button>
              <input type="file" accept="image/*" capture="environment" ref={checkOutFileRef} onChange={handleCheckOutPhotoSelected} className="hidden" />
            </>
          ) : (
            <button onClick={() => setShowCloseModal(true)} className="flex items-center justify-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 font-bold px-4 py-2 rounded-xl transition text-sm md:text-base">
              <LogOut size={16} /> ปิดกะการขาย
            </button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* ================= ซ้าย: Card สรุปยอดขาย ================= */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            
            {/* Card ยอดขายรวม */}
            <div className="bg-pink-600 p-5 md:p-6 rounded-2xl shadow-sm text-white">
              <div className="flex justify-between items-start mb-2 md:mb-4">
                <div>
                  <p className="text-pink-100 font-medium mb-1 text-sm md:text-base">ยอดขายรวมวันนี้</p>
                  {/* ลดขนาด Font ในมือถือ (text-3xl) */}
                  <h2 className="text-3xl md:text-4xl font-bold">฿{Number(summary?.total_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
                </div>
                <div className="bg-white/20 p-2 md:p-3 rounded-2xl">
                  <TrendingUp size={24} className="md:w-7 md:h-7" />
                </div>
              </div>
              <p className="text-xs text-pink-100 opacity-80">* ข้อมูลรีเซ็ตทุกเที่ยงคืน</p>
            </div>

            {/* Card จำนวนบิล */}
            <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-gray-500 font-medium mb-1 text-sm md:text-base">จำนวนบิลทั้งหมด</p>
                  <h2 className="text-3xl md:text-4xl font-bold text-gray-800">{summary?.total_bills || 0} <span className="text-sm md:text-lg text-gray-400 font-normal">บิล</span></h2>
                </div>
                <div className="bg-green-100 text-green-600 p-2 md:p-3 rounded-2xl">
                  <Receipt size={24} className="md:w-7 md:h-7" />
                </div>
              </div>
            </div>

            {/* Card เงินสด */}
            <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-gray-500 font-medium text-sm md:text-base">
                  <Banknote size={18} className="text-emerald-500 md:w-5 md:h-5" /> ยอดรับเงินสด
                </div>
                <span className="font-bold text-gray-800 text-lg md:text-xl">฿{Number(summary?.cash_sales || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-pink-100 rounded-full h-2 mt-3 md:mt-4">
                <div className="bg-emerald-400 h-2 rounded-full" style={{ width: summary?.total_sales ? `${(summary.cash_sales / summary.total_sales) * 100}%` : '0%' }}></div>
              </div>
            </div>

            {/* Card เงินโอน */}
            <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-gray-500 font-medium text-sm md:text-base">
                  <CreditCard size={18} className="text-fuchsia-500 md:w-5 md:h-5" /> ยอดรับเงินโอน (QR)
                </div>
                <span className="font-bold text-gray-800 text-lg md:text-xl">฿{Number(summary?.qr_sales || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-pink-100 rounded-full h-2 mt-3 md:mt-4">
                <div className="bg-fuchsia-400 h-2 rounded-full" style={{ width: summary?.total_sales ? `${(summary.qr_sales / summary.total_sales) * 100}%` : '0%' }}></div>
              </div>
            </div>

          </div>
        </div>

        {/* ================= ขวา: สินค้าขายดี Top 10 ================= */}
        <div className="bg-white rounded-2xl shadow-sm border border-pink-100 p-5 md:p-6 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4 md:mb-6">
            <Package className="text-orange-500 w-5 h-5 md:w-6 md:h-6" />
            <h2 className="text-lg md:text-xl font-bold text-gray-800">10 อันดับสินค้าขายดี</h2>
          </div>
          
          {/* กำหนดความสูงต่ำสุดในมือถือ เพื่อให้เลื่อนได้ง่าย */}
          <div className="flex-1 overflow-y-auto pr-1 md:pr-2 space-y-3 min-h-[300px]">
            {topProducts.length === 0 ? (
              <p className="text-center text-gray-400 mt-10 text-sm">ยังไม่มีข้อมูลการขายในวันนี้</p>
            ) : (
              topProducts.map((product, index) => (
                <div key={product.product_id} className="flex items-center justify-between p-2 md:p-3 hover:bg-pink-50 rounded-xl transition">
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0 ? 'bg-yellow-100 text-yellow-600' :
                      index === 1 ? 'bg-gray-200 text-gray-600' :
                      index === 2 ? 'bg-orange-100 text-orange-600' : 'bg-pink-50 text-pink-600'
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{product.name}</p>
                      <p className="text-xs md:text-sm text-gray-500">ขายแล้ว {product.total_quantity} ชิ้น</p>
                    </div>
                  </div>
                  <div className="font-bold text-pink-600 text-sm md:text-base">
                    ฿{Number(product.total_revenue).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {isAdmin && (
      <>
      {/* ⭐️ ระดับ 1 (สำคัญสุด เห็นตลอด): แจ้งเตือนที่ต้องรู้ทันที */}
      <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mt-6">
        <div onClick={() => setDetailModal({ type: 'lowstock', title: 'สต๊อกใกล้หมด' })} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-orange-100 cursor-pointer hover:shadow-md hover:border-orange-300 transition active:scale-95">
          <div className="flex items-center gap-2 text-orange-500 mb-2"><AlertTriangle size={18} /><span className="font-bold text-xs md:text-sm">สต๊อกใกล้หมด</span></div>
          <p className="text-2xl md:text-3xl font-bold text-gray-800">{lowStock.length} <span className="text-xs md:text-sm text-gray-400 font-normal">รายการ</span></p>
          <p className="text-[10px] text-orange-400 mt-1">แตะเพื่อดูรายละเอียด</p>
        </div>
        <div onClick={() => setDetailModal({ type: 'void', title: 'บิลยกเลิกวันนี้' })} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-red-100 cursor-pointer hover:shadow-md hover:border-red-300 transition active:scale-95">
          <div className="flex items-center gap-2 text-red-500 mb-2"><XCircle size={18} /><span className="font-bold text-xs md:text-sm">บิลยกเลิกวันนี้</span></div>
          <p className="text-2xl md:text-3xl font-bold text-gray-800">{voidSummary?.void_count || 0} <span className="text-xs md:text-sm text-gray-400 font-normal">บิล</span></p>
          <p className="text-[10px] text-red-400 mt-1">มูลค่า ฿{Number(voidSummary?.void_amount || 0).toLocaleString()} • แตะดูรายละเอียด</p>
        </div>
        <div onClick={() => setDetailModal({ type: 'anomalies', title: 'กะเงินสดผิดปกติ' })} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-fuchsia-100 cursor-pointer hover:shadow-md hover:border-fuchsia-300 transition active:scale-95">
          <div className="flex items-center gap-2 text-fuchsia-500 mb-2"><AlertTriangle size={18} /><span className="font-bold text-xs md:text-sm">กะเงินสดผิดปกติ</span></div>
          <p className="text-2xl md:text-3xl font-bold text-gray-800">{shiftAnomalies.length} <span className="text-xs md:text-sm text-gray-400 font-normal">กะ</span></p>
          <p className="text-[10px] text-fuchsia-400 mt-1">แตะเพื่อดูรายละเอียด</p>
        </div>
        <div onClick={() => setDetailModal({ type: 'openshifts', title: 'กะเปิดค้างอยู่' })} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-blue-100 cursor-pointer hover:shadow-md hover:border-blue-300 transition active:scale-95">
          <div className="flex items-center gap-2 text-blue-500 mb-2"><Clock size={18} /><span className="font-bold text-xs md:text-sm">กะเปิดค้างอยู่</span></div>
          <p className="text-2xl md:text-3xl font-bold text-gray-800">{openShifts.length} <span className="text-xs md:text-sm text-gray-400 font-normal">กะ</span></p>
          <p className="text-[10px] text-blue-400 mt-1">แตะเพื่อดูรายละเอียด</p>
        </div>
      </div>

      {/* ⭐️ ระดับ 2: วิเคราะห์วันนี้ (พับเก็บได้) */}
      <Section title="วิเคราะห์ยอดขายวันนี้" icon={<TrendingUp size={20} className="text-emerald-500" />} open={openInsights} onToggle={() => setOpenInsights(!openInsights)}>
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 text-emerald-500 mb-3"><TrendingUp size={20} /><span className="font-bold text-sm text-gray-700">เทียบยอดขาย</span></div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">vs เมื่อวาน</span>
                <span className={`font-bold ${(comparison?.pct_vs_yesterday ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{comparison?.pct_vs_yesterday == null ? '—' : `${comparison.pct_vs_yesterday > 0 ? '+' : ''}${comparison.pct_vs_yesterday}%`}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">vs สัปดาห์ก่อน</span>
                <span className={`font-bold ${(comparison?.pct_vs_last_week ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{comparison?.pct_vs_last_week == null ? '—' : `${comparison.pct_vs_last_week > 0 ? '+' : ''}${comparison.pct_vs_last_week}%`}</span></div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 text-pink-500 mb-3"><ShoppingBag size={20} /><span className="font-bold text-sm text-gray-700">ช่องทางขายวันนี้</span></div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><Store size={14}/> หน้าร้าน</span><span className="font-bold text-gray-800">฿{Number(channel?.walkin_sales || 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><Package size={14}/> Pre-order</span><span className="font-bold text-gray-800">฿{Number(channel?.preorder_sales || 0).toLocaleString()}</span></div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 text-green-600 mb-3"><PiggyBank size={20} /><span className="font-bold text-sm text-gray-700">กำไรขั้นต้นวันนี้</span></div>
            <p className="text-3xl font-bold text-green-600">฿{Number(grossProfit?.gross_profit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            <p className="text-xs text-gray-400 mt-1">หัก GP สินค้าฝากขายแล้ว</p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
          <h2 className="font-bold text-gray-800 mb-4">ยอดขายรายชั่วโมง (วันนี้)</h2>
          {(() => {
            const max = Math.max(1, ...hourly.map(h => Number(h.total)));
            const active = hourly.filter(h => Number(h.total) > 0);
            if (active.length === 0) return <p className="text-center text-gray-400 text-sm py-6">ยังไม่มียอดขายวันนี้</p>;
            return (
              <div className="flex items-end gap-1 h-40">
                {hourly.map(h => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center justify-end group">
                    <div className="w-full bg-pink-400 hover:bg-pink-600 rounded-t transition relative" style={{ height: `${(Number(h.total) / max) * 100}%` }}>
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-600 opacity-0 group-hover:opacity-100 whitespace-nowrap">฿{Number(h.total).toLocaleString()}</span>
                    </div>
                    <span className="text-[8px] text-gray-400 mt-1">{h.hour}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Section>

      {/* ⭐️ ระดับ 3: รายละเอียดพนักงาน/สินค้า/บุคคล (พับเก็บ default ปิด กันรก) */}
      <Section title="รายละเอียดพนักงาน สินค้า และบุคคล" icon={<Users size={20} className="text-pink-500" />} open={openDetails} onToggle={() => setOpenDetails(!openDetails)}>
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 mb-4"><Users className="text-pink-500" size={20} /><h2 className="font-bold text-gray-800">ยอดขายต่อพนักงานต่อกะ (วันนี้)</h2></div>
            <div className="space-y-2">
              {byCashier.length === 0 ? <p className="text-center text-gray-400 text-sm py-4">ยังไม่มีข้อมูล</p> :
                byCashier.map(c => (
                  <div key={c.shift_id} className="flex justify-between items-center p-2 hover:bg-pink-50 rounded-lg">
                    <div>
                      <p className="font-bold text-sm text-gray-800">{c.cashier_name}</p>
                      <p className="text-xs text-gray-500">{c.bill_count} บิล • เปิดกะ {new Date(c.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}{c.shift_status === 'OPEN' ? ' (ยังไม่ปิดกะ)' : ''}</p>
                    </div>
                    <span className="font-bold text-pink-600">฿{Number(c.total_sales).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 mb-4"><PiggyBank className="text-orange-500" size={20} /><h2 className="font-bold text-gray-800">สินค้าฝากขาย (หัก GP แล้ว)</h2></div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {vendorSummary.length === 0 ? <p className="text-center text-gray-400 text-sm py-4">ยังไม่มีข้อมูล</p> :
                vendorSummary.map(v => (
                  <div key={v.vendor_id} className="flex justify-between items-center p-2 hover:bg-pink-50 rounded-lg">
                    <div><p className="font-bold text-sm text-gray-800">{v.vendor_name}</p><p className="text-xs text-gray-500">ขาย {v.total_items_sold} ชิ้น • GP สหกรณ์ ฿{Number(v.coop_gp_earnings).toLocaleString()}</p></div>
                    <span className="font-bold text-pink-600">฿{Number(v.vendor_earnings).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 mb-4"><Package className="text-blue-500" size={20} /><h2 className="font-bold text-gray-800">Pre-order ค้างดำเนินการ</h2></div>
            <div className="space-y-2">
              {pendingOrders.length === 0 ? <p className="text-center text-gray-400 text-sm py-4">ไม่มีออเดอร์ค้าง</p> :
                pendingOrders.map(o => (
                  <div key={o.status} className="flex justify-between items-center p-2 hover:bg-pink-50 rounded-lg text-sm">
                    <span className="font-medium text-gray-700">{o.status}</span>
                    <span className="text-gray-500">{o.count} บิล • ฿{Number(o.total).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100">
            <div className="flex items-center gap-2 mb-4"><PackageX className="text-gray-500" size={20} /><h2 className="font-bold text-gray-800">สินค้าขายไม่ออก (30 วัน)</h2></div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {deadStock.length === 0 ? <p className="text-center text-gray-400 text-sm py-4">ไม่มีสินค้าค้างสต๊อก</p> :
                deadStock.map(p => (
                  <div key={p.id} className="flex justify-between items-center p-2 hover:bg-pink-50 rounded-lg text-sm">
                    <span className="font-medium text-gray-700 line-clamp-1">{p.name}</span>
                    <span className="text-gray-500 shrink-0">เหลือ {p.stock}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-pink-100 mb-6">
          <div className="flex items-center gap-2 mb-4"><Clock className="text-fuchsia-500" size={20} /><h2 className="font-bold text-gray-800">สรุปการมาสายเดือนนี้</h2></div>
          {(() => {
            const byUser: Record<number, { name: string; lateCount: number; totalDays: number; lateMinutes: number }> = {};
            attendanceReport.forEach(r => {
              if (!byUser[r.user_id]) byUser[r.user_id] = { name: r.full_name, lateCount: 0, totalDays: 0, lateMinutes: 0 };
              byUser[r.user_id].totalDays += 1;
              if (r.late_minutes != null && r.late_minutes > 0) {
                byUser[r.user_id].lateCount += 1;
                byUser[r.user_id].lateMinutes += r.late_minutes;
              }
            });
            const summaryList = Object.values(byUser);
            if (summaryList.length === 0) return <p className="text-center text-gray-400 text-sm py-4">ยังไม่มีตารางเวลาที่ตั้งไว้เดือนนี้ (ตั้งได้ที่หน้า "ตารางเวลา")</p>;
            return (
              <div className="space-y-2">
                {summaryList.map(s => (
                  <div key={s.name} className="flex justify-between items-center p-2 hover:bg-pink-50 rounded-lg text-sm">
                    <span className="font-bold text-gray-700">{s.name}</span>
                    <span className={`font-medium ${s.lateCount > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      มาสาย {s.lateCount}/{s.totalDays} วัน {s.lateMinutes > 0 && `(รวม ${s.lateMinutes} นาที)`}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Section>
      </>
      )}

      {/* ================= MODAL ปิดกะ (CASHIER) ================= */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-end md:items-center justify-center sm:p-4 animate-fade-in">
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-lg w-full max-w-md overflow-hidden transform transition-all">
            {!shiftSummary ? (
              <>
                <div className="px-5 py-4 border-b border-pink-100 flex justify-between items-center bg-pink-50 rounded-t-2xl md:rounded-t-none shrink-0">
                  <h2 className="text-base md:text-lg font-bold text-gray-800">ปิดกะการขาย</h2>
                  <button onClick={() => setShowCloseModal(false)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition">✕</button>
                </div>
                <div className="p-6 pb-12 md:p-8 max-h-[75vh] overflow-y-auto">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-700">
                    <p className="font-bold mb-1">📋 วิธีนับเงินปิดกะ</p>
                    <p>• <strong>เงินสด</strong>: นับแบงก์/เหรียญในลิ้นชักแล้วใส่ด้านล่าง</p>
                    <p>• <strong>โอน/QR</strong>: ระบบนับจากบิลให้อัตโนมัติ ไม่ต้องนับเอง</p>
                  </div>
                  <form onSubmit={handleCloseShift}>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {DENOMINATIONS.map(d => (
                        <div key={d} className="flex items-center gap-2 bg-pink-50 rounded-xl p-2">
                          <span className="text-xs font-bold text-gray-600 w-10 shrink-0">฿{d}</span>
                          <input
                            type="number" min="0" value={denomCounts[d] ?? ''}
                            onChange={(e) => setDenomCounts({ ...denomCounts, [d]: e.target.value === '' ? '' : Number(e.target.value) })}
                            placeholder="0" className="w-full p-2 text-center border border-pink-200 rounded-lg text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="bg-red-50 rounded-xl p-4 text-center mb-4">
                      <p className="text-xs font-bold text-gray-500 mb-1">เงินสดที่นับได้จริง</p>
                      <p className="text-3xl font-bold text-red-600">฿{actualCash.toLocaleString()}</p>
                    </div>
                    <div className="mb-4">
                      <label className="block text-xs font-bold text-gray-600 mb-1">หมายเหตุ (ถ้าส่วนต่างเกิน ±20 บาท ระบบจะบังคับให้กรอก)</label>
                      <input type="text" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="เช่น ทอนผิดตอนเช้า" className="w-full p-2.5 border border-pink-200 rounded-lg text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500" />
                    </div>
                    <div className="mb-6">
                      <p className="text-xs font-bold text-gray-600 mb-2">📸 ถ่ายรูปยืนยันว่าอยู่ที่สหกรณ์</p>
                      <label className="block cursor-pointer">
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) { setClosePhoto(file); setClosePhotoPreview(URL.createObjectURL(file)); }
                        }} />
                        {closePhotoPreview ? (
                          <img src={closePhotoPreview} alt="preview" className="w-full h-28 object-cover rounded-xl border border-red-200" />
                        ) : (
                          <div className="w-full h-28 rounded-xl border-2 border-dashed border-red-200 flex flex-col items-center justify-center gap-2 text-red-300 hover:bg-red-50 transition">
                            <span className="text-2xl">📷</span><span className="text-sm font-bold">แตะเพื่อถ่ายรูป</span>
                          </div>
                        )}
                      </label>
                    </div>
                    <button type="submit" disabled={closeLoading} className="w-full bg-red-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-600 transition active:scale-95 disabled:bg-gray-300">
                      {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="p-6 pb-12 md:p-8 text-center">
                <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">สรุปยอดการขาย</h2>
                <p className="text-gray-500 text-sm mb-6">ปิดกะสำเร็จ บันทึกข้อมูลเรียบร้อยแล้ว</p>
                <div className="bg-pink-50 rounded-xl p-4 space-y-2 text-left mb-6 md:mb-8 border border-pink-100 text-sm md:text-base">
                  <p className="font-bold text-gray-700 text-sm border-b border-pink-100 pb-2">สรุปยอดการขาย</p>
                  <div className="flex justify-between"><span className="text-gray-600">จำนวนบิล:</span><span className="font-semibold">{Number(shiftSummary.bill_count || 0)} บิล</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">ยอดรวมทั้งหมด:</span><span className="font-bold text-pink-600">฿{Number(shiftSummary.total_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm pl-2"><span className="text-gray-500">• เงินสด:</span><span>฿{Number(shiftSummary.cash_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm pl-2"><span className="text-gray-500">• โอน/QR (นับจากบิล):</span><span>฿{Number(shiftSummary.qr_sales || 0).toFixed(2)}</span></div>
                  <p className="font-bold text-gray-700 text-sm border-t border-pink-100 pt-2 mt-2">ตรวจนับเงินสด</p>
                  <div className="flex justify-between"><span className="text-gray-600">เงินทอนตั้งต้น:</span><span className="font-semibold">฿{Number(shiftSummary.opening_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">ยอดเงินสดที่ขายได้:</span><span className="font-semibold">฿{Number(shiftSummary.cash_sales || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t pt-2"><span className="text-gray-800 font-bold">เงินสดที่ควรมีในลิ้นชัก:</span><span className="font-bold text-pink-600">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-800 font-bold">นับได้จริง:</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between pt-2 border-t"><span className="text-gray-600 font-bold">ส่วนต่าง:</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)} บาท
                      {Number(shiftSummary.difference) === 0 && ' ✅'}
                    </span>
                  </div>
                  {shiftSummary.note && <div className="flex justify-between pt-1 text-xs"><span className="text-gray-500">หมายเหตุ:</span><span className="text-gray-600 text-right max-w-[60%]">{shiftSummary.note}</span></div>}
                </div>
                <button onClick={handleLogout} className="w-full bg-pink-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-pink-700 transition active:scale-95">ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ⭐️ Detail Modal สำหรับการ์ด 4 ใบ */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-end md:items-center justify-center p-4" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-pink-100">
              <h2 className="font-bold text-gray-800">{detailModal.title}</h2>
              <button onClick={() => setDetailModal(null)} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-4 space-y-2">

              {detailModal.type === 'lowstock' && (
                lowStock.length === 0 ? <p className="text-center text-gray-400 py-6">ไม่มีสินค้าสต๊อกใกล้หมด</p> :
                lowStock.map((p: any) => (
                  <div key={p.id} className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border border-orange-100">
                    <div><p className="font-bold text-sm text-gray-800">{p.name}</p><p className="text-xs text-gray-500">รหัส: {p.barcode || '-'}</p></div>
                    <span className={`font-bold text-lg ${p.stock === 0 ? 'text-red-600' : 'text-orange-500'}`}>{p.stock} <span className="text-xs font-normal text-gray-400">ชิ้น</span></span>
                  </div>
                ))
              )}

              {detailModal.type === 'void' && (
                voidSummary?.void_count === 0 ? <p className="text-center text-gray-400 py-6">ไม่มีบิลยกเลิกวันนี้</p> :
                <div className="bg-red-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-red-600">{voidSummary?.void_count || 0} บิล</p>
                  <p className="text-gray-600 mt-1">มูลค่ารวม <span className="font-bold text-red-500">฿{Number(voidSummary?.void_amount || 0).toLocaleString()}</span></p>
                  <p className="text-xs text-gray-400 mt-2">ดูรายการบิลยกเลิกได้ที่หน้า "ประวัติการขาย" ในตั้งค่า</p>
                </div>
              )}

              {detailModal.type === 'anomalies' && (
                shiftAnomalies.length === 0 ? <p className="text-center text-gray-400 py-6">ไม่มีกะที่ผิดปกติ</p> :
                shiftAnomalies.map((s: any) => (
                  <div key={s.id} className="p-3 bg-fuchsia-50 rounded-xl border border-fuchsia-100">
                    <div className="flex justify-between items-start">
                      <div><p className="font-bold text-sm text-gray-800">{s.cashier_name}</p><p className="text-xs text-gray-500">{new Date(s.closed_at).toLocaleString('th-TH')}</p></div>
                      <span className={`font-bold text-lg ${Number(s.difference) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {Number(s.difference) > 0 ? '+' : ''}{Number(s.difference).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))
              )}

              {detailModal.type === 'openshifts' && (
                openShifts.length === 0 ? <p className="text-center text-gray-400 py-6">ไม่มีกะที่ค้างอยู่</p> :
                openShifts.map((s: any) => (
                  <div key={s.id} className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex justify-between items-center">
                      <div><p className="font-bold text-sm text-gray-800">{s.cashier_name}</p><p className="text-xs text-gray-500">เปิดกะ {new Date(s.opened_at).toLocaleString('th-TH')}</p></div>
                      <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-lg">เปิดอยู่</span>
                    </div>
                  </div>
                ))
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Section({ title, icon, open, onToggle, children }: { title: string; icon: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto mt-6">
      <button onClick={onToggle} className="w-full flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-pink-100 mb-3 hover:bg-pink-50 transition">
        <span className="flex items-center gap-2 font-bold text-gray-800">{icon} {title}</span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="space-y-6">{children}</div>}
    </div>
  );
}