import type { VolumeInfo } from '../../api/types';

const fmtBytes = (b: number | null): string =>
  b == null
    ? '-'
    : b >= 1e9
      ? `${(b / 1e9).toFixed(2)} GB`
      : b >= 1e6
        ? `${(b / 1e6).toFixed(1)} MB`
        : `${(b / 1e3).toFixed(1)} KB`;

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-2">
    <span className="text-xs text-faint">{k}</span>
    <span className="num text-right text-[13px] text-ink">{v}</span>
  </div>
);

export function MetadataPanel({ info, description }: { info: VolumeInfo; description: string }) {
  return (
    <aside className="hidden w-72 shrink-0 overflow-auto border-l border-line bg-surface p-4 lg:block">
      <h2 className="truncate text-sm font-medium" title={description || info.seriesUid}>
        {description || info.seriesUid}
      </h2>
      <div className="mt-3 divide-y divide-line border-t border-line">
        <Row k="Modality" v={info.modality ?? '-'} />
        <Row k="Dimensions" v={info.dims ? info.dims.join(' × ') : '-'} />
        <Row
          k="Spacing"
          v={info.spacing ? `${info.spacing.map((s) => s.toFixed(2)).join(' × ')} mm` : '-'}
        />
        <Row k="Slices" v={String(info.instanceCount)} />
        <Row k="Ordering" v={info.sortMethod ?? '-'} />
        <Row k="GPU memory" v={fmtBytes(info.estimatedBytes)} />
        {info.direction && (
          <Row
            k="Row / col cosines"
            v={info.direction
              .slice(0, 6)
              .map((d) => d.toFixed(0))
              .join(' ')}
          />
        )}
      </div>
    </aside>
  );
}
