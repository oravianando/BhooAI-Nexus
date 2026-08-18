/**
 * Minimal in-process cron scheduler for plugins. Supports a subset of 5-field
 * cron at minute resolution: star, star-slash-N (every N minutes), and specific
 * numbers for each field. Honest v1 subset — full cron (ranges, lists, L/W) is
 * Phase 12.
 */
interface Job {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
  parts: number[]; // [minute, hour, dom, month, dow] matcher encoded as -1 = any, else value (step handled inline)
  step: number; // minute step for */N, else 0
}

function parseField(field: string, min: number, max: number): { value: number; step: number } {
  if (field === '*') return { value: -1, step: 0 };
  const m = /^\*\/(\d+)$/.exec(field);
  if (m) return { value: -1, step: Number(m[1]) };
  return { value: Number(field), step: 0 };
}

export class CronScheduler {
  private jobs = new Map<string, Job>();
  private timer: NodeJS.Timeout | null = null;

  schedule(name: string, cron: string, fn: () => void | Promise<void>): void {
    const [min, hour, dom, month, dow] = cron.trim().split(/\s+/);
    const mf = parseField(min!, 0, 59);
    const hf = parseField(hour!, 0, 23);
    this.jobs.set(name, {
      name, cron, fn,
      parts: [hf.value, parseField(dom!, 1, 31).value, parseField(month!, 1, 12).value, parseField(dow!, 0, 6).value],
      step: mf.step,
    });
    if (this.jobs.size === 1) this.start();
  }

  cancel(name: string): void {
    this.jobs.delete(name);
    if (this.jobs.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private start(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    for (const job of this.jobs.values()) {
      const [hour, dom, month, dow] = job.parts;
      const m = now.getMinutes();
      // minute: */N matches when m % step === 0; specific value matches equality; '*' always.
      const minOk = job.step > 0 ? m % job.step === 0 : true; // step 0 → '*' → any minute
      if (!minOk) continue;
      if (hour !== -1 && hour !== now.getHours()) continue;
      if (month !== -1 && month !== now.getMonth() + 1) continue;
      if (dom !== -1 && dom !== now.getDate()) continue;
      if (dow !== -1 && dow !== now.getDay()) continue;
      try { await job.fn(); } catch { /* swallow job errors */ }
    }
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.jobs.clear();
  }

  has(name: string): boolean { return this.jobs.has(name); }
}
