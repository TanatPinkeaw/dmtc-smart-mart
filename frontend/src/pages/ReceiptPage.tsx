import { useRef, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import { ReceiptSlip } from '../components/pos/ReceiptSlip';
import { Button } from '../components/ui/Button';
import { getCurrentUser } from '../utils/getCurrentUser';

// มือถือ (iOS/LINE browser) ไม่รองรับ link.download → ใช้ open tab แทน
const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export default function ReceiptPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const state = location.state as { receiptData: any; storeInfo: any } | null;

  const handleSave = useCallback(async () => {
    if (!receiptRef.current || loading) return;
    setLoading(true);
    try {
      const dataUrl = await toPng(receiptRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 });
      if (isMobile()) {
        // มือถือ: เปิดรูปใน tab ใหม่ให้ user กด "บันทึกรูปภาพ" เอง
        setPreviewUrl(dataUrl);
      } else {
        // Desktop: download ตรง
        const link = document.createElement('a');
        link.download = `receipt-${state?.receiptData?.sale_id || 'pos'}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('ไม่สามารถสร้างรูปได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }, [state, loading]);

  if (!state?.receiptData) {
    const user = getCurrentUser();
    const fallback = user?.role === 'MEMBER' ? '/pre-order' : '/pos';
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-500 text-lg">ไม่พบข้อมูลใบเสร็จ</p>
          <Button variant="secondary" onClick={() => navigate(fallback)}>
            <ArrowLeft size={16} /> กลับ
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
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            {loading ? <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Download size={16} />}
            {isMobile() ? 'บันทึกรูปภาพ' : 'ดาวน์โหลด PNG'}
          </Button>
        </div>
      </div>

      {/* Mobile image preview — กด "กดค้างที่รูป แล้วเลือกบันทึก" */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center gap-4 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <p className="text-white text-sm font-medium">กดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ"</p>
          <img
            src={previewUrl}
            alt="ใบเสร็จ"
            className="max-w-full max-h-[75vh] rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="text-white/70 text-sm underline"
            onClick={() => setPreviewUrl(null)}
          >
            ปิด
          </button>
        </div>
      )}

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
