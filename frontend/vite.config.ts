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
