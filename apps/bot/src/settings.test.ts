import { describe, expect, it } from 'vitest';
import { isSettingKey, parseSettingInput, SETTING_DEFAULTS, SETTING_KEYS } from './settings.js';

describe('settings schema', () => {
  it('has the spec keys and defaults', () => {
    expect([...SETTING_KEYS].sort()).toEqual(
      [
        'default_volume',
        'history_retention_days',
        'idle_disconnect_seconds',
        'max_queue_length',
        'panel_base_url',
      ].sort(),
    );
    expect(SETTING_DEFAULTS).toMatchObject({
      idle_disconnect_seconds: 300,
      default_volume: 80,
      max_queue_length: 500,
      history_retention_days: 90,
    });
    expect(SETTING_DEFAULTS.panel_base_url).toBeUndefined();
  });
  it('rejects unknown keys', () => {
    expect(isSettingKey('nope')).toBe(false);
    expect(() => parseSettingInput('nope', '1')).toThrow(/Unknown/);
  });
  it('validates and normalizes values', () => {
    expect(parseSettingInput('default_volume', '100')).toBe(100);
    expect(() => parseSettingInput('default_volume', '151')).toThrow();
    expect(() => parseSettingInput('default_volume', 'loud')).toThrow();
    expect(() => parseSettingInput('max_queue_length', '0')).toThrow();
    expect(parseSettingInput('panel_base_url', 'https://celeste.example.com/')).toBe(
      'https://celeste.example.com',
    );
    expect(() => parseSettingInput('panel_base_url', 'ftp://x')).toThrow();
    expect(() => parseSettingInput('panel_base_url', 'not a url')).toThrow();
  });
});
