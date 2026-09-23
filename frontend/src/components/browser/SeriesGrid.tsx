import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Prohibit, Stack } from '@phosphor-icons/react';
import { getSeries } from '../../api/dicomweb';
import { getVolumeInfo } from '../../api/volume';
import type { Series, VolumeInfo } from '../../api/types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { SkeletonCards } from '../ui/Skeleton';
import { ScrubThumb } from './ScrubThumb';

function Card({ s, info, index }: { s: Series; info: VolumeInfo | undefined; index: number }) {
  const blocked = info !== undefined && !info.isVolume;
  const body = (
    <article
      style={{ '--i': index } as React.CSSProperties}
      className={`rise w-48 overflow-hidden rounded-surface border bg-surface transition duration-150 ${
        blocked
          ? 'border-line opacity-50'
          : 'border-line group-hover:border-accent motion-safe:group-hover:-translate-y-0.5'
      }`}
    >
      <ScrubThumb studyUid={s.studyUid} seriesUid={s.seriesUid} thumbSopUid={s.thumbSopUid} />
      <div className="flex flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-medium" title={s.description || undefined}>
          {s.description || `Series ${s.seriesNumber ?? ''}`}
        </h3>
        <p className="num text-xs text-faint">
          {s.modality} · {s.numInstances} images
        </p>
        {info === undefined && <p className="text-xs text-faint">checking geometry</p>}
        {info?.isVolume && info.dims && (
          <p className="num flex items-center gap-1.5 text-xs text-accent">
            <Stack aria-hidden size={13} />
            {info.dims.join(' × ')}
          </p>
        )}
        {blocked && (
          <p className="flex items-start gap-1.5 text-xs text-warn">
            <Prohibit aria-hidden size={13} className="mt-px shrink-0" />
            {info.reason}
          </p>
        )}
      </div>
    </article>
  );

  return info?.isVolume ? (
    <Link
      className="group rounded-surface"
      to={`/viewer/${s.studyUid}/${s.seriesUid}`}
      aria-label={s.description || s.seriesUid}
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function SeriesGrid({ studyUid }: { studyUid: string }) {
  const q = useQuery({ queryKey: ['series', studyUid], queryFn: () => getSeries(studyUid) });
  const infos = useQueries({
    queries: (q.data ?? []).map((s) => ({
      queryKey: ['volume-info', s.seriesUid],
      queryFn: () => getVolumeInfo(s.seriesUid),
    })),
  });
  if (q.isPending) return <SkeletonCards label="loading series" />;
  if (q.isError) return <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-wrap gap-4">
      {q.data.map((s, i) => (
        <Card key={s.seriesUid} s={s} info={infos[i]?.data} index={i} />
      ))}
    </div>
  );
}
