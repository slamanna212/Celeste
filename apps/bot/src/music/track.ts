import { randomUUID } from 'node:crypto';
import type { QueueItemDTO, TrackInfo as TrackInfoDTO } from '@celeste/shared';
import type { Track, UnresolvedTrack } from 'lavalink-client';

export interface Requester {
  id: string;
  name: string | null;
}

export type AnyTrack = Track | UnresolvedTrack;

/** Stamp identity and requester onto a freshly loaded track. userData only holds JSON-safe string/number values. */
export function stampTrack<T extends AnyTrack>(track: T, requester: Requester): T {
  track.requester = requester;
  track.userData = {
    ...(track.userData ?? {}),
    itemId: randomUUID(),
    addedAt: new Date().toISOString(),
    requesterName: requester.name,
  };
  return track;
}

export function itemId(track: AnyTrack): string {
  const id = track.userData?.itemId;
  return typeof id === 'string' ? id : '';
}

export function requesterOf(track: AnyTrack): Requester {
  const r = track.requester as Partial<Requester> | undefined;
  return {
    id: r?.id ?? 'unknown',
    name:
      r?.name ??
      (typeof track.userData?.requesterName === 'string' ? track.userData.requesterName : null),
  };
}

/**
 * For mirrored sources (Spotify/Apple Music via LavaSrc) Lavalink keeps the *original* platform's
 * metadata in `info` (title, artwork, uri, sourceName), so this is already the original metadata.
 * AzuraCast streams are tagged via userData.radio.
 */
export function toTrackInfo(track: AnyTrack): TrackInfoDTO {
  const i = track.info;
  const radio = track.userData?.radioStationId;
  return {
    title: i.title ?? 'Unknown title',
    author: i.author ?? '',
    uri: i.uri ?? null,
    artworkUrl: i.artworkUrl ?? null,
    source: typeof radio === 'string' ? 'azuracast' : String(i.sourceName ?? 'unknown'),
    isStream: !!i.isStream,
    durationMs: i.isStream ? 0 : (i.duration ?? 0),
    isrc: i.isrc ?? null,
  };
}

export function toQueueItem(track: AnyTrack, position: number): QueueItemDTO {
  const r = requesterOf(track);
  const added = track.userData?.addedAt;
  return {
    id: itemId(track),
    position,
    track: toTrackInfo(track),
    requesterId: r.id,
    requesterName: r.name,
    addedAt: typeof added === 'string' ? added : new Date(0).toISOString(),
  };
}

/** Source label used for failure grouping and metrics. */
export function sourceOf(track: AnyTrack | null | undefined): string {
  if (!track) return 'unknown';
  return String(track.info?.sourceName ?? 'unknown');
}
