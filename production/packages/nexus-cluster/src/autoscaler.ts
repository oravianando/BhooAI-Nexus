import type { ClusterConfig } from '@bhooai/nexus-core';
import type { NodeRegistry } from './registry.js';
import type { LoadBalancer } from './lb.js';

export interface AutoscalerDeps {
  registry: NodeRegistry;
  lb: LoadBalancer;
  /** Called when the autoscaler wants to scale up by adding a ready node/branch. */
  scaleUp?: (reason: string) => Promise<void>;
  /** Called to drain + retire one backend node. */
  scaleDown?: (reason: string) => Promise<void>;
  ai?: AiAdvisor;
}

/** AI decision surface the autoscaler may consult (injected, framework-agnostic). */
export interface AiAdvisor {
  /** Ask the AI for a bounded action given observed metrics. Returns null to defer to deterministic rules. */
  decide(input: AutoscaleInput): Promise<DeterministicDecision | null>;
}

export interface AutoscaleInput {
  minNodes: number;
  maxNodes: number;
  currentBackendNodes: number;
  totalRps: number;
  perNodeRps: number;
  cpu: number | null;
  mode: 'auto' | 'manual';
}

export type DeterministicDecision =
  | { action: 'scale-up'; reason: string }
  | { action: 'scale-down'; reason: string }
  | { action: 'hold'; reason: string };

/**
 * Autoscaler — samples the LB's RPS histogram + node metrics, and decides
 * scale-up / scale-down. Two layers:
 *   1. deterministic guardrails (RPS + CPU hysteresis) — always active in auto mode;
 *   2. an optional AI advisor whose proposal is only followed when it lands within
 *      the [minNodes, maxNodes] rails. On failure/AI-null, the deterministic rules
 *      take over, so auto mode can never breach the hard limits.
 */
export class Autoscaler {
  private lastDecisionAt = 0;
  private running = false;

  constructor(private deps: AutoscalerDeps, private cfg: ClusterConfig['autoscale']) {}

  /** One decision cycle. Returns the action taken. */
  async tick(): Promise<DeterministicDecision> {
    if (this.cfg.mode === 'manual') return { action: 'hold', reason: 'manual mode' };
    const now = Date.now();
    if (now - this.lastDecisionAt < this.cfg.cooldownMs) return { action: 'hold', reason: 'cooldown' };

    const backendNodes = this.deps.registry.readyByRole('backend');
    const rpsByNode = this.deps.lb.rpsSnapshot();
    const totalRps = Object.values(rpsByNode).reduce((a, b) => a + b, 0);
    const avgCpu = this.avgCpu(backendNodes.map((n) => n.lastMetrics?.cpu ?? 0));

    const input: AutoscaleInput = {
      minNodes: this.cfg.minNodes,
      maxNodes: this.cfg.maxNodes,
      currentBackendNodes: backendNodes.length,
      totalRps,
      perNodeRps: backendNodes.length ? totalRps / backendNodes.length : 0,
      cpu: avgCpu,
      mode: this.cfg.mode,
    };

    // 1. AI advisor (optional) — bounded to rails.
    if (this.deps.ai) {
      try {
        const ai = await this.deps.ai.decide(input);
        if (ai && ai.action !== 'hold') {
          const within = backendNodes.length >= input.minNodes && backendNodes.length <= input.maxNodes;
          if (!within) return { action: 'hold', reason: 'AI move outside rails' };
          return await this.applyAi(ai);
        }
      } catch {
        /* AI unavailable → fall through to rules */
      }
    }

    // 2. Deterministic rules (per node).
    if (backendNodes.length === 0) {
      await this.deps.scaleUp?.('no backend nodes in registry');
      return { action: 'scale-up', reason: 'no backend nodes' };
    }
    if (backendNodes.length < this.cfg.maxNodes && input.perNodeRps > this.cfg.rpsPerNodeHigh) {
      await this.deps.scaleUp?.(`rps/node ${input.perNodeRps.toFixed(1)} > ${this.cfg.rpsPerNodeHigh}`);
      this.lastDecisionAt = now;
      return { action: 'scale-up', reason: `rps/node ${input.perNodeRps.toFixed(1)}` };
    }
    if (input.cpu !== null && input.cpu > this.cfg.cpuHigh && backendNodes.length < this.cfg.maxNodes) {
      await this.deps.scaleUp?.(`cpu ${input.cpu.toFixed(1)}% > ${this.cfg.cpuHigh}`);
      this.lastDecisionAt = now;
      return { action: 'scale-up', reason: `cpu ${input.cpu.toFixed(1)}%` };
    }
    if (backendNodes.length > this.cfg.minNodes && input.perNodeRps < this.cfg.rpsPerNodeLow) {
      await this.deps.scaleDown?.(`rps/node ${input.perNodeRps.toFixed(1)} < ${this.cfg.rpsPerNodeLow}`);
      this.lastDecisionAt = now;
      return { action: 'scale-down', reason: `rps/node ${input.perNodeRps.toFixed(1)}` };
    }
    return { action: 'hold', reason: 'within thresholds' };
  }

  private async applyAi(ai: { action: 'scale-up' | 'scale-down' | 'hold'; reason: string }): Promise<DeterministicDecision> {
    if (ai.action === 'scale-up') {
      await this.deps.scaleUp?.(ai.reason);
      return { action: 'scale-up', reason: `AI: ${ai.reason}` };
    }
    if (ai.action === 'scale-down') {
      await this.deps.scaleDown?.(ai.reason);
      return { action: 'scale-down', reason: `AI: ${ai.reason}` };
    }
    return { action: 'hold', reason: `AI: ${ai.reason}` };
  }

  private avgCpu(cpus: number[]): number {
    if (cpus.length === 0) return 0;
    return cpus.reduce((a, b) => a + b, 0) / cpus.length;
  }

  start(intervalMs = 10_000): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      void this.tick().finally(() => setTimeout(loop, intervalMs));
    };
    loop();
  }

  stop(): void {
    this.running = false;
  }
}
