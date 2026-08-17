// 📄 pages/Schedules.tsx — หน้าตารางกะการทำงาน (ปฏิทิน)
//    ทำอะไร: ADMIN/MANAGER กำหนด/แก้/ลบกะพนักงานในปฏิทิน + ตั้งวันหยุด; CASHIER ดูได้อย่างเดียว (canManage=false)
// ✅ CHANGED: colors → DMTC Mart theme
// 🔒 UNCHANGED: fetchAll, handleSave, handleAddHoliday, openPopover, popover logic, all state

import { useState, useEffect, useRef } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, CalendarOff, X, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { inputCls } from '../components/ui/fieldStyles';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { getLocalDate } from '../utils/localDate';

interface StaffMember { id: number; full_name: string; role?: string; }
interface ScheduleRow { id: number; cashier_id: number; work_date: string; expected_start?: string; expected_end?: string; }
interface HolidayRow { id: number; holiday_date?: string; note?: string; }

const WEEKDAYS = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

export default function Schedules() {
  const user = getCurrentUserOrRedirect();
  // ⭐️ CASHIER เห็นตารางกะได้ (ดูอย่างเดียว) — ADMIN และ MANAGER แก้ไข/ลบ/กำหนดกะได้ทั้งคู่
  const canManage = user.role === 'ADMIN' || user.role === 'MANAGER';
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [popover, setPopover] = useState<{ date: string; x: number; y: number } | null>(null);
  const [popForm, setPopForm] = useState({ cashier_id: '', expected_start: '09:00', expected_end: '17:00' });
  // ⭐️ ถ้ากำลังแก้ตารางกะที่มีอยู่แล้ว (คลิกจาก badge) เก็บ id ไว้เพื่อรู้ว่าต้อง "แก้" ไม่ใช่ "เพิ่มใหม่"
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const [holidayForm, setHolidayForm] = useState({ holiday_date: '', note: '' });
  const [showHolidayPanel, setShowHolidayPanel] = useState(false);
  const monthStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;

  const fetchAll = async () => {
    try {
      // ⭐️ /api/staff-list (ไม่ใช่ /api/users) — คืนเฉพาะ CASHIER/MANAGER (พนักงานที่กำหนดกะได้จริง)
      //   ไม่มี ADMIN ปนมา และไม่มี student_id/เบอร์โทรติดมา
      const [staffRes, schRes, holRes] = await Promise.all([api.get('/staff-list'), api.get('/schedules'), api.get('/holidays')]);
      setStaff(staffRes.data);
      setSchedules(schRes.data); setHolidays(holRes.data);
    } catch (e) { console.error(e); }
  };

  // IIFE: ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation
  useEffect(() => { void (async () => { await fetchAll(); })(); }, [monthStr]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setPopover(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const holidaySet = new Set(holidays.map(h => h.holiday_date?.slice(0, 10)));
  const schedulesByDate: Record<string, ScheduleRow[]> = {};
  schedules.forEach(s => { const d = s.work_date?.slice(0, 10); if (!schedulesByDate[d]) schedulesByDate[d] = []; schedulesByDate[d].push(s); });
  const cells = [...Array(firstDayOfWeek).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  // 🐛 FIX — เดิม today.toISOString() เป็นวันแบบ UTC: ตอน 00:00–07:00 ไทยไฮไลต์ "วันนี้" เพี้ยนเป็น
  // วันก่อนหน้า — ใช้ getLocalDate() (วันตามเวลาท้องถิ่น)
  const todayStr = getLocalDate();
  const COLORS = ['bg-brand-bg text-brand','bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-purple-100 text-purple-700','bg-orange-100 text-orange-700'];
  const staffName = (id: number) => staff.find(s => s.id === id)?.full_name?.split(' ')[0] || `#${id}`;
  const staffColor = (id: number) => COLORS[staff.findIndex(s => s.id === id) % COLORS.length] || COLORS[0];

  const openPopover = (day: number, e: React.MouseEvent) => {
    if (!canManage) return; // ⭐️ CASHIER ดูปฏิทินได้อย่างเดียว แตะแล้วไม่เด้ง popover แก้ไข
    const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEditingScheduleId(null);
    setPopForm({ cashier_id: '', expected_start: '09:00', expected_end: '17:00' });
    setPopover({ date: dateStr, x: rect.left, y: rect.bottom + window.scrollY });
  };

  // ⭐️ คลิกที่ badge ของพนักงานคนใดคนหนึ่งในวันนั้น → เปิด popover พร้อม pre-fill เวลาเข้า-ออกงานจริงของคนนั้น
  // เพื่อแก้ไขได้ตรงๆ (เดิมเปิดมาแล้ว reset เป็น 09:00–17:00 เสมอ ทำให้ดูเหมือนทุกคนต้องเข้า-ออกงานเวลาเดียวกัน)
  const openEditSchedule = (s: ScheduleRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManage) return;
    const rect = (e.currentTarget as HTMLElement).closest('[data-day-cell]')?.getBoundingClientRect()
      || (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEditingScheduleId(s.id);
    setPopForm({ cashier_id: String(s.cashier_id), expected_start: s.expected_start?.slice(0,5) || '09:00', expected_end: s.expected_end?.slice(0,5) || '17:00' });
    setPopover({ date: s.work_date, x: rect.left, y: rect.bottom + window.scrollY });
  };

  const handleSave = async () => {
    if (!popForm.cashier_id || !popover) return Swal.fire({ icon: 'warning', title: 'กรุณาเลือกพนักงาน' });
    setSaving(true);
    try { await api.post('/schedules', { cashier_id: Number(popForm.cashier_id), work_date: popover.date, expected_start: popForm.expected_start, expected_end: popForm.expected_end }); setPopover(null); setEditingScheduleId(null); fetchAll(); }
    catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setSaving(false); }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    const confirm = await Swal.fire({ title: 'ลบตารางเวลานี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก' });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/schedules/${scheduleId}`);
      if (editingScheduleId === scheduleId) { setPopover(null); setEditingScheduleId(null); }
      fetchAll();
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayForm.holiday_date) return Swal.fire({ icon: 'warning', title: 'กรุณาเลือกวันที่' });
    try { await api.post('/holidays', holidayForm); setHolidayForm({ holiday_date: '', note: '' }); fetchAll(); }
    catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
  };



  return (
    <div className="min-h-screen bg-brand-bg pb-24">
      <div className="max-w-5xl mx-auto">
        {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (PageHeader) */}
        <PageHeader icon={CalendarClock} title="ตารางเวลาทำงาน" />

        <div className="p-4 sm:p-6">
        <p className="text-xs text-gray-400 mb-3 px-1">{canManage ? 'คลิกวันในปฏิทินเพื่อกำหนดกะ หรือคลิกชื่อพนักงานเพื่อแก้ไข' : 'ดูตารางเวลาทำงานของทีม (ผู้จัดการเป็นคนกำหนด)'}</p>

        {canManage && (
          <div className="mb-5">
            <button onClick={() => setShowHolidayPanel(!showHolidayPanel)} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-brand border border-brand-border px-4 py-2.5 rounded-full text-sm font-bold shadow-sm hover:bg-brand-bg active:scale-[0.98] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <CalendarOff size={15} /> วันหยุดพิเศษ
            </button>
          </div>
        )}

        {/* Holiday panel */}
        {canManage && showHolidayPanel && (
          <div className="bg-white border border-orange-200 rounded-3xl shadow-md p-4 mb-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><CalendarOff size={15} className="text-orange-500" /> จัดการวันหยุดพิเศษ</h2>
            <form onSubmit={handleAddHoliday} className="flex flex-wrap gap-2 mb-4">
              <input type="date" required value={holidayForm.holiday_date} onChange={e => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })} className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <input type="text" placeholder="ชื่อวันหยุด (ไม่บังคับ)" value={holidayForm.note} onChange={e => setHolidayForm({ ...holidayForm, note: e.target.value })} className="flex-1 min-w-[140px] px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <button type="submit" className="px-4 py-2 bg-orange-100 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-200 transition-colors duration-150">+ เพิ่ม</button>
            </form>
            <div className="flex flex-wrap gap-2">
              {holidays.map(h => <span key={h.id} className="text-xs font-medium px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-100 rounded-full">{new Date(h.holiday_date ?? '').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} {h.note && `— ${h.note}`}</span>)}
              {holidays.length === 0 && <span className="text-sm text-gray-400">ยังไม่มีวันหยุดพิเศษ</span>}
            </div>
          </div>
        )}

        {/* Calendar */}
        <div className="bg-white border border-brand-border rounded-3xl shadow-md overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
            <button onClick={prevMonth} className="p-2 hover:bg-brand-bg rounded-lg transition-colors duration-150 text-gray-500 hover:text-brand"><ChevronLeft size={18} /></button>
            <span className="text-sm font-bold text-gray-900">{MONTHS_TH[viewDate.getMonth()]} {viewDate.getFullYear() + 543}</span>
            <button onClick={nextMonth} className="p-2 hover:bg-brand-bg rounded-lg transition-colors duration-150 text-gray-500 hover:text-brand"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 bg-brand-bg">
            {WEEKDAYS.map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-gray-500">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px bg-brand-border">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="bg-white min-h-[72px]" />;
              const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;
              const isHoliday = holidaySet.has(dateStr);
              const dayScheds = schedulesByDate[dateStr] || [];
              return (
                <div key={`day-${i}`} data-day-cell onClick={e => !isHoliday && openPopover(day, e)}
                  className={`min-h-[72px] p-1.5 flex flex-col transition-colors duration-150 ${isHoliday ? 'bg-orange-50 cursor-default' : canManage ? 'bg-white hover:bg-brand-bg cursor-pointer' : 'bg-white cursor-default'}`}>
                  <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? 'bg-brand text-white' : isHoliday ? 'text-orange-500' : 'text-gray-700'}`}>{day}</span>
                  {isHoliday && <span className="text-[9px] text-orange-500 font-medium leading-tight">หยุด</span>}
                  <div className="space-y-0.5 overflow-hidden">
                    {dayScheds.slice(0, 3).map((s: ScheduleRow, idx: number) => (
                      <span key={idx} onClick={e => openEditSchedule(s, e)}
                        className={`text-[9px] font-medium px-1 py-0.5 rounded block truncate ${staffColor(s.cashier_id)} ${canManage ? 'hover:ring-1 hover:ring-black/10 cursor-pointer' : ''}`}
                        title={canManage ? 'คลิกเพื่อแก้ไขเวลาของคนนี้' : undefined}>
                        {staffName(s.cashier_id)} {s.expected_start?.slice(0,5)}–{s.expected_end?.slice(0,5)}
                      </span>
                    ))}
                    {dayScheds.length > 3 && <span className="text-[9px] text-gray-400">+{dayScheds.length - 3}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-2">
          {staff.map((s, i) => (
            <span key={s.id} className={`text-xs font-medium px-3 py-1 rounded-full ${COLORS[i % COLORS.length]}`}>{s.full_name}</span>
          ))}
        </div>
        </div>
      </div>

      {/* Popover */}
      {popover && (
        <div ref={popRef} className="fixed z-[100] bg-white border border-brand-border rounded-3xl shadow-xl p-4 w-64 animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ left: Math.min(popover.x, window.innerWidth - 280), top: popover.y + 8 }}>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-900">
              {editingScheduleId ? 'แก้ไขกะ — ' : ''}
              {new Date(popover.date + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
            </h3>
            <button onClick={() => { setPopover(null); setEditingScheduleId(null); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-brand-bg rounded-lg transition-colors duration-150" aria-label="ปิด"><X size={14} /></button>
          </div>
          <select value={popForm.cashier_id} onChange={e => setPopForm({ ...popForm, cashier_id: e.target.value })} className={`${inputCls} w-full mb-2`}>
            <option value="">เลือกพนักงาน</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
          </select>
          {/* ⭐️ ไม่ต้องเป็น 09:00–17:00 เหมือนกันทุกคน — ปรับเวลาเข้า/ออกงานของแต่ละคนแยกกันได้ตรงนี้ */}
          <div className="flex items-center gap-1.5 mb-3">
            <input type="time" value={popForm.expected_start} onChange={e => setPopForm({ ...popForm, expected_start: e.target.value })} className={`${inputCls} flex-1`} />
            <span className="text-gray-400 text-xs">–</span>
            <input type="time" value={popForm.expected_end} onChange={e => setPopForm({ ...popForm, expected_end: e.target.value })} className={`${inputCls} flex-1`} />
          </div>
          {(schedulesByDate[popover.date] || []).map((s: ScheduleRow) => (
            <div key={s.id} className={`flex justify-between items-center px-2 py-1 rounded-lg mb-1 text-xs font-medium ${staffColor(s.cashier_id)} ${editingScheduleId === s.id ? 'ring-2 ring-brand' : ''}`}>
              <button type="button" onClick={(e) => openEditSchedule(s, e)} className="flex-1 text-left truncate">
                {staffName(s.cashier_id)} {s.expected_start?.slice(0,5)}–{s.expected_end?.slice(0,5)}
              </button>
              <button type="button" onClick={() => handleDeleteSchedule(s.id)} className="p-1 ml-1 rounded-md text-current opacity-60 hover:opacity-100 hover:bg-black/10 transition" title="ลบ">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <Button onClick={handleSave} disabled={saving} loading={saving} className="w-full mt-1">
            {saving ? 'กำลังบันทึก...' : editingScheduleId ? 'บันทึกการแก้ไข' : '+ เพิ่มกะ'}
          </Button>
        </div>
      )}
    </div>
  );
}
