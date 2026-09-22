import type { VolumeInfo } from '../../api/types';

const fmtBytes = (b: number | null): string =>
  b == null
    ? '—'
    : b >= 1e9
      ? `${(b / 1e9).toFixed(2)} GB`
      : b >= 1e6
        ? `${(b / 1e6).toFixed(1)} MB`
        : `${(b / 1e3).toFixed(1)} KB`;

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-neutral-800">
    <span className="text-neutral-400">{k}</span>
    <span>{v}</span>
  </div>
);

export function MetadataPanel({ info, description }: { info: VolumeInfo; description: string }) {
  return (
    <aside className="w-64 p-3 text-sm bg-neutral-900 border-l border-neutral-800 overflow-auto">
      <h2 className="font-semibold mb-2 truncate">{description || info.seriesUid}</h2>
      <Row k="Modality" v={info.modality ?? '—'} />
      <Row k="Dimensions" v={info.dims ? info.dims.join(' × ') : '—'} />
      <Row
        k="Spacing"
        v={info.spacing ? `${info.spacing.map((s) => s.toFixed(2)).join(' × ')} mm` : '—'}
      />
      <Row k="Slices" v={String(info.instanceCount)} />
      <Row k="Ordering" v={info.sortMethod ?? '—'} />
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
    </aside>
  );
}
