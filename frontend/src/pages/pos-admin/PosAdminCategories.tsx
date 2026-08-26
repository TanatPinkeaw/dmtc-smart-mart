import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminCategories() {
  const [cats, setCats] = useState<any[]>([]);
  const [name, setName] = useState('');
  const load = () => api.get('/pos-admin/categories').then(r=>setCats(r.data)).catch(()=>{});
  useEffect(()=>{load();},[]);
  const add = async(e:React.FormEvent)=>{e.preventDefault();if(!name.trim())return;await api.post('/pos-admin/categories',{name});setName('');load();};
  const del = async(id:number)=>{if(!confirm('ลบ?'))return;await api.delete(`/pos-admin/categories/${id}`);load();};
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">จัดการหมวดหมู่</h1>
      <form onSubmit={add} className="flex gap-2 mb-6">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อหมวดหมู่" className="border rounded-xl px-4 py-2 flex-1" />
        <button type="submit" className="bg-emerald-600 text-white px-6 py-2 rounded-xl">เพิ่ม</button>
      </form>
      <div className="bg-white rounded-2xl shadow divide-y">
        {cats.map(c=>(
          <div key={c.id} className="flex items-center justify-between p-4">
            <span>{c.name}</span>
            <button onClick={()=>del(c.id)} className="text-red-600 text-sm">ลบ</button>
          </div>
        ))}
      </div>
    </div>
  );
}
