import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPreset } from '../src/index.js';

function names(plugins) {
  return plugins.map((p) => {
    if (typeof p === 'string') return p;
    if (p?.postcssPlugin) return p.postcssPlugin;
    if (p?.plugins && Array.isArray(p.plugins)) return 'cssnano';
    return 'unknown';
  });
}

function has(plugins, name) {
  return names(plugins).includes(name);
}

describe('@bhooai/nexus-postcss createPreset', () => {
  const origEnv = process.env.NODE_ENV;
  beforeEach(() => { delete process.env.NODE_ENV; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it('returns the default plugin chain in the correct order', () => {
    const { plugins } = createPreset();
    expect(names(plugins)).toEqual([
      'postcss-import',
      'postcss-nested',
      'tailwindcss',
      'postcss-preset-env',
      'autoprefixer',
    ]);
  });

  it('enables cssnano in production', () => {
    process.env.NODE_ENV = 'production';
    const { plugins } = createPreset();
    expect(names(plugins)).toContain('cssnano');
  });

  it('disables cssnano in development', () => {
    process.env.NODE_ENV = 'development';
    const { plugins } = createPreset();
    expect(names(plugins)).not.toContain('cssnano');
  });

  it('respects explicit minify:true regardless of NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    const { plugins } = createPreset({ minify: true });
    expect(names(plugins)).toContain('cssnano');
  });

  it('allows disabling individual plugins', () => {
    const { plugins } = createPreset({
      import: false,
      nested: false,
      presetEnv: false,
      autoprefixer: false,
    });
    const n = names(plugins);
    expect(n).not.toContain('postcss-import');
    expect(n).not.toContain('postcss-nested');
    expect(n).not.toContain('postcss-preset-env');
    expect(n).not.toContain('autoprefixer');
    expect(n).toContain('tailwindcss');
  });

  it('always includes tailwindcss even when other plugins are disabled', () => {
    const { plugins } = createPreset({
      import: false,
      nested: false,
      presetEnv: false,
      autoprefixer: false,
      minify: false,
    });
    expect(names(plugins)).toEqual(['tailwindcss']);
  });

  it('accepts presetEnv stage options without error', () => {
    const { plugins } = createPreset({ presetEnv: 'stage3' });
    expect(plugins.find((p) => p?.postcssPlugin === 'postcss-preset-env')).toBeDefined();
  });

  it('accepts autoprefixer options object without error', () => {
    const { plugins } = createPreset({ autoprefixer: { overrideBrowserslist: ['> 1%'] } });
    expect(plugins.find((p) => p?.postcssPlugin === 'autoprefixer')).toBeDefined();
  });

  it('appends custom plugins as string entries', () => {
    const { plugins } = createPreset({ plugins: ['my-plugin', 'another-plugin'] });
    expect(plugins.find((p) => p === 'my-plugin')).toBe('my-plugin');
    expect(plugins.find((p) => p === 'another-plugin')).toBe('another-plugin');
  });

  it('returns an array (postcss-load-config array format)', () => {
    const { plugins } = createPreset();
    expect(Array.isArray(plugins)).toBe(true);
  });

  it('uses postcss-nesting when nestingMode is modern', () => {
    const { plugins } = createPreset({ nestingMode: 'modern' });
    expect(has(plugins, 'postcss-nesting')).toBe(true);
    expect(has(plugins, 'postcss-nested')).toBe(false);
  });

  it('uses postcss-nested by default (classic mode)', () => {
    const { plugins } = createPreset();
    expect(has(plugins, 'postcss-nested')).toBe(true);
    expect(has(plugins, 'postcss-nesting')).toBe(false);
  });

  it('includes postcss-logical when logical is enabled', () => {
    const { plugins } = createPreset({ logical: true });
    expect(has(plugins, 'postcss-logical')).toBe(true);
  });

  it('does not include postcss-logical by default', () => {
    const { plugins } = createPreset();
    expect(has(plugins, 'postcss-logical')).toBe(false);
  });

  it('places postcss-logical before autoprefixer', () => {
    const { plugins } = createPreset({ logical: true });
    const n = names(plugins);
    const logicalIdx = n.indexOf('postcss-logical');
    const autoprefixerIdx = n.indexOf('autoprefixer');
    expect(logicalIdx).toBeGreaterThanOrEqual(0);
    expect(autoprefixerIdx).toBeGreaterThanOrEqual(0);
    expect(logicalIdx).toBeLessThan(autoprefixerIdx);
  });

  it('uses lightningcss engine and skips preset-env + autoprefixer + cssnano', () => {
    process.env.NODE_ENV = 'production';
    const { plugins } = createPreset({ engine: 'lightningcss' });
    const n = names(plugins);
    expect(n).toContain('postcss-lightningcss');
    expect(n).not.toContain('postcss-preset-env');
    expect(n).not.toContain('autoprefixer');
    expect(n).not.toContain('cssnano');
  });

  it('still includes import + tailwindcss under lightningcss engine', () => {
    const { plugins } = createPreset({ engine: 'lightningcss' });
    const n = names(plugins);
    expect(n).toContain('postcss-import');
    expect(n).toContain('tailwindcss');
  });

  it('returns a map when sourcemap is true', () => {
    const result = createPreset({ sourcemap: true });
    expect(result.map).toEqual({ inline: true, annotation: true });
  });

  it('returns map:false when sourcemap is false', () => {
    const result = createPreset({ sourcemap: false });
    expect(result.map).toBe(false);
  });

  it('omits map when sourcemap is not set', () => {
    const result = createPreset();
    expect(result).not.toHaveProperty('map');
  });
});