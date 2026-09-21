# DICOM 3D Web Viewer — Frontend Implementation Plan (Part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React app that browses studies from the backend, uploads DICOM, and opens any volumetric series in a 2×2 Cornerstone3D layout (axial / sagittal / coronal MPR with synchronized crosshairs + GPU volume rendering).

**Architecture:** Cornerstone3D is wrapped in a small `src/cornerstone/` adapter (init, imageIds, volume loading, viewport layout, tool groups, presets). React components own DOM and state; a `useVolume` hook runs the volume-info → metadata → load state machine. All server access goes through `src/api/`.

**Tech Stack:** Node 24, Vite 8, React 19, TypeScript (strict), Tailwind 4, react-router 8, TanStack Query 5, `@cornerstonejs/core|tools|dicom-image-loader` 5.10.x, vitest 5 + jsdom + MSW 2, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-21-dicom-web-viewer-design.md` (§5, §6-frontend, §8). Read it first.

**Prerequisite:** Part 1 (`2026-09-21-dicom-viewer-backend.md`) complete; backend runs on `http://localhost:8000`.

## Global Constraints

- TypeScript `strict: true`; `npm run lint` and `npm run typecheck` pass at the end of every task.
- No DICOM parsing in the frontend; Cornerstone's `wadors` loader + our metadata seeding only.
- `VITE_API_URL` default `http://localhost:8000`.
- Non-volume series are never opened; the viewer shows `Cannot open: {reason}`.
- Cleanup on viewer unmount: tool groups destroyed, elements disabled, volume removed from cache.
- **Git:** user owns the repository; no commit steps in this plan.
- Run commands from `D:\Cluade_WS\Medical_Project\frontend` (PowerShell).

## Backend interfaces consumed (from Part 1)

| Call | Shape |
|---|---|
| `GET /dicomweb/studies` | DICOM JSON array; tags 0020000D, 00100010 (PN), 00100020, 00080020, 00081030, 00080061, 00201206, 00201208 |
| `GET /dicomweb/studies/{s}/series` | tags 0020000E, 00080060, 0008103E, 00200011, 00201209 (+ 00080018 thumbnail SOP, added in Task 3) |
| `GET /dicomweb/studies/{s}/series/{se}/metadata` | array of full DICOM JSON per instance, anatomically sorted; header `X-Sort-Method` |
| `GET …/instances/{sop}/frames/{n}` | multipart/related octet-stream (Cornerstone parses it) |
| `GET …/instances/{sop}/rendered?viewport=W,H` | PNG |
| `GET /api/series/{se}/volume-info` | `{seriesUid,isVolume,reason,dims,spacing,origin,direction,modality,sortMethod,instanceCount,estimatedBytes}` |
| `POST /api/upload` (form field `files`, repeated) | `{accepted, skipped:[{file,reason}], studyUids}` |

## File structure

```
frontend/
├── package.json, vite.config.ts, tsconfig*.json, index.html, .env.development
├── vitest.setup.ts, playwright.config.ts, .prettierrc
├── src/
│   ├── main.tsx, App.tsx, index.css
│   ├── api/  client.ts, types.ts, dicomJson.ts, dicomweb.ts, volume.ts, upload.ts
│   ├── cornerstone/  init.ts, imageIds.ts, presets.ts, volume.ts, viewports.ts, toolGroups.ts
│   ├── hooks/  useSeriesMetadata.ts, useVolume.ts, useViewportState.ts
│   ├── components/
│   │   ├── ui/  Button.tsx, Spinner.tsx, ErrorBanner.tsx
│   │   ├── browser/  StudyList.tsx, SeriesGrid.tsx, UploadDropzone.tsx, BrowserPage.tsx
│   │   └── viewer/  ViewerPage.tsx, ViewerLayout.tsx, ViewportPanel.tsx, Toolbar.tsx,
│   │                ViewportOverlay.tsx, MetadataPanel.tsx, LoadProgress.tsx
│   └── test/  msw.ts (handlers + fixtures)
├── e2e/  viewer.spec.ts, seed_series.py
└── tests co-located as *.test.ts(x) next to sources
```

---

### Task 1: Scaffold Vite + React + TS + Tailwind + vitest + MSW; API client and DICOM-JSON mappers

**Files:**
- Create: project scaffold; `src/api/client.ts`, `types.ts`, `dicomJson.ts`, `dicomweb.ts`, `volume.ts`, `upload.ts`; `src/api/dicomJson.test.ts`, `dicomweb.test.ts`, `upload.test.ts`; `src/test/msw.ts`; `vitest.setup.ts`; `src/index.css`; `.env.development`; `.prettierrc`

**Interfaces:**
- Produces (`api/types.ts`):
  ```ts
  export interface Study { studyUid: string; patientName: string; patientId: string; studyDate: string; description: string; modalities: string[]; numSeries: number; numInstances: number }
  export interface Series { seriesUid: string; studyUid: string; modality: string; description: string; seriesNumber: number | null; numInstances: number; thumbSopUid?: string }
  export type DicomJson = Record<string, { vr: string; Value?: unknown[] }>
  export interface InstanceMeta { sopUid: string; numFrames: number; raw: DicomJson }
  export interface SeriesMetadata { instances: InstanceMeta[]; sortMethod: string }
  export interface VolumeInfo { seriesUid: string; isVolume: boolean; reason: string | null; dims: [number, number, number] | null; spacing: [number, number, number] | null; origin: [number, number, number] | null; direction: number[] | null; modality: string | null; sortMethod: string | null; instanceCount: number; estimatedBytes: number | null }
  export interface UploadSummary { accepted: number; skipped: { file: string; reason: string }[]; studyUids: string[] }
  ```
- Produces (`api/client.ts`): `API_URL: string`; `class ApiError extends Error { status: number }`; `apiUrl(path): string`; `apiFetch<T>(path, init?): Promise<T>`; `apiFetchWithHeaders<T>(path): Promise<{ body: T; headers: Headers }>`.
- Produces (`api/dicomJson.ts`): `str(j, tag): string`, `num(j, tag): number | null`, `strs(j, tag): string[]`, `pn(j, tag): string`.
- Produces (`api/dicomweb.ts`): `getStudies()`, `getSeries(studyUid)`, `getSeriesMetadata(studyUid, seriesUid)`, `frameUrl(studyUid, seriesUid, sopUid, frame)`, `thumbnailUrl(studyUid, seriesUid, sopUid, size=128)`.
- Produces (`api/volume.ts`): `getVolumeInfo(seriesUid)`; (`api/upload.ts`): `uploadFiles(files: File[])`.

- [ ] **Step 1: Scaffold the project**

```powershell
Set-Location D:\Cluade_WS\Medical_Project
npm create vite@latest frontend -- --template react-ts
Set-Location frontend
npm install
npm install react-router @tanstack/react-query @cornerstonejs/core @cornerstonejs/tools @cornerstonejs/dicom-image-loader dicom-parser
npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event msw @playwright/test prettier
```

Replace `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ['@cornerstonejs/dicom-image-loader'], include: ['dicom-parser'] },
  worker: { format: 'es' },
  server: { port: 5173 },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true, exclude: ['e2e/**', 'node_modules/**'] },
});
```

`vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './src/test/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`src/index.css`:

```css
@import 'tailwindcss';
:root { color-scheme: dark; }
body { margin: 0; background: #0a0a0a; color: #f5f5f5; }
```

`package.json` scripts (merge into the generated file):

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest",
  "typecheck": "tsc -b --noEmit",
  "lint": "eslint . && prettier --check src",
  "format": "prettier --write src",
  "e2e": "playwright test"
}
```

`.prettierrc`: `{ "singleQuote": true, "printWidth": 100 }`. `.env.development`: `VITE_API_URL=http://localhost:8000`. In `tsconfig.app.json` ensure `"types": ["vitest/globals"]` is present under `compilerOptions`.

- [ ] **Step 2: Write the failing tests**

`src/test/msw.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const API = 'http://localhost:8000';
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
  seriesUid: SERIES, isVolume: true, reason: null, dims: [16, 16, 4], spacing: [0.5, 0.5, 1],
  origin: [0, 0, 0], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1], modality: 'CT', sortMethod: 'geometry',
  instanceCount: 4, estimatedBytes: 2048,
};

export const handlers = [
  http.get(`${API}/dicomweb/studies`, () => HttpResponse.json([studyJson])),
  http.get(`${API}/dicomweb/studies/${STUDY}/series`, () => HttpResponse.json([seriesJson])),
  http.get(`${API}/dicomweb/studies/${STUDY}/series/${SERIES}/metadata`, () =>
    HttpResponse.json(
      [instanceJson('1.1', 0), instanceJson('1.2', 1), instanceJson('1.3', 2), instanceJson('1.4', 3)],
      { headers: { 'X-Sort-Method': 'geometry' } },
    ),
  ),
  http.get(`${API}/api/series/${SERIES}/volume-info`, () => HttpResponse.json(volumeInfoJson)),
  http.post(`${API}/api/upload`, () =>
    HttpResponse.json({ accepted: 2, skipped: [{ file: 'notes.txt', reason: 'not a DICOM file' }], studyUids: [STUDY] }),
  ),
];
export const server = setupServer(...handlers);
```

`src/api/dicomJson.test.ts`:

```ts
import { num, pn, str, strs } from './dicomJson';

const j = {
  A: { vr: 'LO', Value: ['x'] }, B: { vr: 'IS', Value: [3] },
  C: { vr: 'PN', Value: [{ Alphabetic: 'Doe^J' }] }, D: { vr: 'CS', Value: ['CT', 'MR'] }, E: { vr: 'LO' },
};

test('accessors read DICOM JSON values with safe defaults', () => {
  expect(str(j, 'A')).toBe('x');
  expect(str(j, 'E')).toBe('');
  expect(str(j, 'ZZ')).toBe('');
  expect(num(j, 'B')).toBe(3);
  expect(num(j, 'E')).toBeNull();
  expect(pn(j, 'C')).toBe('Doe^J');
  expect(strs(j, 'D')).toEqual(['CT', 'MR']);
});
```

`src/api/dicomweb.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { getSeries, getSeriesMetadata, getStudies, thumbnailUrl } from './dicomweb';
import { API, SERIES, STUDY, server } from '../test/msw';

test('maps studies', async () => {
  expect(await getStudies()).toEqual([{
    studyUid: STUDY, patientName: 'Test^Patient', patientId: 'P001', studyDate: '20240101',
    description: 'Synthetic study', modalities: ['CT'], numSeries: 1, numInstances: 4,
  }]);
});

test('maps series including thumbnail sop', async () => {
  expect(await getSeries(STUDY)).toEqual([{
    seriesUid: SERIES, studyUid: STUDY, modality: 'CT', description: 'Synthetic series',
    seriesNumber: 1, numInstances: 4, thumbSopUid: '1.2',
  }]);
});

test('metadata keeps order, raw json and sort method', async () => {
  const m = await getSeriesMetadata(STUDY, SERIES);
  expect(m.sortMethod).toBe('geometry');
  expect(m.instances.map((i) => i.sopUid)).toEqual(['1.1', '1.2', '1.3', '1.4']);
  expect(m.instances[0].numFrames).toBe(1);
  expect(m.instances[0].raw['00280010']).toEqual({ vr: 'US', Value: [16] });
});

test('thumbnail url', () => {
  expect(thumbnailUrl(STUDY, SERIES, '1.1', 64)).toBe(
    `${API}/dicomweb/studies/${STUDY}/series/${SERIES}/instances/1.1/rendered?viewport=64,64`,
  );
});

test('non-2xx throws ApiError with detail', async () => {
  server.use(http.get(`${API}/dicomweb/studies`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })));
  await expect(getStudies()).rejects.toMatchObject({ status: 500, message: 'boom' });
});
```

`src/api/upload.test.ts`:

```ts
import { uploadFiles } from './upload';

test('posts files and returns summary', async () => {
  const r = await uploadFiles([new File(['x'], 'a.dcm'), new File(['y'], 'notes.txt')]);
  expect(r.accepted).toBe(2);
  expect(r.skipped[0]).toEqual({ file: 'notes.txt', reason: 'not a DICOM file' });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run`
Expected: FAIL — modules `./dicomJson`, `./dicomweb`, `./upload` not found.

- [ ] **Step 4: Implement the API layer**

`src/api/types.ts`: exactly the interfaces in this task's **Interfaces** block.

`src/api/client.ts`:

```ts
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export const apiUrl = (path: string): string => `${API_URL}${path}`;

async function errorFor(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try { message = ((await res.json()) as { detail?: string }).detail ?? message; } catch { /* keep default */ }
  return new ApiError(res.status, message);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) throw await errorFor(res);
  return (await res.json()) as T;
}

export async function apiFetchWithHeaders<T>(path: string): Promise<{ body: T; headers: Headers }> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw await errorFor(res);
  return { body: (await res.json()) as T, headers: res.headers };
}
```

`src/api/dicomJson.ts`:

```ts
import type { DicomJson } from './types';

const vals = (j: DicomJson, tag: string): unknown[] => j[tag]?.Value ?? [];
export const str = (j: DicomJson, tag: string): string => { const v = vals(j, tag)[0]; return v == null ? '' : String(v); };
export const num = (j: DicomJson, tag: string): number | null => {
  const v = vals(j, tag)[0];
  return typeof v === 'number' ? v : v == null ? null : Number(v);
};
export const strs = (j: DicomJson, tag: string): string[] => vals(j, tag).map(String);
export const pn = (j: DicomJson, tag: string): string => {
  const v = vals(j, tag)[0] as { Alphabetic?: string } | string | undefined;
  return typeof v === 'object' && v ? (v.Alphabetic ?? '') : v ? String(v) : '';
};
```

`src/api/dicomweb.ts`:

```ts
import { apiFetch, apiFetchWithHeaders, apiUrl } from './client';
import { num, pn, str, strs } from './dicomJson';
import type { DicomJson, Series, SeriesMetadata, Study } from './types';

export async function getStudies(): Promise<Study[]> {
  const rows = await apiFetch<DicomJson[]>('/dicomweb/studies');
  return rows.map((j) => ({
    studyUid: str(j, '0020000D'), patientName: pn(j, '00100010'), patientId: str(j, '00100020'),
    studyDate: str(j, '00080020'), description: str(j, '00081030'), modalities: strs(j, '00080061'),
    numSeries: num(j, '00201206') ?? 0, numInstances: num(j, '00201208') ?? 0,
  }));
}

export async function getSeries(studyUid: string): Promise<Series[]> {
  const rows = await apiFetch<DicomJson[]>(`/dicomweb/studies/${studyUid}/series`);
  return rows.map((j) => ({
    seriesUid: str(j, '0020000E'), studyUid: str(j, '0020000D') || studyUid, modality: str(j, '00080060'),
    description: str(j, '0008103E'), seriesNumber: num(j, '00200011'), numInstances: num(j, '00201209') ?? 0,
    thumbSopUid: str(j, '00080018') || undefined,
  }));
}

export async function getSeriesMetadata(studyUid: string, seriesUid: string): Promise<SeriesMetadata> {
  const { body, headers } = await apiFetchWithHeaders<DicomJson[]>(`/dicomweb/studies/${studyUid}/series/${seriesUid}/metadata`);
  return {
    sortMethod: headers.get('X-Sort-Method') ?? 'unknown',
    instances: body.map((raw) => ({ sopUid: str(raw, '00080018'), numFrames: num(raw, '00280008') ?? 1, raw })),
  };
}

export const frameUrl = (studyUid: string, seriesUid: string, sopUid: string, frame: number): string =>
  apiUrl(`/dicomweb/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/frames/${frame}`);

export const thumbnailUrl = (studyUid: string, seriesUid: string, sopUid: string, size = 128): string =>
  apiUrl(`/dicomweb/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/rendered?viewport=${size},${size}`);
```

`src/api/volume.ts`:

```ts
import { apiFetch } from './client';
import type { VolumeInfo } from './types';
export const getVolumeInfo = (seriesUid: string): Promise<VolumeInfo> =>
  apiFetch<VolumeInfo>(`/api/series/${seriesUid}/volume-info`);
```

`src/api/upload.ts`:

```ts
import { apiFetch } from './client';
import type { UploadSummary } from './types';
export function uploadFiles(files: File[]): Promise<UploadSummary> {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return apiFetch<UploadSummary>('/api/upload', { method: 'POST', body: form });
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: 8 tests pass; clean (`npm run format` first if Prettier complains).

---

### Task 2: Cornerstone adapter — init, imageIds + metadata seeding, presets

**Files:**
- Create: `src/cornerstone/init.ts`, `imageIds.ts`, `imageIds.test.ts`, `presets.ts`, `presets.test.ts`

**Interfaces:**
- Produces: `initCornerstone(): Promise<void>` (rejects `Error('WebGL2 required')`); `buildImageIds(studyUid, seriesUid, instances: InstanceMeta[]): string[]`; `seedMetadata(imageIds, instances): void`; `interface VoiPreset { name; center; width }`; `VOI_PRESETS`, `VOLUME_PRESETS`, `voiPresetsFor(modality)`, `volumePresetsFor(modality)`, `defaultVolumePreset(modality)`, `voiRange(p): { lower; upper }`.

- [ ] **Step 1: Write the failing tests**

`src/cornerstone/imageIds.test.ts`:

```ts
import { vi } from 'vitest';
vi.mock('@cornerstonejs/dicom-image-loader', () => ({ wadors: { metaDataManager: { add: vi.fn() } } }));
import { wadors } from '@cornerstonejs/dicom-image-loader';
import { buildImageIds, seedMetadata } from './imageIds';
import { API } from '../test/msw';

const inst = (sop: string, frames = 1) => ({ sopUid: sop, numFrames: frames, raw: { '00080018': { vr: 'UI', Value: [sop] } } });

test('one imageId per frame, wadors scheme', () => {
  expect(buildImageIds('S', 'SE', [inst('a'), inst('b', 3)])).toEqual([
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/a/frames/1`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/1`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/2`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/3`,
  ]);
});

test('seeds metadata for every imageId with its instance raw json', () => {
  const instances = [inst('a'), inst('b', 2)];
  const ids = buildImageIds('S', 'SE', instances);
  seedMetadata(ids, instances);
  const add = vi.mocked(wadors.metaDataManager.add);
  expect(add).toHaveBeenCalledTimes(3);
  expect(add).toHaveBeenNthCalledWith(2, ids[1], instances[1].raw);
  expect(add).toHaveBeenNthCalledWith(3, ids[2], instances[1].raw);
});
```

`src/cornerstone/presets.test.ts`:

```ts
import { defaultVolumePreset, voiPresetsFor, voiRange, volumePresetsFor, VOI_PRESETS } from './presets';

test('CT presets include the four spec windows', () => {
  expect(VOI_PRESETS.CT.map((p) => [p.name, p.center, p.width])).toEqual([
    ['Lung', -600, 1500], ['Bone', 400, 1800], ['Brain', 40, 80], ['Soft tissue', 50, 400],
  ]);
  expect(voiRange(VOI_PRESETS.CT[1])).toEqual({ lower: -500, upper: 1300 });
});

test('unknown modality falls back to CT; MR default volume preset is MR-Default', () => {
  expect(voiPresetsFor('PT')).toEqual(VOI_PRESETS.CT);
  expect(voiPresetsFor(null)).toEqual(VOI_PRESETS.CT);
  expect(volumePresetsFor('MR')).toContain('MR-Default');
  expect(defaultVolumePreset('MR')).toBe('MR-Default');
  expect(defaultVolumePreset('CT')).toBe('CT-Bone');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/cornerstone`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/cornerstone/init.ts`:

```ts
import { init as coreInit } from '@cornerstonejs/core';
import { init as toolsInit, addTool, CrosshairsTool, PanTool, StackScrollTool, TrackballRotateTool, WindowLevelTool, ZoomTool } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

let ready: Promise<void> | null = null;

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

export function initCornerstone(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (!hasWebGL2()) throw new Error('WebGL2 required');
    await coreInit();
    toolsInit();
    dicomImageLoaderInit({ maxWebWorkers: Math.max(1, Math.floor((navigator.hardwareConcurrency ?? 2) / 2)) });
    for (const T of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, CrosshairsTool, TrackballRotateTool]) addTool(T);
  })();
  return ready;
}
```

`src/cornerstone/imageIds.ts`:

```ts
import { wadors } from '@cornerstonejs/dicom-image-loader';
import { frameUrl } from '../api/dicomweb';
import type { InstanceMeta } from '../api/types';

export function buildImageIds(studyUid: string, seriesUid: string, instances: InstanceMeta[]): string[] {
  const ids: string[] = [];
  for (const inst of instances)
    for (let f = 1; f <= inst.numFrames; f++) ids.push(`wadors:${frameUrl(studyUid, seriesUid, inst.sopUid, f)}`);
  return ids;
}

export function seedMetadata(imageIds: string[], instances: InstanceMeta[]): void {
  let k = 0;
  for (const inst of instances)
    for (let f = 0; f < inst.numFrames; f++) wadors.metaDataManager.add(imageIds[k++], inst.raw as never);
}
```

`src/cornerstone/presets.ts`:

```ts
export interface VoiPreset { name: string; center: number; width: number }

export const VOI_PRESETS: Record<'CT' | 'MR', VoiPreset[]> = {
  CT: [
    { name: 'Lung', center: -600, width: 1500 }, { name: 'Bone', center: 400, width: 1800 },
    { name: 'Brain', center: 40, width: 80 }, { name: 'Soft tissue', center: 50, width: 400 },
  ],
  MR: [],
};

export const VOLUME_PRESETS: Record<'CT' | 'MR', string[]> = {
  CT: ['CT-Bone', 'CT-Lung', 'CT-Soft-Tissue', 'CT-AAA'],
  MR: ['MR-Default', 'MR-T2-Brain', 'MR-Angio'],
};

const key = (m: string | null): 'CT' | 'MR' => (m === 'MR' ? 'MR' : 'CT');
export const voiPresetsFor = (modality: string | null): VoiPreset[] => VOI_PRESETS[key(modality)];
export const volumePresetsFor = (modality: string | null): string[] => VOLUME_PRESETS[key(modality)];
export const defaultVolumePreset = (modality: string | null): string => VOLUME_PRESETS[key(modality)][0];
export const voiRange = (p: VoiPreset): { lower: number; upper: number } =>
  ({ lower: p.center - p.width / 2, upper: p.center + p.width / 2 });
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: pass.

---

### Task 3: Study browser — StudyList, SeriesGrid (greyed non-volume), UploadDropzone, BrowserPage, App routing (+ 1-line backend thumbnail addition)

**Files:**
- Create: `src/components/ui/Button.tsx`, `Spinner.tsx`, `ErrorBanner.tsx`; `src/components/browser/StudyList.tsx`, `SeriesGrid.tsx`, `SeriesGrid.test.tsx`, `UploadDropzone.tsx`, `UploadDropzone.test.tsx`, `BrowserPage.tsx`; replace `src/App.tsx`, `src/main.tsx`
- Modify (backend): `backend/app/dicomweb/qido.py` `series_json`, `backend/tests/test_qido.py`

**Interfaces:**
- Produces: `<BrowserPage/>` at `/`; `<SeriesGrid studyUid/>`; `<UploadDropzone onDone(summary)/>`; `<Button active?/>`, `<Spinner/>`, `<ErrorBanner message onRetry?/>`. Route `/viewer/:studyUid/:seriesUid` → placeholder until Task 6.

- [ ] **Step 1: Backend thumbnail SOP (tiny cross-plan change)**

In `backend/app/dicomweb/qido.py::series_json` add `"00080018": _el("UI", s.thumb_sop_uid),`. In `backend/tests/test_qido.py::test_series_and_instances` add `assert s["00080018"]["Value"] == [d[2].SOPInstanceUID]`. Run `python -m pytest tests/test_qido.py -q` in `backend/` → pass.

- [ ] **Step 2: Write the failing frontend tests**

`src/components/browser/SeriesGrid.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { SeriesGrid } from './SeriesGrid';
import { API, SERIES, STUDY, server, volumeInfoJson } from '../../test/msw';

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

test('volume series renders as a link with dims', async () => {
  render(wrap(<SeriesGrid studyUid={STUDY} />));
  const link = await screen.findByRole('link', { name: /Synthetic series/ });
  expect(link).toHaveAttribute('href', `/viewer/${STUDY}/${SERIES}`);
  expect(await screen.findByText('16 × 16 × 4')).toBeInTheDocument();
});

test('non-volume series is greyed with reason and not a link', async () => {
  server.use(http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
    HttpResponse.json({ ...volumeInfoJson, isVolume: false, reason: 'fewer than 3 slices', dims: null })));
  render(wrap(<SeriesGrid studyUid={STUDY} />));
  expect(await screen.findByText('fewer than 3 slices')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Synthetic series/ })).toBeNull();
});
```

`src/components/browser/UploadDropzone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { UploadDropzone } from './UploadDropzone';

