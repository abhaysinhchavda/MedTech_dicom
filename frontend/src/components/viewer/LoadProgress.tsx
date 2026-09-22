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
      className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10"
    >
      <div className="w-64 h-2 bg-neutral-800 rounded">
        <div className="h-2 bg-sky-500 rounded" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-sm text-neutral-300">
        {label} — {done}/{total} slices ({pct}%)
      </div>
    </div>
  );
}
