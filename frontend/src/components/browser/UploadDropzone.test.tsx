import { render, screen, waitFor } from '@testing-library/react';
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

test('allows re-selecting the exact same file twice', async () => {
  const onDone = vi.fn();
  render(<UploadDropzone onDone={onDone} />);
  const input = screen.getByLabelText(/choose files/i);
  const file = new File(['a'], 'a.dcm');

  await userEvent.upload(input, file);
  expect(await screen.findByText(/2 files accepted/)).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledTimes(1);

  await userEvent.upload(input, file);
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
});
