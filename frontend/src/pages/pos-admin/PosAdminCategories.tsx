import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

interface Category { id: number; name: string; }

export default function PosAdminCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/pos-admin/categories').then(r => { setCats(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!newName.trim()) return;
    try { await api.post('/pos-admin/categories', { name: newName.trim() }); setNewName(''); load(); }
    catch (err: any) { setError(err.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try { await api.put(`/pos-admin/categories/${id}`, { name: editName.trim() }); setEditId(null); load(); }
    catch (err: any) { setError(err.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  };

  const del = async (id: number) => {
    if (!confirm('ลบหมวดหมู่นี้? สินค้าในหมวดนี้จะไม่ถูกลบ')) return;
    try { await api.delete(`/pos-admin/categories/${id}`); load(); } catch {}
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">จัดการหมวดหมู่ ({cats.length})</h1>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <form onSubmit={add} className="flex gap-2 mb-6">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อหมวดหมู่ใหม่" className="border rounded-xl px-4 py-2 flex-1 text-sm" />
        <button type="submit" className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700">เพิ่ม</button>
      </form>

      {loading ? <p className="text-gray-500">กำลังโหลด...</p> : (
        <div className="bg-white rounded-2xl shadow divide-y">
          {cats.map(c => (
            <div key={c.id} className="flex items-center justify-between p-4">
              {editId === c.id ? (
                <div className="flex gap-2 flex-1">
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="border rounded-xl px-3 py-1 text-sm flex-1" autoFocus onKeyDown={e => { if (e.key === 'Enter') saveEdit(c.id); if (e.key === 'Escape') setEditId(null); }} />
                  <button onClick={() => saveEdit(c.id)} className="text-emerald-600 text-sm font-medium hover:underline">บันทึก</button>
                  <button onClick={() => setEditId(null)} className="text-gray-400 text-sm hover:underline">ยกเลิก</button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-medium">{c.name}</span>
                  <div className="flex gap-3">
                    <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="text-blue-600 text-xs hover:underline">แก้ไข</button>
                    <button onClick={() => del(c.id)} className="text-red-600 text-xs hover:underline">ลบ</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {cats.length === 0 && <p className="p-6 text-center text-gray-400">ยังไม่มีหมวดหมู่</p>}
        </div>
      )}
    </div>
  );
}
