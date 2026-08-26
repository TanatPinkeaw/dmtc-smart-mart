import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminSettings() {
  const [form, setForm] = useState({store_name:'',tax_id:'',address:'',receipt_footer:''});
  const [saved, setSaved] = useState(false);
  useEffect(()=>{api.get('/pos-admin/settings').then(r=>setForm(r.data)).catch(()=>{});},[]);
  const save = async(e:React.FormEvent)=>{
    e.preventDefault();
    await api.put('/pos-admin/settings',form);
    localStorage.setItem('pos_admin_store',form.store_name);
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  };
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ตั้งค่าร้าน</h1>
      <form onSubmit={save} className="bg-white rounded-2xl shadow p-6 max-w-xl space-y-4">
        <div><label className="block text-sm font-medium mb-1">ชื่อร้าน</label>
          <input value={form.store_name} onChange={e=>setForm({...form,store_name:e.target.value})} className="w-full border rounded-xl px-4 py-2" /></div>
        <div><label className="block text-sm font-medium mb-1">เลขภาษี</label>
          <input value={form.tax_id} onChange={e=>setForm({...form,tax_id:e.target.value})} className="w-full border rounded-xl px-4 py-2" /></div>
        <div><label className="block text-sm font-medium mb-1">ที่อยู่</label>
          <textarea value={form.address} onChange={e=>setForm({...form,address:e.target.value})} className="w-full border rounded-xl px-4 py-2" rows={2} /></div>
        <div><label className="block text-sm font-medium mb-1">ข้อความท้ายใบเสร็จ</label>
          <textarea value={form.receipt_footer} onChange={e=>setForm({...form,receipt_footer:e.target.value})} className="w-full border rounded-xl px-4 py-2" rows={2} /></div>
        <button type="submit" className="bg-emerald-600 text-white px-6 py-2 rounded-xl">
          {saved?'✅ บันทึกแล้ว':'บันทึก'}
        </button>
      </form>
    </div>
  );
}
