import { useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import { ReceiptSlip } from '../components/pos/ReceiptSlip';
import { Button } from '../components/ui/Button';

export default function ReceiptPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const receiptRef = useRef<HTMLDivElement>(null);

  const state = location.state as { receiptData: any; storeInfo: any } | null;

  const handleDownloadPng = useCallback(async () => {
    if (!receiptRef.current) return;
    try {
      const dataUrl = await toPng(receiptRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `receipt-${state?.receiptData?.sale_id || 'pos'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
    }
  }, [state]);

  if (!state?.receiptData) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-500 text-lg">ไม่พบข้อมูลใบเสร็จ</p>
          <Button variant="secondary" onClick={() => navigate('/pos')}>
            <ArrowLeft size={16} /> กลับหน้า POS
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-gray-100 py-6 px-4 flex flex-col items-center print:bg-white print:p-0">
        {/* Receipt slip */}
        <div className="shadow-lg rounded-lg overflow-hidden print:shadow-none print:rounded-none">
          <ReceiptSlip ref={receiptRef} receiptData={state.receiptData} storeInfo={state.storeInfo} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-6 print:hidden">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> กลับ
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} /> พิมพ์ใบเสร็จ
          </Button>
          <Button variant="primary" onClick={handleDownloadPng}>
            <Download size={16} /> ดาวน์โหลด PNG
          </Button>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area { position: absolute; top: 0; left: 0; width: 80mm; padding: 4mm; }
        }
      `}</style>
    </>
  );
}
