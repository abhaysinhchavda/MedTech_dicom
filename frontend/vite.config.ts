/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // vtk.js pulls in xmlbuilder2, whose XMLBuilderCBImpl extends Node's EventEmitter.
  // Vite stubs bare Node builtins as empty modules for the browser, so `events`
  // must resolve to the userland polyfill or every Cornerstone import throws
  // "Class extends value undefined".
  resolve: { alias: { events: 'events/events.js' } },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
  worker: { format: 'es' },
  server: { port: 5173 },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true, exclude: ['e2e/**', 'node_modules/**'] },
});
