import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminProducts() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ barcode:'', name:'', price:0, cost:0, stock:0, category_id:'' });
  const [editing, setEditing] = useState<number|null>(null);

  const load = () => { api.get('/pos-admin/products').then(r => { setProducts(r.data); setLoading(false); }).catch(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/pos-admin/products/${editing}`, form);
      else await api.post('/pos-admin/products', form);
      setForm({ barcode:'', name:'', price:0, cost:0, stock:0, category_id:'' });
      setEditing(null);
      load();
    } catch(err:any) { alert(err.response?.data?.error||'Error'); }
  };

  const del = async (id:number) => { if(!confirm('ลบ?')) return; await api.delete(`/pos-admin/products/${id}`); load(); };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">จัดการสินค้า</h1>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow p-6 mb-6 grid grid-cols-2 md:grid-cols-6 gap-4">
        <input placeholder="บาร์โค้ด" value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} className="border rounded-xl px-3 py-2" />
        <input placeholder="ชื่อสินค้า" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required className="border rounded-xl px-3 py-2" />
        <input type="number" placeholder="ราคา" value={form.price} onChange={e=>setForm({...form,price:+e.target.value})} className="border rounded-xl px-3 py-2" />
        <input type="number" placeholder="ต้นทุน" value={form.cost} onChange={e=>setForm({...form,cost:+e.target.value})} className="border rounded-xl px-3 py-2" />
        <input type="number" placeholder="สต๊อก" value={form.stock} onChange={e=>setForm({...form,stock:+e.target.value})} className="border rounded-xl px-3 py-2" />
        <button type="submit" className="bg-emerald-600 text-white rounded-xl py-2">{editing?'แก้ไข':'เพิ่ม'}</button>
      </form>
      {loading ? <p>กำลังโหลด...</p> : (
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="p-3 text-left">บาร์โค้ด</th><th className="p-3 text-left">ชื่อ</th>
              <th className="p-3 text-right">ราคา</th><th className="p-3 text-right">สต๊อก</th><th className="p-3">จัดการ</th>
            </tr></thead>
            <tbody>{products.map(p=>(
              <tr key={p.id} className="border-t hover:bg-gray-50">
                <td className="p-3">{p.barcode||'-'}</td><td className="p-3">{p.name}</td>
                <td className="p-3 text-right">฿{p.price}</td><td className="p-3 text-right">{p.stock}</td>
                <td className="p-3 text-center">
                  <button onClick={()=>{setEditing(p.id);setForm({barcode:p.barcode||'',name:p.name,price:p.price,cost:p.cost,stock:p.stock,category_id:p.category_id||''});}} className="text-blue-600 mr-2">แก้</button>
                  <button onClick={()=>del(p.id)} className="text-red-600">ลบ</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
