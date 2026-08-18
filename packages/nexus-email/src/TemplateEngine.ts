/**
 * Minimal template engine for emails: `{{name}}` interpolation, `{{#if cond}}…{{/if}}`
 * conditionals (with optional `{{else}}`), and `{{#each items}}…{{this}}…{{/each}}`
 * iteration over arrays. No external dependency (no Handlebars) — sufficient for
 * transactional email templates. Each transformation is applied in sequence
 * (each → if → interpolate); `#each` bodies are rendered recursively per item with
 * `this` merged into the vars.
 */
export class TemplateEngine {
  private readonly templates = new Map<string, string>();

  register(name: string, body: string): void {
    this.templates.set(name, body);
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  render(name: string, vars: Record<string, unknown> = {}): string {
    const body = this.templates.get(name);
    if (body == null) throw new Error(`[nexus-email] unknown template: ${name}`);
    return this.renderString(body, vars);
  }

  renderString(tpl: string, vars: Record<string, unknown>): string {
    return interpolate(expandIf(expandEach(tpl, vars), vars), vars);
  }
}

/** Expand `{{#each key}}…{{/each}}` by rendering the body recursively per item. */
function expandEach(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{#each\s+(\w+(?:\.\w+)*)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key: string, body: string) => {
    const arr = lookup(vars, key.trim());
    if (!Array.isArray(arr)) return '';
    return arr.map((item) => interpolate(expandIf(expandEach(body, { ...vars, this: item }), { ...vars, this: item }), { ...vars, this: item })).join('');
  });
}

/** Expand `{{#if cond}}…{{else}}…{{/if}}` (cond truthy; empty arrays are falsy). */
function expandIf(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_m, cond: string, then: string, els?: string) => {
    const val = lookup(vars, cond.trim());
    const truthy = Array.isArray(val) ? val.length > 0 : !!val;
    return truthy ? then : (els ?? '');
  });
}

/** Replace `{{key}}` (and `{{ a.b.c }}`) with values; unknown keys → ''. */
function interpolate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    const val = lookup(vars, expr.trim());
    return val == null ? '' : String(val);
  });
}

function lookup(vars: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, vars);
}