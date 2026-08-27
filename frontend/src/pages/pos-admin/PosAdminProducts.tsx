import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

interface Product { id: number; barcode: string | null; name: string; price: number; cost: number; stock: number; min_stock: number | null; is_active: boolean; category_id: number | null; category_name: string | null; image_url: string | null; }
interface Category { id: number; name: string; }

export default function PosAdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProd, setEditProd] = useState<Product | null>(null);
  const [form, setForm] = useState({ barcode: '', name: '', price: 0, cost: 0, stock: 0, min_stock: 5, category_id: '' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api.get('/pos-admin/products'), api.get('/pos-admin/categories')])
      .then(([p, c]) => { setProducts(p.data); setCategories(c.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditProd(null); setForm({ barcode: '', name: '', price: 0, cost: 0, stock: 0, min_stock: 5, category_id: '' }); setError(''); setShowModal(true); };
  const openEdit = (p: Product) => { setEditProd(p); setForm({ barcode: p.barcode || '', name: p.name, price: p.price, cost: p.cost, stock: p.stock, min_stock: p.min_stock || 5, category_id: p.category_id?.toString() || '' }); setError(''); setShowModal(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form, category_id: form.category_id ? Number(form.category_id) : null };
      if (editProd) await api.put(`/pos-admin/products/${editProd.id}`, payload);
      else await api.post('/pos-admin/products', payload);
      setShowModal(false); load();
    } catch (err: any) { setError(err.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  };

  const del = async (id: number) => {
    if (!confirm('ลบสินค้านี้?')) return;
    try { await api.delete(`/pos-admin/products/${id}`); load(); } catch {}
  };

  const lowStockCount = products.filter(p => p.is_active && p.stock <= (p.min_stock || 5)).length;
  const filtered = products.filter(p => {
    if (search) { const q = search.toLowerCase(); if (!p.name.toLowerCase().includes(q) && !(p.barcode || '').includes(q)) return false; }
    if (filterCat && String(p.category_id) !== filterCat) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">จัดการสินค้า ({products.length})</h1>
          {lowStockCount > 0 && <p className="text-sm text-orange-600 mt-1">⚠️ สินค้าใกล้หมด {lowStockCount} รายการ</p>}
        </div>
        <button onClick={openAdd} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700">+ เพิ่มสินค้า</button>
      </div>

      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ/บาร์โค้ด..." className="border rounded-xl px-4 py-2 text-sm flex-1 max-w-xs" />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="border rounded-xl px-4 py-2 text-sm">
          <option value="">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? <p className="text-gray-500">กำลังโหลด...</p> : (
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="p-3 text-left">บาร์โค้ด</th><th className="p-3 text-left">ชื่อสินค้า</th>
              <th className="p-3 text-left">หมวด</th><th className="p-3 text-right">ราคา</th>
              <th className="p-3 text-right">ต้นทุน</th><th className="p-3 text-right">สต๊อก</th>
              <th className="p-3 text-center">สถานะ</th><th className="p-3 text-center">จัดการ</th>
            </tr></thead>
            <tbody>{filtered.map(p => {
              const isLow = p.is_active && p.stock <= (p.min_stock || 5);
              return (
                <tr key={p.id} className={`border-t hover:bg-gray-50 ${isLow ? 'bg-orange-50' : ''}`}>
                  <td className="p-3 font-mono text-xs">{p.barcode || '-'}</td>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-gray-500 text-xs">{p.category_name || '-'}</td>
                  <td className="p-3 text-right">฿{p.price}</td>
                  <td className="p-3 text-right text-gray-500">฿{p.cost}</td>
                  <td className={`p-3 text-right font-bold ${isLow ? 'text-red-600' : ''}`}>{p.stock}{isLow && ' ⚠️'}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'ขาย' : 'ปิด'}
                    </span>
                  </td>
                  <td className="p-3 text-center space-x-2">
                    <button onClick={() => openEdit(p)} className="text-blue-600 hover:underline text-xs">แก้</button>
                    <button onClick={() => del(p.id)} className="text-red-600 hover:underline text-xs">ลบ</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-gray-400">ไม่พบสินค้า</p>}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editProd ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>
            {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
            <form onSubmit={submit} className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium mb-1">บาร์โค้ด</label>
              <input value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="ไม่บังคับ" /></div>
              <div><label className="block text-xs font-medium mb-1">ชื่อสินค้า *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium mb-1">หมวดหมู่</label>
              <select value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm">
                <option value="">ไม่มีหมวด</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
              <div><label className="block text-xs font-medium mb-1">ราคาขาย (฿)</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: +e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium mb-1">ต้นทุน (฿)</label>
              <input type="number" step="0.01" value={form.cost} onChange={e => setForm({...form, cost: +e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium mb-1">สต๊อก</label>
              <input type="number" value={form.stock} onChange={e => setForm({...form, stock: +e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium mb-1">สต๊อกขั้นต่ำ (แจ้งเตือน)</label>
              <input type="number" value={form.min_stock} onChange={e => setForm({...form, min_stock: +e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div className="col-span-2 flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 border rounded-xl py-2 text-sm font-medium">ยกเลิก</button>
                <button type="submit" className="flex-1 bg-emerald-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-emerald-700">{editProd ? 'บันทึก' : 'เพิ่ม'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