test('uploads selected files and shows summary', async () => {
  const onDone = vi.fn();
  render(<UploadDropzone onDone={onDone} />);
  const input = screen.getByLabelText(/choose files/i);
  await userEvent.upload(input, [new File(['a'], 'a.dcm'), new File(['b'], 'notes.txt')]);
  expect(await screen.findByText(/2 files accepted/)).toBeInTheDocument();
  expect(screen.getByText(/notes\.txt: not a DICOM file/)).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ accepted: 2 }));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run src/components`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';
export function Button({ active, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const tone = active ? 'bg-sky-600 border-sky-400' : 'bg-neutral-800 border-neutral-700 hover:bg-neutral-700';
  return <button {...rest} className={`rounded px-3 py-1 text-sm border disabled:opacity-40 ${tone} ${className}`} />;
}
```

`src/components/ui/Spinner.tsx`:

```tsx
export const Spinner = () => (
  <div role="status" aria-label="loading" className="animate-spin h-6 w-6 border-2 border-neutral-500 border-t-sky-400 rounded-full" />
);
```

`src/components/ui/ErrorBanner.tsx`:

```tsx
import { Button } from './Button';
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded border border-red-700 bg-red-950 p-3 text-red-200 flex items-center gap-3">
      <span>{message}</span>{onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}
```

`src/components/browser/StudyList.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { getStudies } from '../../api/dicomweb';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';

export function StudyList({ selected, onSelect }: { selected: string | null; onSelect: (uid: string) => void }) {
  const q = useQuery({ queryKey: ['studies'], queryFn: getStudies });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBanner message={`Backend unreachable: ${q.error.message}`} onRetry={() => void q.refetch()} />;
  return (
    <table className="w-full text-sm">
      <thead className="text-neutral-400 text-left">
        <tr><th className="p-2">Patient</th><th>ID</th><th>Date</th><th>Description</th><th>Modality</th><th>Series</th></tr>
      </thead>
      <tbody>
        {q.data.map((s) => (
          <tr key={s.studyUid} onClick={() => onSelect(s.studyUid)}
              className={`cursor-pointer hover:bg-neutral-800 ${selected === s.studyUid ? 'bg-neutral-800' : ''}`}>
            <td className="p-2">{s.patientName || '—'}</td><td>{s.patientId}</td><td>{s.studyDate}</td>
            <td>{s.description}</td><td>{s.modalities.join(', ')}</td><td>{s.numSeries}</td>
          </tr>
        ))}
        {q.data.length === 0 && (
          <tr><td className="p-2 text-neutral-500" colSpan={6}>No studies yet — drop DICOM files below.</td></tr>
        )}
      </tbody>
    </table>
  );
}
```

`src/components/browser/SeriesGrid.tsx`:

