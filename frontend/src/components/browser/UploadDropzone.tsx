import { useRef, useState, type DragEvent } from 'react';
import { CheckCircle, UploadSimple, Warning } from '@phosphor-icons/react';
import { uploadFiles } from '../../api/upload';
import type { UploadSummary } from '../../api/types';
import { Button } from '../ui/Button';
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
  const [over, setOver] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

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
    setOver(false);
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
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-surface border-2 border-dashed p-6 text-center transition-colors duration-150 ${
        over ? 'border-accent bg-accent/5' : 'border-line bg-surface/60'
      }`}
    >
      <UploadSimple
        aria-hidden
        size={26}
        className={over ? 'text-accent' : 'text-faint'}
        weight="duotone"
      />
      <p className="text-sm text-muted">Drop a folder of DICOM files or a .zip here</p>

      <div className="flex gap-2">
        <Button variant="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>
          choose files
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => dirInput.current?.click()}>
          choose a folder
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        aria-label="choose files"
        onChange={(e) => onPick(e.target)}
      />
      <input
        ref={dirInput}
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

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner />
          Indexing
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <Warning aria-hidden size={15} />
          {error}
        </p>
      )}
      {summary && (
        <div className="w-full text-left">
          <p className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle aria-hidden size={15} className="text-accent" />
            {summary.accepted} files accepted
            {summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}
          </p>
          {summary.skipped.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-warn">
              {summary.skipped.map((s) => (
                <li key={s.file} className="truncate">
                  {s.file}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
