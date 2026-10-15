import type {
  ControlRequest,
  HistoryEntryDTO,
  OkResponse,
  Paginated,
  PlayerStateDTO,
  QueueDTO,
  RadioStationDTO,
  SearchResultDTO,
  SearchSource,
  SessionDTO,
} from '@celeste/shared';
import { notifications } from '@mantine/notifications';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

let onSessionEnded: () => void = () => {};
export function setSessionEndedHandler(fn: () => void): void {
  onSessionEnded = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Without a timeout a request stuck behind the tunnel never settles, and the SSE
  // reconnect loop waits on it forever.
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
    else if (method === 'POST') init.body = '{}';
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFailure(0, 'network', 'Network error. Is the bot reachable?');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string };
    const code = e.error ?? 'error';
    if (res.status === 401 && code === 'session_ended') onSessionEnded();
    throw new ApiFailure(res.status, code, e.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Run a mutating call, surfacing errors as notifications. Returns undefined on failure. */
export async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiFailure) {
      if (err.code === 'session_ended') return undefined;
      if (err.status === 429) {
        notifications.show({
          color: 'yellow',
          title: 'Slow down',
          message: 'Too many requests, try again in a moment.',
        });
      } else {
        notifications.show({ color: 'red', title: 'Something went wrong', message: err.message });
      }
    } else {
      notifications.show({ color: 'red', title: 'Error', message: String(err) });
    }
    return undefined;
  }
}

export const api = {
  session: () => request<SessionDTO>('GET', '/api/session'),
  player: () => request<PlayerStateDTO>('GET', '/api/player'),
  queue: () => request<QueueDTO>('GET', '/api/queue'),
  play: (query: string) => request<OkResponse>('POST', '/api/play', { query }),
  playNext: (query: string) => request<OkResponse>('POST', '/api/playnext', { query }),
  control: (body: ControlRequest) => request<OkResponse>('POST', '/api/control', body),
  seek: (ms: number) => request<OkResponse>('POST', '/api/seek', { ms: Math.round(ms) }),
  volume: (value: number) => request<OkResponse>('POST', '/api/volume', { value }),
  filter: (preset: string) => request<OkResponse>('POST', '/api/filter', { preset }),
  move: (from: number, to: number) => request<OkResponse>('POST', '/api/queue/move', { from, to }),
  remove: (id: string) => request<OkResponse>('DELETE', `/api/queue/${encodeURIComponent(id)}`),
  clear: () => request<OkResponse>('DELETE', '/api/queue'),
  search: (q: string, source: SearchSource) =>
    request<SearchResultDTO[]>('GET', `/api/search?q=${encodeURIComponent(q)}&source=${source}`),
  stations: () => request<RadioStationDTO[]>('GET', '/api/radio/stations'),
  playRadio: (stationId: string) => request<OkResponse>('POST', '/api/radio', { stationId }),
  history: (page: number) =>
    request<Paginated<HistoryEntryDTO>>('GET', `/api/history?page=${page}`),
};
