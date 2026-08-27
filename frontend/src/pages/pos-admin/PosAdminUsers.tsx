import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

interface User {
  id: number; student_id: string; full_name: string;
  phone_number: string | null; role: string; points: number; is_active: boolean;
}

const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'MEMBER'];
const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  CASHIER: 'bg-green-100 text-green-700',
  MEMBER: 'bg-gray-100 text-gray-700',
};

export default function PosAdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState({ student_id: '', full_name: '', password: '', role: 'MEMBER', phone_number: '' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/pos-admin/users').then(r => { setUsers(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditUser(null); setForm({ student_id: '', full_name: '', password: '', role: 'MEMBER', phone_number: '' }); setError(''); setShowModal(true); };
  const openEdit = (u: User) => { setEditUser(u); setForm({ student_id: u.student_id, full_name: u.full_name, password: '', role: u.role, phone_number: u.phone_number || '' }); setError(''); setShowModal(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      if (editUser) {
        const payload: any = { full_name: form.full_name, role: form.role, phone_number: form.phone_number };
        if (form.password) payload.password = form.password;
        await api.put(`/pos-admin/users/${editUser.id}`, payload);
      } else {
        await api.post('/pos-admin/users', form);
      }
      setShowModal(false); load();
    } catch (err: any) { setError(err.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  };

  const toggle = async (id: number) => {
    try { await api.put(`/pos-admin/users/${id}/toggle`); load(); } catch {}
  };

  const filtered = users.filter(u => {
    if (search && !u.student_id.includes(search) && !u.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && u.role !== filterRole) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">จัดการผู้ใช้ ({users.length})</h1>
        <button onClick={openAdd} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700">+ เพิ่มผู้ใช้</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหารหัส/ชื่อ..." className="border rounded-xl px-4 py-2 text-sm flex-1 max-w-xs" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="border rounded-xl px-4 py-2 text-sm">
          <option value="">ทุกบทบาท</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {loading ? <p className="text-gray-500">กำลังโหลด...</p> : (
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="p-3 text-left">รหัสนักศึกษา</th><th className="p-3 text-left">ชื่อ</th>
              <th className="p-3 text-left">เบอร์โทร</th><th className="p-3 text-left">บทบาท</th>
              <th className="p-3 text-right">แต้ม</th><th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-center">จัดการ</th>
            </tr></thead>
            <tbody>{filtered.map(u => (
              <tr key={u.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-mono text-xs">{u.student_id}</td>
                <td className="p-3 font-medium">{u.full_name}</td>
                <td className="p-3 text-gray-500">{u.phone_number || '-'}</td>
                <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || ROLE_COLORS.MEMBER}`}>{u.role}</span></td>
                <td className="p-3 text-right">{u.points}</td>
                <td className="p-3 text-center">
                  <button onClick={() => toggle(u.id)} className={`px-2 py-1 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.is_active ? '✅ ใช้งาน' : '❌ ปิด'}
                  </button>
                </td>
                <td className="p-3 text-center">
                  <button onClick={() => openEdit(u)} className="text-blue-600 hover:underline text-xs mr-2">แก้ไข</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-gray-400">ไม่พบผู้ใช้</p>}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h2>
            {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
            <form onSubmit={submit} className="space-y-3">
              {!editUser && (
                <div><label className="block text-sm font-medium mb-1">รหัสนักศึกษา</label>
                <input value={form.student_id} onChange={e => setForm({...form, student_id: e.target.value})} required className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              )}
              <div><label className="block text-sm font-medium mb-1">ชื่อ-นามสกุล</label>
              <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">เบอร์โทรศัพท์</label>
              <input value={form.phone_number} onChange={e => setForm({...form, phone_number: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="ไม่บังคับ" /></div>
              <div><label className="block text-sm font-medium mb-1">รหัสผ่าน {editUser && '(เว้นว่างถ้าไม่เปลี่ยน)'}</label>
              <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required={!editUser} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">บทบาท</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 border rounded-xl py-2 text-sm font-medium">ยกเลิก</button>
                <button type="submit" className="flex-1 bg-emerald-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-emerald-700">{editUser ? 'บันทึก' : 'เพิ่ม'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
