/**
 * The agent console channel: the shell's native console app drives a harness
 * session in the user's own bridge over the pairing relay.
 *
 * Local-provisional, like control and diagnostics: kind 25130 events, NIP-44
 * between the shell's bound session key and the agent key, accepted only from
 * the session a `hello` carrying the pairing secret bound. A message type
 * starts with `console.`, so the control parser never sees one.
 *
 * Refusals: the shell sends nothing unless the agent's `console` grant is on,
 * and the bridge refuses every console message unless it is loopback-only
 * (its relay and Blossom bound to loopback). Console traffic beyond loopback
 * needs a separate review.
 *
 * A connection is either the shell's own (Settings → Models), whose credential
 * travels once inside `console.session-start` after the user consented and is
 * kept in the harness's memory for that session only, or one the harness holds
 * itself (`hyprg connections`, `hyprg login`), which the shell names by id and
 * never sees the secret of. `console.list-connections` asks for the harness's
 * list; `console.connections` answers with descriptors only.
 */

export const CONSOLE_MESSAGE_MAX_BYTES = 256 * 1024;
export const CONSOLE_PROMPT_MAX_CHARS = 32 * 1024;
export const CONSOLE_UPDATE_MAX_EVENTS = 64;

/** Everything the bridge needs to call one connection's preset endpoint. */
export interface ConsoleConnection {
  readonly id: string;
  readonly label: string;
  readonly protocol: 'openai-chat' | 'anthropic-messages' | 'gemini';
  readonly baseUrl: string;
  readonly model: string;
  readonly credentialHeader?: 'authorization-bearer' | 'api-key' | 'x-api-key' | 'x-goog-api-key';
  readonly maxOutputTokens?: number;
}

/** A connection the harness holds: what the shell may show and choose, never its key or tokens. */
export interface ConsoleHarnessConnection {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly auth: 'none' | 'key' | 'chatgpt';
  readonly account?: string;
  readonly isDefault: boolean;
  /** Whether the harness's own check saw the model call a tool. */
  readonly toolsChecked?: boolean;
}

export const CONSOLE_MAX_HARNESS_CONNECTIONS = 64;

export type ConsoleSessionState = 'idle' | 'working' | 'model-error' | 'ended';
export type ConsolePermissionAnswer = 'allow-once' | 'allow-group' | 'deny';

export type ConsoleShellMessage =
  | { readonly v: 1; readonly type: 'console.session-start'; readonly sessionId: string; readonly connection: ConsoleConnection; readonly credential?: string; readonly consentedAt: number }
  | { readonly v: 1; readonly type: 'console.session-start'; readonly sessionId: string; readonly harnessConnection: string; readonly consentedAt: number }
  | { readonly v: 1; readonly type: 'console.list-connections' }
  | { readonly v: 1; readonly type: 'console.prompt'; readonly sessionId: string; readonly promptId: string; readonly text: string }
  | { readonly v: 1; readonly type: 'console.cancel'; readonly sessionId: string }
  | { readonly v: 1; readonly type: 'console.permission-response'; readonly sessionId: string; readonly requestId: string; readonly answer: ConsolePermissionAnswer }
  | { readonly v: 1; readonly type: 'console.attach'; readonly sessionId: string; readonly cursor: number }
  | { readonly v: 1; readonly type: 'console.session-end'; readonly sessionId: string };

/** One rendered event; the bridge's session log numbers them for `attach`. */
export interface ConsoleEvent {
  readonly seq: number;
  readonly at: number;
  readonly kind: 'user' | 'assistant' | 'thought' | 'plan' | 'tool-call' | 'tool-result' | 'skill' | 'state';
  readonly [field: string]: unknown;
}

/**
 * Text the model is producing right now, for live display. It is not part of
 * the log: the finished `assistant` or `thought` event replaces it, and `after`
 * (the log's last `seq` when it was sent) lets a late fragment be ignored.
 */
export interface ConsolePartial {
  readonly kind: 'assistant' | 'thought';
  readonly text: string;
  readonly after: number;
}

export type ConsoleBridgeMessage =
  | { readonly v: 1; readonly type: 'console.connections'; readonly connections: readonly ConsoleHarnessConnection[] }
  | { readonly v: 1; readonly type: 'console.update'; readonly sessionId: string; readonly events: readonly ConsoleEvent[]; readonly partial?: ConsolePartial }
  | { readonly v: 1; readonly type: 'console.permission-request'; readonly sessionId: string; readonly requestId: string; readonly tool: string; readonly group: string; readonly arguments: Readonly<Record<string, unknown>> }
  | { readonly v: 1; readonly type: 'console.session-state'; readonly sessionId: string; readonly state: ConsoleSessionState; readonly detail?: string; readonly refused?: ConsoleRefusal };

