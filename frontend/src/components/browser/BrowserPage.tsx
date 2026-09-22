import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SeriesGrid } from './SeriesGrid';
import { StudyList } from './StudyList';
import { UploadDropzone } from './UploadDropzone';

export function BrowserPage() {
  const [study, setStudy] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <main className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">DICOM 3D Web Viewer</h1>
      <StudyList selected={study} onSelect={setStudy} />
      {study && <SeriesGrid studyUid={study} />}
      <UploadDropzone
        onDone={(s) => {
          void qc.invalidateQueries({ queryKey: ['studies'] });
          void qc.invalidateQueries({ queryKey: ['series'] });
          if (s.studyUids[0]) setStudy(s.studyUids[0]);
        }}
      />
    </main>
  );
}
