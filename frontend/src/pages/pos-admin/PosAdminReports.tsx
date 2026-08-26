import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminReports() {
  const [daily, setDaily] = useState<any[]>([]);
  const [top, setTop] = useState<any[]>([]);
  useEffect(()=>{
    api.get('/pos-admin/reports/daily').then(r=>setDaily(r.data)).catch(()=>{});
    api.get('/pos-admin/reports/top-selling').then(r=>setTop(r.data)).catch(()=>{});
  },[]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">รายงาน</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">รายงานรายวัน</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500"><th>วันที่</th><th className="text-right">บิล</th><th className="text-right">ยอดรวม</th></tr></thead>
            <tbody>{daily.map(d=>(
              <tr key={d.date} className="border-t"><td className="py-2">{d.date}</td><td className="text-right">{d.bills}</td><td className="text-right">฿{Number(d.total).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">สินค้าขายดี</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500"><th>สินค้า</th><th className="text-right">จำนวน</th><th className="text-right">ยอดขาย</th></tr></thead>
            <tbody>{top.map((t,i)=>(
              <tr key={i} className="border-t"><td className="py-2">{t.name}</td><td className="text-right">{t.qty}</td><td className="text-right">฿{Number(t.revenue).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
