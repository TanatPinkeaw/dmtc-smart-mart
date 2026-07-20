import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, ArrowLeft } from 'lucide-react';
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
    <div className="min-h-screen bg-gradient-to-br from-brand-bg via-white to-brand-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand rounded-2xl shadow-lg mb-4">
            <KeyRound size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ลืมรหัสผ่าน</h1>
          <p className="mt-1 text-sm text-gray-500">กรอกรหัสนักศึกษาและเบอร์โทรศัพท์ที่ลงทะเบียนไว้</p>
        </div>

        <div className="bg-white border border-brand-border rounded-2xl shadow-sm p-6">
          {submitted ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                ถ้าข้อมูลถูกต้อง คำขอของคุณถูกส่งให้เจ้าหน้าที่แล้ว
              </p>
              <p className="mt-2 text-xs text-gray-400">
                กรุณารอเจ้าหน้าที่ติดต่อกลับพร้อมลิงก์สำหรับตั้งรหัสผ่านใหม่ (เช่น ทาง LINE หรือช่องทางที่ให้ไว้ตอนสมัคร) ลิงก์จะหมดอายุภายใน 1 ชั่วโมงหลังเจ้าหน้าที่ส่งให้
              </p>
              <button
                onClick={() => navigate('/login')}
                className="mt-5 w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95"
              >
                กลับไปหน้าเข้าสู่ระบบ
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-500">รหัสนักศึกษา</label>
                <input
                  type="text" required value={studentId} onChange={e => setStudentId(e.target.value)}
                  placeholder="รหัสนักศึกษา"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors duration-150"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-500">เบอร์โทรศัพท์</label>
                <input
                  type="tel" required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="0812345678"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors duration-150"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'กำลังส่งคำขอ...' : 'ขอรีเซ็ตรหัสผ่าน'}
              </button>
            </form>
          )}
        </div>

        <Link to="/login" className="mt-4 flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-brand transition-colors">
          <ArrowLeft size={14} /> กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
