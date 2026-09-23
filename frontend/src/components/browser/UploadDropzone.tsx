import { useState, type DragEvent } from 'react';
import { uploadFiles } from '../../api/upload';
import type { UploadSummary } from '../../api/types';
import { Spinner } from '../ui/Spinner';

// A dropped directory entry, per item, has no `webkitGetAsEntry` result in
// some browsers -- guard for that instead of assuming DataTransferItem always
// resolves to a FileSystemEntry.
type FSEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file: (cb: (f: File) => void) => void;
  createReader: () => { readEntries: (cb: (entries: FSEntry[]) => void) => void };
};

function readAllEntries(reader: ReturnType<FSEntry['createReader']>): Promise<FSEntry[]> {
  return new Promise((resolve) => reader.readEntries(resolve));
}

async function walkEntry(entry: FSEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    await new Promise<void>((resolve) => entry.file((f) => (out.push(f), resolve())));
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries returns a page at a time; keep reading until it's empty.
    let batch = await readAllEntries(reader);
    while (batch.length) {
      await Promise.all(batch.map((e) => walkEntry(e, out)));
      batch = await readAllEntries(reader);
    }
  }
}

async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  if (!items || !items[0]?.webkitGetAsEntry) return Array.from(dt.files);
  const entries = Array.from(items)
    .map((it) => it.webkitGetAsEntry() as FSEntry | null)
    .filter((e): e is FSEntry => e !== null);
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, out)));
  return out;
}

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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    void filesFromDataTransfer(dt).then(send);
  };
  const onPick = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    void (async () => {
      try {
        await send(files);
      } finally {
        input.value = '';
      }
    })();
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
          onChange={(e) => onPick(e.target)}
        />
      </label>
      {' / '}
      <label className="underline cursor-pointer">
        choose a folder
        <input
          type="file"
          multiple
          // webkitdirectory is non-standard but supported by every browser
          // that also supports webkitGetAsEntry (Chrome, Firefox, Safari,
          // Edge); there's no standards-track equivalent.
          // @ts-expect-error -- not in the DOM lib's InputHTMLAttributes
          webkitdirectory=""
          className="hidden"
          aria-label="choose a folder"
          onChange={(e) => onPick(e.target)}
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
