import { apiFetch } from './client';
import type { UploadSummary } from './types';
export function uploadFiles(files: File[]): Promise<UploadSummary> {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return apiFetch<UploadSummary>('/api/upload', { method: 'POST', body: form });
}
