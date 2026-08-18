import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaults } from './defaults.js';
import { deepMerge } from './merge.js';
import { configFromEnv, loadEnvFile } from './env.js';
import { nexusConfigSchema } from './schema.js';
import type { DeepPartial, NexusConfig, UserNexusConfig } from './types.js';

export interface LoadOptions {
  /** The imported user config object (from `nexus.config.ts`). */
  userConfig?: UserNexusConfig;
  /** Path to a `nexus.config.ts`/`.js` to import dynamically if `userConfig` not given. */
  userConfigPath?: string;
  /** Path to a shipped default config (the framework's `nexus/nexus.config.ts`) merged right
   *  after the code defaults and before the user config. */
  defaultConfigPath?: string;
  /** Path to `nexus.runtime.json` (admin write-back). Defaults to `<root>/nexus.runtime.json`. */
  runtimePath?: string;
  /** Project root used to resolve relative paths. Defaults to cwd. */
  root?: string;
  /** Env override (for tests). */
  env?: NodeJS.ProcessEnv;
  /** CLI flag overrides (highest precedence). */
  cli?: DeepPartial<NexusConfig>;
}

/**
 * Load and merge configuration in precedence order:
 *   defaults < userConfig (nexus.config.ts) < runtime.json < env < cli
 * Then validate with the zod schema and return a frozen, typed config.
 */
export async function loadConfig(opts: LoadOptions = {}): Promise<NexusConfig> {
  const root = resolve(opts.root ?? process.cwd());
  const env = opts.env ?? process.env;

  // 0. project .env — merged into the env object BEFORE env-var mapping below.
  //    Skipped when a caller passes its own env (tests), which must stay pure.
  if (!opts.env) loadEnvFile(root, env);

  // 1. defaults
  let merged: unknown = defaults;

  // 1b. shipped default config (the framework's nexus.config.ts) — base layer above code defaults
  if (opts.defaultConfigPath && existsSync(resolve(opts.defaultConfigPath))) {
    const defaultConfig = await importUserConfig(resolve(opts.defaultConfigPath));
    merged = deepMerge(merged, defaultConfig);
  }

  // 2. user config (nexus.config.ts / nexus.config.js)
  let userConfig = opts.userConfig;
  if (!userConfig && opts.userConfigPath) {
    userConfig = await importUserConfig(resolve(opts.userConfigPath));
  }
  if (userConfig) merged = deepMerge(merged, userConfig);

  // 3. runtime.json (admin write-back, gitignored)
  const runtimePath = opts.runtimePath ?? resolve(root, 'nexus.runtime.json');
  if (existsSync(runtimePath)) {
    try {
      const runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as DeepPartial<NexusConfig>;
      merged = deepMerge(merged, runtime);
    } catch {
      // A corrupt runtime file must not crash boot; ignore it.
    }
  }

  // 4. env
  merged = deepMerge(merged, configFromEnv(env));

  // 5. cli flags (highest)
  if (opts.cli) merged = deepMerge(merged, opts.cli);

  // validate
  const parsed = nexusConfigSchema.parse(merged);
  return Object.freeze(parsed) as NexusConfig;
}

async function importUserConfig(absPath: string): Promise<UserNexusConfig> {
  const url = pathToFileURL(absPath).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const cfg = (mod.default ?? mod.config) as UserNexusConfig | undefined;
  if (!cfg) {
    throw new Error(
      `Expected ${absPath} to export a config object as the default export or named "config".`,
    );
  }
  return cfg;
}

/** Resolve a path relative to the project root. */
export function resolvePath(cfg: NexusConfig, rel: string): string {
  return resolve(rel);
}

const CONFIG_EXTENSIONS = ['ts', 'js', 'mjs', 'cjs'] as const;

/**
 * Path to the framework's own shipped `nexus.config.ts` (at the framework workspace root).
 * Resolved relative to THIS file so it works from both `src/` (run via tsx) and `dist/`
 * (compiled). When `@bhooai/nexus-core` is installed inside a user app's `node_modules/`,
 * this resolves to a non-existent path under `node_modules/` — so it is simply skipped there
 * (a user app does not inherit the framework's example config).
 */
export function frameworkDefaultConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/config/  ->  src  ->  <pkg>  ->  packages  ->  <framework root>  (4 levels up)
  return resolve(here, '..', '..', '..', '..', 'nexus.config.ts');
}

/**
 * First `nexus.config.{ts,js,mjs,cjs}` found walking UP from `root`, skipping `exclude`.
 * Standard find-first discovery; stops at the filesystem root.
 */
export function discoverUserConfigPath(root: string, exclude?: string): string | undefined {
  let dir = resolve(root);
  const excl = exclude ? resolve(exclude) : undefined;
  for (let i = 0; i < 24; i++) {
    for (const ext of CONFIG_EXTENSIONS) {
      const cand = join(dir, `nexus.config.${ext}`);
      if (existsSync(cand) && (!excl || resolve(cand) !== excl)) return cand;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Auto-discover and load config with the framework's two-level model:
 *   defaults  <  framework default (`nexus/nexus.config.ts`)  <  user config  <  runtime.json  <  env  <  cli
 *
 * The framework default is located via `frameworkDefaultConfigPath()` (the shipped
 * `nexus/nexus.config.ts`). The user config is the nearest `nexus.config.{ts,js,...}` walking
 * up from `root`, SKIPPING that default — so when running the framework's own app (cwd =
 * `nexus/`), the discovery walks past `nexus/nexus.config.ts` and finds the user-editable
 * `nexus.config.js` at the project root, which overrides the default. When running a user app,
 * the framework default path does not exist, so only that app's own config is loaded.
 */
export async function loadConfigAuto(
  opts: Omit<LoadOptions, 'userConfig' | 'userConfigPath' | 'defaultConfigPath'> = {},
): Promise<NexusConfig> {
  const root = resolve(opts.root ?? process.cwd());
  const defaultPath = frameworkDefaultConfigPath();
  const defaultExists = existsSync(defaultPath);
  const userPath = defaultExists
    ? discoverUserConfigPath(root, defaultPath)
    : discoverUserConfigPath(root);
  return loadConfig({
    ...opts,
    root,
    defaultConfigPath: defaultExists ? defaultPath : undefined,
    userConfigPath: userPath,
  });
}

/** Read-only accessor for tests / bootstrap that don't need file loading. */
export function mergeConfig(...sources: DeepPartial<NexusConfig>[]): NexusConfig {
  return Object.freeze(nexusConfigSchema.parse(deepMerge(defaults, ...sources))) as NexusConfig;
}