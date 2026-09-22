import { useQuery } from '@tanstack/react-query';
import { getStudies } from '../../api/dicomweb';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';

export function StudyList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (uid: string) => void;
}) {
  const q = useQuery({ queryKey: ['studies'], queryFn: getStudies });
  if (q.isPending) return <Spinner />;
  if (q.isError)
    return (
      <ErrorBanner
        message={`Backend unreachable: ${q.error.message}`}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <table className="w-full text-sm">
      <thead className="text-neutral-400 text-left">
        <tr>
          <th className="p-2">Patient</th>
          <th>ID</th>
          <th>Date</th>
          <th>Description</th>
          <th>Modality</th>
          <th>Series</th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((s) => (
          <tr
            key={s.studyUid}
            onClick={() => onSelect(s.studyUid)}
            className={`cursor-pointer hover:bg-neutral-800 ${selected === s.studyUid ? 'bg-neutral-800' : ''}`}
          >
            <td className="p-2">{s.patientName || '—'}</td>
            <td>{s.patientId}</td>
            <td>{s.studyDate}</td>
            <td>{s.description}</td>
            <td>{s.modalities.join(', ')}</td>
            <td>{s.numSeries}</td>
          </tr>
        ))}
        {q.data.length === 0 && (
          <tr>
            <td className="p-2 text-neutral-500" colSpan={6}>
              No studies yet — drop DICOM files below.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
