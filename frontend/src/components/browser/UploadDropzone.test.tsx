import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { UploadDropzone } from './UploadDropzone';

test('uploads selected files and shows summary', async () => {
  const onDone = vi.fn();
  render(<UploadDropzone onDone={onDone} />);
  const input = screen.getByLabelText(/choose files/i);
  await userEvent.upload(input, [new File(['a'], 'a.dcm'), new File(['b'], 'notes.txt')]);
  expect(await screen.findByText(/2 files accepted/)).toBeInTheDocument();
  expect(screen.getByText(/notes\.txt: not a DICOM file/)).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ accepted: 2 }));
});
