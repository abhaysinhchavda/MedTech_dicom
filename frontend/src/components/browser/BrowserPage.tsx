import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getStudies } from '../../api/dicomweb';
import { Brand } from '../ui/Brand';
import { SeriesGrid } from './SeriesGrid';
import { StudyList } from './StudyList';
import { UploadDropzone } from './UploadDropzone';

function BackendStatus() {
  const q = useQuery({ queryKey: ['studies'], queryFn: getStudies });
  const state = q.isError ? 'down' : q.isPending ? 'checking' : 'up';
  const text = { down: 'backend unreachable', checking: 'connecting', up: 'backend connected' }[
    state
  ];
  const dot = { down: 'bg-danger', checking: 'bg-faint', up: 'bg-accent' }[state];
  return (
    // A real service-state indicator, the one place a coloured dot earns
    // its keep: the viewer is useless if the DICOMweb backend is not up.
    <span className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

export function BrowserPage() {
  const [study, setStudy] = useState<string | null>(null);
  const qc = useQueryClient();
  const studies = useQuery({ queryKey: ['studies'], queryFn: getStudies });
  const count = studies.data?.length ?? 0;

  return (
    <div className="min-h-full bg-base">
      <header className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 lg:px-8">
          <Brand />
          <BackendStatus />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pt-10 pb-16 lg:px-8">
        <h1 className="max-w-[18ch] text-3xl font-semibold tracking-tight md:text-4xl">
          Brain MR, reconstructed in the browser.
        </h1>
        <p className="mt-3 max-w-[60ch] text-muted">
          Pick a study to open axial, sagittal and coronal planes with a shared 3D volume. Nothing
          leaves this machine.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="flex flex-col gap-8 lg:col-span-8">
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-medium tracking-tight">Studies</h2>
                {count > 0 && (
                  <span className="num text-xs text-faint">
                    {count} indexed{study ? ', 1 open' : ''}
                  </span>
                )}
              </div>
              <StudyList selected={study} onSelect={setStudy} />
            </div>

            {study && (
              <div className="rise">
                <h2 className="mb-3 text-lg font-medium tracking-tight">Series</h2>
                <p className="mb-4 text-sm text-faint">
                  Hover a card to scrub through the stack. Series that are not a regular 3D grid
                  cannot be opened, and say why.
                </p>
                <SeriesGrid studyUid={study} />
              </div>
            )}
          </section>

          <aside className="lg:col-span-4">
            <h2 className="mb-3 text-lg font-medium tracking-tight">Add data</h2>
            <UploadDropzone
              onDone={(s) => {
                void qc.invalidateQueries({ queryKey: ['studies'] });
                void qc.invalidateQueries({ queryKey: ['series'] });
                if (s.studyUids[0]) setStudy(s.studyUids[0]);
              }}
            />
            <p className="mt-3 text-xs text-faint">
              Files are decoded and indexed on the local backend. Anything that is not a DICOM image
              is skipped with a reason rather than failing the batch.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
