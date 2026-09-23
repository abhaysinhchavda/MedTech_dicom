export function LoadProgress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-label="volume load"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-base/80 backdrop-blur-sm"
    >
      <div className="h-1 w-72 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-sm text-muted">
        {label}
        <span className="num ml-2 text-ink">
          {done}/{total} slices
        </span>
        <span className="num ml-2 text-faint">{pct}%</span>
      </div>
    </div>
  );
}