```tsx
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getSeries, thumbnailUrl } from '../../api/dicomweb';
import { getVolumeInfo } from '../../api/volume';
import type { Series, VolumeInfo } from '../../api/types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';

function Card({ s, info }: { s: Series; info: VolumeInfo | undefined }) {
  const body = (
    <div className={`rounded border p-2 w-44 ${info?.isVolume ? 'border-neutral-700 hover:border-sky-500' : 'border-neutral-800 opacity-50'}`}>
      {s.thumbSopUid && <img alt="" className="w-40 h-40 bg-black object-contain" src={thumbnailUrl(s.studyUid, s.seriesUid, s.thumbSopUid, 160)} />}
      <div className="mt-1 text-sm truncate">{s.description || `Series ${s.seriesNumber ?? ''}`}</div>
      <div className="text-xs text-neutral-400">{s.modality} · {s.numInstances} images</div>
      {info?.dims && <div className="text-xs text-neutral-400">{info.dims.join(' × ')}</div>}
      {info && !info.isVolume && <div className="text-xs text-amber-400">{info.reason}</div>}
    </div>
  );
  return info?.isVolume
    ? <Link to={`/viewer/${s.studyUid}/${s.seriesUid}`} aria-label={s.description || s.seriesUid}>{body}</Link>
    : body;
}

export function SeriesGrid({ studyUid }: { studyUid: string }) {
  const q = useQuery({ queryKey: ['series', studyUid], queryFn: () => getSeries(studyUid) });
  const infos = useQueries({
    queries: (q.data ?? []).map((s) => ({ queryKey: ['volume-info', s.seriesUid], queryFn: () => getVolumeInfo(s.seriesUid) })),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-wrap gap-3 p-2">
      {q.data.map((s, i) => <Card key={s.seriesUid} s={s} info={infos[i]?.data} />)}
    </div>
  );
}
```

`src/components/browser/UploadDropzone.tsx`:

```tsx
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
    setBusy(true); setError(null);
    try { const s = await uploadFiles(files); setSummary(s); onDone(s); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); void send(Array.from(e.dataTransfer.files)); };

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
         className="m-4 rounded border-2 border-dashed border-neutral-700 p-6 text-center text-neutral-400">
      <p>Drop a folder of DICOM files or a .zip here, or</p>
      <label className="underline cursor-pointer">choose files
        <input type="file" multiple className="hidden" aria-label="choose files"
               onChange={(e) => void send(Array.from(e.target.files ?? []))} />
      </label>
      {busy && <div className="mt-3 flex justify-center"><Spinner /></div>}
      {error && <p role="alert" className="mt-3 text-red-400">{error}</p>}
      {summary && (
        <div className="mt-3 text-left text-sm">
          <p className="text-neutral-200">
            {summary.accepted} files accepted{summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}
          </p>
          <ul className="text-amber-400">{summary.skipped.map((s) => <li key={s.file}>{s.file}: {s.reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```

Folder drops work through `dataTransfer.files` in Chromium when the user drags a folder; the file picker stays a plain multi-file picker (a `.zip` is the recommended path for large series).

`src/components/browser/BrowserPage.tsx`:

```tsx
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
      <UploadDropzone onDone={(s) => {
        void qc.invalidateQueries({ queryKey: ['studies'] });
        void qc.invalidateQueries({ queryKey: ['series'] });
        if (s.studyUids[0]) setStudy(s.studyUids[0]);
      }} />
    </main>
  );
}
```

`src/App.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { BrowserPage } from './components/browser/BrowserPage';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BrowserPage />} />
          <Route path="/viewer/:studyUid/:seriesUid" element={<div>viewer</div>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initCornerstone } from './cornerstone/init';

const root = createRoot(document.getElementById('root')!);
initCornerstone().then(
  () => root.render(<StrictMode><App /></StrictMode>),
  (e: Error) => root.render(
    <div className="p-8 text-center"><h1 className="text-xl">WebGL2 required</h1><p className="text-neutral-400">{e.message}</p></div>,
  ),
);
```

- [ ] **Step 5: Run tests, typecheck, lint; then look at it**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: pass. Then with the backend running (`..\scripts\dev.ps1` from repo root) and `npm run dev`: `http://localhost:5173` lists the two sample studies, series cards show thumbnails and dims, dropping a DICOM folder adds a study.

---

### Task 4: Cornerstone adapter — volume loading, viewport layout, tool groups

**Files:**
- Create: `src/cornerstone/volume.ts`, `volume.test.ts`, `viewports.ts`, `toolGroups.ts`

**Interfaces:**
- Produces (`volume.ts`): `volumeIdFor(seriesUid)`; `loadVolume(volumeId, imageIds, onProgress?: (done, total) => void): Promise<Types.IImageVolume>`; `releaseVolume(volumeId): void`.
- Produces (`viewports.ts`): `VIEWPORT_IDS = { axial: 'mpr-axial', sagittal: 'mpr-sagittal', coronal: 'mpr-coronal', volume3d: 'vol-3d' } as const`; `type ViewportKey`; `MPR_IDS`, `ALL_IDS`; `createViewerLayout(engineId, elements: Record<ViewportKey, HTMLDivElement>): RenderingEngine`; `showVolume(engine, volumeId, modality): Promise<void>`; `destroyViewerLayout(engine): void`.
- Produces (`toolGroups.ts`): `MPR_TOOL_GROUP`, `VOL_TOOL_GROUP`; `createToolGroups(engineId)`; `setCrosshairsActive(on)`; `destroyToolGroups()`.

- [ ] **Step 1: Write the failing test for `loadVolume`** (core is mocked; real one needs WebGL)

`src/cornerstone/volume.test.ts`:

```ts
import { vi } from 'vitest';

const listeners = new Map<string, Set<(e: Event) => void>>();
const eventTarget = {
  addEventListener: (t: string, f: (e: Event) => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
  removeEventListener: (t: string, f: (e: Event) => void) => listeners.get(t)?.delete(f),
};
const fire = (t: string, detail: unknown) => listeners.get(t)?.forEach((f) => f(new CustomEvent(t, { detail })));
const load = vi.fn();
const removeVolumeLoadObject = vi.fn();
vi.mock('@cornerstonejs/core', () => ({
  eventTarget,
  Enums: { Events: { IMAGE_VOLUME_MODIFIED: 'VM', IMAGE_VOLUME_LOADING_COMPLETED: 'VC', IMAGE_LOAD_ERROR: 'LE' } },
  volumeLoader: { createAndCacheVolume: vi.fn(async (volumeId: string, o: { imageIds: string[] }) => ({ volumeId, imageIds: o.imageIds, load })) },
  cache: { removeVolumeLoadObject, getVolume: vi.fn(() => ({})) },
}));
import { loadVolume, releaseVolume, volumeIdFor } from './volume';

test('resolves on completion and reports progress only for its own volume', async () => {
  const progress = vi.fn();
  const p = loadVolume(volumeIdFor('S'), ['wadors:a', 'wadors:b'], progress);
  await Promise.resolve(); await Promise.resolve(); // let createAndCacheVolume settle
  fire('VM', { volumeId: volumeIdFor('S'), framesProcessed: 1, numberOfFrames: 2 });
  fire('VM', { volumeId: 'other', framesProcessed: 9, numberOfFrames: 9 });
  fire('VC', { volumeId: volumeIdFor('S') });
  const v = await p;
  expect(v.volumeId).toBe('cornerstoneStreamingImageVolume:S');
  expect(load).toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith(1, 2);
  expect(progress).not.toHaveBeenCalledWith(9, 9);
});

test('rejects after a repeated load error for one of its images', async () => {
  const p = loadVolume(volumeIdFor('T'), ['wadors:x']);
  fire('LE', { imageId: 'wadors:x', error: new Error('404') });
  fire('LE', { imageId: 'wadors:x', error: new Error('404') });
  await expect(p).rejects.toThrow(/wadors:x/);
});

test('releaseVolume removes from cache', () => {
  releaseVolume('cornerstoneStreamingImageVolume:S');
  expect(removeVolumeLoadObject).toHaveBeenCalledWith('cornerstoneStreamingImageVolume:S');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/cornerstone/volume`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `volume.ts`, `viewports.ts`, `toolGroups.ts`**

`src/cornerstone/volume.ts`:

```ts
import { cache, Enums, eventTarget, volumeLoader, type Types } from '@cornerstonejs/core';

export const volumeIdFor = (seriesUid: string): string => `cornerstoneStreamingImageVolume:${seriesUid}`;

type ModDetail = { volumeId: string; framesProcessed: number; numberOfFrames: number };
type ErrDetail = { imageId: string; error?: Error };

export function loadVolume(
  volumeId: string, imageIds: string[], onProgress?: (done: number, total: number) => void,
): Promise<Types.IImageVolume> {
  return new Promise((resolve, reject) => {
    const ids = new Set(imageIds);
    const failedOnce = new Set<string>();
    let volume: Types.IImageVolume | undefined;

    const off = () => {
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);
    };
    const onMod = (e: Event) => {
      const d = (e as CustomEvent<ModDetail>).detail;
      if (d.volumeId === volumeId) onProgress?.(d.framesProcessed, d.numberOfFrames);
    };
    const onDone = (e: Event) => {
      if ((e as CustomEvent<{ volumeId: string }>).detail.volumeId !== volumeId) return;
      off(); resolve(volume!);
    };
    const onErr = (e: Event) => {
      const d = (e as CustomEvent<ErrDetail>).detail;
      if (!ids.has(d.imageId)) return;
      if (!failedOnce.has(d.imageId)) { failedOnce.add(d.imageId); return; } // the loader retries once
      off(); reject(new Error(`slice failed to load: ${d.imageId} (${d.error?.message ?? 'error'})`));
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);

    volumeLoader.createAndCacheVolume(volumeId, { imageIds }).then(
      (v) => { volume = v as Types.IImageVolume; (v as unknown as { load: () => void }).load(); },
      (err: Error) => { off(); reject(err); },
    );
  });
}

export function releaseVolume(volumeId: string): void {
  if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
}
```

