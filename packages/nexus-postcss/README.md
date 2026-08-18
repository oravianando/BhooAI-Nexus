# @bhooai/nexus-postcss

Opinionated PostCSS preset for BhooAI Nexus apps — Tailwind, nesting, future CSS, autoprefixing, and minification in one curated pipeline.

## Install

Already included when you scaffold a project with `nexus init`. To add manually:

```bash
npm install @bhooai/nexus-postcss
```

## Usage

### `postcss.config.js` (default)

```js
import { createPreset } from '@bhooai/nexus-postcss';
export default createPreset();
```

### With options

```js
import { createPreset } from '@bhooai/nexus-postcss';
export default createPreset({
  extraContent: ['../../packages/nexus-admin/src/**/*.{ts,tsx}'],
  minify: true,
});
```

### With Tailwind forms + typography plugins

```js
import { createPreset } from '@bhooai/nexus-postcss';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

export default createPreset({
  tailwindPlugins: [forms, typography],
});
```

### Modern CSS nesting (spec-compliant)

```js
import { createPreset } from '@bhooai/nexus-postcss';

export default createPreset({
  nestingMode: 'modern', // use postcss-nesting (real CSS Nesting spec) instead of postcss-nested
});
```

### Lightning CSS engine (experimental, ~100x faster)

```js
import { createPreset } from '@bhooai/nexus-postcss';

export default createPreset({
  engine: 'lightningcss', // replaces preset-env + autoprefixer + cssnano with one lightningcss pass
});
```

Note: `lightningcss` targets browsers directly (not CSS stages), so `postcss-preset-env` stage polyfills are not applied. Nesting, prefixing, and minification are all handled by lightningcss.

### RTL/LTR direction-aware CSS

```js
import { createPreset } from '@bhooai/nexus-postcss';

export default createPreset({
  logical: true, // polyfills margin-inline, padding-block, inset-inline, etc.
});
```

## Plugin chain (in order)

**Default (`engine: 'postcss'`):**

1. **postcss-import** — resolve `@import` statements
2. **postcss-nested** (or **postcss-nesting** when `nestingMode: 'modern'`) — CSS nesting
3. **tailwindcss** — base/components/utilities + content scanning
4. **postcss-logical** (when `logical: true`) — direction-aware properties
5. **postcss-preset-env** (stage 2) — future CSS features today
6. **autoprefixer** — vendor prefixes
7. **cssnano** — minification (only when `NODE_ENV=production` or `minify: true`)

**Lightning CSS (`engine: 'lightningcss'`):**

1. **postcss-import** — resolve `@import` statements
2. **postcss-nested** (or **postcss-nesting** when `nestingMode: 'modern'`) — CSS nesting
3. **tailwindcss** — base/components/utilities + content scanning
4. **postcss-lightningcss** — prefixing + minification + future CSS (replaces preset-env + autoprefixer + cssnano)

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `string[]` | `['./index.html', './src/**/*.{ts,tsx}']` | Tailwind content scan paths |
| `extraContent` | `string[]` | `[]` | Additional content paths to merge |
| `theme` | `object` | `{}` | Tailwind theme extensions |
| `tailwindPlugins` | `array` | `[]` | Tailwind plugins (e.g. `@tailwindcss/forms`, `@tailwindcss/typography`) |
| `import` | `boolean` | `true` | Enable postcss-import |
| `nested` | `boolean` | `true` | Enable CSS nesting |
| `nestingMode` | `'classic' \| 'modern'` | `'classic'` | `'modern'` uses postcss-nesting (real CSS Nesting spec); `'classic'` uses postcss-nested |
| `logical` | `boolean \| object` | `false` | Enable postcss-logical for RTL/LTR direction-aware CSS |
| `presetEnv` | `boolean \| 'stage2' \| 'stage3' \| 'stage4'` | `true` (stage2) | Enable postcss-preset-env (ignored when `engine: 'lightningcss'`) |
| `autoprefixer` | `boolean \| object` | `true` | Enable autoprefixer (ignored when `engine: 'lightningcss'`) |
| `minify` | `boolean` | `NODE_ENV === 'production'` | Enable minification (cssnano or lightningcss) |
| `sourcemap` | `boolean` | `undefined` | Explicit source map control: `true` = inline + annotation, `false` = disabled, `undefined` = let PostCSS/Vite decide |
| `engine` | `'postcss' \| 'lightningcss'` | `'postcss'` | CSS processing backend. `'lightningcss'` is experimental and ~100x faster |
| `plugins` | `Array<[string, any] \| string>` | `[]` | Custom PostCSS plugins to append |

## Theme tokens

Two token stylesheets ship with the preset:

### Dark-only (default)

```css
@import '@bhooai/nexus-postcss/theme.css';
```

22 CSS custom properties (`--nexus-bg`, `--nexus-ink`, `--nexus-surface`, `--nexus-accent`, etc.) on `:root`, plus 15 `--admin-*` aliases for backwards compatibility.

### Light/dark dual theme

```css
@import '@bhooai/nexus-postcss/theme-light-dark.css';
```

Uses the CSS `light-dark()` function so every token adapts to the user's `prefers-color-scheme`. Sets `color-scheme: light dark` on `:root`. `postcss-preset-env` (stage 2, in the default chain) polyfills `light-dark()` for browsers without native support.

## Tailwind config

`tailwind.config.js` is kept in each app — the preset only injects `content` paths and the plugin chain. Theme extensions and Tailwind plugins stay in your `tailwind.config.js`.

Note: Tailwind v3.4+ enables container queries by default — the `@container` utility is available out of the box.

## License

MIT