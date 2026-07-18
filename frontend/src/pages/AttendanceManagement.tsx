// ✅ CHANGED: colors → DMTC Mart theme
// 🔒 UNCHANGED: fetchRecords, handleDelete, handleSaveEdit, handleRunAutoCheckout, all filtering logic

import { useState, useEffect } from 'react';
import { ClipboardCheck, RefreshCw, Edit2, Camera, Trash2 } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { openAuthImage } from '../components/AuthImage'; // ⭐️ SECURITY FIX #1 — เปิดรูปเข้า-ออกงานผ่าน JWT

export default function AttendanceManagement() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAuto, setRunningAuto] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ check_in: '', check_out: '', note: '' });
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterUser, setFilterUser] = useState('');

  useEffect(() => { fetchRecords(); }, [filterDate]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const month = filterDate.slice(0, 7);
      const res = await api.get(`/attendance?month=${month}`);
      setRecords(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const filtered = records.filter(r => {
    const dateOk = !filterDate || (r.check_in && r.check_in.slice(0, 10) === filterDate);
    const nameOk = !filterUser || r.full_name?.includes(filterUser);
    return dateOk && nameOk;
  });

  const toLocalInput = (v: string | null) => {
    if (!v) return '';
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setEditForm({ check_in: toLocalInput(r.check_in), check_out: toLocalInput(r.check_out), note: r.note || '' });
  };

  const handleDelete = async (r: any) => {
    const confirm = await Swal.fire({ title: `ลบรายการของ ${r.full_name}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    try { await api.delete(`/attendance/${r.id}?source=${r.source}`); fetchRecords(); }
    catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/attendance/${editing.id}`, {
        check_in: editForm.check_in ? new Date(editForm.check_in).toISOString().slice(0, 19).replace('T', ' ') : undefined,
        check_out: editForm.check_out ? new Date(editForm.check_out).toISOString().slice(0, 19).replace('T', ' ') : undefined,
        note: editForm.note || undefined,
        source: editing.source
      });
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', showConfirmButton: false, timer: 1500 });
      setEditing(null); fetchRecords();
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleRunAutoCheckout = async () => {
    const confirm = await Swal.fire({ title: 'รันตรวจสอบลืมออกงาน/ปิดกะข้ามวัน?', icon: 'question', text: 'ระบบจะตัดออกงาน/ปิดกะให้อัตโนมัติทุกรายการที่ค้างข้ามวัน', showCancelButton: true, confirmButtonColor: '#F12B6B', cancelButtonColor: '#9ca3af', confirmButtonText: 'รันเลย', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    setRunningAuto(true);
    try {
      const res = await api.post('/attendance/auto-checkout-stale');
      Swal.fire({ icon: 'success', title: 'ตรวจสอบเสร็จแล้ว', text: `ตัดออกงาน ${res.data.attendance_closed} คน, ปิดกะ ${res.data.shifts_closed} กะ` });
      fetchRecords();
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setRunningAuto(false); }
  };

  const inputCls = "px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150";

  return (
    <div className="min-h-screen bg-gray-50 pb-24 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl flex items-center justify-center shrink-0">
              <ClipboardCheck size={18} className="text-[#F12B6B]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">จัดการเข้า-ออกงาน</h1>
              <p className="text-xs text-gray-500">แก้ไขกรณีลืมลงเวลา + ตรวจสอบรูปยืนยันสถานที่</p>
            </div>
          </div>
          <button onClick={handleRunAutoCheckout} disabled={runningAuto} className="flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-orange-100 transition-colors duration-150 disabled:opacity-50">
            <RefreshCw size={15} className={runningAuto ? 'animate-spin' : ''} /> รันตรวจสอบลืมออกงาน
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className={inputCls} />
          <input type="text" placeholder="ค้นหาชื่อ..." value={filterUser} onChange={e => setFilterUser(e.target.value)} className={`${inputCls} w-36`} />
          <button onClick={fetchRecords} className="p-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-[#F12B6B] hover:bg-[#F12B6B] hover:text-white transition-all duration-150 active:scale-95" title="รีเฟรช">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm overflow-hidden">
          {/* Desktop */}
          <table className="hidden sm:table w-full text-left">
            <thead>
              <tr className="border-b border-[#F6C7C7] bg-[#FFF5F7]">
                {['พนักงาน','เข้างาน','ออกงาน','รูป','หมายเหตุ',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({length:4}).map((_,i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[#F6C7C7]/40 rounded-lg animate-pulse w-3/4" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบข้อมูล{filterDate ? ` วันที่ ${filterDate}` : ''}</td></tr>
              ) : filtered.map(r => (
                <tr key={`${r.source}-${r.id}`} className="hover:bg-[#FFF5F7] transition-colors duration-150">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${r.source === 'SHIFT' ? 'bg-[#FFF5F7] text-[#F12B6B] border border-[#FD94B4]' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                        {r.source === 'SHIFT' ? 'กะขาย' : 'ลงชื่อ'}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{r.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.check_in ? new Date(r.check_in).toLocaleString('th-TH') : '-'}</td>
                  <td className="px-4 py-3 text-sm">{r.check_out ? <span className="text-gray-600">{new Date(r.check_out).toLocaleString('th-TH')}</span> : <span className="text-red-500 font-semibold">ยังไม่ออก</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {/* ⭐️ SECURITY FIX #1 — รูปเข้า-ออกงานถูกล็อกให้ต้องมี JWT แล้ว เปิดผ่าน openAuthImage (โหลด blob แนบ token) แทน <a href> ที่จะโดน 401 */}
                      {r.check_in_photo && <button onClick={() => openAuthImage(r.check_in_photo)} title="รูปตอนเข้า" className="p-1 bg-emerald-50 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors duration-150"><Camera size={14} /></button>}
                      {r.check_out_photo && <button onClick={() => openAuthImage(r.check_out_photo)} title="รูปตอนออก" className="p-1 bg-red-50 rounded-lg text-red-500 hover:bg-red-100 transition-colors duration-150"><Camera size={14} /></button>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[150px] truncate">{r.note || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-[#F12B6B] hover:bg-[#FFF5F7] rounded-lg transition-colors duration-150"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(r)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors duration-150"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-50">
            {loading ? <div className="p-4 space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="h-20 bg-[#F6C7C7]/40 rounded-xl animate-pulse" />)}</div>
            : filtered.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">ไม่พบข้อมูล</p>
            : filtered.map(r => (
              <div key={`${r.source}-${r.id}`} className="p-4 hover:bg-[#FFF5F7] transition-colors duration-150">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold mr-1.5 ${r.source === 'SHIFT' ? 'bg-[#FFF5F7] text-[#F12B6B] border border-[#FD94B4]' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                      {r.source === 'SHIFT' ? 'กะขาย' : 'ลงชื่อ'}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{r.full_name}</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-[#F12B6B] hover:bg-[#FFF5F7] rounded-lg transition-colors duration-150"><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(r)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors duration-150"><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">เข้า: {r.check_in ? new Date(r.check_in).toLocaleString('th-TH') : '-'}</p>
                <p className="text-xs">{r.check_out ? <span className="text-gray-500">ออก: {new Date(r.check_out).toLocaleString('th-TH')}</span> : <span className="text-red-500 font-semibold">ยังไม่ออกงาน</span>}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-4">แก้ไขเวลา: {editing.full_name}</h3>
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">เวลาเข้างาน</label><input type="datetime-local" value={editForm.check_in} onChange={e => setEditForm({ ...editForm, check_in: e.target.value })} className={`${inputCls} w-full`} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">เวลาออกงาน</label><input type="datetime-local" value={editForm.check_out} onChange={e => setEditForm({ ...editForm, check_out: e.target.value })} className={`${inputCls} w-full`} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">หมายเหตุ</label><input type="text" value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} placeholder="เช่น ลืมลงชื่อออก..." className={`${inputCls} w-full`} /></div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditing(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors duration-150">ยกเลิก</button>
                <button type="submit" className="flex-1 py-2.5 bg-[#F12B6B] hover:bg-[#FF467E] text-white rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95">บันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