`src/cornerstone/viewports.ts`:

```ts
import { Enums, RenderingEngine, setVolumesForViewports, type Types } from '@cornerstonejs/core';
import { defaultVolumePreset } from './presets';

export const VIEWPORT_IDS = { axial: 'mpr-axial', sagittal: 'mpr-sagittal', coronal: 'mpr-coronal', volume3d: 'vol-3d' } as const;
export type ViewportKey = keyof typeof VIEWPORT_IDS;
export const MPR_IDS: string[] = [VIEWPORT_IDS.axial, VIEWPORT_IDS.sagittal, VIEWPORT_IDS.coronal];
export const ALL_IDS: string[] = [...MPR_IDS, VIEWPORT_IDS.volume3d];
const BLACK: Types.RGB = [0, 0, 0];

export function createViewerLayout(engineId: string, els: Record<ViewportKey, HTMLDivElement>): RenderingEngine {
  const engine = new RenderingEngine(engineId);
  const ortho = (id: string, element: HTMLDivElement, orientation: Enums.OrientationAxis): Types.PublicViewportInput =>
    ({ viewportId: id, type: Enums.ViewportType.ORTHOGRAPHIC, element, defaultOptions: { orientation, background: BLACK } });
  engine.setViewports([
    ortho(VIEWPORT_IDS.axial, els.axial, Enums.OrientationAxis.AXIAL),
    ortho(VIEWPORT_IDS.sagittal, els.sagittal, Enums.OrientationAxis.SAGITTAL),
    ortho(VIEWPORT_IDS.coronal, els.coronal, Enums.OrientationAxis.CORONAL),
    { viewportId: VIEWPORT_IDS.volume3d, type: Enums.ViewportType.VOLUME_3D, element: els.volume3d, defaultOptions: { background: [0.05, 0.05, 0.08] } },
  ]);
  return engine;
}

export async function showVolume(engine: RenderingEngine, volumeId: string, modality: string | null): Promise<void> {
  await setVolumesForViewports(engine, [{ volumeId }], ALL_IDS);
  const v3 = engine.getViewport(VIEWPORT_IDS.volume3d) as Types.IVolumeViewport;
  v3.setProperties({ preset: defaultVolumePreset(modality) });
  for (const id of ALL_IDS) engine.getViewport(id).resetCamera();
  engine.render();
}

export function destroyViewerLayout(engine: RenderingEngine): void {
  for (const id of ALL_IDS) { try { engine.disableElement(id); } catch { /* already disabled */ } }
  engine.destroy();
}
```

`src/cornerstone/toolGroups.ts`:

```ts
import { CrosshairsTool, Enums, PanTool, StackScrollTool, ToolGroupManager, TrackballRotateTool, WindowLevelTool, ZoomTool } from '@cornerstonejs/tools';
import { MPR_IDS, VIEWPORT_IDS } from './viewports';

export const MPR_TOOL_GROUP = 'mpr';
export const VOL_TOOL_GROUP = 'vol3d';
const { MouseBindings, KeyboardBindings } = Enums;
const LINE_COLORS: Record<string, string> = {
  [VIEWPORT_IDS.axial]: 'rgb(200, 0, 0)', [VIEWPORT_IDS.sagittal]: 'rgb(200, 200, 0)', [VIEWPORT_IDS.coronal]: 'rgb(0, 200, 0)',
};

export function createToolGroups(engineId: string): void {
  destroyToolGroups();
  const mpr = ToolGroupManager.createToolGroup(MPR_TOOL_GROUP)!;
  for (const id of MPR_IDS) mpr.addViewport(id, engineId);
  mpr.addTool(WindowLevelTool.toolName);
  mpr.addTool(PanTool.toolName);
  mpr.addTool(ZoomTool.toolName);
  mpr.addTool(StackScrollTool.toolName);
  mpr.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (id: string) => LINE_COLORS[id] ?? 'rgb(255,255,255)',
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    getReferenceLineSlabThicknessControlsOn: () => false,
  });
  mpr.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }, { mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift }] });
  mpr.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Ctrl }] });
  mpr.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
  setCrosshairsActive(true);

  const vol = ToolGroupManager.createToolGroup(VOL_TOOL_GROUP)!;
  vol.addViewport(VIEWPORT_IDS.volume3d, engineId);
  vol.addTool(TrackballRotateTool.toolName);
  vol.addTool(PanTool.toolName);
  vol.addTool(ZoomTool.toolName);
  vol.setToolActive(TrackballRotateTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  vol.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  vol.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Wheel }] });
}

export function setCrosshairsActive(on: boolean): void {
  const mpr = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP);
  if (!mpr) return;
  if (on) {
    mpr.setToolPassive(WindowLevelTool.toolName);
    mpr.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  } else {
    mpr.setToolDisabled(CrosshairsTool.toolName);
    mpr.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  }
}

export function destroyToolGroups(): void {
  for (const id of [MPR_TOOL_GROUP, VOL_TOOL_GROUP]) if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: pass. If typecheck flags a Cornerstone signature, read the `.d.ts` under `node_modules/@cornerstonejs/*/dist/esm/` and adjust the call — do not reach for `any`.

---

### Task 5: `useSeriesMetadata`, `useVolume` (state machine + >1 GB confirm), `useViewportState`

**Files:**
- Create: `src/hooks/useSeriesMetadata.ts`, `useVolume.ts`, `useVolume.test.tsx`, `useViewportState.ts`, `useViewportState.test.ts`

**Interfaces:**
- Produces: `useSeriesMetadata(studyUid, seriesUid, enabled = true)`.
- Produces: `useVolume(studyUid, seriesUid): { status: 'info' | 'metadata' | 'loading' | 'ready' | 'blocked' | 'error'; info: VolumeInfo | null; progress: { done; total }; volumeId: string | null; error: string | null }`; releases the volume on unmount; asks `window.confirm` when `estimatedBytes > 1e9`.
- Produces: `interface ViewportState { sliceIndex; numSlices; voi: { lower; upper } | null; zoom }`; `initialViewportState`; `viewportReducer(state, evt)`; `useViewportState(engineId, viewportId, enabled): ViewportState`.

- [ ] **Step 1: Write the failing tests**

`src/hooks/useVolume.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { API, SERIES, STUDY, server, volumeInfoJson } from '../test/msw';

const loadVolume = vi.fn(async (id: string, ids: string[], onProgress?: (d: number, t: number) => void) => {
  onProgress?.(ids.length, ids.length); return { volumeId: id };
});
const releaseVolume = vi.fn();
vi.mock('../cornerstone/volume', () => ({ loadVolume, releaseVolume, volumeIdFor: (s: string) => `vol:${s}` }));
vi.mock('../cornerstone/imageIds', () => ({
  buildImageIds: (_s: string, _se: string, inst: { sopUid: string }[]) => inst.map((i) => `wadors:${i.sopUid}`),
  seedMetadata: vi.fn(),
}));
import { useVolume } from './useVolume';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { loadVolume.mockClear(); releaseVolume.mockClear(); });

test('info → metadata → loading → ready, then releases on unmount', async () => {
  const { result, unmount } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.volumeId).toBe(`vol:${SERIES}`);
  expect(result.current.progress).toEqual({ done: 4, total: 4 });
  expect(loadVolume).toHaveBeenCalledWith(`vol:${SERIES}`, ['wadors:1.1', 'wadors:1.2', 'wadors:1.3', 'wadors:1.4'], expect.any(Function));
  unmount();
  expect(releaseVolume).toHaveBeenCalledWith(`vol:${SERIES}`);
});

test('non-volume series is blocked with reason and never loads', async () => {
  server.use(http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
    HttpResponse.json({ ...volumeInfoJson, isVolume: false, reason: 'mixed orientations' })));
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('blocked'));
  expect(result.current.error).toBe('mixed orientations');
  expect(loadVolume).not.toHaveBeenCalled();
});

test('loader failure → error', async () => {
  loadVolume.mockRejectedValueOnce(new Error('slice failed to load: x'));
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toMatch(/slice failed/);
});

test('volumes over 1 GB ask for confirmation; cancel → error, no load', async () => {
  server.use(http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
    HttpResponse.json({ ...volumeInfoJson, estimatedBytes: 2e9 })));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/2\.0 GB/));
  expect(result.current.error).toBe('Load cancelled');
  expect(loadVolume).not.toHaveBeenCalled();
  confirm.mockRestore();
});
```

`src/hooks/useViewportState.test.ts`:

```ts
import { initialViewportState, viewportReducer } from './useViewportState';

test('reducer updates slice, voi and zoom independently', () => {
  let s = viewportReducer(initialViewportState, { type: 'slice', sliceIndex: 3, numSlices: 10 });
  s = viewportReducer(s, { type: 'voi', lower: -100, upper: 300 });
  s = viewportReducer(s, { type: 'zoom', zoom: 1.5 });
  expect(s).toEqual({ sliceIndex: 3, numSlices: 10, voi: { lower: -100, upper: 300 }, zoom: 1.5 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/hooks`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hooks**

`src/hooks/useSeriesMetadata.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { getSeriesMetadata } from '../api/dicomweb';

export const useSeriesMetadata = (studyUid: string, seriesUid: string, enabled = true) =>
  useQuery({
    queryKey: ['metadata', studyUid, seriesUid],
    queryFn: () => getSeriesMetadata(studyUid, seriesUid),
    enabled, staleTime: Infinity,
  });
```

`src/hooks/useVolume.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getVolumeInfo } from '../api/volume';
import type { VolumeInfo } from '../api/types';
import { buildImageIds, seedMetadata } from '../cornerstone/imageIds';
import { loadVolume, releaseVolume, volumeIdFor } from '../cornerstone/volume';
import { useSeriesMetadata } from './useSeriesMetadata';

export type VolumeStatus = 'info' | 'metadata' | 'loading' | 'ready' | 'blocked' | 'error';
export interface VolumeState {
  status: VolumeStatus; info: VolumeInfo | null; progress: { done: number; total: number };
  volumeId: string | null; error: string | null;
}
type LoadState = { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string };
const GB = 1e9;

export function useVolume(studyUid: string, seriesUid: string): VolumeState {
  const infoQ = useQuery({ queryKey: ['volume-info', seriesUid], queryFn: () => getVolumeInfo(seriesUid) });
  const canLoad = infoQ.data?.isVolume === true;
  const metaQ = useSeriesMetadata(studyUid, seriesUid, canLoad);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const volumeId = volumeIdFor(seriesUid);
  const started = useRef(false);

  useEffect(() => {
    const info = infoQ.data;
    if (!canLoad || !info || !metaQ.data || started.current) return;
    started.current = true;
    const bytes = info.estimatedBytes ?? 0;
    if (bytes > GB && !window.confirm(`This volume needs ~${(bytes / GB).toFixed(1)} GB of GPU memory. Load it?`)) {
      setLoad({ status: 'error', error: 'Load cancelled' });
      return;
    }
    const imageIds = buildImageIds(studyUid, seriesUid, metaQ.data.instances);
    seedMetadata(imageIds, metaQ.data.instances);
    setProgress({ done: 0, total: imageIds.length });
    setLoad({ status: 'loading' });
    loadVolume(volumeId, imageIds, (done, total) => setProgress({ done, total })).then(
      () => setLoad({ status: 'ready' }),
      (e: Error) => setLoad({ status: 'error', error: e.message }),
    );
  }, [canLoad, infoQ.data, metaQ.data, studyUid, seriesUid, volumeId]);

  useEffect(() => () => { if (started.current) releaseVolume(volumeId); }, [volumeId]);

  const info = infoQ.data ?? null;
  const base = { info, progress };
  if (infoQ.isError) return { ...base, status: 'error', volumeId: null, error: infoQ.error.message };
  if (infoQ.isPending || !info) return { ...base, status: 'info', volumeId: null, error: null };
  if (!info.isVolume) return { ...base, status: 'blocked', volumeId: null, error: info.reason ?? 'not a volume' };
  if (metaQ.isError) return { ...base, status: 'error', volumeId: null, error: metaQ.error.message };
  if (load.status === 'error') return { ...base, status: 'error', volumeId: null, error: load.error ?? 'load failed' };
  if (metaQ.isPending || load.status === 'idle') return { ...base, status: 'metadata', volumeId: null, error: null };
  if (load.status === 'loading') return { ...base, status: 'loading', volumeId: null, error: null };
  return { ...base, status: 'ready', volumeId, error: null };
}
```

`src/hooks/useViewportState.ts`:

```ts
import { Enums, getRenderingEngine, utilities, type Types } from '@cornerstonejs/core';
import { useEffect, useReducer } from 'react';

export interface ViewportState { sliceIndex: number; numSlices: number; voi: { lower: number; upper: number } | null; zoom: number }
export type ViewportEvent =
  | { type: 'slice'; sliceIndex: number; numSlices: number }
  | { type: 'voi'; lower: number; upper: number }
  | { type: 'zoom'; zoom: number };
export const initialViewportState: ViewportState = { sliceIndex: 0, numSlices: 0, voi: null, zoom: 1 };

export function viewportReducer(s: ViewportState, e: ViewportEvent): ViewportState {
  switch (e.type) {
    case 'slice': return { ...s, sliceIndex: e.sliceIndex, numSlices: e.numSlices };
    case 'voi': return { ...s, voi: { lower: e.lower, upper: e.upper } };
    case 'zoom': return { ...s, zoom: e.zoom };
  }
}

export function useViewportState(engineId: string, viewportId: string, enabled: boolean): ViewportState {
  const [state, dispatch] = useReducer(viewportReducer, initialViewportState);
  useEffect(() => {
    if (!enabled) return;
    const vp = getRenderingEngine(engineId)?.getViewport(viewportId) as Types.IVolumeViewport | undefined;
    if (!vp) return;
    const el = vp.element;
    const readSlice = () => {
      try {
        const d = utilities.getImageSliceDataForVolumeViewport(vp);
        dispatch({ type: 'slice', sliceIndex: d.imageIndex, numSlices: d.numberOfSlices });
      } catch { /* volume not attached yet */ }
    };
    const onVoi = (e: Event) => {
      const r = (e as CustomEvent<{ range: { lower: number; upper: number } }>).detail.range;
      dispatch({ type: 'voi', lower: r.lower, upper: r.upper });
    };
    const onCam = () => { readSlice(); dispatch({ type: 'zoom', zoom: vp.getZoom() }); };
    const events = [Enums.Events.VOLUME_NEW_IMAGE, Enums.Events.IMAGE_RENDERED];
    el.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
    for (const ev of events) el.addEventListener(ev, readSlice);
    readSlice();
    const props = vp.getProperties();
    if (props.voiRange) dispatch({ type: 'voi', lower: props.voiRange.lower, upper: props.voiRange.upper });
    return () => {
      el.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
      el.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      for (const ev of events) el.removeEventListener(ev, readSlice);
    };
  }, [engineId, viewportId, enabled]);
  return state;
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: pass. If `vp.getZoom` is absent from the typings, use `vp.getCamera().parallelScale ?? 1` and label the overlay value "scale".

