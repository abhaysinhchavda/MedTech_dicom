import { useQuery } from '@tanstack/react-query';
import { CaretRight, FolderOpen } from '@phosphor-icons/react';
import { getStudies } from '../../api/dicomweb';
import { ErrorBanner } from '../ui/ErrorBanner';
import { SkeletonRows } from '../ui/Skeleton';

// DICOM dates are YYYYMMDD with no separators, which reads as one long number
// in a table column.
const fmtDate = (d: string): string =>
  /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || '-';

const TH = 'px-3 py-2 text-left text-xs font-medium text-faint';

export function StudyList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (uid: string) => void;
}) {
  const q = useQuery({ queryKey: ['studies'], queryFn: getStudies });
  if (q.isPending) return <SkeletonRows rows={3} label="loading studies" />;
  if (q.isError)
    return (
      <ErrorBanner
        message={`Backend unreachable: ${q.error.message}`}
        onRetry={() => void q.refetch()}
      />
    );

  if (q.data.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-surface border border-dashed border-line px-6 py-12 text-center">
        <FolderOpen aria-hidden size={28} className="text-faint" />
        <p className="text-sm text-muted">Nothing indexed yet.</p>
        <p className="max-w-xs text-xs text-faint">
          Add a folder of DICOM files or a .zip in the panel beside this one, and the studies it
          contains will appear here.
        </p>
      </div>
    );

  return (
    // The table keeps every column on a wide screen; below `sm` the two
    // columns that repeat information available elsewhere (patient ID, which
    // echoes the name here, and modality, which the series cards also carry)
    // drop out, and whatever still does not fit scrolls inside the card
    // rather than widening the page.
    <div className="overflow-x-auto rounded-surface border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface">
          <tr>
            <th className={TH}>Patient</th>
            <th className={`${TH} hidden sm:table-cell`}>ID</th>
            <th className={TH}>Date</th>
            <th className={TH}>Description</th>
            <th className={`${TH} hidden sm:table-cell`}>Modality</th>
            <th className={`${TH} text-right`}>Series</th>
            <th className={TH}>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((s, i) => {
            const on = selected === s.studyUid;
            return (
              <tr
                key={s.studyUid}
                style={{ '--i': i } as React.CSSProperties}
                onClick={() => onSelect(s.studyUid)}
                tabIndex={0}
                aria-current={on ? 'true' : undefined}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(s.studyUid);
                  }
                }}
                className={`rise group cursor-pointer border-t border-line transition-colors duration-150 ${
                  on
                    ? 'bg-raised shadow-[inset_2px_0_0_var(--color-accent)]'
                    : 'hover:bg-surface focus-visible:bg-surface'
                }`}
              >
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                  {s.patientName || '-'}
                </td>
                <td className="num hidden px-3 py-2.5 text-muted sm:table-cell">{s.patientId}</td>
                <td className="num px-3 py-2.5 whitespace-nowrap text-muted">
                  {fmtDate(s.studyDate)}
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2.5 text-muted">{s.description}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs whitespace-nowrap text-muted">
                    {s.modalities.join(', ')}
                  </span>
                </td>
                <td className="num px-3 py-2.5 text-right text-muted">{s.numSeries}</td>
                <td className="px-3 py-2.5">
                  <CaretRight
                    aria-hidden
                    size={14}
                    className={on ? 'text-accent' : 'text-faint opacity-0 group-hover:opacity-100'}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
