// 📄 pages/AccountingSummary.tsx — หน้าสรุปบัญชีสหกรณ์ (ADMIN/MANAGER)
//    ทำอะไร: เลือกช่วงวันที่ → โชว์ KPI + แยกตามหมวดหมู่/สินค้า + ยอดต้องจ่ายคืนผู้ฝากขาย + ปุ่ม export Excel
// ⭐️ Co-op Accounting Summary — สรุปบัญชีสหกรณ์: หมวดหมู่ (รายได้/ต้นทุน/กำไร) + ยอดต้องจ่ายคืน
// ผู้ฝากขายแต่ละราย ในช่วงวันที่ที่เลือก + ปุ่ม export Excel (2 ชีต: สรุปบัญชี, ยอดจ่ายคืนผู้ฝากขาย)
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, TrendingUp, Wallet, Coins, Download, PiggyBank } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getBangkokDate } from '../utils/localDate';
import { SkeletonCard, SkeletonDashboardStat } from '../components/ui/Skeleton';

interface CategoryBreakdown { name: string; sales: number; cost: number; profit: number; percentage: number; }
interface ProductBreakdown { name: string; category: string; qty: number; revenue: number; profit: number; }
interface SupplierPayout { vendor_id: number; vendor_name: string; total_items_sold: number; total_sales: number; coop_gp_earnings: number; vendor_payout: number; }
interface AccountingData {
  period: { start_date: string | null; end_date: string | null };
  kpis: { totalRevenue: number; totalCost: number; totalProfit: number; totalOrders: number; aov: number };
  categoryBreakdown: CategoryBreakdown[];
  productBreakdown: ProductBreakdown[];
  supplierPayouts: SupplierPayout[];
}

const baht = (n: number | undefined | null) => '฿' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 🐛 FIX — เดิมแปลงวันที่ผ่าน toISOString() (UTC): (1) start = new Date(y, m, 1) เที่ยงคืนท้องถิ่น
// แปลงเป็น UTC แล้ว slice(0,10) จะได้วันสุดท้ายของเดือนก่อนหน้าเสมอ (ช่วงนี้รวมวันที่ 31 ของเดือน
// ก่อนหน้าเข้าไปทุกครั้ง) (2) end ช่วง 00:00–07:00 ไทยเพี้ยนเป็นเมื่อวาน — ใช้ getBangkokDate()
// ซึ่งให้ YYYY-MM-DD ตามเขตเวลาไทยตรงๆ ไม่ต้องผ่าน Date/toISOString
function getDefaultRange() {
  const today = getBangkokDate();
  return { start: today.slice(0, 7) + '-01', end: today };
}

