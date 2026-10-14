import { describe, expect, it } from 'vitest';
import {
  extractNpFromSse,
  matchStationUrl,
  normalizeBaseUrl,
  parseNowPlaying,
  parseStations,
  sseUrl,
} from './parse.js';

const station = {
  name: 'AzuraTest Radio',
  shortcode: 'azuratest_radio',
  listen_url: 'https://demo.azuracast.com/listen/azuratest_radio/radio.mp3',
  is_public: true,
  mounts: [
    { url: 'https://demo.azuracast.com/listen/azuratest_radio/radio.mp3', is_default: true },
  ],
};
const np = {
  station: { name: 'AzuraTest Radio', shortcode: 'azuratest_radio' },
  listeners: { total: 3, unique: 2, current: 2 },
  now_playing: {
    duration: 280,
    song: { art: 'https://x/art.jpg', text: 'A - B', artist: 'A', title: 'B' },
  },
};

describe('azuracast parsing', () => {
  it('parses /api/stations', () => {
    expect(
      parseStations([
        station,
        { ...station, shortcode: 'priv', is_public: false },
        { name: 'x', shortcode: 'nolisten', mounts: [] },
      ]),
    ).toEqual([
      { name: 'AzuraTest Radio', shortcode: 'azuratest_radio', listenUrl: station.listen_url },
    ]);
    expect(
      parseStations([
        {
          name: 'M',
          shortcode: 'm',
          listen_url: null,
          mounts: [{ url: 'https://h/m', is_default: false }],
        },
      ])[0]?.listenUrl,
    ).toBe('https://h/m');
    expect(() => parseStations({ nope: 1 })).toThrow();
  });
  it('parses now playing', () => {
    expect(parseNowPlaying(np)).toEqual({
      title: 'B',
      artist: 'A',
      artUrl: 'https://x/art.jpg',
      listeners: 2,
    });
    expect(parseNowPlaying({ now_playing: { song: { text: 'Only Text' } } })).toMatchObject({
      title: 'Only Text',
      listeners: null,
    });
    expect(() => parseNowPlaying({})).toThrow();
  });
  it('extracts np from SSE connect and pub payloads', () => {
    expect(
      extractNpFromSse({
        connect: {
          subs: { 'station:x': { publications: [{ data: { np: { a: 1 } } }, { data: { np } }] } },
        },
      }),
    ).toEqual(np);
    expect(extractNpFromSse({ pub: { data: { np } } })).toEqual(np);
    expect(extractNpFromSse({})).toBeNull();
    expect(extractNpFromSse(null)).toBeNull();
  });
  it('builds the SSE URL', () => {
    const u = new URL(sseUrl('https://demo.azuracast.com/', 'azuratest_radio'));
    expect(u.pathname).toBe('/api/live/nowplaying/sse');
    expect(JSON.parse(u.searchParams.get('cf_connect')!)).toEqual({
      subs: { 'station:azuratest_radio': { recover: true } },
    });
  });
  it('normalizes base URLs and matches station URLs', () => {
    expect(normalizeBaseUrl('https://radio.example.com/some/path/?x=1')).toBe(
      'https://radio.example.com',
    );
    expect(normalizeBaseUrl('ftp://x')).toBeNull();
    expect(normalizeBaseUrl('nope')).toBeNull();
    expect(
      matchStationUrl(
        'https://radio.example.com/listen/my_st/radio.mp3',
        'https://radio.example.com',
      ),
    ).toBe('my_st');
    expect(
      matchStationUrl('https://radio.example.com/public/my_st', 'https://radio.example.com'),
    ).toBe('my_st');
    expect(
      matchStationUrl(
        'https://other.example.com/listen/my_st/radio.mp3',
        'https://radio.example.com',
      ),
    ).toBeNull();
  });
});
