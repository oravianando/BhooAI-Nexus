import { describe, it, expect } from 'vitest';
import { Container, ResolutionError } from '../src/index.js';

describe('Container', () => {
  it('resolves singletons once', () => {
    const c = new Container();
    let calls = 0;
    c.register('counter', () => ++calls, { lifetime: 'singleton' });
    expect(c.resolve('counter')).toBe(1);
    expect(c.resolve('counter')).toBe(1);
  });

  it('resolves transients each time', () => {
    const c = new Container();
    let calls = 0;
    c.register('counter', () => ++calls, { lifetime: 'transient' });
    expect(c.resolve('counter')).toBe(1);
    expect(c.resolve('counter')).toBe(2);
  });

  it('injects declared dependencies', () => {
    const c = new Container();
    c.register('base', () => 41);
    c.register('derived', (container, base: number) => base + 1, { deps: ['base'] });
    expect(c.resolve('derived')).toBe(42);
  });

  it('detects circular dependencies', () => {
    const c = new Container();
    c.register('a', (container) => container.resolve('b'), { deps: ['b'] });
    c.register('b', (container) => container.resolve('a'), { deps: ['a'] });
    expect(() => c.resolve('a')).toThrow(ResolutionError);
  });

  it('throws for unregistered services', () => {
    const c = new Container();
    expect(() => c.resolve('missing')).toThrow(ResolutionError);
  });
});