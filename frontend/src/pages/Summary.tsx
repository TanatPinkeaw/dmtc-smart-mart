// ⭐️ หน้า "สรุปข้อมูล" — ADMIN เท่านั้น
// รวมภาพรวมสำคัญประจำเดือน (ยอดขาย, สมาชิก, สต๊อก, ออเดอร์ค้าง, บิลยกเลิก) +
// สรุปชั่วโมงทำงาน/มาสาย/ค่าจ้างต่อพนักงานแต่ละคน (แก้อัตราค่าจ้างได้)

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, ArrowLeft, TrendingUp, Receipt, Users, UserPlus, PackageX,
  ClipboardList, XCircle, Clock, AlertTriangle, Pencil, Check, X as XIcon, Wallet,
  Printer, Percent, Coins, PiggyBank,
} from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';

interface Overview {
  month: string;
  total_bills: number;
  total_sales: number;
  total_members: number;
  new_members: number;
  low_stock_count: number;
  pending_orders_count: number;
  void_count: number;
  void_amount: number;
}

interface PayrollRow {
  user_id: number;
  full_name: string;
  role: 'CASHIER' | 'ADMIN';
  hourly_rate: number;
  total_hours: number;
  late_minutes: number;
  late_hours: number;
  calculated_pay: number;
}

interface ProfitRow {
  period: string;
  revenue: number;
  cogs_own: number;
  vendor_payout: number;
  profit_own: number;
  profit_gp: number;
  profit_total: number;
}
interface ProfitSummary {
  overall: Omit<ProfitRow, 'period'>;
  monthly: ProfitRow[];
}