---

### Task 6: Viewer page — layout, viewports, overlay, progress, toolbar, metadata panel

**Files:**
- Create: `src/components/viewer/ViewerPage.tsx`, `ViewerLayout.tsx`, `ViewportPanel.tsx`, `ViewportOverlay.tsx`, `LoadProgress.tsx`, `Toolbar.tsx`, `Toolbar.test.tsx`, `MetadataPanel.tsx`, `MetadataPanel.test.tsx`
- Modify: `src/App.tsx` (route → `ViewerPage`)

**Interfaces:**
- Produces: `<ViewerPage/>`; `<ViewerLayout volumeId modality/>` (`ENGINE_ID = 'viewer-engine'`); `<ViewportPanel ref engineId viewportId label ready is3d? onMaximize?/>`; `<Toolbar modality crosshairs onCrosshairs onVoiPreset onVolumePreset onInvert onReset/>`; `<MetadataPanel info description/>`; `<LoadProgress done total label/>`.
- DOM hooks for e2e: `data-testid="panel-<Label>"`, `slice-<Label>`, `wl-<Label>`; labels `Axial`, `Sagittal`, `Coronal`, `3D`.

- [ ] **Step 1: Write the failing tests** (pure components; Cornerstone-bound ones are covered by Playwright)

`src/components/viewer/Toolbar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Toolbar } from './Toolbar';

test('CT toolbar exposes presets and fires callbacks', async () => {
  const onVoi = vi.fn(); const onVol = vi.fn(); const onX = vi.fn(); const onReset = vi.fn(); const onInvert = vi.fn();
  render(<Toolbar modality="CT" crosshairs onCrosshairs={onX} onVoiPreset={onVoi} onVolumePreset={onVol} onInvert={onInvert} onReset={onReset} />);
  await userEvent.selectOptions(screen.getByLabelText('MPR window'), 'Bone');
  expect(onVoi).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bone', center: 400, width: 1800 }));
  await userEvent.selectOptions(screen.getByLabelText('3D preset'), 'CT-Lung');
  expect(onVol).toHaveBeenCalledWith('CT-Lung');
  await userEvent.click(screen.getByRole('button', { name: /crosshairs/i }));
  expect(onX).toHaveBeenCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: /invert/i }));
  expect(onInvert).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /reset/i }));
  expect(onReset).toHaveBeenCalled();
});
```

`src/components/viewer/MetadataPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MetadataPanel } from './MetadataPanel';
import { volumeInfoJson } from '../../test/msw';
import type { VolumeInfo } from '../../api/types';

test('shows dims, spacing, modality and memory', () => {
  render(<MetadataPanel info={volumeInfoJson as VolumeInfo} description="Synthetic series" />);
  expect(screen.getByText('16 × 16 × 4')).toBeInTheDocument();
  expect(screen.getByText('0.50 × 0.50 × 1.00 mm')).toBeInTheDocument();
  expect(screen.getByText('CT')).toBeInTheDocument();
  expect(screen.getByText('2.0 KB')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/viewer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the viewer components**

`src/components/viewer/Toolbar.tsx`:

```tsx
import { voiPresetsFor, volumePresetsFor, type VoiPreset } from '../../cornerstone/presets';
import { Button } from '../ui/Button';

