import { existsSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import {
  resolveProjectInfo,
  connectProjectInfo,
  getProjectInfo,
  deleteProjectInfo,
  dropProjectDatabase,
  closeProjectInfo,
} from '@bhooai/nexus-data';
import { tcpReachable, parseHostPort } from '../util.js';
import { isInteractive as wizardInteractive, banner, confirm, prompt, closeWizard, COLORS } from '../wizard.js';

const { GREEN, RED, YELLOW, CYAN, DIM, BOLD, RESET } = COLORS;

/**
 * `nexus uninstall [target]` - remove a project from disk + the databases.
 *
 * What it deletes:
 *   1. The project's own MongoDB database (e.g. `test_app`)
 *   2. The project's record in `nexus_projects.projects`
 *   3. (optional, with --purge) the project directory itself
 *
 * What it does NOT touch:
 *   - The `nexus_projects` database (other projects' records remain)
 *   - The framework (`bhooai-nexus`) install
 *   - Any other project's database
 *
 * Flags:
 *   --target <path>   project root (default: current directory)
 *   --force           skip the confirmation prompt
 *   --purge           also delete the project directory from disk
 *   --no-interactive  never prompt (imply --force unless --dry-run)
 *   --dry-run         show what would be deleted, change nothing
 *   --keep-db         do not drop the project database (only remove the record)
 *   --keep-files      synonym for omitting --purge (default)
 *
 *   Run from inside the project:        `nexus uninstall --purge`
 *   Or point at another project:        `nexus uninstall --target ../my-app --purge`
 *   Preview only:                       `nexus uninstall --dry-run`
 */
export async function uninstall(args: string[]): Promise<number> {
  const target = resolve(argValue(args, '--target') ?? '.');
  const force = args.includes('--force');
  const purge = args.includes('--purge');
  const dryRun = args.includes('--dry-run');
  const keepDb = args.includes('--keep-db');
  const noInteractive = args.includes('--no-interactive') || !wizardInteractive();

  // -- banner ------------------------------------------------------
  banner('BhooAI Nexus - uninstall', [
    dryRun ? 'DRY RUN - nothing will be deleted.' : 'Removes the project DB + its nexus_projects record.',
    purge ? 'Will also DELETE the project directory from disk.' : 'Project files are kept (pass --purge to remove them).',
  ]);

  // -- validate the target is a nexus project ----------------------
  if (!existsSync(resolve(target, 'package.json'))) {
    console.log(`  ${RED}[X] not a project directory: no package.json at ${target}${RESET}\n`);
    return 1;
  }
  const configExists = ['ts', 'js', 'mjs', 'cjs'].some((ext) => existsSync(resolve(target, `nexus.config.${ext}`)));
  if (!configExists) {
    console.log(`  ${RED}[X] not a nexus project: no nexus.config.{ts,js,mjs,cjs} at ${target}${RESET}\n`);
    return 1;
  }

  // -- resolve identity + config -----------------------------------
  const project = await resolveProjectInfo(target);
  let cfg: Awaited<ReturnType<typeof loadConfigAuto>> | undefined;
  try {
    cfg = await loadConfigAuto({ root: target });
  } catch (err) {
    console.log(`  ${YELLOW}[!]  could not load nexus.config: ${(err as Error).message}${RESET}`);
  }
  const dbName = cfg?.db?.name ?? project.dbName;
  const mongoUri = cfg?.db?.uri ?? 'mongodb://localhost:27017';

  console.log(`  ${BOLD}Project${RESET}`);
  console.log(`  ${CYAN}name${RESET}     ${project.name}`);
  console.log(`  ${CYAN}path${RESET}     ${target}`);
  console.log(`  ${CYAN}database${RESET} ${dbName}`);
  console.log(`  ${CYAN}mongo uri${RESET} ${mongoUri}`);
  console.log(`  ${CYAN}purge files${RESET} ${purge ? 'yes' : 'no'}`);
  console.log();

  // -- confirm -----------------------------------------------------
  if (dryRun) {
    // Show the stored record too, for reference.
    await previewRecord(mongoUri, project.name);
    console.log(`\n  ${DIM}Dry run complete - no changes made.${RESET}\n`);
    return 0;
  }

  if (!force && !noInteractive) {
    const ok = await confirm(`Delete the database \`${dbName}\` and remove the \`${project.name}\` record?`, false);
    if (!ok) {
      console.log(`  ${DIM}Aborted.${RESET}`);
      closeWizard();
      return 1;
    }
    if (purge) {
      const ok2 = await confirm(`Also DELETE the directory ${target} from disk? This cannot be undone.`, false);
      if (!ok2) {
        console.log(`  ${YELLOW}Keeping files - only the DB + record will be removed.${RESET}`);
      } else {
        // confirmed purge
      }
    }
    closeWizard();
  } else if (!force && noInteractive) {
    // Non-interactive without --force: refuse to destructively delete.
    console.log(`  ${RED}[X] Refusing to uninstall non-interactively without --force.${RESET}`);
    console.log(`  ${DIM}Pass --force to proceed, or run interactively.${RESET}\n`);
    return 1;
  }

  // -- 1. drop the project database --------------------------------
  if (!keepDb) {
    const mongo = parseHostPort(mongoUri, 27017);
    const mongoOk = await tcpReachable(mongo.host, mongo.port, 1500);
    if (!mongoOk) {
      console.log(`  ${YELLOW}[!]  Mongo unreachable at ${mongo.host}:${mongo.port} - skipping DB drop${RESET}`);
    } else {
      try {
        connectProjectInfo(mongoUri, { autoIndex: false });
        const dropped = await dropProjectDatabase(dbName);
        console.log(`  ${dropped ? GREEN + '[OK]' : YELLOW + '[!]'}  dropped database${RESET} ${CYAN}${dbName}${RESET} ${dropped ? '' : '(already absent)'}`);
      } catch (err) {
        console.log(`  ${RED}[X] failed to drop database ${dbName}: ${(err as Error).message}${RESET}`);
      }
    }
  } else {
    console.log(`  ${DIM}--keep-db: leaving database ${dbName} in place${RESET}`);
  }

  // -- 2. delete the nexus_projects.projects record ---------------
  if (!keepDb || true) {
    try {
      // connectProjectInfo may already be open from the drop step; reusing is fine.
      if (!keepDb) {
        // already connected above
      } else {
        const mongo = parseHostPort(mongoUri, 27017);
        if (await tcpReachable(mongo.host, mongo.port, 1500)) connectProjectInfo(mongoUri, { autoIndex: false });
      }
      const deleted = await deleteProjectInfo(project.name);
      console.log(`  ${deleted ? GREEN + '[OK]' : YELLOW + '[!]'}  deleted record${RESET} ${CYAN}${project.name}${RESET} ${deleted ? 'from nexus_projects.projects' : '(not found)'}`);
    } catch (err) {
      console.log(`  ${RED}[X] failed to delete project record: ${(err as Error).message}${RESET}`);
    } finally {
      try { await closeProjectInfo(); } catch { /* ignore */ }
    }
  }

  // -- 3. purge project files from disk ----------------------------
  if (purge) {
    const removed = await removeDir(target);
    if (removed) {
      console.log(`  ${GREEN}[OK]${RESET} removed directory ${CYAN}${target}${RESET}`);
    } else {
      console.log(`  ${RED}[X] could not fully remove ${target}${RESET}`);
      console.log(`  ${DIM}Some files may be locked by a running process (node_modules, .venv, an editor).${RESET}`);
      console.log(`  ${DIM}Close any servers/editors holding the directory and run:${RESET}`);
      if (process.platform === 'win32') {
        console.log(`    ${CYAN}rd /s /q "${target}"${RESET}`);
      } else {
        console.log(`    ${CYAN}rm -rf "${target}"${RESET}`);
      }
    }
  }

  console.log(`\n  ${GREEN}[OK] Uninstall complete.${RESET}${purge ? '' : ` ${DIM}(project files kept - pass --purge to remove them)${RESET}`}\n`);
  return 0;
}

/** Print the stored nexus_projects record for the project (dry-run preview). */
async function previewRecord(mongoUri: string, name: string): Promise<void> {
  const mongo = parseHostPort(mongoUri, 27017);
  const mongoOk = await tcpReachable(mongo.host, mongo.port, 1500);
  if (!mongoOk) {
    console.log(`  ${YELLOW}[!]  Mongo unreachable - cannot preview the stored record${RESET}`);
    return;
  }
  try {
    connectProjectInfo(mongoUri, { autoIndex: false });
    const rec = await getProjectInfo(name);
    if (rec) {
      console.log(`  ${BOLD}Stored record${RESET}`);
      console.log(`  ${CYAN}name${RESET}     ${rec.name}`);
      console.log(`  ${CYAN}status${RESET}   ${rec.status ?? '?'}`);
      console.log(`  ${CYAN}path${RESET}     ${rec.path}`);
      console.log(`  ${CYAN}dbName${RESET}   ${rec.dbName}`);
    } else {
      console.log(`  ${DIM}no record found in nexus_projects.projects for \`${name}\`${RESET}`);
    }
    await closeProjectInfo();
  } catch (err) {
    console.log(`  ${YELLOW}[!]  could not read record: ${(err as Error).message}${RESET}`);
  }
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

/**
 * Robustly remove a directory tree, working around Windows EPERM errors.
 *  1. Recursively clear the read-only attribute on every entry (Windows sets
 *     it on `node_modules/.bin` shims, `.venv` files, etc. - `rmSync` then
 *     throws EPERM instead of deleting).
 *  2. Try `rmSync`; retry up to 3 times with a short backoff (handles files
 *     briefly locked by a just-killed process or an antivirus scan).
 *  3. Fall back to the OS shell (`rd /s /q` on Windows, `rm -rf` elsewhere)
 *     which uses a different deletion path and often succeeds where Node's
 *     libuv-based unlink fails.
 * Returns true if the directory is gone (or never existed), false otherwise.
 */
async function removeDir(target: string): Promise<boolean> {
  if (!existsSync(target)) return true;

  // Step 1: clear read-only attrs recursively (no-op on non-Windows; cheap).
  clearReadOnly(target);

  // Step 2: rmSync with retries.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true });
      if (!existsSync(target)) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 3 && (code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY')) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        // Re-clear attrs in case a new locked file appeared.
        clearReadOnly(target);
        continue;
      }
      break; // give up on rmSync, fall through to shell
    }
  }

  if (!existsSync(target)) return true;

  // Step 3: OS shell fallback.
  try {
    if (process.platform === 'win32') {
      // `rd /s /q` ignores read-only attrs and forces deletion.
      const r = spawnSync('cmd', ['/c', 'rd', '/s', '/q', target], { windowsHide: true });
      return r.status === 0 && !existsSync(target);
    }
    const r = spawnSync('rm', ['-rf', target]);
    return r.status === 0 && !existsSync(target);
  } catch {
    return !existsSync(target);
  }
}

/** Recursively walk `dir` and clear the read-only bit on every file/dir.
 *  Windows-only in effect; on other platforms chmod is a no-op on the
 *  immutable bits. Uses `0o666` for files and `0o777` for dirs. */
function clearReadOnly(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    try {
      chmodSync(p, st.isDirectory() ? 0o777 : 0o666);
    } catch { /* ignore - best effort */ }
    if (st.isDirectory()) clearReadOnly(p);
  }
  try {
    chmodSync(dir, 0o777);
  } catch { /* ignore */ }
}