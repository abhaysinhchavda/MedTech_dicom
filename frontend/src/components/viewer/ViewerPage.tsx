import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { getSeries } from '../../api/dicomweb';
import { useVolume } from '../../hooks/useVolume';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';
import { LoadProgress } from './LoadProgress';
import { MetadataPanel } from './MetadataPanel';
import { ViewerLayout } from './ViewerLayout';

export function ViewerPage() {
  const { studyUid = '', seriesUid = '' } = useParams();
  const v = useVolume(studyUid, seriesUid);
  const seriesQ = useQuery({ queryKey: ['series', studyUid], queryFn: () => getSeries(studyUid) });
  const description = seriesQ.data?.find((s) => s.seriesUid === seriesUid)?.description ?? '';
  const big = (v.info?.estimatedBytes ?? 0) > 1e9;

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-4 px-3 py-2 bg-neutral-900 border-b border-neutral-800 text-sm">
        <Link to="/" className="text-sky-300">
          ← Studies
        </Link>
        <span className="truncate">{description}</span>
      </header>
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-w-0">
          {v.status === 'blocked' && <ErrorBanner message={`Cannot open: ${v.error}`} />}
          {v.status === 'error' && <ErrorBanner message={v.error ?? 'error'} />}
          {(v.status === 'info' || v.status === 'metadata') && (
            <div className="p-8 flex justify-center">
              <Spinner />
            </div>
          )}
          {v.status === 'loading' && (
            <LoadProgress
              done={v.progress.done}
              total={v.progress.total}
              label={big ? 'Large volume (>1 GB GPU memory)' : 'Loading volume'}
            />
          )}
          {v.status === 'ready' && v.volumeId && v.info && (
            <ViewerLayout volumeId={v.volumeId} modality={v.info.modality} />
          )}
        </div>
        {v.info?.isVolume && <MetadataPanel info={v.info} description={description} />}
      </div>
    </div>
  );
}
