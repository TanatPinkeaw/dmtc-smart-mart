export const SkeletonLine = ({ width = 'w-full', height = 'h-4' }: { width?: string; height?: string }) => (
  <div className={`animate-pulse bg-brand-border/40 rounded-lg ${width} ${height}`} />
);

export const SkeletonCard = () => (
  <div className="bg-white border border-brand-border rounded-2xl p-4 sm:p-6 space-y-3 shadow-md">
    <SkeletonLine width="w-1/3" height="h-4" />
    <SkeletonLine width="w-full" height="h-3" />
    <SkeletonLine width="w-4/5" height="h-3" />
  </div>
);

export const SkeletonDashboardStat = () => (
  <div className="bg-white border border-brand-border rounded-2xl p-4 sm:p-6 space-y-3 shadow-md animate-pulse">
    <div className="flex justify-between items-center">
      <SkeletonLine width="w-1/3" height="h-4" />
      <div className="bg-brand-border/40 rounded-xl h-9 w-9" />
    </div>
    <SkeletonLine width="w-1/2" height="h-8" />
    <SkeletonLine width="w-2/3" height="h-3" />
  </div>
);
