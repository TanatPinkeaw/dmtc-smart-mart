import { TrendingUp, Receipt, Banknote, CreditCard, Package } from 'lucide-react';

const card = "relative overflow-hidden bg-white border border-brand-border rounded-2xl shadow-md";
const accentBar = <div className="absolute top-0 inset-x-0 h-1.5 bg-brand" />;

interface StatCardsProps {
  summary: any;
  topProducts: any[];
}

export function StatCards({ summary, topProducts }: StatCardsProps) {
  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
      <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total sales */}
        <div className="bg-brand rounded-2xl p-5 text-white shadow-sm">
          <div className="flex justify-between items-start mb-3">
            <p className="text-pink-100 text-xs font-medium">ยอดขายรวมวันนี้</p>
            <div className="bg-white/20 p-2 rounded-xl"><TrendingUp size={18} className="text-white" /></div>
          </div>
          <p className="text-3xl font-bold">฿{Number(summary?.total_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-pink-200 mt-2">* ข้อมูลรีเซ็ตทุกเที่ยงคืน</p>
        </div>

        {/* Bills */}
        <div className={`${card} p-5`}>
          {accentBar}
          <div className="flex justify-between items-start mb-3">
            <p className="text-xs font-medium text-gray-500">จำนวนบิลทั้งหมด</p>
            <div className="bg-emerald-50 p-2 rounded-xl"><Receipt size={18} className="text-emerald-500" /></div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{summary?.total_bills || 0} <span className="text-base text-gray-400 font-normal">บิล</span></p>
        </div>

        {/* Cash */}
        <div className={`${card} p-5`}>
          {accentBar}
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3"><Banknote size={16} className="text-emerald-500" /> ยอดรับเงินสด</div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xl font-bold text-gray-900">฿{Number(summary?.cash_sales || 0).toLocaleString()}</p>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: summary?.total_sales ? `${(summary.cash_sales / summary.total_sales) * 100}%` : '0%' }} />
          </div>
        </div>

        {/* QR */}
        <div className={`${card} p-5`}>
          {accentBar}
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3"><CreditCard size={16} className="text-purple-500" /> ยอดรับโอน (QR)</div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xl font-bold text-gray-900">฿{Number(summary?.qr_sales || 0).toLocaleString()}</p>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-400 rounded-full transition-all duration-500" style={{ width: summary?.total_sales ? `${(summary.qr_sales / summary.total_sales) * 100}%` : '0%' }} />
          </div>
        </div>
      </div>

      {/* Top products */}
      <div className={`${card} p-4 flex flex-col`}>
        {accentBar}
        <div className="flex items-center gap-2 mb-4">
          <Package size={18} className="text-orange-400" />
          <h2 className="text-sm font-semibold text-gray-900">10 อันดับสินค้าขายดี</h2>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[240px]">
          {topProducts.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ยังไม่มีข้อมูลวันนี้</p> :
            topProducts.map((p, i) => (
              <div key={p.product_id} className="flex items-center justify-between px-2 py-2 hover:bg-brand-bg rounded-xl transition-colors duration-150">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-brand-bg text-brand'}`}>{i + 1}</span>
                  <div>
                    <p className="text-xs font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                    <p className="text-[10px] text-gray-400">ขาย {p.total_quantity} ชิ้น</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-brand shrink-0">฿{Number(p.total_revenue).toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
