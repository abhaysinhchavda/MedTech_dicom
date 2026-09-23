import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { expect } from 'vitest';

export const API = 'http://localhost:8001';
export const STUDY = '1.2.3';
export const SERIES = '1.2.3.4';

export const studyJson = {
  '0020000D': { vr: 'UI', Value: [STUDY] },
  '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Test^Patient' }] },
  '00100020': { vr: 'LO', Value: ['P001'] },
  '00080020': { vr: 'DA', Value: ['20240101'] },
  '00081030': { vr: 'LO', Value: ['Synthetic study'] },
  '00080061': { vr: 'CS', Value: ['CT'] },
  '00201206': { vr: 'IS', Value: [1] },
  '00201208': { vr: 'IS', Value: [4] },
};
export const seriesJson = {
  '0020000E': { vr: 'UI', Value: [SERIES] },
  '0020000D': { vr: 'UI', Value: [STUDY] },
  '00080060': { vr: 'CS', Value: ['CT'] },
  '0008103E': { vr: 'LO', Value: ['Synthetic series'] },
  '00200011': { vr: 'IS', Value: [1] },
  '00201209': { vr: 'IS', Value: [4] },
  '00080018': { vr: 'UI', Value: ['1.2'] },
};
export const instanceJson = (sop: string, z: number, frames = 1) => ({
  '00080018': { vr: 'UI', Value: [sop] },
  '00200032': { vr: 'DS', Value: [0, 0, z] },
  '00280008': { vr: 'IS', Value: [frames] },
  '00280010': { vr: 'US', Value: [16] },
});
export const volumeInfoJson = {
  seriesUid: SERIES,
  isVolume: true,
  reason: null,
  dims: [16, 16, 4],
  spacing: [0.5, 0.5, 1],
  origin: [0, 0, 0],
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  modality: 'CT',
  sortMethod: 'geometry',
  instanceCount: 4,
  estimatedBytes: 2048,
};

export const handlers = [
  http.get(`${API}/dicomweb/studies`, () => HttpResponse.json([studyJson])),
  http.get(`${API}/dicomweb/studies/${STUDY}/series`, () => HttpResponse.json([seriesJson])),
  http.get(`${API}/dicomweb/studies/${STUDY}/series/${SERIES}/metadata`, () =>
    HttpResponse.json(
      [
        instanceJson('1.1', 0),
        instanceJson('1.2', 1),
        instanceJson('1.3', 2),
        instanceJson('1.4', 3),
      ],
      { headers: { 'X-Sort-Method': 'geometry' } },
    ),
  ),
  http.get(`${API}/api/series/${SERIES}/volume-info`, () => HttpResponse.json(volumeInfoJson)),
  // Actually reads the multipart body instead of returning a fixed payload,
  // so a broken FormData/File serialization (the jsdom bug vitest.setup.ts
  // works around by swapping in undici) fails this handler's own assertions
  // rather than going unnoticed.
  http.post(`${API}/api/upload`, async ({ request }) => {
    const fd = await request.formData();
    const files = fd.getAll('files');
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toBeInstanceOf(File);
    const names = (files as File[]).map((f) => f.name);
    const skipped = names
      .filter((n) => !n.endsWith('.dcm'))
      .map((file) => ({ file, reason: 'not a DICOM file' }));
    return HttpResponse.json({ accepted: names.length, skipped, studyUids: [STUDY] });
  }),
];
export const server = setupServer(...handlers);