export type ConsoleRefusal = 'not-loopback' | 'no-session' | 'unknown-session' | 'rate-limited' | 'too-large' | 'stale-permission';

export type ConsoleMessage = ConsoleShellMessage | ConsoleBridgeMessage;

const SHELL_TYPES = new Set<string>([
  'console.session-start', 'console.list-connections', 'console.prompt', 'console.cancel', 'console.permission-response', 'console.attach', 'console.session-end',
]);

/** True for the messages the shell sends; the bridge acts only on these. */
export function isConsoleShellMessage(message: ConsoleMessage): message is ConsoleShellMessage {
  return SHELL_TYPES.has(message.type);
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SHORT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROTOCOLS = new Set(['openai-chat', 'anthropic-messages', 'gemini']);
const HEADERS = new Set(['authorization-bearer', 'api-key', 'x-api-key', 'x-goog-api-key']);
const STATES = new Set(['idle', 'working', 'model-error', 'ended']);
const ANSWERS = new Set(['allow-once', 'allow-group', 'deny']);
const KINDS = new Set(['user', 'assistant', 'thought', 'plan', 'tool-call', 'tool-result', 'skill', 'state']);
const REFUSALS = new Set(['not-loopback', 'no-session', 'unknown-session', 'rate-limited', 'too-large', 'stale-permission']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isConsoleMessageType(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith('console.');
}

function parseHarnessConnection(value: unknown): ConsoleHarnessConnection | null {
  if (!isRecord(value)) return null;
  const { id, label, provider, protocol, baseUrl, model, auth, account, isDefault, toolsChecked } = value;
  const short = (text: unknown, max: number): text is string => typeof text === 'string' && text.length > 0 && text.length <= max;
  if (typeof id !== 'string' || !SHORT_ID.test(id) || !short(label, 120) || !short(provider, 64) || !short(protocol, 64) || !short(model, 200)) return null;
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl) || baseUrl.length > 2048) return null;
  if (auth !== 'none' && auth !== 'key' && auth !== 'chatgpt') return null;
  if (account !== undefined && !short(account, 320)) return null;
  if (typeof isDefault !== 'boolean' || (toolsChecked !== undefined && typeof toolsChecked !== 'boolean')) return null;
  return { id, label, provider, protocol, baseUrl, model, auth, isDefault, ...(account ? { account } : {}), ...(toolsChecked !== undefined ? { toolsChecked } : {}) };
}

