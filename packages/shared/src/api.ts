// Web panel API contract (spec §9). The bot implements these shapes under /api;
// the SPA consumes them. All timestamps are ISO-8601 strings, all durations milliseconds.

import type { FilterPreset } from './filters.js';

export const LOOP_MODES = ['off', 'track', 'queue'] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 150;

/** Search sources accepted by GET /api/search?source= (mirrors /play autocomplete prefixes). */
export const SEARCH_SOURCES = ['youtube', 'soundcloud', 'spotify', 'applemusic'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

export interface TrackInfo {
  title: string;
  author: string;
  uri: string | null;
  artworkUrl: string | null;
  /** Lavalink sourceName of the *original* platform (e.g. "spotify" for a mirrored track), or "azuracast". */
  source: string;
  isStream: boolean;
  /** 0 for streams. */
  durationMs: number;
  isrc?: string | null;
}

export interface QueueItemDTO {
  id: string;
  /** 1-based position in the upcoming queue (excludes the current track). */
  position: number;
  track: TrackInfo;
  /** Discord user id, or "web:<sessionId>" for items added from the panel. */
  requesterId: string;
  requesterName: string | null;
  addedAt: string;
}

export interface RadioNowPlaying {
  stationId: string; // "<sourceId>:<shortcode>"
  stationName: string;
  title: string;
  artist: string;
  artUrl: string | null;
  listeners: number | null;
}

export interface ChannelRef {
  id: string;
  name: string;
}

export interface PlayerStateDTO {
  guildId: string;
  connected: boolean;
  voiceChannel: ChannelRef | null;
  current: QueueItemDTO | null;
  positionMs: number;
  /** Server time when positionMs was sampled; client interpolates while !paused. */
  positionAt: string;
  paused: boolean;
  volume: number;
  filter: FilterPreset;
  loop: LoopMode;
  radio: RadioNowPlaying | null;
}

export interface SessionDTO {
  sessionId: string;
  guild: { id: string; name: string; iconUrl: string | null };
  voiceChannel: ChannelRef;
  startedAt: string;
}

export interface QueueDTO {
  items: QueueItemDTO[];
  total: number;
  /** Sum of durationMs of non-stream items. */
  totalDurationMs: number;
}

export interface SearchResultDTO {
  title: string;
  author: string;
  /** Pass this back as `query` to POST /api/play or /api/playnext. */
  uri: string;
  durationMs: number;
  artworkUrl: string | null;
  source: string;
  isStream: boolean;
}

export interface RadioStationDTO {
  id: string; // "<sourceId>:<shortcode>"
  name: string;
  sourceLabel: string;
  nowPlaying: RadioNowPlaying | null;
}

export interface HistoryEntryDTO {
  id: string;
  track: TrackInfo;
  requesterId: string;
  requesterName: string | null;
  startedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number; // 1-based
  pageSize: number;
  total: number;
}

export interface ApiError {
  error: string; // machine code, e.g. "session_ended", "not_found", "rate_limited", "bad_request"
  message: string;
}

// ---- Request bodies ----
export interface PlayRequest {
  query: string;
}
export type ControlAction = 'pause' | 'resume' | 'skip' | 'voteskip' | 'stop' | 'shuffle' | 'loop';
export interface ControlRequest {
  action: ControlAction;
  value?: LoopMode;
}
export interface SeekRequest {
  ms: number;
}
export interface VolumeRequest {
  value: number;
}
export interface FilterRequest {
  preset: FilterPreset;
}
export interface QueueMoveRequest {
  from: number;
  to: number;
} // 1-based positions
export interface RadioRequest {
  stationId: string;
}

/** Responses for mutating endpoints. */
export interface OkResponse {
  ok: true;
  message?: string;
}

// ---- SSE (GET /api/events) ----
// Each SSE message uses `event: <type>` and `data: <JSON payload>`.
// On connect the server immediately sends `player` and `queue` snapshots.
export interface SseEventMap {
  player: PlayerStateDTO; // on any player change and on every Lavalink playerUpdate
  queue: QueueDTO; // on any queue change
  radio: RadioNowPlaying; // radio song change
  'session-ended': { reason: string }; // server closes the stream right after
}
export type SseEventType = keyof SseEventMap;

// ---- Routes (for reference) ----
// GET  /s/:token            -> sets signed session cookie, 302 to /player (invalid/ended -> 302 /ended)
// GET  /api/session                      SessionDTO
// GET  /api/player                       PlayerStateDTO
// GET  /api/queue                        QueueDTO
// POST /api/play | /api/playnext         PlayRequest -> OkResponse
// POST /api/control                      ControlRequest -> OkResponse
// POST /api/seek | /api/volume | /api/filter
// POST /api/queue/move                   QueueMoveRequest
// DELETE /api/queue/:id  DELETE /api/queue
// GET  /api/search?q=&source=            SearchResultDTO[]
// GET  /api/radio/stations               RadioStationDTO[]
// POST /api/radio                        RadioRequest
// GET  /api/history?page=                Paginated<HistoryEntryDTO>
// GET  /api/events                       SSE
// Ended/invalid session on any /api call -> 401 { error: "session_ended" }.
// SPA routes: /player /queue /search /radio /history /ended
