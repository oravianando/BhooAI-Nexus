/**
 * Minimal inbuilt metrics registry: counters and histograms with labels.
 * Exposes a JSON snapshot for an admin `/metrics` endpoint and a Prometheus
 * text format for scraper compatibility.
 */
interface CounterState {
  help: string;
  values: Map<string, number>;
}
interface HistogramState {
  help: string;
  buckets: number[];
  counts: Map<string, number[]>; // per-label bucket counts
  sums: Map<string, number>;
  totals: Map<string, number>;
}

export class MetricsRegistry {
  private counters = new Map<string, CounterState>();
  private histograms = new Map<string, HistogramState>();

  counter(name: string, help = ''): CounterState {
    let c = this.counters.get(name);
    if (!c) {
      c = { help, values: new Map() };
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, buckets: number[] = [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10], help = ''): HistogramState {
    let h = this.histograms.get(name);
    if (!h) {
      h = { help, buckets, counts: new Map(), sums: new Map(), totals: new Map() };
      this.histograms.set(name, h);
    }
    return h;
  }

  inc(name: string, value = 1, labels: Record<string, string> = {}): void {
    const key = labelKey(labels);
    const c = this.counter(name);
    c.values.set(key, (c.values.get(key) ?? 0) + value);
  }

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(labels);
    const h = this.histogram(name);
    let counts = h.counts.get(key);
    if (!counts) {
      counts = new Array(h.buckets.length).fill(0);
      h.counts.set(key, counts);
    }
    for (let i = 0; i < h.buckets.length; i++) if (value <= h.buckets[i]!) counts[i]!++;
    h.sums.set(key, (h.sums.get(key) ?? 0) + value);
    h.totals.set(key, (h.totals.get(key) ?? 0) + 1);
  }

  /** JSON snapshot for an admin endpoint. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, c] of this.counters) {
      out[name] = { type: 'counter', help: c.help, values: Object.fromEntries(c.values) };
    }
    for (const [name, h] of this.histograms) {
      out[name] = {
        type: 'histogram',
        help: h.help,
        buckets: h.buckets,
        counts: Object.fromEntries(h.counts),
        sums: Object.fromEntries(h.sums),
        totals: Object.fromEntries(h.totals),
      };
    }
    return out;
  }

  /** Prometheus text exposition format. */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [name, c] of this.counters) {
      if (c.help) lines.push(`# HELP ${name} ${c.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, val] of c.values) lines.push(`${name}${labels} ${val}`);
    }
    for (const [name, h] of this.histograms) {
      if (h.help) lines.push(`# HELP ${name} ${h.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labels, counts] of h.counts) {
        let cumulative = 0;
        for (let i = 0; i < h.buckets.length; i++) {
          cumulative += counts[i]!;
          const le = h.buckets[i]!;
          lines.push(`${name}_bucket${withLabel(labels, 'le', String(le))} ${cumulative}`);
        }
        lines.push(`${name}_bucket${withLabel(labels, 'le', '+Inf')} ${h.totals.get(labels) ?? 0}`);
        lines.push(`${name}_sum${labels} ${h.sums.get(labels) ?? 0}`);
        lines.push(`${name}_count${labels} ${h.totals.get(labels) ?? 0}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

function labelKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(',')}}`;
}

function withLabel(existing: string, name: string, value: string): string {
  if (!existing) return `{${name}="${escapeLabel(value)}"}`;
  return existing.slice(0, -1) + `,${name}="${escapeLabel(value)}"}`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}