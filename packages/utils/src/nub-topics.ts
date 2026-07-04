export const SUPPORTED_NUB_IFC_PROTOCOL_CAPABILITIES = [
  'inc:NAP-01',
  'inc:NAP-02',
  'inc:NAP-03',
  'inc:NAP-04',
  'inc:NAP-05',
  'inc:NAP-06',
] as const;

export const IDENTITY_CHANGED_TOPIC = 'identity:changed';
/**
 * @deprecated The shell no longer emits this topic (the bridge no longer dual-emits;
 * canonical topic is `identity:changed`). Retained only because feed/profile/live-chat
 * napplets still import it via the @hyprgate/utils barrel; napplet subscriber cleanup is
 * deferred to Phase 87.
 */
export const LEGACY_AUTH_IDENTITY_CHANGED_TOPIC = 'auth:identity-changed';

const CANONICAL_HEX_PUBKEY = /^[0-9a-f]{64}$/;

export interface IdentityChangedPayload {
  pubkey: string | null;
}

export interface ProfileOpenPayload {
  pubkey: string;
}

export const PROFILE_READY_TOPIC = 'profile:ready' as const;

export interface ChatOpenDmPayload {
  pubkey: string;
  displayName?: string;
}

export interface StreamChannelSwitchMetadata {
  title?: string;
  chatRelays?: string[];
  image?: string;
  hostPubkey?: string;
}

export interface StreamChannelSwitchPayload {
  streamId: string;
  streamUrl?: string;
  metadata: StreamChannelSwitchMetadata;
}

export interface StreamCurrentContextPayload {
  requestId?: string;
  streamAddr: string | null;
  title: string | null;
  chatRelays: string[];
}

export function isCanonicalHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_HEX_PUBKEY.test(value);
}

export function parseIdentityChangedPayload(payload: unknown): IdentityChangedPayload | null {
  if (!isRecord(payload)) return null;
  if (payload.pubkey === null) return { pubkey: null };
  if (!isCanonicalHexPubkey(payload.pubkey)) return null;
  return { pubkey: payload.pubkey };
}

export function parseProfileOpenPayload(payload: unknown): ProfileOpenPayload | null {
  if (!isRecord(payload) || !isCanonicalHexPubkey(payload.pubkey)) return null;
  return { pubkey: payload.pubkey };
}

export function parseChatOpenDmPayload(payload: unknown): ChatOpenDmPayload | null {
  const profile = parseProfileOpenPayload(payload);
  if (!profile) return null;
  const displayName = isRecord(payload) && typeof payload.displayName === 'string' && payload.displayName.trim()
    ? payload.displayName
    : undefined;
  return displayName ? { ...profile, displayName } : profile;
}

export function createStreamChannelSwitchPayload(input: {
  streamId: string;
  streamUrl?: string | null;
  title?: string | null;
  chatRelays?: string[] | null;
  image?: string | null;
  hostPubkey?: string | null;
}): StreamChannelSwitchPayload {
  const metadata: StreamChannelSwitchMetadata = {
    chatRelays: normalizeRelayList(input.chatRelays),
  };

  if (input.title) metadata.title = input.title;
  if (input.image) metadata.image = input.image;
  if (input.hostPubkey) metadata.hostPubkey = input.hostPubkey;

  return {
    streamId: input.streamId,
    ...(input.streamUrl ? { streamUrl: input.streamUrl } : {}),
    metadata,
  };
}

export function parseStreamChannelSwitchPayload(payload: unknown): StreamChannelSwitchPayload | null {
  const record = coerceRecord(payload);
  if (!record || typeof record.streamId !== 'string' || record.streamId.trim() === '') return null;

  const metadata = readMetadata(record);
  if (!metadata) return null;

  return {
    streamId: record.streamId,
    ...(typeof record.streamUrl === 'string' && record.streamUrl.trim() ? { streamUrl: record.streamUrl } : {}),
    metadata,
  };
}

export function createStreamCurrentContextPayload(
  context: {
    streamAddr: string | null;
    title?: string | null;
    chatRelays?: string[] | null;
  },
  request?: unknown,
): StreamCurrentContextPayload {
  const requestId = getRequestId(request);
  return {
    ...(requestId ? { requestId } : {}),
    streamAddr: context.streamAddr,
    title: context.title ?? null,
    chatRelays: normalizeRelayList(context.chatRelays),
  };
}

function readMetadata(payload: Record<string, unknown>): StreamChannelSwitchMetadata | null {
  const metadataValue = payload.metadata;
  if (metadataValue !== undefined && !isRecord(metadataValue)) return null;
  const metadataRecord = isRecord(metadataValue) ? metadataValue : {};

  const title = readOptionalString(metadataRecord.title) ?? readOptionalString(payload.title);
  const image = readOptionalString(metadataRecord.image);
  const hostPubkey = readOptionalString(metadataRecord.hostPubkey);
  const chatRelaysValue = metadataRecord.chatRelays ?? payload.chatRelays;

  if (chatRelaysValue !== undefined && !isStringArray(chatRelaysValue)) return null;

  return {
    ...(title ? { title } : {}),
    chatRelays: normalizeRelayList(chatRelaysValue),
    ...(image ? { image } : {}),
    ...(hostPubkey ? { hostPubkey } : {}),
  };
}

function getRequestId(request: unknown): string | undefined {
  const record = coerceRecord(request);
  if (!record || typeof record.requestId !== 'string') return undefined;
  const requestId = record.requestId.trim();
  return requestId ? requestId : undefined;
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? value : undefined;
}

function normalizeRelayList(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
