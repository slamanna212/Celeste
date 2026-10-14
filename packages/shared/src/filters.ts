// Filter presets shared by the bot (/filter, NP buttons) and the web panel.
// Each preset is a Lavalink v4 `filters` object (see Lavalink REST docs, "Filters").
// Applying a preset replaces all filters; volume is handled separately via player volume.

export const FILTER_PRESETS = [
  'off',
  'bassboost',
  'nightcore',
  'vaporwave',
  '8d',
  'karaoke',
  'soft',
  'treble',
] as const;

export type FilterPreset = (typeof FILTER_PRESETS)[number];

export interface EqualizerBand {
  band: number; // 0..14
  gain: number; // -0.25..1.0
}

export interface LavalinkFilters {
  equalizer?: EqualizerBand[];
  karaoke?: { level?: number; monoLevel?: number; filterBand?: number; filterWidth?: number };
  timescale?: { speed?: number; pitch?: number; rate?: number };
  rotation?: { rotationHz?: number };
  lowPass?: { smoothing?: number };
}

const bands = (gains: number[]): EqualizerBand[] => gains.map((gain, band) => ({ band, gain }));

export const FILTER_DEFINITIONS: Record<FilterPreset, { label: string; filters: LavalinkFilters }> =
  {
    off: { label: 'Off', filters: {} },
    bassboost: {
      label: 'Bass boost',
      filters: {
        equalizer: bands([0.2, 0.15, 0.1, 0.05, 0.0, -0.05, -0.05, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
    },
    nightcore: {
      label: 'Nightcore',
      filters: { timescale: { speed: 1.165, pitch: 1.125, rate: 1.05 } },
    },
    vaporwave: {
      label: 'Vaporwave',
      filters: {
        timescale: { speed: 0.85, pitch: 0.8, rate: 1.0 },
        equalizer: bands([0.3, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
    },
    '8d': { label: '8D', filters: { rotation: { rotationHz: 0.2 } } },
    karaoke: {
      label: 'Karaoke',
      filters: { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 } },
    },
    soft: { label: 'Soft', filters: { lowPass: { smoothing: 20.0 } } },
    treble: {
      label: 'Treble',
      filters: {
        equalizer: bands([0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.25, 0.25]),
      },
    },
  };

export function isFilterPreset(value: unknown): value is FilterPreset {
  return typeof value === 'string' && (FILTER_PRESETS as readonly string[]).includes(value);
}
