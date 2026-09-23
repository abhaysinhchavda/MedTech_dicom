import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initCornerstone } from './cornerstone/init';

const root = createRoot(document.getElementById('root')!);
initCornerstone().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (e: Error) =>
    root.render(
      <div className="mx-auto max-w-md p-12 text-center">
        <h1 className="text-xl font-semibold tracking-tight">WebGL2 required</h1>
        <p className="mt-2 text-sm text-muted">
          This viewer renders the volume on the GPU, and this browser did not provide a WebGL2
          context.
        </p>
        <p className="mt-4 text-xs text-faint">{e.message}</p>
      </div>,
    ),
);
