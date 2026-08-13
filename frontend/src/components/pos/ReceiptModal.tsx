// 📄 components/pos/ReceiptModal.tsx — popup ใบเสร็จหลังขายสำเร็จ (POS)
//    ทำอะไร: โชว์ ReceiptSlip + ปุ่มพิมพ์/เปิดหน้าเต็ม /receipt — เด้งขึ้นทันทีหลัง checkout ผ่าน
import { CheckCircle, X, Printer, Maximize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ReceiptSlip } from './ReceiptSlip';

interface ReceiptModalProps {
  receiptData: any;
  storeInfo: any;
  onClose: () => void;
}

export function ReceiptModal({ receiptData, storeInfo, onClose }: ReceiptModalProps) {
  const navigate = useNavigate();

  return (
    <Modal onClose={onClose} widthClassName="sm:max-w-sm print:max-w-full print:shadow-none print:rounded-none">
      <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg print:hidden">
        <h3 className="text-sm font-semibold text-brand flex items-center gap-2"><CheckCircle size={16} /> ทำรายการสำเร็จ</h3>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 active:scale-90 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="ปิด"><X size={16} /></button>
      </div>

      <ReceiptSlip receiptData={receiptData} storeInfo={storeInfo} />

      <div className="flex gap-2 p-4 border-t border-brand-border print:hidden">
        <Button variant="secondary" onClick={() => window.print()} className="flex-1">
          <Printer size={16} /> พิมพ์
        </Button>
        <Button variant="secondary" onClick={() => navigate('/receipt', { state: { receiptData, storeInfo } })} className="flex-1">
          <Maximize2 size={16} /> ดูเต็มจอ
        </Button>
        <Button variant="primary" onClick={onClose} className="flex-1">ปิด</Button>
      </div>
    </Modal>
  );
}
