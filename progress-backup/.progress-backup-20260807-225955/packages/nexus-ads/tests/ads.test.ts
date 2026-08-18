import { describe, it, expect } from 'vitest';
import { GaqlBuilder, GoogleAdsClient, createGoogleAds, campaignsQuery, campaignMetricsQuery, type HttpTransport, type HttpRequest, type HttpResponse } from '../src/index.js';

describe('GaqlBuilder', () => {
  it('builds a SELECT/FROM/WHERE/ORDER/LIMIT query', () => {
    const q = new GaqlBuilder().select('campaign.id', 'campaign.name').from('campaign').where("campaign.status = 'ENABLED'").orderBy('campaign.id', 'DESC').limit(10).build();
    expect(q).toBe("SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED' ORDER BY campaign.id DESC LIMIT 10");
  });
  it('joins multiple WHERE with AND', () => {
    const q = new GaqlBuilder().select('campaign.id').from('campaign').where('a = 1').where('b = 2').build();
    expect(q).toBe('SELECT campaign.id FROM campaign WHERE a = 1 AND b = 2');
  });
  it('requires FROM and at least one field', () => {
    expect(() => new GaqlBuilder().select('x').build()).toThrow(/FROM/);
    expect(() => new GaqlBuilder().from('campaign').build()).toThrow(/field/);
  });
  it('campaignsQuery convenience builds the standard query', () => {
    expect(campaignsQuery(5)).toBe('SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id ASC LIMIT 5');
  });
  it('campaignMetricsQuery includes date range + metrics', () => {
    const q = campaignMetricsQuery('2024-01-01', '2024-01-31', 10);
    expect(q).toContain("segments.date >= '2024-01-01'");
    expect(q).toContain("segments.date <= '2024-01-31'");
    expect(q).toContain('metrics.clicks');
  });
});

function mockTransport(routes: { match: string; respond: (req: HttpRequest) => HttpResponse }[]): HttpTransport {
  return async (req) => {
    for (const r of routes) if (req.url.includes(r.match)) return r.respond(req);
    return { status: 404, body: JSON.stringify({ error: `no mock for ${req.url}` }) };
  };
}

const cfg = {
  enabled: true,
  developerToken: 'dev-token',
  clientId: 'cid',
  clientSecret: 'csec',
  refreshToken: 'rtok',
  customerId: '123-456-7890',
};

describe('GoogleAdsClient', () => {
  it('throws if required creds are missing', () => {
    expect(() => new GoogleAdsClient({ ...cfg, developerToken: '' } as any, mockTransport([]))).toThrow(/developerToken/);
  });

  it('acquires an OAuth2 token (cached) and calls googleAds:search', async () => {
    let tokenCalls = 0;
    const t = mockTransport([
      { match: 'oauth2.googleapis.com/token', respond: (req) => { tokenCalls++; void req; return { status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }; } },
      { match: 'googleAds:search', respond: (req) => ({ status: 200, body: JSON.stringify({ results: [{ campaign: { id: '1', name: 'Camp A', status: 'ENABLED', advertisingChannelType: 'SEARCH' } }] }) }) },
    ]);
    const client = new GoogleAdsClient(cfg as any, t);
    const rows = await client.search('1234567890', 'SELECT campaign.id FROM campaign LIMIT 1');
    expect(tokenCalls).toBe(1);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.campaign as any).name).toBe('Camp A');
    // second call reuses the cached token
    await client.search('1234567890', 'SELECT campaign.id FROM campaign LIMIT 1');
    expect(tokenCalls).toBe(1);
  });

  it('listCampaigns maps rows to Campaign objects', async () => {
    const t = mockTransport([
      { match: 'oauth2.googleapis.com/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: 'googleAds:search', respond: (req) => {
        const body = JSON.parse(req.body as string);
        expect(body.query).toContain('FROM campaign');
        return { status: 200, body: JSON.stringify({ results: [{ campaign: { id: '1', name: 'A', status: 'ENABLED' } }, { campaign: { id: '2', name: 'B', status: 'PAUSED' } }] }) };
      } },
    ]);
    const client = new GoogleAdsClient(cfg as any, t);
    const camps = await client.listCampaigns();
    expect(camps).toHaveLength(2);
    expect(camps[0]!.name).toBe('A');
    expect(camps[1]!.id).toBe('2');
  });

  it('normalizes customer ids (strips hyphens) and sends developer-token header', async () => {
    let sentHeaders: Record<string, string> = {};
    let sentUrl = '';
    const t = mockTransport([
      { match: 'oauth2.googleapis.com/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: 'googleAds:search', respond: (req) => { sentHeaders = req.headers ?? {}; sentUrl = req.url; return { status: 200, body: JSON.stringify({ results: [] }) }; } },
    ]);
    const client = new GoogleAdsClient({ ...cfg, loginCustomerId: '11-22-33' } as any, t);
    await client.search('1-2-3', 'SELECT campaign.id FROM campaign');
    expect(sentUrl).toContain('/customers/123/googleAds:search');
    expect(sentHeaders['developer-token']).toBe('dev-token');
    expect(sentHeaders['login-customer-id']).toBe('112233');
    expect(sentHeaders.authorization).toBe('Bearer tok');
  });

  it('propagates search errors', async () => {
    const t = mockTransport([
      { match: 'oauth2.googleapis.com/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: 'googleAds:search', respond: () => ({ status: 400, body: JSON.stringify({ error: { message: 'bad query' } }) }) },
    ]);
    const client = new GoogleAdsClient(cfg as any, t);
    await expect(client.search('123', 'bad')).rejects.toThrow(/search failed/);
  });

  it('handles pagination via nextPageToken', async () => {
    let call = 0;
    const t = mockTransport([
      { match: 'oauth2.googleapis.com/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: 'googleAds:search', respond: () => {
        call++;
        if (call === 1) return { status: 200, body: JSON.stringify({ results: [{ campaign: { id: '1' } }], nextPageToken: 'tok2' }) };
        return { status: 200, body: JSON.stringify({ results: [{ campaign: { id: '2' } }] }) };
      } },
    ]);
    const client = new GoogleAdsClient(cfg as any, t);
    const rows = await client.search('123', 'SELECT campaign.id FROM campaign');
    expect(call).toBe(2);
    expect(rows).toHaveLength(2);
  });
});

describe('createGoogleAds factory', () => {
  it('builds a client with the default transport', () => {
    const client = createGoogleAds(cfg as any);
    expect(client).toBeInstanceOf(GoogleAdsClient);
  });
});