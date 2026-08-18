import { describe, it, expect } from 'vitest';
import { mergeConfig, configFromEnv, deepMerge } from '../src/index.js';

describe('deepMerge', () => {
  it('merges nested objects with later sources winning', () => {
    const out = deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } });
    expect(out).toEqual({ a: { b: 9, c: 2 } });
  });

  it('replaces arrays rather than concatenating', () => {
    const out = deepMerge({ list: [1, 2] }, { list: [3] });
    expect(out).toEqual({ list: [3] });
  });
});

describe('configFromEnv', () => {
  it('maps NEXUS_SERVER_PORT to { server: { port } } with coercion', () => {
    const cfg = configFromEnv({ NEXUS_SERVER_PORT: '5000', NEXUS_SERVER_HTTPS: 'true' });
    expect(cfg.server?.port).toBe(5000);
    expect(cfg.server?.https).toBe(true);
  });
});

describe('mergeConfig', () => {
  it('applies user overrides over defaults and validates', () => {
    const cfg = mergeConfig({ server: { port: 5000 }, auth: { jwt: { secret: 'supersecret' } } });
    expect(cfg.server.port).toBe(5000);
    expect(cfg.server.host).toBe('0.0.0.0'); // default retained
    expect(cfg.auth.jwt.secret).toBe('supersecret');
  });

  it('rejects an invalid jwt secret length', () => {
    expect(() => mergeConfig({ auth: { jwt: { secret: 'short' } } })).toThrow();
  });

  it('rejects an out-of-range port', () => {
    expect(() => mergeConfig({ server: { port: 99999 } })).toThrow();
  });

  it('returns a frozen object', () => {
    const cfg = mergeConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});