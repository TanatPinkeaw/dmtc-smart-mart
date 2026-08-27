import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

interface Stats { users: number; products: number; today_sales: number; }
interface WeeklySale { date: string; bills: number; total: number; }
interface LowStock { id: number; name: string; stock: number; min_stock: number | null; }

export default function PosAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [weekly, setWeekly] = useState<WeeklySale[]>([]);
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const storeName = localStorage.getItem('pos_admin_store') || '';

  const load = useCallback(() => {
    Promise.all([
      api.get('/pos-admin/stats').catch(() => ({ data: null })),
      api.get('/pos-admin/stats/weekly').catch(() => ({ data: [] })),
      api.get('/pos-admin/stats/low-stock').catch(() => ({ data: [] })),
    ]).then(([s, w, l]) => { setStats(s.data); setWeekly(w.data); setLowStock(l.data); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const maxTotal = Math.max(...weekly.map(d => d.total), 1);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">แดชบอร์ด — {storeName}</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">ผู้ใช้ทั้งหมด</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{stats?.users ?? '-'}</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">สินค้าทั้งหมด</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{stats?.products ?? '-'}</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">ยอดขายวันนี้</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">฿{(stats?.today_sales ?? 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Sales Chart */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">📈 ยอดขาย 7 วันล่าสุด</h2>
          {weekly.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-2">
              {weekly.map(d => (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-20 shrink-0">{new Date(d.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full flex items-center justify-end pr-2 transition-all" style={{ width: `${Math.max((d.total / maxTotal) * 100, 4)}%` }}>
                      {d.total > 0 && <span className="text-xs text-white font-medium">฿{d.total.toLocaleString()}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right">{d.bills} บิล</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">⚠️ สินค้าใกล้หมด</h2>
          {lowStock.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">สินค้าทั้งหมดมีสต๊อกเพียงพอ</p>
          ) : (
            <div className="space-y-2">
              {lowStock.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-xl">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-sm font-bold text-red-600">{p.stock} ชิ้น</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
