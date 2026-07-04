import type { NostrEvent } from '@hyprgate/types';
import { nip19 } from 'nostr-tools';

export const KIND_APP_HANDLER = 31990;
export const KIND_APP_HANDLER_RECOMMENDATION = 31989;

export interface Nip89WebHandler {
  urlTemplate: string;
  entityType: string | null;
}

export interface Nip89Handler {
  id: string;
  identity: string;
  name: string;
  dTag: string;
  supportedTargets: string[];
  kinds: number[];
  summary: string;
  web: Nip89WebHandler[];
  event: NostrEvent;
}

export interface Nip89HandlerRef {
  kind: number;
  pubkey: string;
  dTag: string;
  relays: string[];
}

export function nip89HandlerFromEvent(event: NostrEvent): Nip89Handler | null {
  if (event.kind !== KIND_APP_HANDLER) return null;
  const dTag = firstTag(event, 'd');
  if (!dTag) return null;
  const kinds = uniqueNumbers(event.tags.filter((tag) => tag[0] === 'k').map((tag) => tag[1]));
  const web = event.tags.flatMap((tag) => {
    if (tag[0] !== 'web' || typeof tag[1] !== 'string' || tag[1].length === 0) return [];
    return [{ urlTemplate: tag[1], entityType: tag[2] && tag[2] !== 'web' ? tag[2] : null }];
  });
  if (kinds.length === 0 && web.length === 0) return null;
  const targets = uniqueStrings([
    ...kinds.map((kind) => `kind:${kind}`),
    ...event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1]).filter(isString),
    ...web.map((item) => item.entityType).filter(isString),
    dTag,
  ]);
  return {
    id: event.id,
    identity: `${KIND_APP_HANDLER}:${event.pubkey}:${dTag}`,
    name: readName(event) ?? dTag,
    dTag,
    supportedTargets: targets,
    kinds,
    summary: summarize(event.content),
    web,
    event,
  };
}

export function nip89HandlerSupportsKind(handler: Nip89Handler, kind: number): boolean {
  return handler.kinds.includes(kind) || handler.supportedTargets.includes(`kind:${kind}`);
}

export function dedupeNip89Handlers(handlers: Nip89Handler[]): Nip89Handler[] {
  const seen = new Set<string>();
  const deduped: Nip89Handler[] = [];
  for (const handler of handlers) {
    if (seen.has(handler.identity)) continue;
    seen.add(handler.identity);
    deduped.push(handler);
  }
  return deduped;
}

export function nip89RecommendationRefsForKind(event: NostrEvent, targetKind: number): Nip89HandlerRef[] {
  if (event.kind !== KIND_APP_HANDLER_RECOMMENDATION) return [];
  if (firstTag(event, 'd') !== String(targetKind)) return [];
  return event.tags
    .filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string')
    .map((tag) => parseHandlerAddress(tag))
    .filter((ref): ref is Nip89HandlerRef => ref != null);
}

export function formatNip89HandlerLink(handler: Nip89Handler, target: NostrEvent): string | null {
  const web = preferredWebHandler(handler, target);
  if (!web) return null;
  const encoded = encodeTargetForHandler(web.entityType, target);
  if (!encoded) return null;
  return replaceBech32Placeholder(web.urlTemplate, encoded);
}

function preferredWebHandler(handler: Nip89Handler, target: NostrEvent): Nip89WebHandler | null {
  const specific = handler.web
    .filter((item) => item.entityType)
    .find((item) => encodeTargetForHandler(item.entityType, target) != null);
  return specific ?? handler.web.find((item) => item.entityType == null) ?? null;
}

function encodeTargetForHandler(entityType: string | null, target: NostrEvent): string | null {
  const type = entityType ?? 'nevent';
  try {
    if (type === 'note') return nip19.noteEncode(target.id);
    if (type === 'nevent') return nip19.neventEncode({ id: target.id, author: target.pubkey, kind: target.kind });
    if (type === 'nprofile') return nip19.nprofileEncode({ pubkey: target.pubkey });
    if (type === 'naddr') {
      const dTag = firstTag(target, 'd');
      if (!dTag) return null;
      return nip19.naddrEncode({ kind: target.kind, pubkey: target.pubkey, identifier: dTag });
    }
  } catch {
    return null;
  }
  return null;
}

function replaceBech32Placeholder(template: string, encoded: string): string {
  if (template.includes('<bech32>')) return template.replaceAll('<bech32>', encoded);
  if (template.includes('{bech32}')) return template.replaceAll('{bech32}', encoded);
  if (template.includes('bech32')) return template.replaceAll('bech32', encoded);
  const separator = template.includes('?') ? '&' : '?';
  return `${template}${separator}event=${encodeURIComponent(encoded)}`;
}

function parseHandlerAddress(tag: string[]): Nip89HandlerRef | null {
  const address = tag[1];
  if (!address) return null;
  const [kindText, pubkey, dTag] = address.split(':');
  if (Number(kindText) !== KIND_APP_HANDLER || !pubkey || !dTag) return null;
  return {
    kind: KIND_APP_HANDLER,
    pubkey,
    dTag,
    relays: tag.slice(2).filter(isRelayHint),
  };
}

function readName(event: NostrEvent): string | null {
  const nameTag = firstTag(event, 'name') ?? firstTag(event, 'display_name') ?? firstTag(event, 'title');
  if (nameTag) return nameTag;
  try {
    const parsed = JSON.parse(event.content) as { name?: string; display_name?: string; displayName?: string; title?: string };
    return parsed.display_name ?? parsed.displayName ?? parsed.title ?? parsed.name ?? null;
  } catch {
    return null;
  }
}

function firstTag(event: NostrEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name && tag[1])?.[1] ?? null;
}

function summarize(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return 'No handler description content.';
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNumbers(values: Array<string | undefined>): number[] {
  return Array.from(new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value))));
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRelayHint(value: string): boolean {
  return value.startsWith('wss://') || value.startsWith('ws://');
}
