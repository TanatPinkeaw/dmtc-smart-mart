// 📄 components/ui/Skeleton.tsx — โครงจางๆ (loading placeholder) โชว์ระหว่างรอโหลดข้อมูล แทนจอเปล่า/สปินเนอร์
//    export SkeletonLine/SkeletonCard/SkeletonDashboardStat ฯลฯ เอาไปวางตำแหน่งที่ข้อมูลจริงจะมาแทน
export const SkeletonLine = ({ width = 'w-full', height = 'h-4', className = '' }: { width?: string; height?: string; className?: string }) => (
  <div className={`animate-pulse bg-brand-border/40 rounded-lg ${width} ${height} ${className}`} />
);

export const SkeletonCard = () => (
  <div className="bg-white border border-brand-border rounded-3xl p-4 sm:p-6 space-y-3 shadow-md">
    <SkeletonLine width="w-1/3" height="h-4" />
    <SkeletonLine width="w-full" height="h-3" />
    <SkeletonLine width="w-4/5" height="h-3" />
  </div>
);

export const SkeletonDashboardStat = () => (
  <div className="bg-white border border-brand-border rounded-3xl p-4 sm:p-6 space-y-3 shadow-md animate-pulse">
    <div className="flex justify-between items-center">
      <SkeletonLine width="w-1/3" height="h-4" />
      <div className="bg-brand-border/40 rounded-xl h-9 w-9" />
    </div>
    <SkeletonLine width="w-1/2" height="h-8" />
    <SkeletonLine width="w-2/3" height="h-3" />
  </div>
);

// แถบรายการ (list row) — ใช้แทนกล่อง loading ซ้ำๆ ในลิสต์/ตาราง/การ์ดแถวเดียว
export const SkeletonListRow = ({ height = 'h-20', className = '' }: { height?: string; className?: string }) => (
  <div className={`bg-white border border-brand-border rounded-3xl animate-pulse ${height} ${className}`} />
);
