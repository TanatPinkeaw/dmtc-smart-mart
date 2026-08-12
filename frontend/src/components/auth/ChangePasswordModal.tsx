// 📄 components/auth/ChangePasswordModal.tsx — กล่องเปลี่ยนรหัสผ่าน (บังคับตอนใช้รหัสชั่วคราวครั้งแรก)
//    ทำอะไร: ฟอร์มกรอกรหัสเดิม+รหัสใหม่ (มีแถบวัดความแข็งแรง) แล้วยิง PUT /users/:id/change-password
import { useState } from 'react';
import Swal from '../../swal';
import api from '../../api';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { validatePasswordStrength } from '../../validators/passwordValidator';
import { KeyRound, X } from 'lucide-react';
import { getErrorMessage } from '../../utils/errorMessage';

interface ChangePasswordModalProps {
  userId: number;
  onClose: () => void;
  // ⭐️ Security remediation — บัญชีที่รหัสผ่านยังเป็นค่าเริ่มต้น (เดาง่าย) ต้องเปลี่ยนก่อนใช้งานต่อ
  // ปิด modal นี้/กด backdrop ปิดเองไม่ได้จนกว่าจะเปลี่ยนรหัสผ่านสำเร็จ
  forceChange?: boolean;
}

export function ChangePasswordModal({ userId, onClose, forceChange = false }: ChangePasswordModalProps) {
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate new password strength
    const passwordCheck = validatePasswordStrength(form.new_password);
    if (!passwordCheck.valid) {
      Swal.fire('รหัสผ่านยังไม่ปลอดภัยพอ', passwordCheck.errors.join('\n'), 'warning');
      return;
    }

    // Check passwords match
    if (form.new_password !== form.confirm_password) {
      Swal.fire('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน กรุณากรอกใหม่', 'error');
      return;
    }

    setLoading(true);
    try {
      await api.put(`/users/${userId}/change-password`, form);
      // ⭐️ Security remediation — เคลียร์ flag must_change_password ฝั่ง client ให้ตรงกับ backend ทันที
      if (forceChange) {
        try {
          const cached = JSON.parse(localStorage.getItem('user') || '{}');
          localStorage.setItem('user', JSON.stringify({ ...cached, must_change_password: false }));
        } catch { /* localStorage.user corrupted — ไม่ต้อง block การเปลี่ยนรหัสผ่านที่สำเร็จแล้ว */ }
      }
      Swal.fire('สำเร็จ', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');
      onClose();
    } catch (err: any) {
      Swal.fire('ผิดพลาด', getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={forceChange ? undefined : onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full sm:max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-brand" />
            <h3 className="font-semibold text-gray-900">เปลี่ยนรหัสผ่าน</h3>
          </div>
          {!forceChange && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white transition-colors duration-150"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {forceChange && (
          <p className="px-5 pt-3 text-xs text-amber-600 bg-amber-50 border-b border-amber-100 py-2">
            บัญชีนี้ใช้รหัสผ่านชั่วคราวอยู่ กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานต่อ
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleChangePassword} className="p-5 space-y-4 max-h-[80dvh] overflow-y-auto">
          {/* Current Password */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">รหัสผ่านปัจจุบัน</label>
            <input
              type="password"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              placeholder="กรอกรหัสผ่านปัจจุบัน"
              required
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
            />
          </div>

          {/* New Password */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">รหัสผ่านใหม่</label>
            <input
              type="password"
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              placeholder="ตั้งรหัสผ่านใหม่"
              required
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
            />
            <PasswordStrengthMeter password={form.new_password} />
          </div>

          {/* Confirm Password */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">ยืนยันรหัสผ่านใหม่</label>
            <input
              type="password"
              value={form.confirm_password}
              onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
              placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
              required
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 text-white font-bold text-sm rounded-full transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed
                enabled:bg-gradient-to-br enabled:from-brand enabled:to-brand-dark disabled:bg-brand-border disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  กำลังเปลี่ยน...
                </span>
              ) : 'เปลี่ยนรหัสผ่าน'}
            </button>
            {!forceChange && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm rounded-full transition-all duration-150 active:scale-[0.98]"
              >
                ยกเลิก
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
