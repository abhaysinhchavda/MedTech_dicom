import { initialViewportState, viewportReducer } from './useViewportState';

test('reducer updates slice, voi and zoom independently', () => {
  let s = viewportReducer(initialViewportState, { type: 'slice', sliceIndex: 3, numSlices: 10 });
  s = viewportReducer(s, { type: 'voi', lower: -100, upper: 300 });
  s = viewportReducer(s, { type: 'zoom', zoom: 1.5 });
  expect(s).toEqual({ sliceIndex: 3, numSlices: 10, voi: { lower: -100, upper: 300 }, zoom: 1.5 });
});
