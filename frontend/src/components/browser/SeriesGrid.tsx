import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getSeries, thumbnailUrl } from '../../api/dicomweb';
import { getVolumeInfo } from '../../api/volume';
import type { Series, VolumeInfo } from '../../api/types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';

function Card({ s, info }: { s: Series; info: VolumeInfo | undefined }) {
  const borderClass =
    info === undefined
      ? 'border-neutral-800'
      : info.isVolume
        ? 'border-neutral-700 hover:border-sky-500'
        : 'border-neutral-800 opacity-50';

  const body = (
    <div className={`rounded border p-2 w-44 ${borderClass}`}>
      {s.thumbSopUid && (
        <img
          alt=""
          className="w-40 h-40 bg-black object-contain"
          src={thumbnailUrl(s.studyUid, s.seriesUid, s.thumbSopUid, 160)}
        />
      )}
      <div className="mt-1 text-sm truncate">
        {s.description || `Series ${s.seriesNumber ?? ''}`}
      </div>
      <div className="text-xs text-neutral-400">
        {s.modality} · {s.numInstances} images
      </div>
      {info === undefined && <div className="text-xs text-neutral-500">checking…</div>}
      {info?.isVolume && info.dims && (
        <div className="text-xs text-neutral-400">{info.dims.join(' × ')}</div>
      )}
      {info && !info.isVolume && <div className="text-xs text-amber-400">{info.reason}</div>}
    </div>
  );
  return info?.isVolume ? (
    <Link to={`/viewer/${s.studyUid}/${s.seriesUid}`} aria-label={s.description || s.seriesUid}>
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
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-wrap gap-3 p-2">
      {q.data.map((s, i) => (
        <Card key={s.seriesUid} s={s} info={infos[i]?.data} />
      ))}
    </div>
  );
}
