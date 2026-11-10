/**
 * Draft diagnostics the shell publishes to a paired agent's relay.
 *
 * Local-provisional transport (Phase 2 of "agents are apps"): a kind 25129
 * event in the NIP-01 ephemeral range, tagged `p` with the agent pubkey and
 * `a` with the draft address, whose content is a NIP-44 ciphertext of an
 * {@link AgentDiagnosticsBatch} from an ephemeral per-session shell key to the
 * agent key. No existing NAP covers shell → agent delivery; this schema is the
 * shared contract between `apps/shell` and `apps/harness` until the
 * relay control extension (Phase 3) subsumes it.
 */

export const AGENT_DIAGNOSTICS_KIND = 25129;

export type AgentDiagnosticType =
  | 'resolution'
  | 'handshake'
  | 'console'
  | 'grant'
  | 'runtime'
  | 'publish-refused';

export type AgentDiagnosticStatus =
  | 'started'
  | 'ok'
  | 'failed'
  | 'ready'
  | 'fallback'
  | 'denied'
  | 'quarantined';

export interface AgentDiagnosticEntry {
  readonly v: 1;
  /** Milliseconds since epoch, shell clock. */
  readonly at: number;
  readonly windowId: string;
  /** `35129:<pubkey>:<d>` (or `15129:<pubkey>:` for a root app). */
  readonly address: string;
  readonly dTag: string;
  readonly aggregateHash?: string;
  readonly type: AgentDiagnosticType;
  /** Resolution stage (`resolve`, `fetch`, `verify`, `instantiate`, `handshake`) or domain for grants. */
  readonly stage?: string;
  readonly status?: AgentDiagnosticStatus;
  readonly message?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface AgentDiagnosticsBatch {
  readonly v: 1;
  readonly entries: readonly AgentDiagnosticEntry[];
}

const TYPES: ReadonlySet<string> = new Set(['resolution', 'handshake', 'console', 'grant', 'runtime', 'publish-refused']);
const STATUSES: ReadonlySet<string> = new Set(['started', 'ok', 'failed', 'ready', 'fallback', 'denied', 'quarantined']);
const ADDRESS_PATTERN = /^(35129|15129):[0-9a-f]{64}:[^\s]*$/;
const MAX_MESSAGE = 4096;

export function isAgentDiagnosticEntry(value: unknown): value is AgentDiagnosticEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return entry.v === 1
    && typeof entry.at === 'number' && Number.isFinite(entry.at)
    && typeof entry.windowId === 'string' && entry.windowId.length > 0 && entry.windowId.length <= 128
    && typeof entry.address === 'string' && ADDRESS_PATTERN.test(entry.address)
    && typeof entry.dTag === 'string'
    && (entry.aggregateHash === undefined || (typeof entry.aggregateHash === 'string' && /^[0-9a-f]{64}$/.test(entry.aggregateHash)))
    && typeof entry.type === 'string' && TYPES.has(entry.type)
    && (entry.stage === undefined || (typeof entry.stage === 'string' && entry.stage.length <= 64))
    && (entry.status === undefined || (typeof entry.status === 'string' && STATUSES.has(entry.status)))
    && (entry.message === undefined || (typeof entry.message === 'string' && entry.message.length <= MAX_MESSAGE))
    && (entry.data === undefined || (typeof entry.data === 'object' && entry.data !== null && !Array.isArray(entry.data)));
}

/** Parse a decrypted batch; malformed entries are dropped, never trusted. */
export function parseAgentDiagnosticsBatch(json: string): AgentDiagnosticEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const batch = parsed as { v?: unknown; entries?: unknown };
  if (batch.v !== 1 || !Array.isArray(batch.entries)) return [];
  return batch.entries.filter(isAgentDiagnosticEntry).slice(0, 256);
}
