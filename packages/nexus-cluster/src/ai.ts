import { AiClient } from '@bhooai/nexus-ai-client';
import type { AiAdvisor, AutoscaleInput, DeterministicDecision } from './autoscaler.js';

export interface AiAdvisorOptions {
  serverUrl: string;
  timeoutMs?: number;
  model?: string;
}

/**
 * AiAdvisor-over-HTTP — the "AI manages it automatically" layer. Sends the
 * observed cluster metrics to the BhooAI Nexus AI server and asks for a bounded
 * scale action. If the AI errors or answers with anything other than a
 * scale-up/down/hold (or is off-rail), the caller's deterministic guardrails
 * remain authoritative.
 */
export class HttpAiAdvisor implements AiAdvisor {
  private client: AiClient;
  private model: string;

  constructor(opts: AiAdvisorOptions) {
    this.client = new AiClient({ serverUrl: opts.serverUrl, timeoutMs: opts.timeoutMs, maxRetries: 0 });
    this.model = opts.model ?? 'gpt-4o-mini';
  }

  async decide(input: AutoscaleInput): Promise<DeterministicDecision | null> {
    const prompt = `You are the autoscaler for a BhooAI Nexus container mesh. Decide ONE action.

Constraints (never violate these):
- never suggest more than ${input.maxNodes} backend nodes
- never suggest fewer than ${input.minNodes} backend nodes

Current state:
- mode: ${input.mode}
- backend nodes: ${input.currentBackendNodes}
- total RPS: ${input.totalRps}
- RPS per node: ${input.perNodeRps.toFixed(1)}
- average CPU%: ${input.cpu !== null ? input.cpu.toFixed(1) : 'unknown'}
- scale-up if RPS/node is consistently > 15 or CPU > 80%
- scale-down if RPS/node is < 5

Reply with EXACTLY one line, nothing else, one of:
scale-up|scale-down|hold

Example: scale-up`;

    const res = await this.client.chat({ model: this.model, messages: [{ role: 'user', content: prompt }], stream: false });
    const text = res.choices?.[0]?.message?.content ?? '';
    const match = /(scale-up|scale-down|hold)/.exec(text);
    if (!match) return null;
    const action = match[1] as DeterministicDecision['action'];
    const reason = `ai advised ${action}`;
    if (action === 'hold') return { action, reason };
    // Rail check happens in the autoscaler; return the raw proposal.
    return { action, reason };
  }
}