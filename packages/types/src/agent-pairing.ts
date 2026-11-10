/**
 * Agent pairing payload shared by the bridge (which prints it) and the shell
 * (which parses it, shows the parsed values in its own confirmation dialog and
 * writes the trusted-agent record). The URI carries values, never
 * instructions: everything it says is validated here and confirmed by the
 * user before it has any effect.
 *
 *   hyprgate-agent:pair?pubkey=<hex>&tier=draft&relay=<ws>&blossom=<http>&secret=<hex>&label=<text>
 *
 * `secret` binds the pairing: the shell stores it with the trusted-agent record
 * and echoes it in every `hello` it sends over the relay, so the bridge accepts
 * a shell session only from the party that scanned this URI. It travels in the
 * URI (user's hands) and in NIP-44 ciphertext, never in plaintext on the relay.
 */

export const AGENT_PAIRING_SCHEME = 'hyprgate-agent:';
export const AGENT_PAIRING_PATH = 'pair';
export const PAIR_AGENT_QUERY_PARAM = 'pair-agent';

export type AgentPairingTier = 'draft';

export interface AgentPairingPayload {
  readonly pubkey: string;
  readonly tier: AgentPairingTier;
  readonly relays: readonly string[];
  readonly blossomServers: readonly string[];
  /** Pairing secret (32 to 64 lowercase hex characters). */
  readonly secret: string;
  readonly label?: string;
}

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
export const PAIRING_SECRET_PATTERN = /^[0-9a-f]{32,64}$/;
const MAX_ENDPOINTS = 8;
const MAX_LABEL = 80;

export function formatAgentPairingUri(payload: AgentPairingPayload): string {
  const params = new URLSearchParams();
  params.set('pubkey', payload.pubkey);
  params.set('tier', payload.tier);
  for (const relay of payload.relays) params.append('relay', relay);
  for (const server of payload.blossomServers) params.append('blossom', server);
  params.set('secret', payload.secret);
  if (payload.label) params.set('label', payload.label);
  return `${AGENT_PAIRING_SCHEME}${AGENT_PAIRING_PATH}?${params.toString()}`;
}

function endpoints(values: string[], protocols: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of values) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (!protocols.includes(url.protocol)) return null;
    const href = url.href.replace(/\/$/, '');
    if (!out.includes(href)) out.push(href);
    if (out.length > MAX_ENDPOINTS) return null;
  }
  return out;
}

/** Parse a pairing URI. Returns null for anything malformed; nothing is partially accepted. */
export function parseAgentPairingUri(uri: string): AgentPairingPayload | null {
  const trimmed = uri.trim();
  const prefix = `${AGENT_PAIRING_SCHEME}${AGENT_PAIRING_PATH}?`;
  const alternate = `${AGENT_PAIRING_SCHEME}//${AGENT_PAIRING_PATH}?`;
  let query: string;
  if (trimmed.startsWith(prefix)) query = trimmed.slice(prefix.length);
  else if (trimmed.startsWith(alternate)) query = trimmed.slice(alternate.length);
  else return null;
  const params = new URLSearchParams(query);
  const pubkey = (params.get('pubkey') ?? '').trim().toLowerCase();
  if (!PUBKEY_PATTERN.test(pubkey)) return null;
  if (params.get('tier') !== 'draft') return null;
  const relays = endpoints(params.getAll('relay'), ['ws:', 'wss:']);
  const blossomServers = endpoints(params.getAll('blossom'), ['http:', 'https:']);
  if (!relays || relays.length === 0 || !blossomServers) return null;
  const secret = (params.get('secret') ?? '').trim().toLowerCase();
  if (!PAIRING_SECRET_PATTERN.test(secret)) return null;
  const label = (params.get('label') ?? '').trim();
  if (label.length > MAX_LABEL) return null;
  return {
    pubkey,
    tier: 'draft',
    relays,
    blossomServers,
    secret,
    ...(label ? { label } : {}),
  };
}

/** Accept either a bare pairing URI or a shell link carrying one in `?pair-agent=`. */
export function parseAgentPairingInput(input: string): AgentPairingPayload | null {
  const direct = parseAgentPairingUri(input);
  if (direct) return direct;
  try {
    const url = new URL(input.trim());
    const nested = url.searchParams.get(PAIR_AGENT_QUERY_PARAM);
    return nested ? parseAgentPairingUri(nested) : null;
  } catch {
    return null;
  }
}

export function agentPairingFromSearch(search: string): { uri: string; payload: AgentPairingPayload } | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const uri = params.get(PAIR_AGENT_QUERY_PARAM);
  if (!uri) return null;
  const payload = parseAgentPairingUri(uri);
  return payload ? { uri, payload } : null;
}
