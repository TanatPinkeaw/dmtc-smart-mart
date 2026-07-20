import { AlertTriangle, XCircle, Clock } from 'lucide-react';

interface AlertCardsGridProps {
  lowStock: any[];
  voidSummary: any;
  shiftAnomalies: any[];
  openShifts: any[];
  pendingApprovalShifts: any[];
  onOpenDetail: (type: string, title: string) => void;
}

export function AlertCardsGrid({ lowStock, voidSummary, shiftAnomalies, openShifts, pendingApprovalShifts, onOpenDetail }: AlertCardsGridProps) {
  const cards = [
    { type: 'lowstock', title: 'สต๊อกใกล้หมด', value: `${lowStock.length} รายการ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-orange-200 hover:border-orange-400', icon: <AlertTriangle size={16} />, color: 'text-orange-500' },
    { type: 'void', title: 'บิลยกเลิกวันนี้', value: `${voidSummary?.void_count || 0} บิล`, sub: `฿${Number(voidSummary?.void_amount || 0).toLocaleString()}`, border: 'border-red-200 hover:border-red-400', icon: <XCircle size={16} />, color: 'text-red-500' },
    { type: 'anomalies', title: 'กะเงินสดผิดปกติ', value: `${shiftAnomalies.length} กะ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-purple-200 hover:border-purple-400', icon: <AlertTriangle size={16} />, color: 'text-purple-500' },
    { type: 'openshifts', title: 'กะเปิดค้างอยู่', value: `${openShifts.length} กะ`, sub: 'แตะเพื่อดูรายละเอียด', border: 'border-blue-200 hover:border-blue-400', icon: <Clock size={16} />, color: 'text-blue-500' },
    { type: 'pending_approval', title: 'รออนุมัติปิดกะ', value: `${pendingApprovalShifts.length} กะ`, sub: pendingApprovalShifts.length > 0 ? 'ส่วนต่างเกิน ฿100' : 'ไม่มีกะรออนุมัติ', border: 'border-amber-300 hover:border-amber-500', icon: <AlertTriangle size={16} />, color: 'text-amber-600' },
  ];

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {cards.map(a => (
        <div key={a.type} onClick={() => onOpenDetail(a.type, a.title)} className={`bg-white border ${a.border} rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-150 active:scale-95`}>
          <div className={`flex items-center gap-1.5 ${a.color} mb-2`}>{a.icon}<span className="text-xs font-semibold">{a.title}</span></div>
          <p className="text-lg font-bold text-gray-900">{a.value}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{a.sub}</p>
        </div>
      ))}
    </div>
  );
}