const baht = (n: number) => '฿' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getCurrentMonth(): string {
  const now = new Date();
  const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const y = bkk.getFullYear();
  const m = String(bkk.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default function Summary() {
  const user = getCurrentUserOrRedirect();
  const navigate = useNavigate();

  const [month, setMonth] = useState(getCurrentMonth());
  const [overview, setOverview] = useState<Overview | null>(null);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [profitView, setProfitView] = useState<'overall' | 'monthly'>('overall');
  const [loading, setLoading] = useState(true);

  // Inline edit state for hourly rate
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRateValue, setEditRateValue] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    if (user.role !== 'ADMIN') { navigate('/'); return; }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ovRes, prRes, pfRes] = await Promise.all([
        api.get(`/reports/monthly-overview?month=${month}`),
        api.get(`/reports/payroll?month=${month}`),
        api.get('/reports/profit-summary'),
      ]);
      setOverview(ovRes.data);
      setPayroll(prRes.data.staff || []);
      setProfit(pfRes.data);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  const totalPayroll = payroll.reduce((sum, p) => sum + Number(p.calculated_pay || 0), 0);
  const totalLateHours = payroll.reduce((sum, p) => sum + Number(p.late_hours || 0), 0);

  const startEditRate = (row: PayrollRow) => {
    setEditingId(row.user_id);
    setEditRateValue(String(row.hourly_rate));
  };

  const cancelEditRate = () => {
    setEditingId(null);
    setEditRateValue('');
  };

  const saveRate = async (userId: number) => {
    const rate = Number(editRateValue);
    if (!Number.isFinite(rate) || rate < 0) {
      return Swal.fire({ icon: 'warning', title: 'อัตราค่าจ้างไม่ถูกต้อง', text: 'กรุณาระบุตัวเลข ≥ 0' });
    }
    setSavingRate(true);
    try {
      await api.put(`/users/${userId}/hourly-rate`, { hourly_rate: rate });
      setPayroll(prev => prev.map(p => p.user_id === userId
        ? { ...p, hourly_rate: rate, calculated_pay: Math.round(p.total_hours * rate * 100) / 100 }
        : p));
      setEditingId(null);
      setEditRateValue('');
      Swal.fire({ icon: 'success', title: 'บันทึกอัตราค่าจ้างสำเร็จ', showConfirmButton: false, timer: 1200 });
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setSavingRate(false);
    }
  };

  const overviewCards = overview ? [
    { icon: <TrendingUp size={18} />, label: 'ยอดขายรวมเดือนนี้', value: `฿${Number(overview.total_sales).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'text-emerald-600', border: 'border-emerald-200' },
    { icon: <Receipt size={18} />, label: 'จำนวนบิล', value: `${overview.total_bills} บิล`, color: 'text-blue-600', border: 'border-blue-200' },
    { icon: <Users size={18} />, label: 'สมาชิกทั้งหมด', value: `${overview.total_members} คน`, color: 'text-purple-600', border: 'border-purple-200' },
    { icon: <UserPlus size={18} />, label: 'สมาชิกใหม่เดือนนี้', value: `${overview.new_members} คน`, color: 'text-[#F12B6B]', border: 'border-[#F6C7C7]' },
    { icon: <PackageX size={18} />, label: 'สต๊อกใกล้หมด', value: `${overview.low_stock_count} รายการ`, color: 'text-orange-600', border: 'border-orange-200' },
    { icon: <ClipboardList size={18} />, label: 'ออเดอร์จองค้างอยู่', value: `${overview.pending_orders_count} ออเดอร์`, color: 'text-cyan-600', border: 'border-cyan-200' },
    { icon: <XCircle size={18} />, label: 'บิลยกเลิกเดือนนี้', value: `${overview.void_count} บิล (฿${Number(overview.void_amount).toLocaleString()})`, color: 'text-red-600', border: 'border-red-200' },
    { icon: <Wallet size={18} />, label: 'ค่าจ้างรวมเดือนนี้ (ประมาณการ)', value: `฿${totalPayroll.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'text-[#F12B6B]', border: 'border-[#F6C7C7]' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-[#F6C7C7] text-gray-500 transition">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BarChart3 className="text-[#F12B6B]" size={24} />
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">สรุปข้อมูล</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-[#F6C7C7] rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#F12B6B]"
          />
          {/* ⭐️ ปุ่มปรินต์/บันทึก PDF สำหรับนำไปเสนออาจารย์ */}
          <button onClick={() => window.print()} className="print:hidden flex items-center gap-1.5 border border-[#F6C7C7] text-[#F12B6B] rounded-xl px-3 py-2 text-sm font-semibold hover:bg-[#FFF5F7] active:scale-95 transition">
            <Printer size={16} /> ปรินต์
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-2 border-[#F12B6B] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {overviewCards.map((c, i) => (
              <div key={i} className={`bg-white border ${c.border} rounded-2xl p-4 shadow-sm`}>
                <div className={`flex items-center gap-1.5 mb-2 ${c.color}`}>
                  {c.icon}
                  <span className="text-xs font-semibold">{c.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-800">{c.value}</p>
              </div>
            ))}
          </div>

          {/* ⭐️ สรุปรายได้ & กำไร (แยกกำไรจาก GP ฝากขาย ออกจากกำไรสินค้าสหกรณ์เอง) */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#F6C7C7] overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-[#F6C7C7] flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Coins size={18} className="text-[#F12B6B]" /> สรุปรายได้ &amp; กำไร (แยกกำไรจาก GP)
              </h2>
              <div className="flex bg-[#FFF5F7] border border-[#F6C7C7] rounded-full p-0.5 print:hidden">
                <button onClick={() => setProfitView('overall')} className={`px-3 py-1 rounded-full text-xs font-semibold transition ${profitView === 'overall' ? 'bg-[#F12B6B] text-white' : 'text-gray-500'}`}>ภาพรวมทั้งหมด</button>
                <button onClick={() => setProfitView('monthly')} className={`px-3 py-1 rounded-full text-xs font-semibold transition ${profitView === 'monthly' ? 'bg-[#F12B6B] text-white' : 'text-gray-500'}`}>รายเดือน</button>
              </div>
            </div>

            {!profit || profit.monthly.length === 0 ? (
              <p className="p-6 text-center text-gray-400 text-sm">ยังไม่มีข้อมูลการขาย</p>
            ) : profitView === 'overall' ? (
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-emerald-600 mb-1"><TrendingUp size={16} /><span className="text-xs font-semibold">รายได้รวม (ยอดขาย)</span></div>
                    <p className="text-lg font-bold text-gray-800">{baht(profit.overall.revenue)}</p>
                  </div>
                  <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-[#F12B6B] mb-1"><Wallet size={16} /><span className="text-xs font-semibold">กำไรรวมของสหกรณ์</span></div>
                    <p className="text-xl font-bold text-[#F12B6B]">{baht(profit.overall.profit_total)}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-blue-600 mb-1"><PiggyBank size={16} /><span className="text-xs font-semibold">กำไรสินค้าสหกรณ์เอง</span></div>
                    <p className="text-lg font-bold text-gray-800">{baht(profit.overall.profit_own)}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-amber-600 mb-1"><Percent size={16} /><span className="text-xs font-semibold">กำไรจาก GP (ฝากขาย)</span></div>
                    <p className="text-lg font-bold text-gray-800">{baht(profit.overall.profit_gp)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-xs">
                  <div className="flex justify-between bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-500">ต้นทุนสินค้าสหกรณ์เอง</span><span className="font-semibold text-gray-700">{baht(profit.overall.cogs_own)}</span></div>
                  <div className="flex justify-between bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-500">ส่วนแบ่งคืนผู้ฝากขาย</span><span className="font-semibold text-gray-700">{baht(profit.overall.vendor_payout)}</span></div>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs">
                    <tr>
                      <th className="p-3 border-b">เดือน</th>
                      <th className="p-3 border-b text-right">รายได้</th>
                      <th className="p-3 border-b text-right">กำไรสหกรณ์เอง</th>
                      <th className="p-3 border-b text-right">กำไรจาก GP</th>
                      <th className="p-3 border-b text-right">กำไรรวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.monthly.map(m => (
                      <tr key={m.period} className="border-b last:border-0 hover:bg-[#FFF5F7]">
                        <td className="p-3 font-semibold text-gray-800">{m.period}</td>
                        <td className="p-3 text-right">{baht(m.revenue)}</td>
                        <td className="p-3 text-right text-blue-600">{baht(m.profit_own)}</td>
                        <td className="p-3 text-right text-amber-600">{baht(m.profit_gp)}</td>
                        <td className="p-3 text-right font-bold text-[#F12B6B]">{baht(m.profit_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-bold">
                      <td className="p-3">รวมทั้งหมด</td>
                      <td className="p-3 text-right">{baht(profit.overall.revenue)}</td>
                      <td className="p-3 text-right text-blue-600">{baht(profit.overall.profit_own)}</td>
                      <td className="p-3 text-right text-amber-600">{baht(profit.overall.profit_gp)}</td>
                      <td className="p-3 text-right text-[#F12B6B]">{baht(profit.overall.profit_total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="px-5 py-3 text-xs text-gray-400 border-t border-[#F6C7C7]">
              * กำไรสินค้าสหกรณ์เอง = ราคาขาย − ต้นทุน | กำไรจาก GP = ยอดขายสินค้าฝากขาย × %GP (ส่วนที่เหลือคืนผู้ฝากขาย) | รวมทั้งขายหน้าร้าน + พรีออเดอร์ที่สำเร็จแล้ว
            </p>
          </div>

          {/* Payroll table */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#F6C7C7] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F6C7C7] flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Clock size={18} className="text-[#F12B6B]" />
                ชั่วโมงทำงาน / มาสาย / ค่าจ้างพนักงาน
              </h2>
              {totalLateHours > 0 && (
                <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 flex items-center gap-1">
                  <AlertTriangle size={14} /> รวมมาสาย {totalLateHours.toFixed(2)} ชม.
                </span>
              )}
            </div>

            {/* ⭐️ FIX: mobile card fallback — เดิมมีแค่ table + overflow-x-auto บนมือถือต้องเลื่อนซ้ายขวา
                อ่านยาก โดยเฉพาะตอนแก้อัตราค่าจ้าง ปุ่มเล็กเกินไปกดยาก */}
            <div className="sm:hidden divide-y divide-gray-100">
              {payroll.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">ไม่มีข้อมูลพนักงานในเดือนนี้</p>
              ) : payroll.map(row => (
                <div key={`m-${row.user_id}`} className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold text-gray-800">{row.full_name}</p>
                      <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${row.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {row.role === 'ADMIN' ? 'ผู้จัดการ' : 'แคชเชียร์'}
                      </span>
                    </div>
                    <span className="font-bold text-[#F12B6B] text-lg">฿{Number(row.calculated_pay).toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-3">
                    <div>ชั่วโมงทำงาน: <span className="font-semibold text-gray-800">{Number(row.total_hours).toFixed(2)}</span></div>
                    <div className={row.late_hours > 0 ? 'text-red-500 font-semibold' : ''}>มาสาย: {Number(row.late_hours).toFixed(2)} ชม.</div>
                  </div>
                  {editingId === row.user_id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" min="0" step="0.01" value={editRateValue}
                        onChange={(e) => setEditRateValue(e.target.value)}
                        className="flex-1 border border-[#FD94B4] rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#F12B6B]"
                        autoFocus
                      />
                      <button onClick={() => saveRate(row.user_id)} disabled={savingRate} className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 active:scale-95 transition disabled:opacity-50"><Check size={16} /></button>
                      <button onClick={cancelEditRate} disabled={savingRate} className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 active:scale-95 transition disabled:opacity-50"><XIcon size={16} /></button>
                    </div>
                  ) : (
                    <button onClick={() => startEditRate(row)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#FFF5F7] text-sm active:scale-95 transition">
                      <span className="text-gray-500">ค่าจ้าง/ชม.</span>
                      <span className="font-semibold text-gray-800 flex items-center gap-1.5">฿{Number(row.hourly_rate).toFixed(2)} <Pencil size={12} className="text-[#F12B6B]" /></span>
                    </button>
                  )}
                </div>
              ))}
              {payroll.length > 0 && (
                <div className="p-4 flex justify-between items-center bg-gray-50 font-bold text-sm">
                  <span>รวมค่าจ้างทั้งหมดเดือนนี้</span>
                  <span className="text-[#F12B6B]">฿{totalPayroll.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="p-3 border-b">ชื่อพนักงาน</th>
                    <th className="p-3 border-b">ตำแหน่ง</th>
                    <th className="p-3 border-b text-right">ชั่วโมงทำงาน</th>
                    <th className="p-3 border-b text-right">มาสาย (ชม.)</th>
                    <th className="p-3 border-b text-right">ค่าจ้าง/ชม.</th>
                    <th className="p-3 border-b text-right">ค่าจ้างรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-gray-400 text-sm">ไม่มีข้อมูลพนักงานในเดือนนี้</td></tr>
                  )}
                  {payroll.map(row => (
                    <tr key={row.user_id} className="border-b last:border-0 hover:bg-[#FFF5F7] text-sm">
                      <td className="p-3 font-semibold text-gray-800">{row.full_name}</td>
                      <td className="p-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {row.role === 'ADMIN' ? 'ผู้จัดการ' : 'แคชเชียร์'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-semibold">{Number(row.total_hours).toFixed(2)}</td>
                      <td className={`p-3 text-right font-semibold ${row.late_hours > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                        {Number(row.late_hours).toFixed(2)}
                      </td>
                      <td className="p-3 text-right">
                        {editingId === row.user_id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editRateValue}
                              onChange={(e) => setEditRateValue(e.target.value)}
                              className="w-20 border border-[#FD94B4] rounded-lg px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[#F12B6B]"
                              autoFocus
                            />
                            <button
                              onClick={() => saveRate(row.user_id)}
                              disabled={savingRate}
                              className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition disabled:opacity-50"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={cancelEditRate}
                              disabled={savingRate}
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition disabled:opacity-50"
                            >
                              <XIcon size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <span>฿{Number(row.hourly_rate).toFixed(2)}</span>
                            <button
                              onClick={() => startEditRate(row)}
                              className="p-1 rounded-lg text-gray-400 hover:text-[#F12B6B] hover:bg-[#FFF5F7] transition"
                              title="แก้ไขอัตราค่าจ้าง"
                            >
                              <Pencil size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-bold text-[#F12B6B]">฿{Number(row.calculated_pay).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                {payroll.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-bold text-sm">
                      <td className="p-3" colSpan={5}>รวมค่าจ้างทั้งหมดเดือนนี้</td>
                      <td className="p-3 text-right text-[#F12B6B]">฿{totalPayroll.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-4">
            * ชั่วโมงทำงานคำนวณจากกะที่ปิดสมบูรณ์แล้ว (แคชเชียร์) และบันทึกเข้า-ออกงาน (ผู้จัดการ) เฉพาะเดือนที่เลือก
            ส่วนค่าจ้างเป็นตัวเลขประมาณการ (ชั่วโมงทำงาน × อัตราค่าจ้าง) ไม่รวมภาษี/ประกันสังคม
          </p>
        </>
      )}
    </div>
  );
}