function parseConnection(value: unknown): ConsoleConnection | null {
  if (!isRecord(value)) return null;
  const { id, label, protocol, baseUrl, model, credentialHeader, maxOutputTokens } = value;
  if (typeof id !== 'string' || !SHORT_ID.test(id) || typeof label !== 'string' || label.length > 120) return null;
  if (typeof protocol !== 'string' || !PROTOCOLS.has(protocol) || typeof model !== 'string' || !model || model.length > 200) return null;
  if (typeof baseUrl !== 'string') return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  if (credentialHeader !== undefined && (typeof credentialHeader !== 'string' || !HEADERS.has(credentialHeader))) return null;
  if (maxOutputTokens !== undefined && (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1)) return null;
  return {
    id, label, protocol: protocol as ConsoleConnection['protocol'], baseUrl: baseUrl.replace(/\/$/, ''), model,
    ...(credentialHeader ? { credentialHeader: credentialHeader as ConsoleConnection['credentialHeader'] } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

/** Parse one decrypted console message. Returns null for anything malformed or oversized. */
export function parseConsoleMessage(json: string): ConsoleMessage | null {
  if (json.length > CONSOLE_MESSAGE_MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!isRecord(parsed) || parsed.v !== 1 || !isConsoleMessageType(parsed.type)) return null;
  // The two messages about the harness's connections belong to no session.
  if (parsed.type === 'console.list-connections') return { v: 1, type: 'console.list-connections' };
  if (parsed.type === 'console.connections') {
    if (!Array.isArray(parsed.connections) || parsed.connections.length > CONSOLE_MAX_HARNESS_CONNECTIONS) return null;
    const connections = parsed.connections.map(parseHarnessConnection);
    if (connections.some((connection) => connection === null)) return null;
    return { v: 1, type: 'console.connections', connections: connections as ConsoleHarnessConnection[] };
  }
  const sessionId = parsed.sessionId;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
  switch (parsed.type) {
    case 'console.session-start': {
      if (typeof parsed.consentedAt !== 'number') return null;
      if (parsed.harnessConnection !== undefined) {
        if (typeof parsed.harnessConnection !== 'string' || !SHORT_ID.test(parsed.harnessConnection) || parsed.connection !== undefined || parsed.credential !== undefined) return null;
        return { v: 1, type: 'console.session-start', sessionId, harnessConnection: parsed.harnessConnection, consentedAt: parsed.consentedAt };
      }
      const connection = parseConnection(parsed.connection);
      if (!connection || typeof parsed.consentedAt !== 'number') return null;
      if (parsed.credential !== undefined && (typeof parsed.credential !== 'string' || parsed.credential.length > 4096)) return null;
      return { v: 1, type: 'console.session-start', sessionId, connection, consentedAt: parsed.consentedAt, ...(typeof parsed.credential === 'string' ? { credential: parsed.credential } : {}) };
    }
    case 'console.prompt':
      if (typeof parsed.promptId !== 'string' || !SHORT_ID.test(parsed.promptId)) return null;
      if (typeof parsed.text !== 'string' || !parsed.text.trim() || parsed.text.length > CONSOLE_PROMPT_MAX_CHARS) return null;
      return { v: 1, type: 'console.prompt', sessionId, promptId: parsed.promptId, text: parsed.text };
    case 'console.cancel':
      return { v: 1, type: 'console.cancel', sessionId };
    case 'console.session-end':
      return { v: 1, type: 'console.session-end', sessionId };
    case 'console.attach':
      if (typeof parsed.cursor !== 'number' || !Number.isInteger(parsed.cursor) || parsed.cursor < 0) return null;
      return { v: 1, type: 'console.attach', sessionId, cursor: parsed.cursor };
    case 'console.permission-response':
      if (typeof parsed.requestId !== 'string' || !SHORT_ID.test(parsed.requestId)) return null;
      if (typeof parsed.answer !== 'string' || !ANSWERS.has(parsed.answer)) return null;
      return { v: 1, type: 'console.permission-response', sessionId, requestId: parsed.requestId, answer: parsed.answer as ConsolePermissionAnswer };
    case 'console.update':
      if (!Array.isArray(parsed.events) || parsed.events.length > CONSOLE_UPDATE_MAX_EVENTS) return null;
      if (!parsed.events.every((event) => isRecord(event) && typeof event.seq === 'number' && typeof event.at === 'number' && KINDS.has(String(event.kind)))) return null;
      if (parsed.partial !== undefined) {
        const partial = parsed.partial;
        if (!isRecord(partial) || (partial.kind !== 'assistant' && partial.kind !== 'thought') || typeof partial.text !== 'string' || typeof partial.after !== 'number') return null;
        return { v: 1, type: 'console.update', sessionId, events: parsed.events as unknown as ConsoleEvent[], partial: { kind: partial.kind, text: partial.text, after: partial.after } };
      }
      return { v: 1, type: 'console.update', sessionId, events: parsed.events as unknown as ConsoleEvent[] };
    case 'console.permission-request':
      if (typeof parsed.requestId !== 'string' || !SHORT_ID.test(parsed.requestId)) return null;
      if (typeof parsed.tool !== 'string' || parsed.tool.length > 128 || typeof parsed.group !== 'string' || parsed.group.length > 96) return null;
      if (!isRecord(parsed.arguments)) return null;
      return { v: 1, type: 'console.permission-request', sessionId, requestId: parsed.requestId, tool: parsed.tool, group: parsed.group, arguments: parsed.arguments };
    case 'console.session-state':
      if (typeof parsed.state !== 'string' || !STATES.has(parsed.state)) return null;
      if (parsed.refused !== undefined && (typeof parsed.refused !== 'string' || !REFUSALS.has(parsed.refused))) return null;
      return {
        v: 1, type: 'console.session-state', sessionId, state: parsed.state as ConsoleSessionState,
        ...(typeof parsed.detail === 'string' ? { detail: parsed.detail.slice(0, 2000) } : {}),
        ...(typeof parsed.refused === 'string' ? { refused: parsed.refused as ConsoleRefusal } : {}),
      };
    default:
      return null;
  }
}
