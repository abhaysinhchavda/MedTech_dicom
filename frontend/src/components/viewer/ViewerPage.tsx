import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { apiUrl } from '../../api/client';
import { getSeries } from '../../api/dicomweb';
import { useMeasurements } from '../../hooks/useMeasurements';
import { useVolume } from '../../hooks/useVolume';
import { Brand } from '../ui/Brand';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Skeleton } from '../ui/Skeleton';
import { LoadProgress } from './LoadProgress';
import { MetadataPanel } from './MetadataPanel';
import { ViewerLayout } from './ViewerLayout';

// The four panels the viewer is about to build, drawn as empty frames while
// the geometry and metadata requests are still in flight.
const PanelSkeleton = () => (
  <div
    role="status"
    aria-label="preparing viewports"
    className="grid h-full grid-cols-2 grid-rows-2 gap-2 p-2"
  >
    {Array.from({ length: 4 }, (_, i) => (
      <Skeleton key={i} className="h-full w-full" />
    ))}
  </div>
);

export function ViewerPage() {
  const { studyUid = '', seriesUid = '' } = useParams();
  const v = useVolume(studyUid, seriesUid);
  const seriesQ = useQuery({ queryKey: ['series', studyUid], queryFn: () => getSeries(studyUid) });
  const description = seriesQ.data?.find((s) => s.seriesUid === seriesUid)?.description ?? '';
  const big = (v.info?.estimatedBytes ?? 0) > 1e9;
  const m = useMeasurements(seriesUid, v.status === 'ready');
  const reportUrl =
    m.set?.srSeriesUid && m.set.srSopUid
      ? apiUrl(
          `/dicomweb/studies/${studyUid}/series/${m.set.srSeriesUid}/instances/${m.set.srSopUid}`,
        )
      : null;

  return (
    <div className="flex h-full flex-col bg-base">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-3">
        <Link
          to="/"
          className="press flex items-center gap-1.5 rounded-control border border-line bg-raised px-2.5 py-1.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong"
        >
          <ArrowLeft aria-hidden size={15} />
          Studies
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{description}</span>
        <Brand compact />
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {v.status === 'blocked' && (
            <div className="p-4">
              <ErrorBanner message={`Cannot open this series: ${v.error}`} />
            </div>
          )}
          {v.status === 'error' && (
            <div className="p-4">
              <ErrorBanner message={v.error ?? 'error'} />
            </div>
          )}
          {(v.status === 'info' || v.status === 'metadata') && <PanelSkeleton />}
          {v.status === 'loading' && (
            <>
              <PanelSkeleton />
              <LoadProgress
                done={v.progress.done}
                total={v.progress.total}
                label={big ? 'Large volume, over 1 GB of GPU memory' : 'Loading volume'}
              />
            </>
          )}
          {v.status === 'ready' && v.volumeId && v.info && (
            <ViewerLayout
              volumeId={v.volumeId}
              modality={v.info.modality}
              dirty={m.dirty}
              saving={m.saving}
              canMeasure={Boolean(m.set?.frameOfReferenceUid)}
              onSave={() => void m.save()}
              reportUrl={reportUrl}
              onAnnotationChange={m.markDirty}
            />
          )}
          {/* Both notices are non-blocking on purpose: an unreadable or
              unsaveable report must never stop the images being read. */}
          {m.parseError && (
            <div
              role="status"
              className="absolute inset-x-2 top-14 z-20 rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
            >
              A report exists for this series but could not be read. Measuring and saving will
              replace it.
            </div>
          )}
          {m.error && (
            <div
              role="alert"
              className="absolute inset-x-2 top-14 z-20 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {m.error}
            </div>
          )}
        </div>
        {v.info?.isVolume && <MetadataPanel info={v.info} description={description} />}
      </div>
    </div>
  );
}
