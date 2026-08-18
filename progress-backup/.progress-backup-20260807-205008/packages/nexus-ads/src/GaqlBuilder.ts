/**
 * GAQL (Google Ads Query Language) builder. Produces queries like:
 *   SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED' ORDER BY campaign.id LIMIT 50
 */
export class GaqlBuilder {
  private fields: string[] = [];
  private resource: string = '';
  private conditions: string[] = [];
  private order?: { field: string; dir: 'ASC' | 'DESC' };
  private limitN?: number;

  select(...fields: string[]): this {
    this.fields.push(...fields);
    return this;
  }
  from(resource: string): this {
    this.resource = resource;
    return this;
  }
  /** Add a condition, e.g. `where("campaign.status = 'ENABLED'")`. */
  where(condition: string): this {
    this.conditions.push(condition);
    return this;
  }
  orderBy(field: string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this.order = { field, dir };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  build(): string {
    if (!this.resource) throw new Error('[nexus-ads] GaqlBuilder: FROM resource required');
    if (this.fields.length === 0) throw new Error('[nexus-ads] GaqlBuilder: at least one field required');
    let q = `SELECT ${this.fields.join(', ')} FROM ${this.resource}`;
    if (this.conditions.length) q += ` WHERE ${this.conditions.join(' AND ')}`;
    if (this.order) q += ` ORDER BY ${this.order.field} ${this.order.dir}`;
    if (this.limitN != null) q += ` LIMIT ${this.limitN}`;
    return q;
  }
}

/** Convenience: standard campaign listing query. */
export function campaignsQuery(limit = 50): string {
  return new GaqlBuilder()
    .select('campaign.id', 'campaign.name', 'campaign.status', 'campaign.advertising_channel_type')
    .from('campaign')
    .orderBy('campaign.id')
    .limit(limit)
    .build();
}

/** Convenience: campaign performance metrics for a date range (YYYY-MM-DD). */
export function campaignMetricsQuery(fromDate: string, toDate: string, limit = 50): string {
  return new GaqlBuilder()
    .select(
      'campaign.id',
      'campaign.name',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
    )
    .from('campaign')
    .where(`segments.date >= '${fromDate}'`)
    .where(`segments.date <= '${toDate}'`)
    .orderBy('campaign.id')
    .limit(limit)
    .build();
}