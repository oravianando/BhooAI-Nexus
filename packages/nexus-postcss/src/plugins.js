import postcssImport from 'postcss-import';
import postcssNested from 'postcss-nested';
import postcssNesting from 'postcss-nesting';
import postcssLogical from 'postcss-logical';
import tailwindcss from 'tailwindcss';
import postcssPresetEnv from 'postcss-preset-env';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import postcssLightningcss from 'postcss-lightningcss';

export function createPreset(options = {}) {
  const DEFAULT_CONTENT = ['./index.html', './src/**/*.{ts,tsx}'];
  const PRESET_ENV_STAGES = ['stage2', 'stage3', 'stage4'];
  const env = process.env.NODE_ENV ?? 'development';
  const shouldMinify = options.minify ?? env === 'production';
  const presetEnvStage = PRESET_ENV_STAGES.includes(options.presetEnv)
    ? options.presetEnv
    : 'stage2';
  const enablePresetEnv = options.presetEnv !== false;
  const enableImport = options.import ?? true;
  const enableNested = options.nested ?? true;
  const enableAutoprefixer = options.autoprefixer !== false;
  const useModernNesting = options.nestingMode === 'modern';
  const useLightningcss = options.engine === 'lightningcss';

  const content = [...(options.content ?? DEFAULT_CONTENT), ...(options.extraContent ?? [])];
  const tailwindOpts = {
    content,
    theme: options.theme ?? {},
    plugins: options.tailwindPlugins ?? [],
  };

  const plugins = [];
  if (enableImport) plugins.push(postcssImport({}));
  if (enableNested) {
    plugins.push(useModernNesting ? postcssNesting() : postcssNested());
  }
  plugins.push(tailwindcss(tailwindOpts));

  if (useLightningcss) {
    // lightningcss handles prefixing + minification + some future CSS in one pass.
    // It replaces postcss-preset-env + autoprefixer + cssnano.
    plugins.push(postcssLightningcss({ minify: shouldMinify }));
  } else {
    if (options.logical) {
      const logicalOpts = typeof options.logical === 'object' ? options.logical : {};
      plugins.push(postcssLogical(logicalOpts));
    }
    if (enablePresetEnv) plugins.push(postcssPresetEnv({ stage: presetEnvStage }));
    if (enableAutoprefixer) {
      const apOpts = typeof options.autoprefixer === 'object' ? options.autoprefixer : {};
      plugins.push(autoprefixer(apOpts));
    }
    if (shouldMinify) plugins.push(cssnano({ preset: 'default' }));
  }

  if (options.plugins) {
    for (const p of options.plugins) {
      if (typeof p === 'string') plugins.push(p);
      else plugins.push(p[0](p[1] ?? {}));
    }
  }

  const map = options.sourcemap === true
    ? { inline: true, annotation: true }
    : options.sourcemap === false
      ? false
      : undefined;

  return { plugins, ...(map !== undefined && { map }) };
}