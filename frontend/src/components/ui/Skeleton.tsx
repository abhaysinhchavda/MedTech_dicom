/*
 * Shaped placeholders rather than a spinner: the study table and the series
 * cards both have a known geometry before their data lands, so reserving it
 * keeps the layout from jumping when it does.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton relative overflow-hidden rounded-control bg-raised ${className}`}
    />
  );
}

export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2 p-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function SkeletonCards({ cards = 3, label }: { cards?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-wrap gap-3">
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className="h-60 w-48" />
      ))}
    </div>
  );
}
