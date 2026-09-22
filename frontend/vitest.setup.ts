import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { File } from 'node:buffer';
import { FormData, Headers, Request, Response, fetch } from 'undici';
import { server } from './src/test/msw';

// jsdom's own fetch/FormData/File stack has a bug serializing multipart bodies
// (jsdom's Request constructor throws on FormData entries holding a File — see
// jsdom/lib/generated/idl/FormData.js `forEach`). Swap in Node's native fetch
// primitives (undici) before MSW patches `fetch`, so requests never touch
// jsdom's broken multipart serialization. `node:buffer`'s File is the same
// class Node's global File already is, so it round-trips through undici's
// FormData/Request cleanly.
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData, File });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
