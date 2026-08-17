// 📄 pages/ForgotPassword.tsx — หน้าลืมรหัสผ่าน (ยืนยันตัวตนด้วยเบอร์โทร แล้วไปตั้งรหัสใหม่)
// ✅ CHANGED: visual refresh to match Home/Login design language (rounded-3xl card, gradient
//   button + loading spinner, bolder heading)
// 🔒 UNCHANGED: handleSubmit, API call, all state

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, ArrowLeft } from 'lucide-react';
import { FieldLabel } from '../components/ui/FieldLabel';
import { Button } from '../components/ui/Button';
import api from '../api';

// ⭐️ ระบบนี้ไม่มีคอลัมน์ email บน users — ยืนยันตัวตนด้วย student_id + phone_number แทน
// (ตรงกับ backend จริง: POST /api/auth/forgot-password รับ { student_id, phone_number })
export default function ForgotPassword() {
  const [studentId, setStudentId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { student_id: studentId, phone_number: phoneNumber });
      // ⭐️ backend ตอบข้อความเดียวกันเสมอไม่ว่าจะเจอบัญชีหรือไม่ (กัน enumeration) — แสดงผลตรงๆ
      setSubmitted(true);
    } catch {
      // แม้ error ก็ยังโชว์ข้อความเดิม กันดักจับว่าบัญชีมีจริงไหมจาก response ต่าง
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-brand-bg flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center mb-4 shadow-lg">
            <KeyRound size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">ลืมรหัสผ่าน</h1>
          <p className="mt-1 text-sm text-gray-500 font-medium text-center">กรอกรหัสนักศึกษาและเบอร์โทรศัพท์ที่ลงทะเบียนไว้</p>
        </div>

        <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-6">
          {submitted ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-700 leading-relaxed font-medium">
                ถ้าข้อมูลถูกต้อง คำขอของคุณถูกส่งให้เจ้าหน้าที่แล้ว
              </p>
              <p className="mt-2 text-xs text-gray-400">
                กรุณารอเจ้าหน้าที่ติดต่อกลับพร้อมลิงก์สำหรับตั้งรหัสผ่านใหม่ (เช่น ทาง LINE หรือช่องทางที่ให้ไว้ตอนสมัคร) ลิงก์จะหมดอายุภายใน 1 ชั่วโมงหลังเจ้าหน้าที่ส่งให้
              </p>
              <Button size="lg" className="w-full mt-5" onClick={() => navigate('/login')}>
                กลับไปหน้าเข้าสู่ระบบ
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <FieldLabel>รหัสนักศึกษา</FieldLabel>
                <input
                  type="text" required value={studentId} onChange={e => setStudentId(e.target.value)}
                  placeholder="รหัสนักศึกษา"
                  className="w-full px-4 py-3 rounded-full border border-brand-border bg-brand-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white"
                />
              </div>
              <div>
                <FieldLabel>เบอร์โทรศัพท์</FieldLabel>
                <input
                  type="tel" required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="0812345678"
                  className="w-full px-4 py-3 rounded-full border border-brand-border bg-brand-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-3.5 mt-1 rounded-full text-white font-bold text-sm transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed
                  enabled:bg-gradient-to-br enabled:from-brand enabled:to-brand-dark disabled:bg-brand-border
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    กำลังส่งคำขอ...
                  </span>
                ) : 'ขอรีเซ็ตรหัสผ่าน'}
              </button>
            </form>
          )}
        </div>

        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-brand font-medium transition-colors duration-150">
          <ArrowLeft size={14} /> กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
