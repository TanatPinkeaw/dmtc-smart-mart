// ✅ CHANGED: colors → DMTC Mart theme
// 🔒 UNCHANGED: fetchData, calendar logic, all state

import { useState, useEffect } from 'react';
import { CalendarDays, CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

export default function StaffCalendar() {
  const [today] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [holidays, setHolidays] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const monthStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => { fetchData(); }, [monthStr]);

  const fetchData = async () => {
    try {
      const holRes = await api.get('/holidays');
      setHolidays(holRes.data);
      if (user.role === 'CASHIER' || user.role === 'ADMIN') {
        const schRes = await api.get(`/schedules?cashier_id=${user.id}`);
        setSchedules(schRes.data);
      }
    } catch (e) { console.error(e); }
  };

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const holidayDates = new Set(holidays.map(h => h.holiday_date?.slice(0, 10)));
  const holidayMap: Record<string, string> = {};
  holidays.forEach(h => { if (h.holiday_date) holidayMap[h.holiday_date.slice(0, 10)] = h.note || 'วันหยุดพิเศษ'; });
  const scheduleMap: Record<string, any> = {};
  schedules.forEach(s => { if (s.work_date) scheduleMap[s.work_date.slice(0, 10)] = s; });
  const todayStr = today.toISOString().slice(0, 10);
  const cells: (number | null)[] = [...Array(firstDayOfWeek).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="min-h-screen bg-gray-50 pb-24 p-4 sm:p-6">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl flex items-center justify-center shrink-0">
            <CalendarDays size={18} className="text-[#F12B6B]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">ปฏิทินวันทำงาน</h1>
            <p className="text-xs text-gray-500">ตารางงาน + วันหยุดพิเศษของสหกรณ์</p>
          </div>
        </div>

        {/* Calendar card */}
        <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm overflow-hidden mb-4">
          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#F6C7C7]">
            <button onClick={prevMonth} className="p-2 hover:bg-[#FFF5F7] rounded-lg transition-colors duration-150 text-gray-500 hover:text-[#F12B6B]"><ChevronLeft size={18} /></button>
            <span className="text-sm font-bold text-gray-900">{MONTHS_TH[viewDate.getMonth()]} {viewDate.getFullYear() + 543}</span>
            <button onClick={nextMonth} className="p-2 hover:bg-[#FFF5F7] rounded-lg transition-colors duration-150 text-gray-500 hover:text-[#F12B6B]"><ChevronRight size={18} /></button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 bg-[#FFF5F7]">
            {WEEKDAYS.map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-gray-500">{d}</div>)}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-px bg-[#F6C7C7]">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} className="bg-white min-h-[60px]" />;
              const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;
              const isHoliday = holidayDates.has(dateStr);
              const sched = scheduleMap[dateStr];
              return (
                <div key={`day-${i}`} className={`min-h-[60px] p-1.5 flex flex-col ${isHoliday ? 'bg-orange-50' : 'bg-white'}`}>
                  <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-[#F12B6B] text-white' : isHoliday ? 'text-orange-500' : 'text-gray-700'}`}>{day}</span>
                  {isHoliday && <span className="mt-0.5 text-[9px] text-orange-500 font-medium leading-tight">{holidayMap[dateStr]}</span>}
                  {sched && !isHoliday && <span className="mt-0.5 text-[9px] text-[#F12B6B] font-semibold bg-[#FFF5F7] rounded px-1 leading-tight">{sched.expected_start?.slice(0,5)}–{sched.expected_end?.slice(0,5)}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#F12B6B] inline-block" /> วันนี้</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-50 border border-orange-200 inline-block" /> วันหยุดพิเศษ</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#FFF5F7] border border-[#F6C7C7] inline-block" /> กะที่กำหนดไว้</span>
        </div>

        {/* Holiday list */}
        {holidays.length > 0 && (
          <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <CalendarOff size={15} className="text-orange-500" /> วันหยุดพิเศษ
            </h2>
            <ul className="space-y-2 divide-y divide-gray-50">
              {holidays.slice(0, 10).map(h => (
                <li key={h.id} className="flex justify-between items-center text-xs py-1.5 first:pt-0">
                  <span className="font-semibold text-orange-500">{new Date(h.holiday_date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="text-gray-400">{h.note || 'วันหยุดพิเศษ'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