export interface ToolbarProps {
  modality: string | null; crosshairs: boolean; onCrosshairs: (on: boolean) => void;
  onVoiPreset: (p: VoiPreset) => void; onVolumePreset: (name: string) => void; onInvert: () => void; onReset: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const voi = voiPresetsFor(p.modality);
  const vol = volumePresetsFor(p.modality);
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-neutral-900 border-b border-neutral-800 text-sm">
      <Button active={p.crosshairs} onClick={() => p.onCrosshairs(!p.crosshairs)}>Crosshairs</Button>
      <label className="flex items-center gap-1">MPR window
        <select aria-label="MPR window" className="bg-neutral-800 rounded px-1" defaultValue=""
                onChange={(e) => { const s = voi.find((x) => x.name === e.target.value); if (s) p.onVoiPreset(s); }}>
          <option value="" disabled>{voi.length ? 'preset…' : 'from header'}</option>
          {voi.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">3D preset
        <select aria-label="3D preset" className="bg-neutral-800 rounded px-1" defaultValue={vol[0]}
                onChange={(e) => p.onVolumePreset(e.target.value)}>
          {vol.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <Button onClick={p.onInvert}>Invert</Button>
      <Button onClick={p.onReset}>Reset</Button>
    </div>
  );
}
```

`src/components/viewer/MetadataPanel.tsx`:

```tsx
import type { VolumeInfo } from '../../api/types';

const fmtBytes = (b: number | null): string =>
  b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(1)} KB`;
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-neutral-800"><span className="text-neutral-400">{k}</span><span>{v}</span></div>
);

export function MetadataPanel({ info, description }: { info: VolumeInfo; description: string }) {
  return (
    <aside className="w-64 p-3 text-sm bg-neutral-900 border-l border-neutral-800 overflow-auto">
      <h2 className="font-semibold mb-2 truncate">{description || info.seriesUid}</h2>
      <Row k="Modality" v={info.modality ?? '—'} />
      <Row k="Dimensions" v={info.dims ? info.dims.join(' × ') : '—'} />
      <Row k="Spacing" v={info.spacing ? `${info.spacing.map((s) => s.toFixed(2)).join(' × ')} mm` : '—'} />
      <Row k="Slices" v={String(info.instanceCount)} />
      <Row k="Ordering" v={info.sortMethod ?? '—'} />
      <Row k="GPU memory" v={fmtBytes(info.estimatedBytes)} />
      {info.direction && <Row k="Row / col cosines" v={info.direction.slice(0, 6).map((d) => d.toFixed(0)).join(' ')} />}
    </aside>
  );
}
```

`src/components/viewer/LoadProgress.tsx`:

```tsx
export function LoadProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div role="progressbar" aria-valuenow={pct} aria-label="volume load"
         className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10">
      <div className="w-64 h-2 bg-neutral-800 rounded"><div className="h-2 bg-sky-500 rounded" style={{ width: `${pct}%` }} /></div>
      <div className="mt-2 text-sm text-neutral-300">{label} — {done}/{total} slices ({pct}%)</div>
    </div>
  );
}
```

`src/components/viewer/ViewportOverlay.tsx`:

```tsx
import type { ViewportState } from '../../hooks/useViewportState';

export function ViewportOverlay({ label, state, is3d }: { label: string; state: ViewportState; is3d?: boolean }) {
  const wl = state.voi ? `W ${Math.round(state.voi.upper - state.voi.lower)} / L ${Math.round((state.voi.upper + state.voi.lower) / 2)}` : '';
  return (
    <>
      <div className="absolute top-1 left-2 text-xs text-sky-300 pointer-events-none">{label}</div>
      {!is3d && (
        <div className="absolute bottom-1 left-2 text-xs text-neutral-300 pointer-events-none" data-testid={`slice-${label}`}>
          {state.numSlices ? `${state.sliceIndex + 1} / ${state.numSlices}` : ''}
        </div>
      )}
      {!is3d && <div className="absolute bottom-1 right-2 text-xs text-neutral-300 pointer-events-none" data-testid={`wl-${label}`}>{wl}</div>}
    </>
  );
}
```

`src/components/viewer/ViewportPanel.tsx`:

```tsx
import { forwardRef } from 'react';
import { useViewportState } from '../../hooks/useViewportState';
import { ViewportOverlay } from './ViewportOverlay';

export interface ViewportPanelProps {
  engineId: string; viewportId: string; label: string; ready: boolean; is3d?: boolean; onMaximize?: () => void;
}

export const ViewportPanel = forwardRef<HTMLDivElement, ViewportPanelProps>(function ViewportPanel(
  { engineId, viewportId, label, ready, is3d, onMaximize }, ref,
) {
  const state = useViewportState(engineId, viewportId, ready);
  return (
    <div className="relative bg-black border border-neutral-800 min-h-0" onDoubleClick={onMaximize} data-testid={`panel-${label}`}>
      <div ref={ref} className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
      <ViewportOverlay label={label} state={state} is3d={is3d} />
    </div>
  );
});
```

`src/components/viewer/ViewerLayout.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { getRenderingEngine, type Types } from '@cornerstonejs/core';
import { ALL_IDS, MPR_IDS, VIEWPORT_IDS, createViewerLayout, destroyViewerLayout, showVolume, type ViewportKey } from '../../cornerstone/viewports';
import { createToolGroups, destroyToolGroups, setCrosshairsActive } from '../../cornerstone/toolGroups';
import { voiRange, type VoiPreset } from '../../cornerstone/presets';
import { Toolbar } from './Toolbar';
import { ViewportPanel } from './ViewportPanel';

export const ENGINE_ID = 'viewer-engine';
const LABELS: Record<ViewportKey, string> = { axial: 'Axial', sagittal: 'Sagittal', coronal: 'Coronal', volume3d: '3D' };

export function ViewerLayout({ volumeId, modality }: { volumeId: string; modality: string | null }) {
  const axial = useRef<HTMLDivElement>(null); const sagittal = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null); const volume3d = useRef<HTMLDivElement>(null);
  const refs = { axial, sagittal, coronal, volume3d };
  const [ready, setReady] = useState(false);
  const [crosshairs, setCrosshairs] = useState(true);
  const [max, setMax] = useState<ViewportKey | null>(null);

  useEffect(() => {
    const engine = createViewerLayout(ENGINE_ID, {
      axial: axial.current!, sagittal: sagittal.current!, coronal: coronal.current!, volume3d: volume3d.current!,
    });
    createToolGroups(ENGINE_ID);
    let alive = true;
    void showVolume(engine, volumeId, modality).then(() => { if (alive) setReady(true); });
    return () => { alive = false; setReady(false); destroyToolGroups(); destroyViewerLayout(engine); };
  }, [volumeId, modality]);

  useEffect(() => { getRenderingEngine(ENGINE_ID)?.resize(true); }, [max]);

  const engine = () => getRenderingEngine(ENGINE_ID);
  const mpr = () => MPR_IDS.map((id) => engine()!.getViewport(id) as Types.IVolumeViewport);
  const vol3d = () => engine()!.getViewport(VIEWPORT_IDS.volume3d) as Types.IVolumeViewport;

  const onVoiPreset = (p: VoiPreset) => { for (const vp of mpr()) { vp.setProperties({ voiRange: voiRange(p) }); vp.render(); } };
  const onVolumePreset = (name: string) => { vol3d().setProperties({ preset: name }); vol3d().render(); };
  const onInvert = () => { for (const vp of mpr()) { vp.setProperties({ invert: !(vp.getProperties().invert ?? false) }); vp.render(); } };
  const onReset = () => {
    const e = engine(); if (!e) return;
    for (const id of ALL_IDS) { const vp = e.getViewport(id) as Types.IVolumeViewport; vp.resetProperties(); }
    void showVolume(e, volumeId, modality);
  };
  const onCrosshairs = (on: boolean) => { setCrosshairs(on); setCrosshairsActive(on); engine()?.render(); };

  const panel = (key: ViewportKey) => (
    <div key={key} className={max && max !== key ? 'hidden' : 'contents'}>
      <ViewportPanel ref={refs[key]} engineId={ENGINE_ID} viewportId={VIEWPORT_IDS[key]} label={LABELS[key]}
                     ready={ready} is3d={key === 'volume3d'} onMaximize={() => setMax(max ? null : key)} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <Toolbar modality={modality} crosshairs={crosshairs} onCrosshairs={onCrosshairs} onVoiPreset={onVoiPreset}
               onVolumePreset={onVolumePreset} onInvert={onInvert} onReset={onReset} />
      <div className={`flex-1 grid gap-1 p-1 min-h-0 ${max ? 'grid-cols-1 grid-rows-1' : 'grid-cols-2 grid-rows-2'}`}>
        {(['axial', 'sagittal', 'coronal', 'volume3d'] as ViewportKey[]).map(panel)}
      </div>
    </div>
  );
}
```

`display: contents` wrappers keep all four `<div ref>` elements mounted while a panel is maximised — Cornerstone must never lose its elements — so hidden panels get `hidden` rather than being unmounted.

`src/components/viewer/ViewerPage.tsx`:

