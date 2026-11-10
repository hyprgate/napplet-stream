/**
 * Control over the relay: the shell projects its safety-filtered command
 * catalog to a paired agent as encrypted relay messages, and executes the
 * agent's calls through the same gateway every other caller uses.
 *
 * Local-provisional transport (Phase 3 of "agents are apps"): kind 25130
 * events in the NIP-01 ephemeral range. Shell → agent messages are `p`-tagged
 * with the agent pubkey and NIP-44 encrypted from the shell's ephemeral
 * session key; agent → shell messages are `p`-tagged with that session pubkey
 * and encrypted from the agent key. A `hello-request` is the one plaintext
 * message: it carries no secrets and lets a bridge that starts after the shell
 * ask for the catalog.
 *
 * Session binding: the shell session key is ephemeral, so a `hello` echoes the
 * pairing secret from the pairing URI (inside the ciphertext). The bridge
 * accepts a session only from a `hello` carrying its own secret and ignores
 * every other key's messages; any NIP-42-authenticated relay client could
 * otherwise claim to be the shell.
 */

export const AGENT_CONTROL_KIND = 25130;

export interface AgentToolDescriptor {
  /** Canonical dotted control operation id. */
  readonly id: string;
  readonly revision: number;
  readonly domain: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  readonly confirmation: boolean;
}

export interface AgentControlHello {
  readonly v: 1;
  readonly type: 'hello';
  /** Shell session pubkey the agent must address calls to. */
  readonly session: string;
  /** Pairing secret from the pairing URI; the bridge requires it to match. */
  readonly secret?: string;
  readonly tools: readonly AgentToolDescriptor[];
}

export interface AgentControlHelloRequest {
  readonly v: 1;
  readonly type: 'hello-request';
}

export interface AgentControlToolPublished {
  readonly v: 1;
  readonly type: 'tool-published';
  readonly tool: AgentToolDescriptor;
}

/** The rest of a catalog too big for one `hello`, which NIP-44's 65535-byte limit caps. */
export interface AgentControlToolsPublished {
  readonly v: 1;
  readonly type: 'tools-published';
  readonly tools: readonly AgentToolDescriptor[];
}

export interface AgentControlToolWithdrawn {
  readonly v: 1;
  readonly type: 'tool-withdrawn';
  readonly id: string;
  readonly revision: number;
}

export interface AgentControlRevoked {
  readonly v: 1;
  readonly type: 'revoked';
}

