// 📄 components/pos/RewardModal.tsx — popup แลกของรางวัลด้วยแต้ม (POS, เปิดเมื่อมีสมาชิกในบิล)
//    ทำอะไร: โชว์สินค้าของรางวัล (is_reward_item, stock>0), ปุ่มแลก enable เฉพาะที่แต้มพอ, เลือกแล้วเพิ่มเป็น
//    บรรทัดราคา 0 ติดธง redeem_reward (backend หักแต้ม+ตัดสต๊อกตอน checkout)
// ⭐️ Part 5/6 — โมดัลแลกของรางวัลด้วยแต้ม (เปิดเมื่อมีสมาชิกในบิล)
//   โชว์สินค้าที่ is_reward_item=1 และ stock>0 ปุ่ม "แลก" enable เฉพาะรายการที่แต้มสมาชิกพอ
//   เลือกแล้ว = เพิ่มลงตะกร้าเป็นบรรทัดราคา 0 ที่ติดธง redeem_reward (backend หักแต้ม+ตัดสต๊อกตอน checkout)
import { useState, useEffect } from 'react';
import { Gift } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SkeletonLine } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
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
    <Modal
      onClose={onClose}
      widthClassName="sm:max-w-lg"
      title={<><Gift size={16} /> แลกของรางวัล — มีแต้ม {memberPoints.toLocaleString()} แต้ม</>}
    >
      <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              <SkeletonLine width="w-1/3" height="h-4" />
              <SkeletonLine width="w-full" height="h-3" />
              <SkeletonLine width="w-4/5" height="h-3" />
            </div>
          ) : error ? (
            <EmptyState tone="error" icon={<Gift size={24} />} title={error} />
          ) : rewards.length === 0 ? (
            <EmptyState icon={<Gift size={24} />} title="ยังไม่มีของรางวัล" hint="ตั้งค่าสินค้าเป็นของรางวัลได้ที่หน้าจัดการสินค้า" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {rewards.map(r => {
                const canAfford = canAffordReward(memberPoints, r.points_required);
                return (
                  <div key={r.id} className="bg-white border border-brand-border rounded-3xl overflow-hidden flex flex-col">
                    <div className="h-24 bg-brand-bg shrink-0">
                      {r.image_url
                        ? <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center"><Gift size={22} className="text-brand-mid" /></div>}
                    </div>
                    <div className="p-2.5 flex flex-col flex-1">
                      <p className="text-xs font-bold text-gray-800 leading-snug line-clamp-2 flex-1">{r.name}</p>
                      <p className="text-[11px] font-bold text-brand mt-1">{r.points_required.toLocaleString()} แต้ม</p>
                      <Button
                          size="sm"
                          className="mt-2 w-full"
                          disabled={!canAfford}
                          onClick={() => { onRedeem(r); onClose(); }}
                        >
                          {canAfford ? 'แลก' : 'แต้มไม่พอ'}
                        </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </Modal>
  );
}
