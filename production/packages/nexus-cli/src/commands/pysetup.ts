import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { versionOf } from '../util.js';
import { isInteractive as wizardInteractive, confirm, prompt, closeWizard } from '../wizard.js';

/**
 * Install the Python AI server dependencies (plus any extra packages).
 *
 * Locates `apps/ai-server/requirements.txt` (or a path given with --requirements),
 * optionally creates a virtualenv with --venv, and streams pip output through so the
 * user can watch progress.
 *
 *   nexus pysetup                        install from requirements.txt
 *   nexus pysetup openai pandas          install requirements.txt + extra packages
 *   nexus pysetup --venv                 create ./apps/ai-server/.venv and install into it
 *   nexus pysetup --interactive          prompt for venv y/n + python path (TTY only)
 *   nexus pysetup --upgrade              upgrade existing packages
 *   nexus pysetup --python C:/Python/Python314/python.exe
 *   nexus pysetup --requirements ./my-requirements.txt
 */
export async function pysetup(args: string[]): Promise<number> {
  let opts: PyOpts = parseArgs(args);

  // -- interactive wizard mode (TTY only) ---------------------------
  if (opts.interactive && wizardInteractive()) {
    opts = await interactivePrompt(opts);
    closeWizard();
  }

  const reqFile = resolve(process.cwd(), opts.requirements || findRequirementsFile(process.cwd()));
  const py = await resolvePython(opts.python);

  if (!opts.requirements && !findRequirementsFile(process.cwd())) {
    console.error('Could not find apps/ai-server/requirements.txt - pass one with --requirements <path>.');
    return 1;
  }
  if (!existsSync(reqFile)) {
    console.error(`requirements file not found: ${reqFile}`);
    return 1;
  }
  if (!py) {
    console.error(`Python interpreter not found (tried python / python3). Pass --python <path>.`);
    return 1;
  }

  const venvPy = opts.venv ? join(opts.venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : py;
  const createVenv = async () => {
    if (existsSync(venvPy)) return 0;
    console.log(`\n\x1b[36m[pysetup]\x1b[0m creating venv at ${opts.venvDir}`);
    return run(py, ['-m', 'venv', opts.venvDir]);
  };

  console.log(`\n\x1b[36m[pysetup]\x1b[0m installing python packages`);
  console.log(`  python      : ${py}${opts.venv ? ` -> ${venvPy}` : ''}`);
  console.log(`  requirements: ${reqFile}`);
  console.log(`  extras      : ${opts.extras.length ? opts.extras.join(', ') : '(none)'}`);
  if (opts.venv) console.log(`  venv        : ${opts.venvDir}`);

  if (opts.venv) {
    const venvCode = await createVenv();
    if (venvCode !== 0) return venvCode;
  }

  const pipArgs = ['-m', 'pip', 'install'];
  if (opts.upgrade) pipArgs.push('--upgrade');
  pipArgs.push('-r', reqFile, ...opts.extras);

  const code = await run(venvPy ?? py, pipArgs);
  if (code !== 0) {
    console.error(`\n[pysetup] install failed (exit ${code}).`);
    return code;
  }
  console.log(`\n\x1b[32m[pysetup]\x1b[0m done - ${opts.extras.length ? opts.extras.join(' ') : 'core requirements'} installed.`);
  return 0;
}

/** Interactive prompts for venv + python path. Returns updated opts. */
async function interactivePrompt(opts: PyOpts): Promise<PyOpts> {
  const wantVenv = await confirm('Create a virtualenv for the AI server?', opts.venv);
  const pythonPath = await prompt('Python interpreter path (blank = auto-detect)', opts.python || '');
  return { ...opts, venv: wantVenv, python: pythonPath.trim() };
}

interface PyOpts { python: string; requirements: string; extras: string[]; upgrade: boolean; venv: boolean; venvDir: string; interactive: boolean }

function parseArgs(args: string[]): PyOpts {
  let python = '';
  let requirements = '';
  let upgrade = false;
  let venv = false;
  let interactive = false;
  const extras: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--python') { python = args[++i] ?? ''; continue; }
    if (a === '--requirements' || a === '-r') { requirements = args[++i] ?? ''; continue; }
    if (a === '--upgrade' || a === '-U') { upgrade = true; continue; }
    if (a === '--venv') { venv = true; continue; }
    if (a === '--interactive') { interactive = true; continue; }
    if (a.startsWith('--') || a.startsWith('-')) continue;
    extras.push(a);
  }
  const reqDir = requirements ? resolve(requirements) : join(process.cwd(), 'apps', 'ai-server');
  return { python, requirements, extras, upgrade, venv, venvDir: join(reqDir, '.venv'), interactive };
}

/** Find a requirements.txt under the cwd that belongs to the AI server. */
function findRequirementsFile(cwd: string): string {
  const candidates = [
    join(cwd, 'apps', 'ai-server', 'requirements.txt'),
    join(cwd, 'apps', 'server', 'requirements.txt'),
    join(cwd, 'requirements.txt'),
  ];
  return candidates.find((p) => existsSync(p)) ?? '';
}

async function resolvePython(explicit: string): Promise<string> {
  if (explicit) return existsSync(explicit) ? explicit : explicit;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const c of candidates) {
    if (await versionOf(c)) return c;
  }
  return '';
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (err) => {
      console.error(`\x1b[31m[pysetup]\x1b[0m failed to run ${cmd}: ${err.message}`);
      resolveRun(1);
    });
    child.on('close', (code) => resolveRun(code ?? 0));
  });
}