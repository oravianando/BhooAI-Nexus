import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { nodeIdFor } from '@bhooai/nexus-cluster';
import { scanRuntimes, scanServices, isPortFree, type Prereq, tcpReachable, parseHostPort } from '../util.js';
import {
  resolveProjectInfo as resolveProjectInfoDb,
  connectProjectInfo,
  upsertProjectInfo,
  closeProjectInfo,
  sanitizeDbName,
  type ProjectInfo,
} from '@bhooai/nexus-data';
import { pysetup } from './pysetup.js';
import {
  isInteractive as wizardInteractive,
  banner,
  confirm,
  prompt,
  select,
  multiSelect,
  promptHidden,
  summaryTable,
  statusIcon,
  closeWizard,
  COLORS,
} from '../wizard.js';

interface InitOptions {
  force?: boolean;
  target?: string;
}

const { GREEN, RED, YELLOW, CYAN, DIM, BOLD, RESET } = COLORS;

const __dirname = dirname(fileURLToPath(import.meta.url));
// templates/ lives at the package root (sibling of src/ and dist/), so it works
// whether this file runs from src/commands/ (dev, via tsx) or dist/commands/.
const TEMPLATES = resolve(__dirname, '..', '..', 'templates');

/** AI provider catalogue - labels shown in the multi-select, env var each key writes.
 *  The `envComment` is the line written above the key in .env. Order matches the
 *  .env block layout (local providers first, then cloud providers alphabetically). */
const AI_PROVIDERS: Array<{ id: string; label: string; envVar: string; needsKey: boolean; envComment: string }> = [
  { id: 'ollama', label: 'Ollama (local, no key)', envVar: 'NEXUS_AI_OLLAMA_API_KEY', needsKey: false, envComment: 'Ollama (local) - no API key needed' },
  { id: 'openai', label: 'OpenAI', envVar: 'NEXUS_AI_OPENAI_API_KEY', needsKey: true, envComment: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'NEXUS_AI_ANTHROPIC_API_KEY', needsKey: true, envComment: 'Anthropic Claude' },
  { id: 'google', label: 'Google (Gemini)', envVar: 'NEXUS_AI_GOOGLE_API_KEY', needsKey: true, envComment: 'Google Gemini' },
  { id: 'groq', label: 'Groq', envVar: 'NEXUS_AI_GROQ_API_KEY', needsKey: true, envComment: 'Groq' },
  { id: 'mistral', label: 'Mistral', envVar: 'NEXUS_AI_MISTRAL_API_KEY', needsKey: true, envComment: 'Mistral AI' },
  { id: 'cohere', label: 'Cohere', envVar: 'NEXUS_AI_COHERE_API_KEY', needsKey: true, envComment: 'Cohere' },
  { id: 'together', label: 'Together AI', envVar: 'NEXUS_AI_TOGETHER_API_KEY', needsKey: true, envComment: 'Together AI' },
  { id: 'fireworks', label: 'Fireworks', envVar: 'NEXUS_AI_FIREWORKS_API_KEY', needsKey: true, envComment: 'Fireworks AI' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'NEXUS_AI_DEEPSEEK_API_KEY', needsKey: true, envComment: 'DeepSeek' },
  { id: 'perplexity', label: 'Perplexity', envVar: 'NEXUS_AI_PERPLEXITY_API_KEY', needsKey: true, envComment: 'Perplexity' },
  { id: 'xai', label: 'xAI (Grok)', envVar: 'NEXUS_AI_XAI_API_KEY', needsKey: true, envComment: 'xAI (Grok)' },
  { id: 'replicate', label: 'Replicate', envVar: 'NEXUS_AI_REPLICATE_API_KEY', needsKey: true, envComment: 'Replicate' },
  { id: 'huggingface', label: 'Hugging Face', envVar: 'NEXUS_AI_HUGGINGFACE_API_KEY', needsKey: true, envComment: 'Hugging Face' },
  { id: 'nvidia', label: 'NVIDIA NIM', envVar: 'NEXUS_AI_NVIDIA_API_KEY', needsKey: true, envComment: 'NVIDIA NIM' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'NEXUS_AI_OPENROUTER_API_KEY', needsKey: true, envComment: 'OpenRouter' },
  { id: 'lmstudio', label: 'LM Studio (local, no key)', envVar: 'NEXUS_AI_LMSTUDIO_API_KEY', needsKey: false, envComment: 'LM Studio (local) - no API key needed' },
  { id: 'alephalpha', label: 'Aleph Alpha', envVar: 'NEXUS_AI_ALEPHALPHA_API_KEY', needsKey: true, envComment: 'Aleph Alpha' },
  { id: 'stability', label: 'Stability AI', envVar: 'NEXUS_AI_STABILITY_API_KEY', needsKey: true, envComment: 'Stability AI' },
  { id: 'azure', label: 'Azure OpenAI', envVar: 'NEXUS_AI_AZURE_API_KEY', needsKey: true, envComment: 'Azure OpenAI' },
];

/** Payment provider key/secret env-var names (empty by default - fill in .env). */
const PAYMENT_ENV_KEYS = [
  'NEXUS_PAYMENTS_RAZORPAY_KEY_ID',
  'NEXUS_PAYMENTS_RAZORPAY_KEY_SECRET',
  'NEXUS_PAYMENTS_PAYPAL_CLIENT_ID',
  'NEXUS_PAYMENTS_PAYPAL_CLIENT_SECRET',
  'NEXUS_PAYMENTS_PAYU_MERCHANT_KEY',
  'NEXUS_PAYMENTS_PAYU_SALT',
  'NEXUS_PAYMENTS_SKRILL_MERCHANT_EMAIL',
  'NEXUS_PAYMENTS_PAYONEER_PROGRAM_ID',
  'NEXUS_PAYMENTS_PAYONEER_API_KEY',
];

