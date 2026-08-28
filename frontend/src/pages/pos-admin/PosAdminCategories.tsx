import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { InlineAlert } from '../../components/ui/InlineAlert';

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

      {error && <InlineAlert tone="error" className="mb-4">{error}</InlineAlert>}

      <form onSubmit={add} className="flex gap-2 mb-6">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อหมวดหมู่ใหม่" className="border rounded-xl px-4 py-2 flex-1 text-sm" />
        <Button type="submit" variant="success" size="sm">เพิ่ม</Button>
      </form>

      {loading ? <p className="text-gray-500">กำลังโหลด...</p> : (
        <div className="bg-white rounded-2xl shadow divide-y">
          {cats.map(c => (
            <div key={c.id} className="flex items-center justify-between p-4">
              {editId === c.id ? (
                <div className="flex gap-2 flex-1">
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="border rounded-xl px-3 py-1 text-sm flex-1" autoFocus onKeyDown={e => { if (e.key === 'Enter') saveEdit(c.id); if (e.key === 'Escape') setEditId(null); }} />
                  <Button variant="ghost" size="sm" onClick={() => saveEdit(c.id)}>บันทึก</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>ยกเลิก</Button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-medium">{c.name}</span>
                  <div className="flex gap-3">
                    <Button variant="ghost" size="sm" onClick={() => { setEditId(c.id); setEditName(c.name); }}>แก้ไข</Button>
                    <Button variant="ghost" size="sm" onClick={() => del(c.id)}>ลบ</Button>
                  </div>
                </>
              )}
            </div>
          ))}
          {cats.length === 0 && <EmptyState compact title="ยังไม่มีหมวดหมู่" />}
        </div>
      )}
    </div>
  );
}
