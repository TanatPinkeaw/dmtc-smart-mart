import { useState, useEffect } from 'react';
import api from '../../api';
interface Stats { users: number; products: number; today_sales: number; }
export default function PosAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const storeName = localStorage.getItem('pos_admin_store') || '';
  useEffect(() => { api.get('/pos-admin/stats').then(r => setStats(r.data)).catch(() => {}); }, []);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">แดชบอร์ด — {storeName}</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">ผู้ใช้ทั้งหมด</p>
          <p className="text-3xl font-bold text-emerald-600">{stats?.users ?? '-'}</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">สินค้าทั้งหมด</p>
          <p className="text-3xl font-bold text-blue-600">{stats?.products ?? '-'}</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <p className="text-gray-500 text-sm">ยอดขายวันนี้</p>
          <p className="text-3xl font-bold text-orange-600">฿{(stats?.today_sales ?? 0).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
