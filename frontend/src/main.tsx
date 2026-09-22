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
      <div className="p-8 text-center">
        <h1 className="text-xl">WebGL2 required</h1>
        <p className="text-neutral-400">{e.message}</p>
      </div>,
    ),
);