/** Recursively collect every file under `dir`, as paths relative to `dir`. */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...listFiles(abs, base));
    } else {
      out.push(relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** First non-internal IPv4 of this host (display only). */
function localAddress(): string {
  for (const entry of Object.values(networkInterfaces())) {
    for (const net of entry ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

/** Print onboarding instructions for the chosen server kind. */
function printSetup(kind: 'root' | 'node', role: string, token: string, port: number): void {
  const ip = localAddress();
  if (kind === 'root') {
    console.log('');
    console.log(`${GREEN}BhooAI Nexus root server${RESET} - hub of the node mesh`);
    console.log(`  ${CYAN}npm run dev${RESET}             start backend, frontend, AI server, admin`);
    console.log(`  ${CYAN}nexus cluster serve${RESET}     enable the mesh (load balancer) + autoscaler`);
    console.log(`  ${CYAN}nexus cluster link <url>${RESET}   register a node by its agent URL`);
    console.log(`  pairing token: ${DIM}${token}${RESET}`);
    console.log('  add nodes from the admin UI  \u2b21 Cluster  tab, or with:');
    console.log(`    nexus cluster link http://<node-host>:<node-port>`);
    return;
  }
  console.log('');
  console.log(`${GREEN}BhooAI Nexus node server${RESET} - role ${role}`);
  console.log(`  ${CYAN}nexus node serve --role=${role} --port=${port}${RESET}    start the ${role} node agent`);
  console.log(`  node id:       ${DIM}${nodeIdFor(process.cwd(), role as never)}${RESET}`);
  console.log(`  ${GREEN}agent link:    http://${ip}:${port}${RESET}`);
  console.log(`  pairing token: ${DIM}${token}${RESET}`);
  console.log('  give these to the root operator to add this server:');
  console.log(`    nexus cluster link http://${ip}:${port}`);
}

// -- collected wizard choices ----------------------------------------
interface WizardChoices {
  projectName: string;
  kind: 'root' | 'node';
  role: string;
  agentPort: number;
  mongoUri: string;
  redisUrl: string;
  aiProviders: string[];
  aiKeys: Record<string, string>;
  venv: boolean;
  /** Shared cluster pairing token. For root: generated fresh. For node:
   *  reused from a sibling root project or prompted/flagged so the node
   *  can authenticate to the central. Empty = generate fresh (root only). */
  clusterToken: string;
}

/** Parse the new wizard flags from the CLI args (non-interactive path). */
function parseWizardArgs(args: string[], target: string): WizardChoices {
  const name = argValue(args, '--name') ?? basename(resolve(target));
  const kind = (argValue(args, '--as') === 'node' ? 'node' : 'root') as 'root' | 'node';
  const role = argValue(args, '--role') ?? 'backend';
  const agentPort = Number(argValue(args, '--port') ?? '7575');
  const mongoUri = argValue(args, '--mongo-uri') ?? `mongodb://localhost:27017/${name.replace(/[^a-z0-9_-]/gi, '-')}`;
  const redisUrl = argValue(args, '--redis-url') ?? 'redis://localhost:6379';
  const clusterToken = argValue(args, '--cluster-token') ?? '';
  const aiProvidersArg = argValue(args, '--ai-providers') ?? 'ollama';
  const aiProviders = aiProvidersArg.split(',').map((s) => s.trim()).filter(Boolean);
  const aiKeys: Record<string, string> = {};
  // --ai-key openai=sk-xxx anthropic=sk-ant-yyy (repeatable)
  for (const a of args) {
    const m = /^--ai-key=([a-z0-9_-]+)=(.*)$/i.exec(a);
    if (m) aiKeys[m[1]!] = m[2]!;
    const i = args.indexOf('--ai-key');
    if (i >= 0) {
      const v = args[i + 1];
      if (v) {
        const kv = v.split('=');
        if (kv.length === 2) aiKeys[kv[0]!] = kv[1]!;
      }
    }
  }
  const venv = args.includes('--venv') ? true : args.includes('--no-venv') ? false : true;
  return { projectName: name, kind, role, agentPort, mongoUri, redisUrl, aiProviders, aiKeys, venv, clusterToken };
}

/** Scaffold a new Nexus project from templates/.
 *  `nexus init [target] [--force] [--as=root|node] [--role=R] [--port=N]
 *    [--name=N] [--mongo-uri=URI] [--redis-url=URL] [--ai-providers=a,b]
 *    [--ai-key id=val] [--venv|--no-venv] [--no-interactive] [--no-install]
 *    [--skip-mongo-check]`.
 */
export async function init(opts: InitOptions = {}, args: string[] = []): Promise<number> {
  const targetArg = opts.target ?? args[0] ?? '.';
  const target = resolve(targetArg);
  const force = opts.force ?? args.includes('--force');
  const skipInstall = args.includes('--no-install') || args.includes('--skip-install');
  const skipPysetup = skipInstall; // pysetup is part of "install everything"
  const noInteractive = args.includes('--no-interactive') || !wizardInteractive();
  const skipMongoCheck = args.includes('--skip-mongo-check');

  if (!existsSync(TEMPLATES)) {
    console.error(`init: templates directory not found at ${TEMPLATES}`);
    return 1;
  }

  // -- Step 0: banner ----------------------------------------------
  banner('BhooAI Nexus - project setup wizard', [
    'Scaffolds backend + frontend + admin + Python AI server,',
    'wires Mongo/Redis, generates secrets, installs Node + Python deps.',
    noInteractive ? 'Running non-interactively (flag-driven).' : 'Answer the prompts; defaults are shown in [brackets].',
  ]);

  // -- Step 1: prerequisite scan -----------------------------------
  const runtimes = await scanRuntimes();
  console.log(`  ${BOLD}Prerequisites${RESET}`);
  for (const r of runtimes) {
    const icon = statusIcon(r.ok);
    const color = !r.ok && r.critical ? RED : !r.ok ? YELLOW : CYAN;
    console.log(`  ${icon} ${color}${r.name.padEnd(10)}${RESET} ${DIM}${r.detail}${RESET}`);
  }
  console.log();

  const criticalMissing = runtimes.filter((r) => r.critical && !r.ok);
  if (criticalMissing.length > 0) {
    console.log(`${RED}  Missing critical prerequisites: ${criticalMissing.map((r) => r.name).join(', ')}${RESET}`);
    console.log(`${RED}  Install them before running \`nexus init\` again.${RESET}\n`);
    return 1;
  }

  // Mongo/Redis reachability (warn, don't block - wizard can still scaffold).
  let services: Prereq[] = [];
  if (!skipMongoCheck) {
    // We don't have a config yet; probe the defaults the template ships with.
    services = await scanServices({
      db: { uri: 'mongodb://localhost:27017' },
      redis: { url: 'redis://localhost:6379' },
      ai: { serverUrl: 'http://localhost:8000' },
      server: { host: '0.0.0.0', port: 4000 },
      frontend: { port: 3000 },
      admin: { port: 3001 },
    });
    const mongoDown = services.find((s) => s.name === 'mongodb' && !s.ok);
    const redisDown = services.find((s) => s.name === 'redis' && !s.ok);
    if (mongoDown || redisDown) {
      console.log(`  ${YELLOW}[!]  ${mongoDown?.detail ?? ''}${mongoDown && redisDown ? ' | ' : ''}${redisDown?.detail ?? ''}${RESET}`);
      if (!noInteractive) {
        // Retry loop: y / n / re-check. Lets the user start Mongo/Redis in
        // another terminal and re-probe without aborting the wizard.
        let decided = false;
        while (!decided) {
          const choice = await select(
            'Mongo/Redis not reachable. What do you want to do?',
            [
              { label: 'Retry check (I have started/restarted them)', value: 'retry' },
              { label: 'Continue anyway (skip - fix later)', value: 'yes' },
              { label: 'Abort setup', value: 'no' },
            ],
            'retry',
          );
          if (choice === 'retry') {
            services = await scanServices({
              db: { uri: 'mongodb://localhost:27017' },
              redis: { url: 'redis://localhost:6379' },
              ai: { serverUrl: 'http://localhost:8000' },
              server: { host: '0.0.0.0', port: 4000 },
              frontend: { port: 3000 },
              admin: { port: 3001 },
            });
            const md = services.find((s) => s.name === 'mongodb' && !s.ok);
            const rd = services.find((s) => s.name === 'redis' && !s.ok);
            if (!md && !rd) {
              console.log(`  ${GREEN}[OK] Mongo + Redis reachable now${RESET}\n`);
              decided = true;
            } else {
              console.log(`  ${YELLOW}[!]  ${md?.detail ?? ''}${md && rd ? ' | ' : ''}${rd?.detail ?? ''}${RESET}`);
            }
          } else if (choice === 'yes') {
            decided = true;
          } else {
            console.log(`${DIM}Aborted.${RESET}`);
            closeWizard();
            return 1;
          }
        }
      } else {
        console.log(`  ${DIM}(continuing - pass --skip-mongo-check to silence)${RESET}`);
      }
      console.log();
    }
  }

  // -- Steps 2-9: gather choices -----------------------------------
  const choices = parseWizardArgs(args, target);

  if (!noInteractive) {
    choices.projectName = await prompt('Project name?', choices.projectName);

    // Step 3: server kind
    choices.kind = await select<'root' | 'node'>(
      'Run this server as:',
      [
        { label: 'root - hub of your node mesh (load balancer + autoscaler)', value: 'root' },
        { label: 'node - a worker that joins a root and takes a role', value: 'node' },
      ],
      choices.kind,
    );

    // Step 4: cluster role + port + token (only for node)
    if (choices.kind === 'node') {
      choices.role = await select(
        'Node role:',
        [
          { label: 'backend (API core)', value: 'backend' },
          { label: 'ai (AI inference engine)', value: 'ai' },
          { label: 'files (static + uploads storage)', value: 'files' },
          { label: 'database (Mongo + Redis)', value: 'database' },
        ],
        choices.role,
      );
      const portStr = await prompt('Node agent port?', String(choices.agentPort));
      const p = Number(portStr);
      if (Number.isFinite(p) && p > 0) choices.agentPort = p;

      // The node must present the SAME pairing token as the root. Try to
      // detect a sibling root project's token; else prompt for it.
      const detected = detectSiblingRootToken(target);
      if (detected) {
        choices.clusterToken = detected;
        console.log(`  ${GREEN}[OK]${RESET} reused cluster token from sibling root project`);
      } else if (choices.clusterToken) {
        console.log(`  ${DIM}using --cluster-token${RESET}`);
      } else {
        const t = await prompt('Cluster pairing token (from the root - run `nexus cluster serve` there to see it)?', '');
        choices.clusterToken = t.trim();
      }
    }

    // Step 5: ports - auto-allocate is the default; just confirm.
    const autoPorts = await confirm('Auto-allocate free ports for backend/frontend/admin/ai?', true);
    if (!autoPorts) {
      console.log(`  ${DIM}(custom ports - edit nexus.config.ts after scaffolding)${RESET}`);
    }

    // Step 6: Mongo URI
    const defaultMongo = `mongodb://localhost:27017/${choices.projectName.replace(/[^a-z0-9_-]/gi, '-')}`;
    choices.mongoUri = await prompt('MongoDB URI?', defaultMongo);

    // Step 7: Redis URL
    choices.redisUrl = await prompt('Redis URL?', 'redis://localhost:6379');

    // Step 8: AI providers
    const providerOptions = AI_PROVIDERS.map((p) => ({ label: p.label, value: p.id }));
    const defaultProviders = choices.aiProviders.length ? choices.aiProviders : ['ollama'];
    const selected = await multiSelect('AI providers to enable:', providerOptions, defaultProviders);
    choices.aiProviders = selected;
    choices.aiKeys = {};
    for (const id of selected) {
      const meta = AI_PROVIDERS.find((p) => p.id === id);
      if (meta?.needsKey) {
        const key = await promptHidden(`${meta.label} API key (Enter to skip, fill later in .env):`);
        if (key) choices.aiKeys[id] = key;
      }
    }

    // Step 9: Python venv
    choices.venv = await confirm('Create a Python virtualenv for the AI server?', true);

    // Step 10: review
    console.log(`\n  ${BOLD}Review${RESET}`);
    const review: Array<{ label: string; value: string; ok?: boolean }> = [
      { label: 'project', value: choices.projectName },
      { label: 'kind', value: choices.kind },
      { label: 'mongo', value: choices.mongoUri },
      { label: 'redis', value: choices.redisUrl },
      { label: 'ai providers', value: choices.aiProviders.join(', ') || '(none)' },
      { label: 'python venv', value: choices.venv ? 'yes' : 'no' },
    ];
    summaryTable(review);
    console.log();
    const proceed = await confirm('Proceed with setup?', true);
    if (!proceed) {
      console.log(`${DIM}Aborted.${RESET}`);
      closeWizard();
      return 1;
    }
    console.log();
  }

  // -- Step 11: scaffold templates ---------------------------------
  console.log(`  ${BOLD}Scaffolding project files...${RESET}`);
  const files = listFiles(TEMPLATES);
  let created = 0;
  let skipped = 0;
  for (const rel of files) {
    // npm strips .gitignore/.dockerignore files from published tarballs, so
    // the template ships them as `gitignore`/`dockerignore` and restores the
    // conventional names here.
    const outputRel = rel === 'gitignore' ? '.gitignore' : rel === 'dockerignore' ? '.dockerignore' : rel;
    const abs = join(target, outputRel);
    const preservesExistingConfig = outputRel === 'nexus.config.ts' &&
      ['js', 'mjs', 'cjs'].some((ext) => existsSync(join(target, `nexus.config.${ext}`)));
    if (outputRel === 'package.json' && existsSync(abs) && !force) {
      mergePackageManifest(abs, join(TEMPLATES, rel));
      console.log(`  ${GREEN}update${RESET} ${outputRel}`);
      continue;
    }
    if ((existsSync(abs) || preservesExistingConfig) && !force) {
      console.log(`  ${DIM}skip${RESET}  ${outputRel} (exists)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(join(TEMPLATES, rel)));
    console.log(`  ${GREEN}create${RESET} ${outputRel}`);
    created++;
  }

  // -- Step 11.5: stamp the chosen project name into package.json --
  // The template ships with `"name": "my-nexus-app"`. resolveProjectInfo()
  // (used by the backend + admin) reads this field as the canonical project
  // identity, so it must match what the user typed - otherwise the admin
  // sidebar shows "My Nexus App" and the nexus_projects record is orphaned.
  patchPackageName(target, choices.projectName);

  // -- Step 12: wire framework dependency --------------------------
  wireFrameworkDependency(target);

  // -- Step 13: allocate free ports --------------------------------
  await allocateProjectPorts(target);

  // -- Step 14: write config (cluster + chosen Mongo/Redis/AI) -----
  // Root generates a fresh pairing token; node reuses the one supplied
  // (detected from a sibling root, prompted, or passed via --cluster-token)
  // so the central can authenticate this node's agent.
  const token = choices.clusterToken || randomBytes(16).toString('hex');
  applyClusterConfig(target, choices.kind, token);
  patchConfig(target, {
    mongoUri: choices.mongoUri,
    redisUrl: choices.redisUrl,
  });

  // -- Step 15: generate .env (JWT + Mongo/Redis + AI keys + payments) --
  ensureJwtSecret(target);
  writeEnvBlock(target, [
    { key: 'MONGODB_URI', value: choices.mongoUri },
    { key: 'REDIS_URL', value: choices.redisUrl },
    // Python AI server binds loopback so only Node (same host) can reach it.
    { key: 'AI_HOST', value: '127.0.0.1' },
  ]);
  writeAiKeys(target, choices.aiKeys);
  ensureEnvKeys(target, PAYMENT_ENV_KEYS, 'Payment provider keys', '# Fill in the keys for payment providers you want to use.');

  // -- Step 15.5: register project in nexus_projects.projects ----
  // Pre-registers the project (status 'stopped') so the frontend/backend/admin
  // can recognise it by name + path + settings before the first `npm run dev`.
  // Non-fatal: if Mongo is down (user chose "continue anyway"), skip silently.
  await registerProject(target, choices, token);

  console.log(`\nScaffolded ${created} file(s) into ${target}${skipped ? ` (${skipped} skipped)` : ''}.`);

  // -- Step 16: npm install ----------------------------------------
  if (!skipInstall) {
    if (installDependencies(target) !== 0) {
      closeWizard();
      return 1;
    }
  } else {
    console.log(`  ${DIM}Skipping npm install (--no-install/--skip-install).${RESET}`);
  }

  // -- Step 17: Python setup (pysetup) -----------------------------
  if (!skipPysetup) {
    const pyArgs: string[] = [];
    if (choices.venv) pyArgs.push('--venv');
    console.log(`\n  ${BOLD}Setting up Python AI server...${RESET}`);
    const pyCode = await pysetup(pyArgs);
    if (pyCode !== 0) {
      console.log(`  ${YELLOW}Python setup skipped/failed (exit ${pyCode}). Run \`npm run pysetup\` later.${RESET}`);
    }
  } else {
    console.log(`  ${DIM}Skipping Python setup (--skip-install).${RESET}`);
  }

  // -- Step 18: verify ---------------------------------------------
  await verifyProject(target);

  // -- Step 19: next steps -----------------------------------------
  printSetup(choices.kind, choices.role, token, choices.agentPort);
  console.log(`\n  ${BOLD}Next:${RESET}  ${CYAN}cd ${relative(process.cwd(), target) || '.'}${RESET}  then  ${CYAN}npm run dev${RESET}\n`);

  closeWizard();
  return 0;
}

/** Detect a sibling root project's cluster token by scanning the parent
 *  directory for `nexus.config.{ts,js,mjs,cjs}` files that have
 *  `cluster: { enabled: true, token: '<non-empty>' }`. Returns the first
 *  match (excluding the target itself), or '' if none found.
 *  This lets `nexus init --as=node` reuse the root's pairing token
 *  automatically when the node is scaffolded next to the root. */
function detectSiblingRootToken(target: string): string {
  const parent = dirname(target);
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return '';
  }
  for (const name of entries) {
    const sibling = join(parent, name);
    if (resolve(sibling) === resolve(target)) continue;
    if (!statSync(sibling).isDirectory()) continue;
    for (const ext of ['ts', 'js', 'mjs', 'cjs']) {
      const cfgPath = join(sibling, `nexus.config.${ext}`);
      if (!existsSync(cfgPath)) continue;
      try {
        const src = readFileSync(cfgPath, 'utf8');
        // Match: cluster: { ... enabled: true, ... token: '<value>', ... }
        if (!/cluster\s*:/.test(src)) continue;
        if (!/enabled\s*:\s*true/.test(src)) continue;
        const m = /\btoken\s*:\s*'([0-9a-fA-F]{16,})'/.exec(src);
        if (m && m[1]) return m[1];
      } catch { /* ignore unreadable */ }
    }
  }
  return '';
}

/** Patch the `name` field of the scaffolded package.json to the chosen project
 *  name. The template ships with "my-nexus-app"; resolveProjectInfo() reads
 *  this as the canonical identity, so it must match the user's choice. */
function patchPackageName(target: string, name: string): void {
  const pkgPath = join(target, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
  if (pkg.name === name) return;
  pkg.name = name;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${GREEN}update${RESET} package.json (name: ${name})`);
}

/** Patch nexus.config.ts with the chosen Mongo URI / Redis URL (idempotent, preserves formatting). */
function patchConfig(target: string, values: { mongoUri: string; redisUrl: string }): void {
  const configPath = join(target, 'nexus.config.ts');
  if (!existsSync(configPath)) return;
  let src = readFileSync(configPath, 'utf8');
  let changed = false;
  const mongoRe = /(db:\s*\{\s*uri:\s*')[^']*(')/;
  if (mongoRe.test(src) && !src.includes(`uri: '${values.mongoUri}'`)) {
    src = src.replace(mongoRe, `$1${values.mongoUri}$2`);
    changed = true;
  }
  const redisRe = /(redis:\s*\{\s*url:\s*')[^']*(')/;
  if (redisRe.test(src) && !src.includes(`url: '${values.redisUrl}'`)) {
    src = src.replace(redisRe, `$1${values.redisUrl}$2`);
    changed = true;
  }
  if (changed) {
    writeFileSync(configPath, src);
    console.log(`  ${GREEN}update${RESET} nexus.config.ts (mongo/redis)`);
  }
}

/** Write a list of KEY=VALUE entries to .env (appending, no clobber of existing keys). */
function writeEnvBlock(target: string, entries: Array<{ key: string; value: string }>): void {
  const envPath = join(target, '.env');
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  let added = false;
  for (const { key, value } of entries) {
    if (new RegExp(`^${key}\\s*=`, 'm').test(content)) {
      content = content.replace(new RegExp(`^${key}\\s*=.*$`, 'm'), `${key}=${value}`);
    } else {
      content = `${content.trimEnd()}\n${key}=${value}\n`;
    }
    added = true;
  }
  if (added) {
    writeFileSync(envPath, content);
    console.log(`  ${GREEN}update${RESET} .env (MONGODB_URI/REDIS_URL/AI_HOST)`);
  }
}

/** Write the full AI provider API key block (all 20 providers, with comments)
 *  into .env, then overwrite the ones the user actually entered with their
 *  values. Idempotent - if the block already exists, only fills in missing
 *  keys + updates user-entered values. */
function writeAiKeys(target: string, keys: Record<string, string>): void {
  const envPath = join(target, '.env');
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  const sectionHeader = '# -- AI provider API keys ---------------------------------------------';
  const sectionIntro = '# Fill in the keys for providers you want to use, then enable them from';
  const sectionIntro2 = '# the admin panel -> AI Agents -> AI Providers tab.';
  const sectionIntro3 = '# Local providers (ollama, lmstudio) don\'t need keys.';
  const blockExists = content.includes('NEXUS_AI_OLLAMA_API_KEY');

  if (!blockExists) {
    // Append the full block (header + intro + per-provider comment + KEY=).
    const lines: string[] = ['', sectionHeader, sectionIntro, sectionIntro2, sectionIntro3, ''];
    for (const p of AI_PROVIDERS) {
      lines.push(`# ${p.envComment}`);
      lines.push(`${p.envVar}=`);
    }
    lines.push('');
    content = `${content.trimEnd()}\n${lines.join('\n')}`;
  } else {
    // Block exists - add any missing provider keys (idempotent for upgrades).
    for (const p of AI_PROVIDERS) {
      if (!new RegExp(`^${p.envVar}\\s*=`, 'm').test(content)) {
        content = `${content.trimEnd()}\n# ${p.envComment}\n${p.envVar}=\n`;
      }
    }
  }

  // Overwrite the keys the user actually entered with their values.
  let changed = false;
  for (const [id, value] of Object.entries(keys)) {
    const meta = AI_PROVIDERS.find((p) => p.id === id);
    if (!meta) continue;
    if (new RegExp(`^${meta.envVar}\\s*=`, 'm').test(content)) {
      content = content.replace(new RegExp(`^${meta.envVar}\\s*=.*$`, 'm'), `${meta.envVar}=${value}`);
      changed = true;
    }
  }

  writeFileSync(envPath, content);
  console.log(`  ${GREEN}update${RESET} .env (AI provider keys - ${AI_PROVIDERS.length} placeholders${Object.keys(keys).length ? ` + ${Object.keys(keys).length} entered` : ''})`);
}

/** Pre-register the scaffolded project in the shared `nexus_projects.projects`
 *  collection. Writes name, path, dbName, status='stopped', and a settings
 *  snapshot (kind, role, mongo, redis, ai providers, payments, ports, paths)
 *  so frontend/backend/admin can recognise the project before first startup.
 *  Non-fatal: skipped (with a warning) if Mongo is unreachable - the backend
 *  will upsert a fresher record on its first `npm run dev`. */
async function registerProject(target: string, choices: WizardChoices, clusterToken: string): Promise<void> {
  console.log(`\n  ${BOLD}Registering project in nexus_projects...${RESET}`);
  try {
    const base = await resolveProjectInfoDb(target);
    const dbName = sanitizeDbName(choices.projectName);

    // Probe Mongo before connecting (user may have chosen "continue anyway").
    const mongo = parseHostPort(choices.mongoUri, 27017);
    const mongoOk = await tcpReachable(mongo.host, mongo.port, 1500);
    if (!mongoOk) {
      console.log(`  ${YELLOW}[!]  Mongo unreachable - skipping project registration (backend will register on first start)${RESET}`);
      return;
    }

    connectProjectInfo(choices.mongoUri, { autoIndex: true });
    const settings: Record<string, unknown> = {
      env: 'development',
      kind: choices.kind,
      ...(choices.kind === 'node' ? { role: choices.role } : {}),
      mongoUri: choices.mongoUri,
      redisUrl: choices.redisUrl,
      database: dbName,
      ai: {
        providers: choices.aiProviders,
        // Keys are NOT stored here - they live only in .env (secrets sink).
        keysConfigured: Object.keys(choices.aiKeys),
      },
      payments: { currency: 'INR', providersConfigured: [] },
      cluster: { enabled: choices.kind === 'root', token: clusterToken },
      paths: { uploads: 'uploads', plugins: 'plugins', certs: 'certs', logs: 'logs' },
      ports: { backend: 4000, frontend: 3000, admin: 3001, ai: 8000 },
    };
    const record: ProjectInfo = {
      ...base,
      name: choices.projectName,
      path: target,
      dbName,
      status: 'stopped',
      version: '0.1.0',
      startedAt: undefined,
      settings,
    };
    await upsertProjectInfo(record);
    console.log(`  ${GREEN}[OK]${RESET} registered  ${CYAN}${choices.projectName}${RESET} ${DIM}-> nexus_projects.projects${RESET}`);
    await closeProjectInfo();
  } catch (err) {
    console.log(`  ${YELLOW}[!]  project registration skipped: ${(err as Error).message}${RESET}`);
  }
}

/** Run a mini-doctor on the freshly scaffolded project. Non-fatal - just prints. */
async function verifyProject(target: string): Promise<void> {
  console.log(`\n  ${BOLD}Verifying...${RESET}`);
  try {
    // Load the just-written config via the framework loader.
    const { loadConfigAuto } = await import('../../../nexus-core/src/index.js');
    const cfg = await loadConfigAuto({ root: target });
    const services = await scanServices(cfg);
    for (const s of services) {
      const icon = statusIcon(s.ok);
      const color = s.ok ? CYAN : YELLOW;
      console.log(`  ${icon} ${color}${s.name.padEnd(14)}${RESET} ${DIM}${s.detail}${RESET}`);
    }
    // Assert Python AI server stays loopback (security invariant).
    const aiHost = new URL(cfg.ai.serverUrl).hostname;
    const loopback = aiHost === '127.0.0.1' || aiHost === 'localhost';
    console.log(`  ${statusIcon(loopback)} ${loopback ? CYAN : RED}ai loopback${RESET}      ${DIM}${aiHost}${loopback ? '' : ' - should be 127.0.0.1'}${RESET}`);
  } catch (err) {
    console.log(`  ${YELLOW}[!]  verify skipped: ${(err as Error).message}${RESET}`);
  }
  console.log();
}

/** Write the `cluster` section into the scaffolded nexus.config.ts.
 *  The template ships with `cluster: { enabled: false, token: '' }`, so this
 *  always patches the existing line - setting `enabled` (true for root, false
 *  for node) and stamping a fresh pairing `token`. Idempotent on re-runs. */
function applyClusterConfig(target: string, kind: 'root' | 'node', token: string): void {
  const configPath = join(target, 'nexus.config.ts');
  if (!existsSync(configPath)) return;
  let src = readFileSync(configPath, 'utf8');
  const enabled = kind === 'root';
  const desiredToken = token;

  if (!/cluster\s*:/.test(src)) {
    // No cluster block at all - insert one after the opening brace.
    const clusterLine = `  cluster: { enabled: ${enabled}, token: '${desiredToken}' },`;
    writeFileSync(configPath, src.replace(
      /(const config: Partial<NexusConfig> = \{\r?\n)/,
      `$1${clusterLine}\n`,
    ));
    console.log(`  ${GREEN}create${RESET} nexus.config.ts (cluster: ${kind})`);
    return;
  }

  // Patch the existing cluster line's `enabled` + `token` in place.
  let changed = false;

  // enabled: <bool>
  const enabledRe = /(cluster\s*:\s*\{[^}]*\benabled\s*:\s*)(false|true)/;
  const enabledMatch = enabledRe.exec(src);
  if (enabledMatch && enabledMatch[2] !== String(enabled)) {
    src = src.replace(enabledRe, `$1${enabled}`);
    changed = true;
  }

  // token: '<value>'  - only stamp a fresh token when the existing one is empty,
  // so re-running `nexus init .` doesn't invalidate already-paired cluster nodes.
  const tokenRe = /(cluster\s*:\s*\{[^}]*\btoken\s*:\s*')([^']*)(')/;
  const tokenMatch = tokenRe.exec(src);
  if (tokenMatch && tokenMatch[2] === '' && desiredToken) {
    src = src.replace(tokenRe, `$1${desiredToken}$3`);
    changed = true;
  }

  if (changed) {
    writeFileSync(configPath, src);
    console.log(`  ${GREEN}update${RESET} nexus.config.ts (cluster: ${kind}, enabled: ${enabled})`);
  } else {
    console.log(`  ${DIM}keep${RESET}  nexus.config.ts (cluster: ${kind} already set)`);
  }
}

/** Set up the bhooai-nexus workspace + file: dependency for a scaffolded project.
 *  The framework path is resolved relative to the Nexus CLI's own location. */
function wireFrameworkDependency(target: string): void {
  // FRAMEWORK_PACKAGES is three levels up from packages/nexus-cli/src/commands/init.ts:
  //   packages/nexus-cli/  ->  ../../../
  // So the framework root (bhooai-nexus) is at:
  const frameworkRoot = resolve(__dirname, '..', '..', '..', '..');
  const targetRel = relative(target, frameworkRoot).replace(/\\/g, '/');

  // Update the generated package.json: stamp the correct framework path.
  const pkgPath = join(target, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, any>;

  // Workspaces: point at the framework's packages/ instead of a local copy.
  pkg.workspaces = [`${targetRel}/packages/*`, 'apps/backend', 'apps/admin', 'apps/frontend'];

  // Dependencies: add the bhooai-nexus file: dep for the CLI bin.
  const deps = (pkg.dependencies = pkg.dependencies ?? {}) as Record<string, any>;
  deps['bhooai-nexus'] = `file:${targetRel}`;

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${GREEN}update${RESET} package.json (framework workspace -> ${targetRel})`);

  // Update tailwind.config.js - point the content scanner at the framework's
  // nexus-admin source so Tailwind generates utility classes used by the admin SPA.
  const tailwindPath = join(target, 'apps', 'admin', 'tailwind.config.js');
  if (existsSync(tailwindPath)) {
    // From apps/admin/ to the framework: first go up to the project root (../..),
    // then follow targetRel to the framework root.
    const adminRel = `../../${targetRel}`;
    const tailwindSrc = readFileSync(tailwindPath, 'utf8');
    const updated = tailwindSrc.replace(
      /'\.\.\/\.\.\/[^']*nexus-admin\/src\/\*\*\/\*\.\{ts,tsx\}'/,
      `'${adminRel}/packages/nexus-admin/src/**/*.{ts,tsx}'`,
    );
    if (updated !== tailwindSrc) {
      writeFileSync(tailwindPath, updated);
      console.log(`  ${GREEN}update${RESET} apps/admin/tailwind.config.js (content path -> framework)`);
    }
  }

  // Update vite.config.ts - add /ai proxy entry if missing.
  const vitePath = join(target, 'apps', 'admin', 'vite.config.ts');
  if (existsSync(vitePath)) {
    let viteSrc = readFileSync(vitePath, 'utf8');
    if (!viteSrc.includes("'/ai'")) {
      viteSrc = viteSrc.replace(
        /'\/csrf-token': \{ target, changeOrigin: true \},/,
        `'/csrf-token': { target, changeOrigin: true },\n        '/ai': { target, changeOrigin: true },`,
      );
      writeFileSync(vitePath, viteSrc);
      console.log(`  ${GREEN}update${RESET} apps/admin/vite.config.ts (added /ai proxy)`);
    }
  }
}

/** Auto-allocate free ports for a freshly scaffolded project and patch its
 *  nexus.config.ts. All projects ship with the same defaults (server 4000,
 *  frontend 3000, admin 3001, AI 8000, cluster LB 8080, agent 7575), so a
 *  second project running on the same machine collides - its admin Vite fails
 *  to bind and the browser hits another project's admin (wrong project name). */
async function allocateProjectPorts(target: string): Promise<void> {
  const configPath = join(target, 'nexus.config.ts');
  if (!existsSync(configPath)) return;
  let src = readFileSync(configPath, 'utf8');

  const defaults: Array<{ key: string; port: number }> = [
    { key: 'server', port: 4000 },
    { key: 'frontend', port: 3000 },
    { key: 'admin', port: 3001 },
    { key: 'ai', port: 8000 },
    { key: 'lb', port: 8080 },
    { key: 'agent', port: 7575 },
  ];

  const allocated: Record<string, number> = {};
  let changed = false;
  for (const { key, port } of defaults) {
    if (await isPortFree('127.0.0.1', port)) {
      allocated[key] = port;
      continue;
    }
    let free = port;
    for (let i = 1; i <= 100; i++) {
      if (await isPortFree('127.0.0.1', port + i)) { free = port + i; break; }
    }
    if (free !== port) {
      allocated[key] = free;
      changed = true;
    } else {
      allocated[key] = port;
    }
  }

  if (!changed) return;

  const patch = (section: string, portKey: string, value: number) => {
    const re = new RegExp(`(${section}\\s*:\\s*\\{[^}]*${portKey}\\s*:\\s*)\\d+`, '');
    if (re.test(src)) src = src.replace(re, `$1${value}`);
  };

  patch('server', 'port', allocated.server!);
  patch('frontend', 'port', allocated.frontend!);
  patch('admin', 'port', allocated.admin!);
  const aiRe = /(ai:\s*\{\s*serverUrl:\s*'http:\/\/[^:]+:)\d+/;
  if (aiRe.test(src)) src = src.replace(aiRe, `$1${allocated.ai}`);
  patch('cluster', 'lbPort', allocated.lb!);
  patch('cluster', 'nodeAgentPort', allocated.agent!);

  writeFileSync(configPath, src);
  console.log(`  ${GREEN}update${RESET} nexus.config.ts (free ports: server ${allocated.server}, frontend ${allocated.frontend}, admin ${allocated.admin}, ai ${allocated.ai})`);
}

function installDependencies(target: string): number {
  console.log('\n  Installing project dependencies (React, Vite, admin, and framework packages)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], {
    cwd: target,
    stdio: 'inherit',
    // Windows npm is a .cmd shim and requires shell execution.
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`init: npm install failed: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    console.error(`init: npm install exited with code ${result.status ?? 'unknown'}`);
    return result.status ?? 1;
  }
  console.log('  Dependencies installed.');
  return 0;
}

function ensureJwtSecret(target: string): void {
  const envPath = join(target, '.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const current = /^NEXUS_AUTH_JWT_SECRET\s*=\s*(.*)$/m.exec(existing)?.[1]?.trim();
  if (current && current !== 'change-me-please' && !current.startsWith('change-me-please-')) {
    // Secret already set - just ensure the placeholder sections exist.
    ensureEnvKeys(target, PAYMENT_ENV_KEYS, 'Payment provider keys', '# Fill in the keys for payment providers you want to use.');
    return;
  }

  const secret = randomBytes(32).toString('base64url');
  const line = `NEXUS_AUTH_JWT_SECRET=${secret}`;
  let next = /^NEXUS_AUTH_JWT_SECRET\s*=.*$/m.test(existing)
    ? existing.replace(/^NEXUS_AUTH_JWT_SECRET\s*=.*$/m, line)
    : `${existing.trimEnd()}${existing.trimEnd() ? '\n' : ''}${line}\n`;
  writeFileSync(envPath, next);
  console.log(`  ${GREEN}${existing ? 'update' : 'create'}${RESET} .env (JWT secret generated)`);
  ensureEnvKeys(target, PAYMENT_ENV_KEYS, 'Payment provider keys', '# Fill in the keys for payment providers you want to use.');
}

/** Ensure all env-var keys (payments) exist in .env (empty). Idempotent. */
function ensureEnvKeys(target: string, keys: string[], sectionTitle: string, sectionComment: string): void {
  const envPath = join(target, '.env');
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  let added = false;

  if (keys.some((k) => new RegExp(`^${k}\\s*=`, 'm').test(content))) {
    // Section exists - add any missing keys individually.
    for (const key of keys) {
      if (!new RegExp(`^${key}\\s*=`, 'm').test(content)) {
        content = `${content.trimEnd()}\n${key}=\n`;
        added = true;
      }
    }
  } else {
    // Add the full block.
    const block = [
      '',
      `# \u2500\u2500 ${sectionTitle} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      sectionComment,
      '',
      ...keys.map((k) => `${k}=`),
      '',
    ].join('\n');
    content = `${content.trimEnd()}${block}`;
    added = true;
  }

  if (added) {
    writeFileSync(envPath, content);
    console.log(`  ${GREEN}update${RESET} .env (${sectionTitle} placeholders added)`);
  }
}

function mergePackageManifest(targetPath: string, templatePath: string): void {
  const current = JSON.parse(readFileSync(targetPath, 'utf8')) as Record<string, any>;
  const template = JSON.parse(readFileSync(templatePath, 'utf8')) as Record<string, any>;
  const merged = {
    ...template,
    ...current,
    type: template.type ?? current.type,
    workspaces: template.workspaces ?? current.workspaces,
    scripts: { ...(current.scripts ?? {}), ...(template.scripts ?? {}) },
    // Keep project-specific versions and local file: dependencies when an
    // existing manifest is upgraded; the template only supplies missing keys.
    dependencies: { ...(template.dependencies ?? {}), ...(current.dependencies ?? {}) },
    devDependencies: { ...(template.devDependencies ?? {}), ...(current.devDependencies ?? {}) },
  };
  writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
}