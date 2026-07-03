export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-200 ${className ?? ""}`} />;
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${className ?? ""}`}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${className ?? ""}`}>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2 h-6 w-20" />
    </div>
  );
}
