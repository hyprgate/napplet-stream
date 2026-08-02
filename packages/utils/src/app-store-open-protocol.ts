import {
  createIntentRequest,
  parseIntentResult,
  type IntentRequest,
  type IntentRequestOptions,
  type IntentResult,
} from '@hyprgate/types';

export const APP_OPEN_TOPIC = 'app:open' as const;

export interface AppOpenPayload {
  dTag: string;
  title?: string;
  class?: string;
  component?: string;
  author?: string;
  relays?: string[];
  source?: 'app-store';
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function safeToken(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);
}

function safePubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function safeRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}

export function parseAppOpenPayload(value: unknown): AppOpenPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppOpenPayload>;
  const dTag = nonEmptyString(candidate.dTag);
  if (!dTag || !safeToken(dTag)) return null;

  const title = nonEmptyString(candidate.title);
  const windowClass = nonEmptyString(candidate.class);
  const component = nonEmptyString(candidate.component);
  if (windowClass && !safeToken(windowClass)) return null;
  if (component && !safeToken(component)) return null;
  const author = nonEmptyString(candidate.author)?.toLowerCase();
  if (author && !safePubkey(author)) return null;
  const relays = Array.isArray(candidate.relays)
    ? [...new Set(candidate.relays.map(nonEmptyString).filter((relay): relay is string => Boolean(relay)))]
      .filter(safeRelayUrl)
      .slice(0, 8)
    : [];

  return {
    dTag,
    ...(title ? { title } : {}),
    ...(windowClass ? { class: windowClass } : {}),
    ...(component ? { component } : {}),
    ...(author ? { author } : {}),
    ...(relays.length > 0 ? { relays } : {}),
    ...(candidate.source === 'app-store' ? { source: 'app-store' } : {}),
  };
}

/** Build a validated App Store launch request without encoding selectors into the archetype. */
export function createAppOpenIntentRequest(
  archetype: string,
  payload: unknown,
  options: IntentRequestOptions = {},
): IntentRequest | null {
  const app = parseAppOpenPayload(payload);
  return app ? createIntentRequest({ archetype, ...options, payload: app }) : null;
}

/** Parse a canonical result so callers can distinguish handled and no-handler outcomes. */
export function parseAppOpenIntentResult(value: unknown): IntentResult | null {
  return parseIntentResult(value);
}
