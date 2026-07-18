// ✅ CHANGED: colors, layout, stat cards → DMTC Mart theme
// 🔒 UNCHANGED: fetchData, socket listeners, all interfaces/types/state

import { useState, useEffect } from 'react';
import { Wallet, Package, TrendingUp, PiggyBank } from 'lucide-react';
import api from '../api';
import { useSocket } from '../SocketContext';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';

interface VendorSummary {
  vendor_id: number; student_id: string; full_name: string;
  total_items_sold: number; total_sales: number; coop_gp_earnings: number; vendor_earnings: number;
}
interface VendorDetailItem {
  product_id: number; product_name: string; gp_rate: number;
  quantity_sold: number; total_sales: number; coop_gp_earnings: number; vendor_earnings: number;
}

export default function VendorSales() {
  const [summary, setSummary] = useState<VendorSummary | null>(null);
  const [items, setItems] = useState<VendorDetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const socket = useSocket();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2

  useEffect(() => {
    fetchData();
    if (!socket) return;
    socket.on('dashboard_updated', fetchData);
    socket.on('stock_updated', fetchData);
    return () => { socket.off('dashboard_updated', fetchData); socket.off('stock_updated', fetchData); };
  }, [socket]);

  const fetchData = async () => {
    try {
      const [summaryRes, detailRes] = await Promise.all([
        api.get(`/reports/vendor-sales?vendor_id=${user.id}`),
        api.get(`/reports/vendor-sales/detail?vendor_id=${user.id}`)
      ]);
      setSummary(summaryRes.data[0] || null);
      setItems(detailRes.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

  if (loading) return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-white border border-[#F6C7C7] rounded-2xl animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 pb-24">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl flex items-center justify-center shrink-0">
            <PiggyBank size={20} className="text-[#F12B6B]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">ยอดฝากขายของฉัน</h1>
            <p className="text-xs text-gray-500">สรุปยอดและเงินที่สหกรณ์จะโอนคืน</p>
          </div>
        </div>

        {!summary || items.length === 0 ? (
          <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm py-16 flex flex-col items-center text-center">
            <div className="w-14 h-14 bg-[#FFF5F7] rounded-2xl flex items-center justify-center mb-3">
              <Package size={24} className="text-[#FD94B4]" />
            </div>
            <p className="text-sm font-medium text-gray-600">ยังไม่มีสินค้าฝากขาย</p>
            <p className="text-xs text-gray-400 mt-1">ยังไม่มียอดขายเข้ามา</p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              <div className="bg-[#F12B6B] rounded-2xl p-4 text-white">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-pink-100">รายได้ที่จะได้รับ</p>
                  <Wallet size={18} className="text-pink-200" />
                </div>
                <p className="text-2xl font-bold">฿{fmt(Number(summary.vendor_earnings))}</p>
              </div>
              <div className="bg-white border border-[#F6C7C7] rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-gray-500">ยอดขายรวม</p>
                  <TrendingUp size={18} className="text-emerald-500" />
                </div>
                <p className="text-xl font-bold text-gray-900">฿{fmt(Number(summary.total_sales))}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">ขาย {summary.total_items_sold} ชิ้น</p>
              </div>
              <div className="bg-white border border-[#F6C7C7] rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-gray-500">หัก GP สหกรณ์</p>
                  <Package size={18} className="text-orange-400" />
                </div>
                <p className="text-xl font-bold text-gray-900">฿{fmt(Number(summary.coop_gp_earnings))}</p>
              </div>
            </div>

            {/* Detail list */}
            <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-[#F6C7C7]">
                <h2 className="text-sm font-semibold text-gray-800">รายละเอียดตามสินค้า</h2>
              </div>
              <ul className="divide-y divide-gray-50">
                {items.map(item => (
                  <li key={item.product_id} className="flex justify-between items-center px-4 py-3.5 hover:bg-[#FFF5F7] transition-colors duration-150">
                    <div className="min-w-0 pr-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.product_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">ขาย {item.quantity_sold} ชิ้น • GP {item.gp_rate}% • ยอดขาย ฿{Number(item.total_sales).toLocaleString()}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-[#F12B6B]">฿{fmt(Number(item.vendor_earnings))}</p>
                      <p className="text-[10px] text-gray-400">ได้รับคืน</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
