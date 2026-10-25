import { describe, expect, test } from 'bun:test';
import { decodeTheme, palettes } from '../src/lib/palette';

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('theme preferences', () => {
  test('defaults safely to dark, including unknown stored values', () => {
    expect(decodeTheme(null)).toBe('dark');
    expect(decodeTheme('system')).toBe('dark');
    expect(decodeTheme('dark')).toBe('dark');
    expect(decodeTheme('light')).toBe('light');
  });
  test('both modes expose the same semantic tokens and distinct editor surfaces', () => {
    expect(Object.keys(palettes.light)).toEqual(Object.keys(palettes.dark));
    expect(palettes.light.editor).not.toBe(palettes.dark.editor);
    expect(palettes.light.selection).not.toBe(palettes.dark.selection);
  });
  for (const [mode, colors] of Object.entries(palettes)) {
    test(`${mode} text, notices, buttons and syntax meet normal-text contrast`, () => {
      for (const surface of [colors.bg, colors.panel, colors.raised, colors.console]) {
        for (const text of [colors.text, colors.muted, colors.faint, colors.accent, colors.error]) {
          expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
      for (const key of ['syntaxKeyword', 'syntaxString', 'syntaxFunction', 'syntaxNumber', 'syntaxComment', 'syntaxOperator'] as const) {
        expect(contrast(colors[key], colors.editor)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
