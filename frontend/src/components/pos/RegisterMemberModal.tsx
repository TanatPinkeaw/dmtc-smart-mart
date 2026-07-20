import { UserPlus, X } from 'lucide-react';

const inputCls = "w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150";

interface RegForm { student_id: string; full_name: string; phone_number: string; }

interface RegisterMemberModalProps {
  regForm: RegForm;
  onRegFormChange: (form: RegForm) => void;
  regLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const FIELDS = [
  { key: 'student_id', label: 'รหัสนักศึกษา', placeholder: 'เช่น 66209010001', type: 'text' },
  { key: 'full_name', label: 'ชื่อ-นามสกุล', placeholder: 'นาย/นางสาว...', type: 'text' },
  { key: 'phone_number', label: 'เบอร์โทรศัพท์', placeholder: '08X-XXX-XXXX', type: 'tel' },
] as const;

export function RegisterMemberModal({ regForm, onRegFormChange, regLoading, onSubmit, onClose }: RegisterMemberModalProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-emerald-50">
          <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2"><UserPlus size={16} /> สมัครสมาชิกใหม่</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors duration-150"><X size={16} /></button>
        </div>
        <form onSubmit={onSubmit} className="p-5 space-y-3">
          {FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
              <input type={f.type} required placeholder={f.placeholder} value={regForm[f.key]} onChange={e => onRegFormChange({ ...regForm, [f.key]: e.target.value })} className={inputCls} />
            </div>
          ))}
          <button type="submit" disabled={regLoading} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 mt-2">
            {regLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
          </button>
        </form>
      </div>
    </div>
  );
}
