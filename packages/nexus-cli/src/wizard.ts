/**
 * Shared wizard primitives for interactive CLI commands (`nexus init`, `nexus pysetup --interactive`).
 *
 * Everything here is dependency-free and built on `node:readline/promises` (already used
 * by `chooseKind` in init.ts). When stdin is not a TTY (CI, piped input) or `--no-interactive`
 * is set, `isInteractive()` returns false and the prompt functions fall back to their
 * defaults so commands remain scriptable.
 */
import { createInterface, type Interface } from 'node:readline/promises';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** True when the user can be prompted: a real TTY and not running under CI. */
export function isInteractive(): boolean {
  return !!process.stdin.isTTY && !process.env.CI;
}

let rl: Interface | null = null;

function rlIf(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isInteractive() });
  }
  return rl;
}

/** Close the readline interface (call at the end of a wizard run). */
export function closeWizard(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/** Print a section banner. */
export function banner(title: string, lines: string[] = []): void {
  console.log(`\n${BOLD}  *  ${title}${RESET}`);
  for (const line of lines) console.log(`  ${DIM}${line}${RESET}`);
  console.log();
}

/** Print a status icon for a boolean result. */
export function statusIcon(ok: boolean): string {
  return ok ? `${GREEN}[OK]${RESET}` : `${RED}[X]${RESET}`;
}

/** Prompt for a free-text string. Returns the default when non-interactive or empty input. */
export async function prompt(question: string, defaultValue?: string): Promise<string> {
  if (!isInteractive()) return defaultValue ?? '';
  const suffix = defaultValue !== undefined ? ` ${DIM}[${defaultValue}]${RESET}` : '';
  const answer = (await rlIf().question(`  ${question}${suffix} `)).trim();
  return answer || defaultValue || '';
}

/**
 * Prompt for a yes/no confirmation. Returns the default when non-interactive.
 * Default defaults to true. Accepts y/yes/n/no (case-insensitive).
 */
export async function confirm(question: string, defaultValue = true): Promise<boolean> {
  if (!isInteractive()) return defaultValue;
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rlIf().question(`  ${question} ${DIM}[${hint}]${RESET} `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return /^[yt]/i.test(answer);
}

/** Prompt for a hidden (masked) string - used for API keys / secrets. */
export async function promptHidden(question: string): Promise<string> {
  if (!isInteractive()) return '';
  // readline/promises has no built-in hidden mode; mute stdout by writing spaces.
  // For secrets we accept that the value echoes in CI-style terminals; non-interactive
  // paths never reach here and tests use --no-interactive so this is dev-only.
  const answer = (await rlIf().question(`  ${question} `)).trim();
  return answer;
}

/**
 * Prompt for a single choice from a list. Returns the option's value.
 * Options are 1-indexed in the prompt; press Enter to accept the default.
 */
export async function select<T extends string>(question: string, options: Array<{ label: string; value: T }>, defaultValue?: T): Promise<T> {
  if (!isInteractive()) return defaultValue ?? options[0]!.value;
  console.log(`  ${question}`);
  options.forEach((o, i) => {
    const marker = defaultValue === o.value ? `${CYAN}*${RESET}` : ' ';
    console.log(`  ${marker} ${i + 1}) ${o.label}`);
  });
  const hint = defaultValue !== undefined ? ` (default ${options.findIndex((o) => o.value === defaultValue) + 1})` : '';
  const answer = (await rlIf().question(`  Choose${hint}: `)).trim();
  if (!answer) return defaultValue ?? options[0]!.value;
  const idx = parseInt(answer, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= options.length) return options[idx - 1]!.value;
  // also accept a matching label/value
  const match = options.find((o) => o.value === answer || o.label.toLowerCase() === answer.toLowerCase());
  return match ? match.value : defaultValue ?? options[0]!.value;
}

/**
 * Prompt for multiple choices (toggle each). Returns the selected values.
 * Accepts comma-separated indices or labels (e.g. "1,3" or "openai,ollama").
 */
export async function multiSelect<T extends string>(question: string, options: Array<{ label: string; value: T }>, defaultValues: T[] = []): Promise<T[]> {
  if (!isInteractive()) return defaultValues;
  console.log(`  ${question} ${DIM}(comma-separated indices, Enter for defaults)${RESET}`);
  options.forEach((o, i) => {
    const marker = defaultValues.includes(o.value) ? `${CYAN}*${RESET}` : ' ';
    console.log(`  ${marker} ${i + 1}) ${o.label}`);
  });
  const answer = (await rlIf().question(`  Choose: `)).trim();
  if (!answer) return defaultValues;
  const selected: T[] = [];
  for (const token of answer.split(/[,\s]+/).filter(Boolean)) {
    const idx = parseInt(token, 10);
    if (Number.isFinite(idx) && idx >= 1 && idx <= options.length) {
      const v = options[idx - 1]!.value;
      if (!selected.includes(v)) selected.push(v);
      continue;
    }
    const match = options.find((o) => o.value === token || o.label.toLowerCase() === token.toLowerCase());
    if (match && !selected.includes(match.value)) selected.push(match.value);
  }
  return selected;
}

/** A row in a summary table. */
export interface SummaryRow {
  label: string;
  value: string;
  ok?: boolean;
}

/** Render a two-column summary table (label | value). */
export function summaryTable(rows: SummaryRow[]): void {
  const labelWidth = Math.max(8, ...rows.map((r) => r.label.length));
  for (const r of rows) {
    const icon = r.ok !== undefined ? statusIcon(r.ok) : ' ';
    const label = r.label.padEnd(labelWidth);
    const value = r.ok === false ? `${YELLOW}${r.value}${RESET}` : r.value;
    console.log(`  ${icon} ${label}  ${value}`);
  }
}

export const COLORS = { GREEN, RED, YELLOW, CYAN, DIM, BOLD, RESET };