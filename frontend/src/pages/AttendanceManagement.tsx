// 📄 pages/AttendanceManagement.tsx — หน้าจัดการเวลาเข้า-ออกงานพนักงาน (ADMIN/MANAGER)
//    ทำอะไร: ดู/แก้/ลบบันทึกเข้า-ออกงาน + สั่ง auto check-out คนที่ลืมออกงาน + กรองตามช่วง/คน
// ✅ CHANGED: colors → DMTC Mart theme
// 🔒 UNCHANGED: fetchRecords, handleDelete, handleSaveEdit, handleRunAutoCheckout, all filtering logic

import { useState, useEffect } from 'react';
import { ClipboardCheck, RefreshCw, Edit2, Camera, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { inputCls } from '../components/ui/fieldStyles';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme';
import { getErrorMessage } from '../utils/errorMessage';
import AuthImage from '../components/common/AuthImage'; // ⭐️ SECURITY FIX #1 — เปิดรูปเข้า-ออกงานผ่าน JWT
import PhotoLightbox from '../components/common/PhotoLightbox'; // ⭐️ mobile — แตะรูปดูแบบ modal ในหน้า แทนเปิดแท็บใหม่ (window.open blob ที่มือถือหลายรุ่นบล็อก)
import { getLocalDate } from '../utils/localDate'; // ⭐️ วันนี้ตามเวลาท้องถิ่น (กันเพี้ยนจาก toISOString ที่เป็น UTC — ย้าย helper ไป utils กลาง)

interface AttendanceRecord {
  id: number;
  full_name: string;
  check_in?: string | null;
  check_out?: string | null;
  note?: string | null;
  source?: string;
  photo_path?: string | null;
  check_in_photo?: string | null;
  check_out_photo?: string | null;
  role?: string;
}

export default function AttendanceManagement() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAuto, setRunningAuto] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [editForm, setEditForm] = useState({ check_in: '', check_out: '', note: '' });
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [filterUser, setFilterUser] = useState('');
  const [lightbox, setLightbox] = useState<{ path: string; title: string } | null>(null);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const month = filterDate.slice(0, 7);
      const res = await api.get(`/attendance?month=${month}`);
      setRecords(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // IIFE: ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation
  useEffect(() => { void (async () => { await fetchRecords(); })(); }, [filterDate]);

  const filtered = records.filter(r => {
    const dateOk = !filterDate || (r.check_in && r.check_in.slice(0, 10) === filterDate);
    const nameOk = !filterUser || r.full_name?.includes(filterUser);
    return dateOk && nameOk;
  });

  const toLocalInput = (v: string | null | undefined) => {
    if (!v) return '';
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const openEdit = (r: AttendanceRecord) => {
    setEditing(r);
    setEditForm({ check_in: toLocalInput(r.check_in), check_out: toLocalInput(r.check_out), note: r.note || '' });
  };

  const handleDelete = async (r: AttendanceRecord) => {
    const confirm = await Swal.fire({ title: `ลบรายการของ ${r.full_name}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    try { await api.delete(`/attendance/${r.id}?source=${r.source}`); fetchRecords(); }
    catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return; // กัน null — ฟอร์มแก้ไขเปิดเมื่อมี editing เสมอ
    try {
      await api.put(`/attendance/${editing.id}`, {
        check_in: editForm.check_in ? new Date(editForm.check_in).toISOString().slice(0, 19).replace('T', ' ') : undefined,
        check_out: editForm.check_out ? new Date(editForm.check_out).toISOString().slice(0, 19).replace('T', ' ') : undefined,
        note: editForm.note || undefined,
        source: editing.source
      });
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', showConfirmButton: false, timer: 1500 });
      setEditing(null); fetchRecords();
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleRunAutoCheckout = async () => {
    const confirm = await Swal.fire({ title: 'รันตรวจสอบลืมออกงาน/ปิดกะข้ามวัน?', icon: 'question', text: 'ระบบจะตัดออกงาน/ปิดกะให้อัตโนมัติทุกรายการที่ค้างข้ามวัน', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af', confirmButtonText: 'รันเลย', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    setRunningAuto(true);
    try {
      const res = await api.post('/attendance/auto-checkout-stale');
      Swal.fire({ icon: 'success', title: 'ตรวจสอบเสร็จแล้ว', text: `ตัดออกงาน ${res.data.attendance_closed} คน, ปิดกะ ${res.data.shifts_closed} กะ` });
      fetchRecords();
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setRunningAuto(false); }
  };



  return (
    <div className="min-h-screen bg-brand-bg pb-24">
      <div className="max-w-5xl mx-auto">

        {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (PageHeader) */}
        <PageHeader icon={ClipboardCheck} title="จัดการเข้า-ออกงาน" />

        <div className="p-4 sm:p-6">
        <p className="text-xs text-gray-400 mb-3 px-1">แก้ไขกรณีลืมลงเวลา + ตรวจสอบรูปยืนยันสถานที่</p>

        <div className="mb-5">
          <button onClick={handleRunAutoCheckout} disabled={runningAuto} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-brand border border-brand-border px-4 py-2.5 rounded-full text-sm font-bold shadow-sm hover:bg-brand-bg active:scale-[0.98] transition-all duration-150 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <RefreshCw size={15} className={runningAuto ? 'animate-spin' : ''} /> รันตรวจสอบลืมออกงาน
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className={inputCls} />
          <input type="text" placeholder="ค้นหาชื่อ..." value={filterUser} onChange={e => setFilterUser(e.target.value)} className={`${inputCls} w-36`} />
          <button onClick={fetchRecords} className="p-2.5 bg-brand-bg border border-brand-border rounded-xl text-brand hover:bg-brand hover:text-white transition-all duration-150 active:scale-95" title="รีเฟรช">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-brand-border rounded-3xl shadow-md overflow-hidden">
          {/* Desktop */}
          <table className="hidden sm:table w-full text-left">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg">
                {['พนักงาน','เข้างาน','ออกงาน','รูป','หมายเหตุ',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({length:4}).map((_,i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-brand-border/40 rounded-lg animate-pulse w-3/4" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบข้อมูล{filterDate ? ` วันที่ ${filterDate}` : ''}</td></tr>
              ) : filtered.map(r => (
                <tr key={`${r.source}-${r.id}`} className="hover:bg-brand-bg transition-colors duration-150">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${r.source === 'SHIFT' ? 'bg-brand-bg text-brand border border-brand-mid' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                        {r.source === 'SHIFT' ? 'กะขาย' : 'ลงชื่อ'}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{r.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.check_in ? new Date(r.check_in).toLocaleString('th-TH') : '-'}</td>
                  <td className="px-4 py-3 text-sm">{r.check_out ? <span className="text-gray-600">{new Date(r.check_out).toLocaleString('th-TH')}</span> : <span className="text-red-500 font-semibold">ยังไม่ออก</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {/* ⭐️ SECURITY FIX #1 — รูปเข้า-ออกงานถูกล็อกให้ต้องมี JWT แล้ว เปิดผ่าน PhotoLightbox (โหลด blob แนบ token) แทน <a href> ที่จะโดน 401 */}
                      {r.check_in_photo && <button onClick={() => setLightbox({ path: r.check_in_photo ?? '', title: `รูปตอนเข้างาน — ${r.full_name}` })} title="รูปตอนเข้า" className="p-1 bg-emerald-50 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors duration-150"><Camera size={14} /></button>}
                      {r.check_out_photo && <button onClick={() => setLightbox({ path: r.check_out_photo ?? '', title: `รูปตอนออกงาน — ${r.full_name}` })} title="รูปตอนออก" className="p-1 bg-red-50 rounded-lg text-red-500 hover:bg-red-100 transition-colors duration-150"><Camera size={14} /></button>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[150px] truncate">{r.note || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand-bg rounded-lg transition-colors duration-150"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(r)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors duration-150"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-50">
            {loading ? <div className="p-4 space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="h-20 bg-brand-border/40 rounded-xl animate-pulse" />)}</div>
            : filtered.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">ไม่พบข้อมูล</p>
            : filtered.map(r => (
              <div key={`${r.source}-${r.id}`} className="p-4 hover:bg-brand-bg transition-colors duration-150">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold mr-1.5 ${r.source === 'SHIFT' ? 'bg-brand-bg text-brand border border-brand-mid' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                      {r.source === 'SHIFT' ? 'กะขาย' : 'ลงชื่อ'}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{r.full_name}</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand-bg rounded-lg transition-colors duration-150"><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(r)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors duration-150"><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">เข้า: {r.check_in ? new Date(r.check_in).toLocaleString('th-TH') : '-'}</p>
                <p className="text-xs">{r.check_out ? <span className="text-gray-500">ออก: {new Date(r.check_out).toLocaleString('th-TH')}</span> : <span className="text-red-500 font-semibold">ยังไม่ออกงาน</span>}</p>

                {/* ⭐️ รูปยืนยันสถานที่ — แตะที่ thumbnail เพื่อดูแบบเต็มจอ (มือถือ) */}
                {(r.check_in_photo || r.check_out_photo) && (
                  <div className="flex gap-2 mt-2.5">
                    {r.check_in_photo && (
                      <button
                        onClick={() => setLightbox({ path: r.check_in_photo ?? '', title: `รูปตอนเข้างาน — ${r.full_name}` })}
                        className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-200 active:scale-95 transition-transform duration-150 shrink-0"
                        aria-label="ดูรูปตอนเข้างาน"
                      >
                        <AuthImage path={r.check_in_photo ?? ''} alt="รูปตอนเข้างาน" className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-gray-100 flex items-center justify-center"><Camera size={16} className="text-gray-300" /></div>} />
                        <span className="absolute bottom-0 inset-x-0 bg-emerald-600/80 text-white text-[9px] font-bold text-center py-0.5">เข้า</span>
                      </button>
                    )}
                    {r.check_out_photo && (
                      <button
                        onClick={() => setLightbox({ path: r.check_out_photo ?? '', title: `รูปตอนออกงาน — ${r.full_name}` })}
                        className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-red-200 active:scale-95 transition-transform duration-150 shrink-0"
                        aria-label="ดูรูปตอนออกงาน"
                      >
                        <AuthImage path={r.check_out_photo ?? ''} alt="รูปตอนออกงาน" className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-gray-100 flex items-center justify-center"><Camera size={16} className="text-gray-300" /></div>} />
                        <span className="absolute bottom-0 inset-x-0 bg-red-500/80 text-white text-[9px] font-bold text-center py-0.5">ออก</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)} title={`แก้ไขเวลา: ${editing.full_name}`}>
            <form onSubmit={handleSaveEdit} className="space-y-3 p-5">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">เวลาเข้างาน</label><input type="datetime-local" value={editForm.check_in} onChange={e => setEditForm({ ...editForm, check_in: e.target.value })} className={`${inputCls} w-full`} /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">เวลาออกงาน</label><input type="datetime-local" value={editForm.check_out} onChange={e => setEditForm({ ...editForm, check_out: e.target.value })} className={`${inputCls} w-full`} /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุ</label><input type="text" value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} placeholder="เช่น ลืมลงชื่อออก..." className={`${inputCls} w-full`} /></div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditing(null)}>ยกเลิก</Button>
                <Button type="submit" className="flex-1">บันทึก</Button>
              </div>
            </form>
        </Modal>
      )}

      {/* ⭐️ Lightbox รูปยืนยันสถานที่ — responsive ทั้งมือถือ/เดสก์ท็อป */}
      {lightbox && (
        <PhotoLightbox path={lightbox.path} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
