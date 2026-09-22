export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8001';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export const apiUrl = (path: string): string => `${API_URL}${path}`;

async function errorFor(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    message = ((await res.json()) as { detail?: string }).detail ?? message;
  } catch {
    /* keep default */
  }
  return new ApiError(res.status, message);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) throw await errorFor(res);
  return (await res.json()) as T;
}

export async function apiFetchWithHeaders<T>(path: string): Promise<{ body: T; headers: Headers }> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw await errorFor(res);
  return { body: (await res.json()) as T, headers: res.headers };
}