```tsx
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
        <Link to="/" className="text-sky-300">← Studies</Link><span className="truncate">{description}</span>
      </header>
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-w-0">
          {v.status === 'blocked' && <ErrorBanner message={`Cannot open: ${v.error}`} />}
          {v.status === 'error' && <ErrorBanner message={v.error ?? 'error'} />}
          {(v.status === 'info' || v.status === 'metadata') && <div className="p-8 flex justify-center"><Spinner /></div>}
          {v.status === 'loading' && (
            <LoadProgress done={v.progress.done} total={v.progress.total} label={big ? 'Large volume (>1 GB GPU memory)' : 'Loading volume'} />
          )}
          {v.status === 'ready' && v.volumeId && v.info && <ViewerLayout volumeId={v.volumeId} modality={v.info.modality} />}
        </div>
        {v.info?.isVolume && <MetadataPanel info={v.info} description={description} />}
      </div>
    </div>
  );
}
```

In `src/App.tsx` replace the placeholder route element with `<ViewerPage />` (`import { ViewerPage } from './components/viewer/ViewerPage'`).

- [ ] **Step 4: Run tests, typecheck, lint; then use it**

Run: `npm test -- --run; npm run typecheck; npm run lint`
Expected: pass. Then run backend + `npm run dev`, open the CT sample: four panels render; wheel scrolls axial; crosshair drag moves the other planes; "Bone" changes W/L; 3D rotates with left-drag; "CT-Lung" changes the render; double-click maximises; back → open MR → back → CT again works without console errors. Fix anything that does not before Task 7.

---

### Task 7: Playwright smoke test with a synthetic-series backend fixture

**Files:**
- Create: `e2e/seed_series.py`, `e2e/viewer.spec.ts`, `playwright.config.ts`

**Interfaces:**
- `e2e/seed_series.py` writes a 40-slice 64×64 CT series into `$env:SAMPLES_DIR` using the backend's `tests/conftest.make_ct_series`. Playwright's `webServer` starts the backend under a temp data dir, then Vite.

- [ ] **Step 1: Write the seed script**

`e2e/seed_series.py`:

```python
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from tests.conftest import make_ct_series, write_series  # noqa: E402

out = Path(os.environ["SAMPLES_DIR"]) / "e2e-ct"
if not out.exists():
    write_series(make_ct_series(40, rows=64, cols=64, spacing=(1.0, 1.0, 1.0)), out)
print(f"seeded {out}")
```

- [ ] **Step 2: Write the Playwright config and the spec**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'dicom-e2e-'));
const env = {
  SAMPLES_DIR: join(tmp, 'samples'), STORE_DIR: join(tmp, 'store'),
  DB_PATH: join(tmp, 'store', 'index.sqlite'), CORS_ORIGINS: 'http://localhost:5173',
};
const py = join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe');

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    { command: `"${py}" e2e/seed_series.py && "${py}" -m uvicorn app.main:app --port 8000 --app-dir ../backend`, port: 8000, env, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run dev', port: 5173, reuseExistingServer: false, timeout: 60_000 },
  ],
});
```

`e2e/viewer.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function canvasIsNonBlack(page: Page, panel: string): Promise<boolean> {
  return page.evaluate((label) => {
    const c = document.querySelector(`[data-testid="panel-${label}"] canvas`) as HTMLCanvasElement | null;
    if (!c) return false;
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const px = new Uint8Array(4 * 64 * 64);
    gl.readPixels(Math.max(0, Math.floor(c.width / 2) - 32), Math.max(0, Math.floor(c.height / 2) - 32), 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px.some((v, i) => i % 4 !== 3 && v > 8);
  }, panel);
}

test('open series, scroll, crosshairs, preset, reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  for (const p of ['Axial', 'Sagittal', 'Coronal', '3D'])
    await expect.poll(() => canvasIsNonBlack(page, p), { timeout: 30_000 }).toBe(true);

  const axialSlice = page.getByTestId('slice-Axial');
  await expect(axialSlice).toHaveText('21 / 40');
  await page.getByTestId('panel-Axial').hover();
  await page.mouse.wheel(0, 300);
  await expect(axialSlice).not.toHaveText('21 / 40');

  const sagBefore = await page.getByTestId('slice-Sagittal').textContent();
  const box = (await page.getByTestId('panel-Axial').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('slice-Sagittal')).not.toHaveText(sagBefore ?? '');

  await page.getByLabel('MPR window').selectOption('Bone');
  await expect(page.getByTestId('wl-Axial')).toContainText('W 1800');

  await page.getByRole('link', { name: /Studies/ }).click();
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  await expect.poll(() => canvasIsNonBlack(page, 'Axial'), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Install the browser and run**

Run: `npx playwright install chromium; npm run e2e`
Expected: the spec passes end to end. Fix real failures in the app, not the test. The one permitted relaxation: if software WebGL cannot produce a non-black 3D panel, change the `3D` entry of the loop to assert only that `[data-testid="panel-3D"] canvas` exists, and say so in the README's testing note. If `readPixels` returns zeros because the drawing buffer is not preserved, switch the check to `canvas.toDataURL()` length > a black-canvas baseline captured at test start.

---

### Task 8: Scripts integration, README with real screenshots, definition-of-done check

**Files:**
- Verify: `scripts/dev.ps1`, `scripts/test.ps1` (created in Part 1; both already branch on `frontend/package.json`)
- Create: `README.md` (repo root), `docs/screenshots/browser.png`, `viewer-ct.png`, `viewer-mr.png`, `rotate.gif`

- [ ] **Step 1: Verify the scripts**

From repo root: `.\scripts\test.ps1` → pytest + ruff + mypy + vitest, exit 0. `.\scripts\dev.ps1` → two windows (uvicorn :8000, Vite :5173).

- [ ] **Step 2: Capture screenshots**

With samples loaded: `docs/screenshots/browser.png` (both studies + series cards), `viewer-ct.png` (2×2 layout, CT-Bone), `viewer-mr.png`, `rotate.gif` (3D panel rotating, ~5 s; Windows Game Bar or ScreenToGif). Real captures only.

- [ ] **Step 3: Write `README.md`**

````markdown
# DICOM 3D Web Viewer

Browser-based 3D viewer for CT/MR DICOM series: multiplanar reconstruction (axial / sagittal /
coronal) with synchronized crosshairs and GPU volume rendering, served from a Python DICOMweb backend.

![viewer](docs/screenshots/viewer-ct.png)
![3D rotation](docs/screenshots/rotate.gif)

## Architecture

(paste the diagram from `docs/superpowers/specs/2026-09-21-dicom-web-viewer-design.md` §3)

- **backend/** — FastAPI + pydicom. Ingests DICOM (decodes compressed transfer syntaxes once at ingest),
  validates each series as a regular 3D grid, indexes into SQLite, and serves **QIDO-RS**, **WADO-RS**
  (`metadata`, `frames`, `rendered`) plus `/api/upload` and `/api/series/{uid}/volume-info`.
- **frontend/** — React + Vite + TypeScript on **Cornerstone3D**: streaming volume loader over the
  WADO-RS endpoints; three orthographic viewports + one `VOLUME_3D` viewport sharing one GPU volume.

## Run it

```powershell
cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -e ".[dev]"
python ..\scripts\fetch_samples.py      # ~70 MB of public sample data (credits below)
cd ..\frontend; npm install
cd ..; .\scripts\dev.ps1                # open http://localhost:5173
```

Tests: `.\scripts\test.ps1` (pytest + ruff + mypy + vitest) · `cd frontend; npm run e2e` (Playwright, software WebGL).

## DICOM standards implemented

QIDO-RS study/series/instance search · WADO-RS metadata / frames / instance / rendered · DICOM JSON
model (PS3.18 Annex F) · transfer-syntax normalisation (JPEG 2000, JPEG-LS, RLE → Explicit VR LE) ·
anatomical slice ordering from ImageOrientationPatient / ImagePositionPatient · volume regularity checks.

## Sample data credits

- LIDC-IDRI (CC BY 3.0) — https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX
- UPENN-GBM (CC BY 4.0) — https://doi.org/10.7937/TCIA.709X-DN49

Data courtesy of The Cancer Imaging Archive (TCIA).

## Roadmap

Measurements (length / angle / probe) · labelmap segmentation · marching-cubes surface export.
````

- [ ] **Step 4: Definition-of-done check (spec §10)**

- `.\scripts\test.ps1` exits 0 and `npm run e2e` passes.
- Both sample series open into the 2×2 layout; scroll and crosshairs are smooth; 3D rotates interactively on the GTX 1650.
- Dropping a DICOM folder adds a study within seconds; skipped files and non-volume series show their reasons.
- README screenshots are real captures.

---

## Self-review (done while writing)

- **Spec coverage:** §5.1 layout → Tasks 1–6 (`BrowserPage`/`ViewerPage` are the route containers; `MprViewport` and `Volume3dViewport` collapse into one `ViewportPanel` — same behaviour, less duplication); §5.2 bindings → Task 4; §5.3 data-flow steps 1–8 → Tasks 4–6; §5.4 browser → Task 3 (thumbnail SOP needed a one-line backend addition, done in Task 3 Step 1); §5.5 errors → Tasks 3, 5, 6 (>1 GB confirm tested in Task 5); §6 frontend tests → every task + Task 7 Playwright; §8 tooling/README → Tasks 1, 8.
- **Placeholder scan:** none.
- **Type consistency:** `VolumeInfo`, `Series.thumbSopUid?`, `InstanceMeta.raw`, `VoiPreset`/`voiRange`, `VIEWPORT_IDS`/`MPR_IDS`/`ALL_IDS`, `ENGINE_ID`, `useVolume` statuses, and `data-testid` names (`panel-<Label>`, `slice-<Label>`, `wl-<Label>` with labels `Axial`/`Sagittal`/`Coronal`/`3D`) are identical across Tasks 1–7.
