import { useState, useEffect } from 'react';
import api from '../../api';

export default function PosAdminSettings() {
  const [form, setForm] = useState({
    store_name: '', tax_id: '', address: '', receipt_footer: '',
    tax_rate: '', min_stock_threshold: '',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/pos-admin/settings').then(r => {
      const d = r.data;
      setForm({
        store_name: d.store_name || '',
        tax_id: d.tax_id || '',
        address: d.address || '',
        receipt_footer: d.receipt_footer || '',
        tax_rate: d.tax_rate ?? '',
        min_stock_threshold: d.min_stock_threshold ?? '',
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      await api.put('/pos-admin/settings', form);
      localStorage.setItem('pos_admin_store', form.store_name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) { setError(err.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  };

  if (loading) return <p className="text-gray-500">กำลังโหลด...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ตั้งค่าร้าน</h1>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <form onSubmit={save} className="bg-white rounded-2xl shadow p-6 max-w-xl space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">ชื่อร้าน</label>
          <input value={form.store_name} onChange={e => setForm({...form, store_name: e.target.value})} required className="w-full border rounded-xl px-4 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">เลขประจำตัวผู้เสียภาษี</label>
          <input value={form.tax_id} onChange={e => setForm({...form, tax_id: e.target.value})} className="w-full border rounded-xl px-4 py-2 text-sm" placeholder="เช่น 0-1234-56789-01-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ที่อยู่ร้าน</label>
          <textarea value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full border rounded-xl px-4 py-2 text-sm" rows={2} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ข้อความท้ายใบเสร็จ</label>
          <textarea value={form.receipt_footer} onChange={e => setForm({...form, receipt_footer: e.target.value})} className="w-full border rounded-xl px-4 py-2 text-sm" rows={2} placeholder="เช่น ขอบคุณที่ใช้บริการ" />
        </div>

        <hr className="my-2" />
        <p className="text-sm font-semibold text-gray-700">ตั้งค่าระบบ</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">อัตราภาษี (%)</label>
            <input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({...form, tax_rate: e.target.value})} className="w-full border rounded-xl px-4 py-2 text-sm" placeholder="เช่น 7" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">สต๊อกขั้นต่ำ (แจ้งเตือน)</label>
            <input type="number" value={form.min_stock_threshold} onChange={e => setForm({...form, min_stock_threshold: e.target.value})} className="w-full border rounded-xl px-4 py-2 text-sm" placeholder="เช่น 5" />
          </div>
        </div>

        <button type="submit" className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700">
          {saved ? '✅ บันทึกแล้ว' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}
