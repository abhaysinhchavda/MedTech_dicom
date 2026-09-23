import { vi } from 'vitest';

// vi.mock factories are hoisted above this file's own top-level declarations,
// so the shared mock state they close over must be created inside vi.hoisted
// (plain top-level consts would still be in the TDZ when the factory runs).
const { eventTarget, fire, load, removeVolumeLoadObject } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const eventTarget = {
    addEventListener: (t: string, f: (e: Event) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    },
    removeEventListener: (t: string, f: (e: Event) => void) => listeners.get(t)?.delete(f),
  };
  const fire = (t: string, detail: unknown) =>
    listeners.get(t)?.forEach((f) => f(new CustomEvent(t, { detail })));
  const load = vi.fn();
  const removeVolumeLoadObject = vi.fn();
  return { listeners, eventTarget, fire, load, removeVolumeLoadObject };
});
vi.mock('@cornerstonejs/core', () => ({
  eventTarget,
  Enums: {
    Events: {
      IMAGE_VOLUME_MODIFIED: 'VM',
      IMAGE_VOLUME_LOADING_COMPLETED: 'VC',
      IMAGE_LOAD_ERROR: 'LE',
    },
  },
  volumeLoader: {
    createAndCacheVolume: vi.fn(async (volumeId: string, o: { imageIds: string[] }) => ({
      volumeId,
      imageIds: o.imageIds,
      load,
    })),
  },
  cache: { removeVolumeLoadObject, getVolume: vi.fn(() => ({})) },
}));
import { loadVolume, releaseVolume, volumeIdFor } from './volume';

test('resolves on completion and reports progress only for its own volume', async () => {
  const progress = vi.fn();
  const p = loadVolume(volumeIdFor('S'), ['wadors:a', 'wadors:b'], progress);
  await Promise.resolve();
  await Promise.resolve(); // let createAndCacheVolume settle
  fire('VM', { volumeId: volumeIdFor('S'), framesProcessed: 1, numberOfFrames: 2 });
  fire('VM', { volumeId: 'other', framesProcessed: 9, numberOfFrames: 9 });
  fire('VC', { volumeId: volumeIdFor('S') });
  const v = await p;
  expect(v.volumeId).toBe('cornerstoneStreamingImageVolume:S');
  expect(load).toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith(1, 2);
  expect(progress).not.toHaveBeenCalledWith(9, 9);
});

test('rejects on the first load error, naming the failed slice', async () => {
  // Real event shape (an upstream Cornerstone arg-order bug): detail.imageId
  // is the numeric imageIdIndex, not a wadors: string -- see the comment on
  // ErrDetail in volume.ts. A mock shaped like { imageId: 'wadors:x' } would
  // hide the bug this test exists to catch.
  removeVolumeLoadObject.mockClear();
  const p = loadVolume(volumeIdFor('T'), ['wadors:x', 'wadors:y']);
  fire('LE', { imageId: 1, error: new Error('404') });
  await expect(p).rejects.toThrow(/wadors:y/);
  expect(removeVolumeLoadObject).toHaveBeenCalledWith(volumeIdFor('T'));
});

test('releaseVolume removes from cache', () => {
  releaseVolume('cornerstoneStreamingImageVolume:S');
  expect(removeVolumeLoadObject).toHaveBeenCalledWith('cornerstoneStreamingImageVolume:S');
});

test('releaseVolume still removes an in-flight (not-yet-cached) volume', () => {
  // cache.getVolume only returns a value once the load resolves, so this must
  // not gate on it -- an in-flight load must still be released.
  removeVolumeLoadObject.mockClear();
  releaseVolume(volumeIdFor('U'));
  expect(removeVolumeLoadObject).toHaveBeenCalledWith(volumeIdFor('U'));
});

test('releaseVolume does not throw when the id is not actually cached', () => {
  removeVolumeLoadObject.mockImplementationOnce(() => {
    throw new Error('no volume with id missing');
  });
  expect(() => releaseVolume('missing')).not.toThrow();
});

test('aborting mid-load rejects with AbortError and releases the cached volume', async () => {
  removeVolumeLoadObject.mockClear();
  const controller = new AbortController();
  const p = loadVolume(volumeIdFor('AB'), ['wadors:a'], undefined, controller.signal);
  await Promise.resolve();
  await Promise.resolve(); // let createAndCacheVolume settle
  controller.abort();
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  expect(removeVolumeLoadObject).toHaveBeenCalledWith(volumeIdFor('AB'));
});

test('aborting after a successful resolve is a no-op', async () => {
  removeVolumeLoadObject.mockClear();
  const controller = new AbortController();
  const p = loadVolume(volumeIdFor('AC'), ['wadors:a'], undefined, controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  fire('VC', { volumeId: volumeIdFor('AC') });
  await expect(p).resolves.toMatchObject({ volumeId: volumeIdFor('AC') });
  controller.abort();
  await Promise.resolve();
  expect(removeVolumeLoadObject).not.toHaveBeenCalled();
});
