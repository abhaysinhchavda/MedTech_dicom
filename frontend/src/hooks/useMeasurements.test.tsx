import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useMeasurements } from './useMeasurements';
import { API, SERIES, server } from '../test/msw';

// Mutable on purpose. The hook decides whether the set is dirty by comparing
// what Cornerstone holds against what the report stored, so a test that wants
// to look edited has to actually edit something -- which is also what the
// real tool does.
const stored = () => ({
  id: '2.25.100000000000000000000000000000001',
  tool: 'Length',
  points: [
    [0, 0, 0],
    [3, 4, 0],
  ],
  plane: { normal: [0, 0, 1], up: [0, -1, 0] },
  values: [{ name: 'Length', value: 5, unit: 'mm' }],
  label: null,
});
let held: ReturnType<typeof stored>[] = [stored()];
beforeEach(() => {
  held = [stored()];
});
/** Drag a handle, the way the user would. */
const moveAHandle = () => {
  held = [
    {
      ...stored(),
      points: [
        [0, 0, 0],
        [30, 40, 0],
      ],
    },
  ];
};
/** Cornerstone recomputing a restored annotation: numbers move, geometry does not. */
const recompute = () => {
  held = [{ ...stored(), values: [{ name: 'Length', value: 5.0001, unit: 'mm' }] }];
};

vi.mock('../cornerstone/annotations', () => ({
  loadAnnotations: vi.fn(),
  clearAnnotations: vi.fn(),
  readAnnotations: vi.fn(() => held),
}));

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

test('loads on mount and is not dirty', async () => {
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.dirty).toBe(false);
  expect(result.current.parseError).toBeNull();
});

test('markDirty then save sends what Cornerstone holds and clears dirty', async () => {
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));

  act(() => {
    moveAHandle();
    result.current.markDirty();
  });
  expect(result.current.dirty).toBe(true);

  await act(async () => {
    await result.current.save();
  });
  await waitFor(() => expect(result.current.dirty).toBe(false));
  expect(result.current.set?.srSopUid).toBe('1.2.9.2');
});

test('a save conflict surfaces as an error without clearing dirty', async () => {
  server.use(
    http.put(`${API}/api/series/${SERIES}/measurements`, () =>
      HttpResponse.json({ detail: 'report changed since it was loaded' }, { status: 409 }),
    ),
  );
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => {
    moveAHandle();
    result.current.markDirty();
  });

  await act(async () => {
    await result.current.save();
  });

  await waitFor(() => expect(result.current.error).toMatch(/changed since/));
  expect(result.current.dirty).toBe(true);
});

test('recomputing a restored measurement is not an edit', async () => {
  // `invalidated` asks Cornerstone to recalculate a restored measurement
  // against the loaded volume, and each recalculation fires the same event a
  // drag does. Treating those as edits armed Save on every series that
  // already had a report, before anyone had touched anything. Found by
  // opening the real T2-FLAIR series.
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));

  act(() => {
    recompute();
    result.current.markDirty();
  });
  expect(result.current.dirty).toBe(false);

  // A real edit still arms it.
  act(() => {
    moveAHandle();
    result.current.markDirty();
  });
  expect(result.current.dirty).toBe(true);
});

test('saving makes what is on screen the new baseline', async () => {
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));

  act(() => {
    moveAHandle();
    result.current.markDirty();
  });
  await act(async () => {
    await result.current.save();
  });
  await waitFor(() => expect(result.current.dirty).toBe(false));

  // A recompute after the save must not re-arm against the replaced report.
  act(() => result.current.markDirty());
  expect(result.current.dirty).toBe(false);
});

test('a parse error is surfaced and leaves the viewer usable', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/measurements`, () =>
      HttpResponse.json({
        seriesUid: SERIES,
        frameOfReferenceUid: '1.2.9',
        srSeriesUid: '1.2.9.1',
        srSopUid: '1.2.9.2',
        parseError: 'SrParseError: no measurement groups found',
        measurements: [],
      }),
    ),
  );
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.parseError).toMatch(/no measurement groups/);
  expect(result.current.status).toBe('ready');
});
