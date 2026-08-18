import type { AdminPageSpec, SlotSpec } from '../host.js';

/**
 * AdminExtensions: a registry the host fills as plugins register admin pages and
 * slots. The admin app reads this (via the supervisor/control API or a direct
 * endpoint) to render nav entries, pages, and dashboard widgets contributed by
 * plugins. Pages are grouped by `group` and ordered within their group; slots are
 * ordered within their slot name.
 */
export class AdminExtensions {
  private pages = new Map<string, AdminPageSpec & { plugin: string }>();
  private slots = new Map<string, Array<SlotSpec & { plugin: string }>>();

  registerPage(plugin: string, page: AdminPageSpec): void {
    this.pages.set(page.path, { ...page, plugin });
  }

  registerSlot(plugin: string, slot: SlotSpec): void {
    const arr = this.slots.get(slot.slot) ?? [];
    arr.push({ ...slot, plugin });
    arr.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    this.slots.set(slot.slot, arr);
  }

  removePlugin(plugin: string): void {
    for (const [path, p] of this.pages) if (p.plugin === plugin) this.pages.delete(path);
    for (const [slot, arr] of this.slots) this.slots.set(slot, arr.filter((s) => s.plugin !== plugin));
  }

  listPages(): Array<AdminPageSpec & { plugin: string }> {
    return [...this.pages.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** Pages grouped by their `group` (for nav rendering), preserving order. */
  groupedPages(): Record<string, Array<AdminPageSpec & { plugin: string }>> {
    const groups: Record<string, Array<AdminPageSpec & { plugin: string }>> = {};
    for (const p of this.listPages()) {
      const g = p.group ?? 'Plugins';
      (groups[g] ??= []).push(p);
    }
    return groups;
  }

  listSlots(slot: string): Array<SlotSpec & { plugin: string }> {
    return this.slots.get(slot) ?? [];
  }

  toJSON(): { pages: Array<AdminPageSpec & { plugin: string }>; slots: Record<string, Array<SlotSpec & { plugin: string }>> } {
    const slotsObj: Record<string, Array<SlotSpec & { plugin: string }>> = {};
    for (const [slot, arr] of this.slots) slotsObj[slot] = arr;
    return { pages: this.listPages(), slots: slotsObj };
  }
}