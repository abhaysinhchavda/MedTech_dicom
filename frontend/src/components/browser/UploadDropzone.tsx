import { useState, type DragEvent } from 'react';
import { uploadFiles } from '../../api/upload';
import type { UploadSummary } from '../../api/types';
import { Spinner } from '../ui/Spinner';

export function UploadDropzone({ onDone }: { onDone: (s: UploadSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const s = await uploadFiles(files);
      setSummary(s);
      onDone(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void send(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="m-4 rounded border-2 border-dashed border-neutral-700 p-6 text-center text-neutral-400"
    >
      <p>Drop a folder of DICOM files or a .zip here, or</p>
      <label className="underline cursor-pointer">
        choose files
        <input
          type="file"
          multiple
          className="hidden"
          aria-label="choose files"
          onChange={(e) => void send(Array.from(e.target.files ?? []))}
        />
      </label>
      {busy && (
        <div className="mt-3 flex justify-center">
          <Spinner />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-400">
          {error}
        </p>
      )}
      {summary && (
        <div className="mt-3 text-left text-sm">
          <p className="text-neutral-200">
            {summary.accepted} files accepted
            {summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}
          </p>
          <ul className="text-amber-400">
            {summary.skipped.map((s) => (
              <li key={s.file}>
                {s.file}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