export default function AccountingSummary() {
  const navigate = useNavigate();
  const defaultRange = getDefaultRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState<AccountingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);


  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/accounting-summary?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  // IIFE ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation (pattern เดียวกับ Notifications)
  useEffect(() => { void (async () => { await loadData(); })(); }, [startDate, endDate]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/reports/accounting-summary/export?start_date=${startDate}&end_date=${endDate}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounting-summary_${startDate}_ถึง_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const kpiCards = data ? [
    { icon: <TrendingUp size={18} />, label: 'รายได้รวม', value: baht(data.kpis.totalRevenue), color: 'text-emerald-600', border: 'border-emerald-200' },
    { icon: <Coins size={18} />, label: 'ต้นทุนรวม', value: baht(data.kpis.totalCost), color: 'text-orange-600', border: 'border-orange-200' },
    { icon: <Wallet size={18} />, label: 'กำไรขั้นต้นรวม', value: baht(data.kpis.totalProfit), color: 'text-brand', border: 'border-brand-border' },
    { icon: <PiggyBank size={18} />, label: 'ยอดเฉลี่ยต่อบิล', value: baht(data.kpis.aov), color: 'text-blue-600', border: 'border-blue-200' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 bg-gradient-to-r from-brand to-brand-dark rounded-3xl shadow-md p-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-white/20 text-white active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="text-white" size={24} />
            <h1 className="text-xl md:text-2xl font-semibold text-white">สรุปบัญชีสหกรณ์</h1>
          </div>
        </div>

        {/* Date range + export */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-white border border-brand-border rounded-full px-3 py-2 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-brand" />
          <span className="text-gray-400 text-sm">ถึง</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-white border border-brand-border rounded-full px-3 py-2 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-brand" />
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="ml-auto flex items-center gap-1.5 bg-white border border-brand-border text-brand rounded-full px-4 py-2 text-sm font-bold shadow-sm hover:bg-brand-bg active:scale-[0.98] transition-all duration-150 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Download size={16} /> {exporting ? 'กำลัง Export...' : 'Export Excel'}
          </button>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonDashboardStat key={i} />)}
            </div>
            <SkeletonCard />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              {kpiCards.map((c, i) => (
                <div key={i} className={`bg-white border ${c.border} rounded-3xl p-4 shadow-md hover:shadow-lg transition-all duration-150`}>
                  <div className={`flex items-center gap-1.5 mb-2 ${c.color}`}>
                    {c.icon}
                    <span className="text-xs font-semibold">{c.label}</span>
                  </div>
                  <p className="text-lg font-bold text-gray-800">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Category breakdown */}
            <div className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-brand-border">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <Coins size={18} className="text-brand" /> สรุปตามหมวดหมู่ (รายได้ / ต้นทุน / กำไร)
                </h2>
              </div>
              {!data || data.categoryBreakdown.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">ไม่มีข้อมูลการขายในช่วงวันที่นี้</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left whitespace-nowrap text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs">
                      <tr>
                        <th className="p-3 border-b">หมวดหมู่</th>
                        <th className="p-3 border-b text-right">รายได้</th>
                        <th className="p-3 border-b text-right">ต้นทุน</th>
                        <th className="p-3 border-b text-right">กำไร</th>
                        <th className="p-3 border-b text-right">สัดส่วน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.categoryBreakdown.map(c => (
                        <tr key={c.name} className="border-b last:border-0 hover:bg-brand-bg">
                          <td className="p-3 font-semibold text-gray-800">{c.name}</td>
                          <td className="p-3 text-right">{baht(c.sales)}</td>
                          <td className="p-3 text-right text-orange-600">{baht(c.cost)}</td>
                          <td className="p-3 text-right font-bold text-brand">{baht(c.profit)}</td>
                          <td className="p-3 text-right text-gray-500">{c.percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ⭐️ ผู้ใช้ขอ — บอกด้วยว่าขายสินค้าอะไรบ้าง (เดิมมีแค่สรุปตามหมวดหมู่) ครบทุกตัว ไม่ตัด top 10 */}
            <div className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-brand-border">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-brand" /> สินค้าที่ขาย ({data?.productBreakdown.length || 0} รายการ)
                </h2>
              </div>
              {!data || data.productBreakdown.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">ไม่มีข้อมูลการขายในช่วงวันที่นี้</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-left whitespace-nowrap text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs sticky top-0">
                      <tr>
                        <th className="p-3 border-b">สินค้า</th>
                        <th className="p-3 border-b">หมวดหมู่</th>
                        <th className="p-3 border-b text-right">จำนวนที่ขายได้</th>
                        <th className="p-3 border-b text-right">ยอดขายรวม</th>
                        <th className="p-3 border-b text-right">กำไรรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.productBreakdown.map(p => (
                        <tr key={p.name} className="border-b last:border-0 hover:bg-brand-bg">
                          <td className="p-3 font-semibold text-gray-800">{p.name}</td>
                          <td className="p-3 text-gray-500">{p.category}</td>
                          <td className="p-3 text-right">{p.qty.toLocaleString()} ชิ้น</td>
                          <td className="p-3 text-right">{baht(p.revenue)}</td>
                          <td className="p-3 text-right font-bold text-brand">{baht(p.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Supplier GP payouts */}
            <div className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-border">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <PiggyBank size={18} className="text-orange-400" /> ยอดต้องจ่ายคืนผู้ฝากขาย (หัก GP แล้ว)
                </h2>
              </div>
              {!data || data.supplierPayouts.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">ไม่มีสินค้าฝากขายที่ขายได้ในช่วงวันที่นี้</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left whitespace-nowrap text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs">
                      <tr>
                        <th className="p-3 border-b">ผู้ฝากขาย</th>
                        <th className="p-3 border-b text-right">จำนวนที่ขายได้</th>
                        <th className="p-3 border-b text-right">ยอดขายรวม</th>
                        <th className="p-3 border-b text-right">ส่วนแบ่ง GP สหกรณ์</th>
                        <th className="p-3 border-b text-right">ต้องจ่ายคืน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.supplierPayouts.map(v => (
                        <tr key={v.vendor_id} className="border-b last:border-0 hover:bg-brand-bg">
                          <td className="p-3 font-semibold text-gray-800">{v.vendor_name}</td>
                          <td className="p-3 text-right">{v.total_items_sold} ชิ้น</td>
                          <td className="p-3 text-right">{baht(v.total_sales)}</td>
                          <td className="p-3 text-right text-emerald-600">{baht(v.coop_gp_earnings)}</td>
                          <td className="p-3 text-right font-bold text-brand">{baht(v.vendor_payout)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
