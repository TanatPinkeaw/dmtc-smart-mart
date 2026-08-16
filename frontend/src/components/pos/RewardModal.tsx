// 📄 components/pos/RewardModal.tsx — popup แลกของรางวัลด้วยแต้ม (POS, เปิดเมื่อมีสมาชิกในบิล)
//    ทำอะไร: โชว์สินค้าของรางวัล (is_reward_item, stock>0), ปุ่มแลก enable เฉพาะที่แต้มพอ, เลือกแล้วเพิ่มเป็น
//    บรรทัดราคา 0 ติดธง redeem_reward (backend หักแต้ม+ตัดสต๊อกตอน checkout)
// ⭐️ Part 5/6 — โมดัลแลกของรางวัลด้วยแต้ม (เปิดเมื่อมีสมาชิกในบิล)
//   โชว์สินค้าที่ is_reward_item=1 และ stock>0 ปุ่ม "แลก" enable เฉพาะรายการที่แต้มสมาชิกพอ
//   เลือกแล้ว = เพิ่มลงตะกร้าเป็นบรรทัดราคา 0 ที่ติดธง redeem_reward (backend หักแต้ม+ตัดสต๊อกตอน checkout)
import { useState, useEffect } from 'react';
import { Gift, X } from 'lucide-react';
import api from '../../api';
import { getErrorMessage } from '../../utils/errorMessage';
import { canAffordReward } from '../../utils/rewardCart'; // ⭐️ ลอจิกแต้มพอ/ไม่พอ (pure — เทสต์ได้)

interface RewardProduct {
  id: number; name: string; price: string | number; image_url: string | null;
  points_required: number; stock: number;
}

interface RewardModalProps {
  memberPoints: number;
  onClose: () => void;
  onRedeem: (product: RewardProduct) => void;
}

export function RewardModal({ memberPoints, onClose, onRedeem }: RewardModalProps) {
  const [rewards, setRewards] = useState<RewardProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products/rewards')
      .then(res => setRewards(res.data || []))
      .catch(err => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full sm:max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-brand to-brand-dark">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Gift size={16} /> แลกของรางวัล — มีแต้ม {memberPoints.toLocaleString()} แต้ม
          </h3>
          <button onClick={onClose} className="p-1 text-white/90 hover:text-white rounded-lg hover:bg-white/20 active:scale-90 transition-all duration-150" aria-label="ปิด"><X size={18} /></button>
        </div>

        <div className="max-h-[70dvh] overflow-y-auto p-4">
          {loading ? (
            <p className="text-center text-gray-400 py-10 text-sm">กำลังโหลด...</p>
          ) : error ? (
            <p className="text-center text-red-500 py-10 text-sm">{error}</p>
          ) : rewards.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-brand-bg rounded-2xl flex items-center justify-center mb-3"><Gift size={24} className="text-brand-mid" /></div>
              <p className="text-sm font-medium text-gray-600">ยังไม่มีของรางวัล</p>
              <p className="text-xs text-gray-400 mt-1">ตั้งค่าสินค้าเป็นของรางวัลได้ที่หน้าจัดการสินค้า</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {rewards.map(r => {
                const canAfford = canAffordReward(memberPoints, r.points_required);
                return (
                  <div key={r.id} className="bg-white border border-brand-border rounded-2xl overflow-hidden flex flex-col">
                    <div className="h-24 bg-brand-bg shrink-0">
                      {r.image_url
                        ? <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center"><Gift size={22} className="text-brand-mid" /></div>}
                    </div>
                    <div className="p-2.5 flex flex-col flex-1">
                      <p className="text-xs font-bold text-gray-800 leading-snug line-clamp-2 flex-1">{r.name}</p>
                      <p className="text-[11px] font-bold text-brand mt-1">{r.points_required.toLocaleString()} แต้ม</p>
                      <button
                        disabled={!canAfford}
                        onClick={() => { onRedeem(r); onClose(); }}
                        className={`mt-2 w-full py-1.5 rounded-full text-[11px] font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          canAfford
                            ? 'bg-gradient-to-br from-brand to-brand-dark text-white active:scale-95'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {canAfford ? 'แลก' : 'แต้มไม่พอ'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
