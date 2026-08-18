import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import {
  readFingerprint,
  syncConfig,
  type FileSyncReport,
  type SyncReport,
} from '../config-sync.js';

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * `nexus sync` - rewrite every derived artifact (Dockerfile, docker.* helpers,
 * bin/serve-all.mjs, apps/admin/package.json, the shared project-info DB) to
 * match the single `nexus.config.ts` source of truth.
 *
 * Returns the process exit code and always prints the resolved values so the
 * "one config prints everywhere" contract is visible.
 */
export async function syncCommand(args: string[] = []): Promise<number> {
  const root = process.cwd();
  const opts = {
    write: !args.includes('--check') && !args.includes('--dry-run'),
    db: !args.includes('--no-db'),
  };

  if (!opts.write) {
    process.stdout.write(`${DIM}  nexus sync - dry run (nothing written)${RESET}\n\n`);
  }

  const cfg = await loadConfigAuto({ root });
  const report = await syncConfig(root, cfg, opts);

  printReport(report, root);

  if (!opts.write) {
    process.stdout.write(`\n  ${YELLOW}Dry run - run \`nexus sync\` (no flag) to write the changes.${RESET}\n`);
  }

  const changed = report.files.some((f) => f.status === 'updated');
  if (changed) {
    process.stdout.write(`\n  ${GREEN}Synced. Run \`nexus dev\` to boot the stack on the new values.${RESET}\n`);
  } else {
    process.stdout.write(`\n  ${DIM}Everything is already in sync.${RESET}\n`);
  }

  return 0;
}

/** Print the per-value summary + per-file status table. */
function printReport(report: SyncReport, root: string): void {
  const v = report.values;

  process.stdout.write(`\n${BOLD}  *  Nexus config sync${RESET} ${DIM}${root}${RESET}\n\n`);

  process.stdout.write(`  ${CYAN}Value${RESET}${' '.repeat(12 - 5)}Config -> everywhere\n`);
  process.stdout.write(`  -----------------------------\n`);
  const rows: Array<[string, string]> = [
    ['backend', `${v.serverPort}`],
    ['frontend', `${v.frontendPort}`],
    ['admin', `${v.adminPort}`],
    ['node agent', `${v.nodePort}`],
    ['cluster LB', `${v.lbPort}`],
    ['AI server', `${v.aiPort}`],
    ['database', `${v.dbName}`],
  ];
  for (const [label, value] of rows) {
    const pad = label.padEnd(10);
    process.stdout.write(`  ${CYAN}${pad}${RESET} ${value}\n`);
  }

  process.stdout.write('\n');
  for (const f of report.files) {
    const status = statusLabel(f);
    process.stdout.write(`  ${f.file.padEnd(28)}${status}\n`);
    if (f.status === 'updated' && f.changes.length > 0) {
      for (const line of f.changes) {
        process.stdout.write(`    ${DIM}${line}${RESET}\n`);
      }
    }
  }

  process.stdout.write(`\n  ${BOLD}Database${RESET}  ${dbLabel(report.db)}\n`);

  if (readFingerprint(root)) {
    process.stdout.write(`  ${DIM}fingerprint ${report.fingerprint}${RESET}\n`);
  }
}

function statusLabel(f: FileSyncReport): string {
  switch (f.status) {
    case 'updated':
      return `${GREEN}updated${RESET}`;
    case 'in-sync':
      return `${DIM}in sync${RESET}`;
    case 'missing':
      return `${YELLOW}missing${RESET}`;
    default:
      return `${YELLOW}no match - review${RESET}`;
  }
}

function dbLabel(db: SyncReport['db']): string {
  switch (db) {
    case 'updated':
      return `${GREEN}project record upserted${RESET}`;
    case 'failed':
      return `${YELLOW}unreachable - skipped${RESET}`;
    default:
      return `${DIM}skipped${RESET}`;
  }
}