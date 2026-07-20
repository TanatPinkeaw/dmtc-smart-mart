import { UserPlus, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

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
    <Modal onClose={onClose} widthClassName="sm:max-w-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-emerald-50">
        <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2"><UserPlus size={16} /> สมัครสมาชิกใหม่</h3>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 active:scale-90 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><X size={16} /></button>
      </div>
      <form onSubmit={onSubmit} className="p-5 space-y-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
            <Input type={f.type} required placeholder={f.placeholder} value={regForm[f.key]} onChange={e => onRegFormChange({ ...regForm, [f.key]: e.target.value })} />
          </div>
        ))}
        <Button type="submit" variant="primary" loading={regLoading} className="w-full mt-2 bg-emerald-500 hover:bg-emerald-600 focus-visible:ring-emerald-400">
          {regLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
        </Button>
      </form>
    </Modal>
  );
}