export interface AgentControlCall {
  readonly v: 1;
  readonly type: 'call';
  readonly callId: string;
  readonly id: string;
  readonly revision: number;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface AgentControlCancel {
  readonly v: 1;
  readonly type: 'cancel';
  readonly callId: string;
}

export interface AgentControlResult {
  readonly v: 1;
  readonly type: 'result';
  readonly callId: string;
  /** The gateway's safe invocation snapshot, already redacted by the shell. */
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export type AgentControlShellMessage =
  | AgentControlHello
  | AgentControlToolPublished
  | AgentControlToolsPublished
  | AgentControlToolWithdrawn
  | AgentControlRevoked
  | AgentControlResult;

export type AgentControlAgentMessage =
  | AgentControlHelloRequest
  | AgentControlCall
  | AgentControlCancel;

export type AgentControlMessage = AgentControlShellMessage | AgentControlAgentMessage;

const HEX64 = /^[0-9a-f]{64}$/;
const SECRET_PATTERN = /^[0-9a-f]{32,64}$/;
const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isAgentToolDescriptor(value: unknown): value is AgentToolDescriptor {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && ID_PATTERN.test(value.id) && value.id.length <= 128
    && typeof value.revision === 'number' && Number.isInteger(value.revision)
    && typeof value.domain === 'string' && value.domain.length <= 64
    && typeof value.title === 'string' && value.title.length <= 200
    && typeof value.description === 'string' && value.description.length <= 8192
    && isRecord(value.inputSchema)
    && typeof value.readOnly === 'boolean'
    && typeof value.confirmation === 'boolean';
}

/** Parse one decrypted message. Returns null for anything malformed. */
export function parseAgentControlMessage(json: string): AgentControlMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.type !== 'string') return null;
  switch (parsed.type) {
    case 'hello':
      if (typeof parsed.session !== 'string' || !HEX64.test(parsed.session) || !Array.isArray(parsed.tools)) return null;
      if (!parsed.tools.every(isAgentToolDescriptor) || parsed.tools.length > 1024) return null;
      if (parsed.secret !== undefined && (typeof parsed.secret !== 'string' || !SECRET_PATTERN.test(parsed.secret))) return null;
      return { v: 1, type: 'hello', session: parsed.session, tools: parsed.tools, ...(typeof parsed.secret === 'string' ? { secret: parsed.secret } : {}) };
    case 'hello-request':
      return { v: 1, type: 'hello-request' };
    case 'tool-published':
      return isAgentToolDescriptor(parsed.tool) ? { v: 1, type: 'tool-published', tool: parsed.tool } : null;
    case 'tools-published':
      if (!Array.isArray(parsed.tools) || parsed.tools.length > 1024 || !parsed.tools.every(isAgentToolDescriptor)) return null;
      return { v: 1, type: 'tools-published', tools: parsed.tools };
    case 'tool-withdrawn':
      if (typeof parsed.id !== 'string' || !ID_PATTERN.test(parsed.id) || typeof parsed.revision !== 'number') return null;
      return { v: 1, type: 'tool-withdrawn', id: parsed.id, revision: parsed.revision };
    case 'revoked':
      return { v: 1, type: 'revoked' };
    case 'call':
      if (typeof parsed.callId !== 'string' || !CALL_ID_PATTERN.test(parsed.callId)) return null;
      if (typeof parsed.id !== 'string' || !ID_PATTERN.test(parsed.id) || typeof parsed.revision !== 'number') return null;
      if (!isRecord(parsed.arguments)) return null;
      return { v: 1, type: 'call', callId: parsed.callId, id: parsed.id, revision: parsed.revision, arguments: parsed.arguments };
    case 'cancel':
      if (typeof parsed.callId !== 'string' || !CALL_ID_PATTERN.test(parsed.callId)) return null;
      return { v: 1, type: 'cancel', callId: parsed.callId };
    case 'result':
      if (typeof parsed.callId !== 'string' || !CALL_ID_PATTERN.test(parsed.callId) || !isRecord(parsed.snapshot)) return null;
      return { v: 1, type: 'result', callId: parsed.callId, snapshot: parsed.snapshot };
    default:
      return null;
  }
}

/** Error code of a call the user denied in the shell's permission dialog. */
export const AGENT_DENIED_CODE = 'denied-by-user';

/**
 * Result of a call the user denied. The tool stays in the catalog: a denial
 * is a structured answer the agent can act on, not a missing tool.
 */
export type AgentDeniedSnapshot = {
  readonly status: 'denied';
  readonly operationId: string;
  /** Permission group the call belonged to (for example `desktop-read`). */
  readonly group: string;
  readonly errors: readonly [{ readonly code: typeof AGENT_DENIED_CODE; readonly message: string }];
};

export function agentDeniedSnapshot(operationId: string, group: string): AgentDeniedSnapshot {
  return {
    status: 'denied',
    operationId,
    group,
    errors: [{ code: AGENT_DENIED_CODE, message: `The user denied ${operationId}. Do not retry it unless the user asks; continue without it or ask the user.` }],
  };
}

export function isAgentDeniedSnapshot(value: unknown): value is AgentDeniedSnapshot {
  return isRecord(value) && value.status === 'denied' && typeof value.operationId === 'string'
    && Array.isArray(value.errors) && value.errors.some((error) => isRecord(error) && error.code === AGENT_DENIED_CODE);
}

/** MCP tool names allow only `[A-Za-z0-9_-]`; dotted control ids map one-to-one. */
export function agentToolNameFor(operationId: string): string {
  return `shell_${operationId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}
