import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'dicom-e2e-'));
const env = {
  SAMPLES_DIR: join(tmp, 'samples'),
  STORE_DIR: join(tmp, 'store'),
  DB_PATH: join(tmp, 'store', 'index.sqlite'),
  CORS_ORIGINS: 'http://localhost:5173',
};
// frontend/package.json sets "type": "module", so this config loads as an ES
// module under Node -- __dirname isn't defined there. import.meta.dirname
// (Node 20.11+/21.2+) is the ESM equivalent.
const py = join(import.meta.dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe');

export default defineConfig({
  testDir: 'e2e',
  // Headroom for awaitPainted's 90s budget (see e2e/viewer.spec.ts): the
  // first test waits on four panels, and a test that opens the viewer twice
  // pays that wait twice.
  timeout: 300_000,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        // Every viewer page builds five WebGL contexts (four viewports plus
        // vtk.js's own), and StrictMode mounts the engine twice, so three
        // tests in one browser process blow past Chromium's default cap of
        // 16. Past it Chromium evicts the OLDEST contexts -- which by then
        // belong to the test currently running -- and a lost context never
        // paints again, so the panel stays black for the rest of the test.
        '--max-active-webgl-contexts=64',
      ],
    },
  },
  webServer: [
    {
      // Controller ruling: backend has no module-level `app` — must use uvicorn's
      // factory mode (app.main:create_app --factory), and the port is 8001 (8000 is
      // held by a Windows service on this machine). SAMPLES_DIR/STORE_DIR/DB_PATH
      // flow through `env` so the seed script and the backend agree on the same
      // temp data dir, letting the backend ingest the synthetic series on startup.
      command: `"${py}" e2e/seed_series.py && "${py}" -m uvicorn app.main:create_app --factory --port 8001 --app-dir ../backend`,
      port: 8001,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: 'npm run dev', port: 5173, reuseExistingServer: false, timeout: 60_000 },
  ],
});
