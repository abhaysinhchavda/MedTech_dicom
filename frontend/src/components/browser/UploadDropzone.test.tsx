import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { UploadDropzone } from './UploadDropzone';

// Minimal fakes for the FileSystemEntry API a real directory drop exposes via
// DataTransferItem.webkitGetAsEntry() -- jsdom doesn't implement it.
function fakeFileEntry(file: File) {
  return { isFile: true, isDirectory: false, file: (cb: (f: File) => void) => cb(file) };
}
function fakeDirEntry(entries: unknown[]) {
  let read = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb: (e: unknown[]) => void) => {
        // Real readers page results and return [] once exhausted.
        cb(read ? [] : entries);
        read = true;
      },
    }),
  };
}

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
  expect(await screen.findByText(/1 files accepted/)).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledTimes(1);

  await userEvent.upload(input, file);
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
});

test('dropping a folder walks its entries and uploads the nested files', async () => {
  const onDone = vi.fn();
  render(<UploadDropzone onDone={onDone} />);
  const dropzone = screen.getByText(/drop a folder/i).closest('div')!;

  const dirEntry = fakeDirEntry([
    fakeFileEntry(new File(['a'], 'a.dcm')),
    fakeFileEntry(new File(['b'], 'b.dcm')),
  ]);
  fireEvent.drop(dropzone, {
    dataTransfer: {
      items: [{ webkitGetAsEntry: () => dirEntry }],
      files: [],
    },
  });

  expect(await screen.findByText(/2 files accepted/)).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ accepted: 2, skipped: [] }));
});
