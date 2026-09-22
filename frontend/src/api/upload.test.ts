import { uploadFiles } from './upload';

test('posts files and returns summary', async () => {
  const r = await uploadFiles([new File(['x'], 'a.dcm'), new File(['y'], 'notes.txt')]);
  expect(r.accepted).toBe(2);
  expect(r.skipped[0]).toEqual({ file: 'notes.txt', reason: 'not a DICOM file' });
});
