import { http, HttpResponse } from 'msw';
import { getSeries, getSeriesMetadata, getStudies, thumbnailUrl } from './dicomweb';
import { API, SERIES, STUDY, server } from '../test/msw';

test('maps studies', async () => {
  expect(await getStudies()).toEqual([
    {
      studyUid: STUDY,
      patientName: 'Test^Patient',
      patientId: 'P001',
      studyDate: '20240101',
      description: 'Synthetic study',
      modalities: ['CT'],
      numSeries: 1,
      numInstances: 4,
    },
  ]);
});

test('maps series including thumbnail sop', async () => {
  expect(await getSeries(STUDY)).toEqual([
    {
      seriesUid: SERIES,
      studyUid: STUDY,
      modality: 'CT',
      description: 'Synthetic series',
      seriesNumber: 1,
      numInstances: 4,
      thumbSopUid: '1.2',
    },
  ]);
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
  server.use(
    http.get(`${API}/dicomweb/studies`, () =>
      HttpResponse.json({ detail: 'boom' }, { status: 500 }),
    ),
  );
  await expect(getStudies()).rejects.toMatchObject({ status: 500, message: 'boom' });
});
