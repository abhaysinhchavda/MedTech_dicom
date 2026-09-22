import { num, pn, str, strs } from './dicomJson';

const j = {
  A: { vr: 'LO', Value: ['x'] },
  B: { vr: 'IS', Value: [3] },
  C: { vr: 'PN', Value: [{ Alphabetic: 'Doe^J' }] },
  D: { vr: 'CS', Value: ['CT', 'MR'] },
  E: { vr: 'LO' },
};

test('accessors read DICOM JSON values with safe defaults', () => {
  expect(str(j, 'A')).toBe('x');
  expect(str(j, 'E')).toBe('');
  expect(str(j, 'ZZ')).toBe('');
  expect(num(j, 'B')).toBe(3);
  expect(num(j, 'E')).toBeNull();
  expect(pn(j, 'C')).toBe('Doe^J');
  expect(strs(j, 'D')).toEqual(['CT', 'MR']);
});
