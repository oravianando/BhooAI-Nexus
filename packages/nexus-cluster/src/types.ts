import type { NodeRole } from '@bhooai/nexus-core';

export type { NodeRole } from '@bhooai/nexus-core';

/** Hardware/compute tier hint reported at register time. */
export type NodeTier = 'dev' | 'standard' | 'large';

/** Shape exchanged between the central and any node over HTTP. */
export interface NodeIdentity {
  id: string;
  role: NodeRole;
  tier: NodeTier;
  version: string;
  /** Base URL of the node's agent control API, e.g. http://host:7575. */
  baseUrl: string;
  /** role -> service base URL, e.g. backend -> http://host:4000. */
  services: Partial<Record<NodeRole, string>>;
  /** Capability strings the node supports, e.g. "start", "stop", "metrics". */
  capabilities: string[];
  /** Human-friendly project name (from the node's package.json `name`). */
  project?: string;
}

export interface NodeHealth {
  ok: boolean;
  time: string;
  services: Partial<Record<NodeRole, boolean>>;
  message?: string;
}

export interface NodeMetricsSample {
  nodeId: string;
  rps: number;
  cpu: number;
  memoryMb: number;
  sampledAt: number;
}

/** Command the central may execute on a node (allowlist enforced). */
export type NodeCommand = 'start' | 'stop' | 'restart' | 'logs' | 'update' | 'script';

export interface NodeExecRequest {
  command: NodeCommand;
  /** For "script": the script/bundle id to push & run. */
  target?: string;
  args?: string[];
}

export interface NodeExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr?: string;
  /** audit line appended by the node, e.g. "run start@2026-… by central:…" */
  audit?: string;
}

/** One entry in the central registry. */
export interface RegistryNode {
  identity: NodeIdentity;
  status: 'pending' | 'ready' | 'unreachable';
  registeredAt: string;
  lastSeenAt: string;
  lastHealth?: NodeHealth;
  lastMetrics?: NodeMetricsSample;
  enabled: boolean;
  /** Per-node pairing token used to authenticate to this node's agent. Falls
   *  back to the registry's shared token when undefined (legacy behaviour). */
  authToken?: string;
}