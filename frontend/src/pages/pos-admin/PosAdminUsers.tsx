import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(()=>{api.get('/pos-admin/users').then(r=>setUsers(r.data)).catch(()=>{});},[]);
  const roleColor = (r:string)=>r==='ADMIN'?'bg-purple-100 text-purple-700':r==='MANAGER'?'bg-blue-100 text-blue-700':r==='CASHIER'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-700';
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">จัดการผู้ใช้</h1>
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="p-3 text-left">รหัส</th><th className="p-3 text-left">ชื่อ</th>
            <th className="p-3 text-left">บทบาท</th><th className="p-3 text-right">แต้ม</th><th className="p-3 text-center">สถานะ</th>
          </tr></thead>
          <tbody>{users.map(u=>(
            <tr key={u.id} className="border-t hover:bg-gray-50">
              <td className="p-3">{u.student_id}</td><td className="p-3">{u.full_name}</td>
              <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs ${roleColor(u.role)}`}>{u.role}</span></td>
              <td className="p-3 text-right">{u.points}</td>
              <td className="p-3 text-center">{u.is_active?'✅':'❌'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
