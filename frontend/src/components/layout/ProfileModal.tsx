import { User, Phone, KeyRound } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface ProfileModalProps {
  initials: string;
  fullName: string;
  studentIdOrUsername: string;
  role: string;
  phoneNumber: string;
  onPhoneNumberChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  onClose: () => void;
  onOpenChangePassword: () => void;
}

export function ProfileModal({
  initials, fullName, studentIdOrUsername, role, phoneNumber,
  onPhoneNumberChange, onSubmit, loading, onClose, onOpenChangePassword,
}: ProfileModalProps) {
  return (
    <Modal onClose={onClose} title={undefined}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg">
        <div className="flex items-center gap-2">
          <User size={18} className="text-brand" />
          <h3 className="font-semibold text-gray-900">บัญชีของฉัน</h3>
        </div>
      </div>

      <form onSubmit={onSubmit} className="p-5 space-y-4">
        {/* Avatar */}
        <div className="flex flex-col items-center pt-1 pb-3">
          <div className="w-14 h-14 bg-brand rounded-full flex items-center justify-center text-white text-xl font-bold mb-2">{initials}</div>
          <p className="font-semibold text-gray-900 text-sm">{fullName}</p>
          <p className="text-xs text-gray-400">{studentIdOrUsername}</p>
          <span className="mt-1.5 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-bg text-brand border border-brand-mid">{role}</span>
        </div>

        {/* Phone */}
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Phone size={13} /> เบอร์โทรศัพท์</label>
          <input type="tel" value={phoneNumber} onChange={e => onPhoneNumberChange(e.target.value)} placeholder="08X-XXX-XXXX" className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
          <p className="text-[11px] text-amber-600">⚠️ รหัสผ่านเริ่มต้นคือเบอร์โทรตอนสมัคร ถ้าเปลี่ยนเบอร์ควรเปลี่ยนรหัสผ่านด้วย</p>
        </div>

        {/* Change Password Button */}
        <div className="pt-3 border-t border-brand-border">
          <button
            type="button"
            onClick={onOpenChangePassword}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95"
          >
            <KeyRound size={16} /> เปลี่ยนรหัสผ่าน
          </button>
        </div>

        <button type="submit" disabled={loading} className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
          {loading ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
        </button>
      </form>
    </Modal>
  );
}
