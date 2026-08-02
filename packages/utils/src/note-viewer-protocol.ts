import {
  createIntentRequest,
  parseIntentResult,
  type IntentRequest,
  type IntentRequestOptions,
  type IntentResult,
  type NostrEvent,
} from '@hyprgate/types';
import {
  KIND_GENERIC_REPOST,
  KIND_NOTE,
  KIND_REACTION,
  KIND_REPOST,
} from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';

export const NOTE_VIEWER_OPEN_TOPIC = 'note:open' as const;
export const NOTE_VIEWER_READY_TOPIC = 'note:ready' as const;
export const NOTE_VIEWER_OPEN_PROTOCOL = 'NAP-04' as const;
export { KIND_GENERIC_REPOST, KIND_REACTION, KIND_REPOST };
export const KIND_TEXT_NOTE = KIND_NOTE;
export const KIND_NIP22_COMMENT = 1111 as const;

export type NoteViewerInteractionKind = 'kind1-reply' | 'nip22-comment';

export interface EventReference {
  type: 'event';
  id: string;
  relay?: string;
  marker?: string;
  kind?: number;
  pubkey?: string;
}

export interface AddressReference {
  type: 'address';
  address: string;
  relay?: string;
  kind?: number;
  pubkey?: string;
}

export type NoteViewerTargetReference = EventReference | AddressReference;

export type NoteViewerOpenTarget =
  | {
      type: 'event';
      id: string;
      kind?: number;
      pubkey?: string;
      nip19?: string;
    }
  | {
      type: 'address';
      kind: number;
      pubkey: string;
      identifier: string;
      nip19?: string;
    };

export interface NoteViewerOpenPayload {
  target: NoteViewerOpenTarget;
  relays?: string[];
  source?: {
    napplet?: string;
    windowId?: string;
    requestId?: string;
  };
  behavior?: {
    focus?: boolean;
    newWindow?: boolean;
  };
}

export interface Nip10ReplyReference {
  type: 'kind1-reply';
  root: EventReference;
  parent: EventReference;
  pubkeys: string[];
  source: 'marked' | 'positional';
}

export interface Nip22CommentReference {
  type: 'nip22-comment';
  root: NoteViewerTargetReference;
  parent: NoteViewerTargetReference;
  rootKind?: number;
  parentKind?: number;
  rootPubkey?: string;
  parentPubkey?: string;
}

export type NoteViewerReplyReference = Nip10ReplyReference | Nip22CommentReference;

export interface Kind1ReplyTagInput {
  root: Pick<NostrEvent, 'id' | 'pubkey'>;
  parent?: Pick<NostrEvent, 'id' | 'pubkey'> | null;
  relay?: string;
}

export interface Nip22CommentTagInput {
  root: Pick<NostrEvent, 'id' | 'pubkey' | 'kind'>;
  parent?: Pick<NostrEvent, 'id' | 'pubkey' | 'kind'> | null;
  relay?: string;
}

export function parseNip10Reply(event: Pick<NostrEvent, 'kind' | 'tags'>): Nip10ReplyReference | null {
  if (event.kind !== KIND_TEXT_NOTE) return null;

  const eTags = event.tags.filter((tag) => tag[0] === 'e' && hasValue(tag, 1));
  if (eTags.length === 0) return null;

  const markedRoot = eTags.find((tag) => tag[3] === 'root');
  const markedReply = [...eTags].reverse().find((tag) => tag[3] === 'reply');

  if (markedRoot) {
    const root = readEventReference(markedRoot);
    const parent = readEventReference(markedReply ?? markedRoot);
    if (!root || !parent) return null;
    return {
      type: 'kind1-reply',
      root,
      parent,
      pubkeys: readUniqueTagValues(event.tags, 'p'),
      source: 'marked',
    };
  }

  const root = readEventReference(eTags[0]);
  const parent = readEventReference(eTags[eTags.length - 1]);
  if (!root || !parent) return null;

  return {
    type: 'kind1-reply',
    root,
    parent,
    pubkeys: readUniqueTagValues(event.tags, 'p'),
    source: 'positional',
  };
}

export function parseNip22Comment(event: Pick<NostrEvent, 'kind' | 'tags'>): Nip22CommentReference | null {
  if (event.kind !== KIND_NIP22_COMMENT) return null;

  const root = readTargetReference(event.tags, 'E', 'A');
  if (!root) return null;
  const rootKind = readFirstNumberTag(event.tags, 'K');
  const rootPubkey = readFirstTagValue(event.tags, 'P');
  const parent = readTargetReference(event.tags, 'e', 'a') ?? root;
  const parentKind = readFirstNumberTag(event.tags, 'k') ?? rootKind;
  const parentPubkey = readFirstTagValue(event.tags, 'p') ?? rootPubkey;

  return {
    type: 'nip22-comment',
    root: applyKindAndPubkey(root, rootKind, rootPubkey),
    parent: applyKindAndPubkey(parent, parentKind, parentPubkey),
    rootKind,
    parentKind,
    rootPubkey,
    parentPubkey,
  };
}

export function parseNoteViewerReply(event: Pick<NostrEvent, 'kind' | 'tags'>): NoteViewerReplyReference | null {
  return parseNip10Reply(event) ?? parseNip22Comment(event);
}

export function createNoteViewerOpenPayload(input: NoteViewerOpenPayload): NoteViewerOpenPayload | null {
  if (!isValidOpenTarget(input.target)) return null;
  const relays = input.relays !== undefined ? uniqueStrings(input.relays.filter((relay) => relay.length > 0)) : undefined;
  const target = relays !== undefined && relays.length > 0
    ? withRelayHintedNip19(input.target, relays)
    : input.target;
  return {
    target,
    ...(relays !== undefined ? { relays } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.behavior !== undefined ? { behavior: input.behavior } : {}),
  };
}

/** Build a validated note request while leaving action and convention independent. */
export function createNoteViewerOpenIntentRequest(
  payload: NoteViewerOpenPayload,
  options: IntentRequestOptions = {},
): IntentRequest | null {
  const note = createNoteViewerOpenPayload(payload);
  return note ? createIntentRequest({ archetype: 'note', ...options, payload: note }) : null;
}

/** Parse a canonical note result so consumers keep explicit no-handler outcomes. */
export function parseNoteViewerOpenIntentResult(value: unknown): IntentResult | null {
  return parseIntentResult(value);
}

export function isNoteViewerOpenPayload(value: unknown): value is NoteViewerOpenPayload {
  if (!isRecord(value)) return false;
  if (!isValidOpenTarget(value.target)) return false;
  if ('relays' in value && !isStringArray(value.relays)) return false;
  return true;
}

export function noteViewerLoadTargetFromPayload(payload: unknown): string | null {
  if (!isNoteViewerOpenPayload(payload)) return null;
  const target = payload.target;
  const relays = uniqueStrings((payload.relays ?? []).filter((relay) => relay.length > 0));
  if (relays.length > 0) {
    const hinted = withRelayHintedNip19(target, relays).nip19;
    if (typeof hinted === 'string' && hinted.trim()) return hinted.trim();
  }
  if (typeof target.nip19 === 'string' && target.nip19.trim()) return target.nip19.trim();
  return target.type === 'event' ? target.id : null;
}

export function createKind1ReplyTags(input: Kind1ReplyTagInput): string[][] {
  const parent = input.parent ?? input.root;
  const tags: string[][] = [
    createEventTag('e', input.root.id, input.relay, 'root'),
  ];

  if (parent.id !== input.root.id) {
    tags.push(createEventTag('e', parent.id, input.relay, 'reply'));
  }

  for (const pubkey of uniqueStrings([input.root.pubkey, parent.pubkey])) {
    tags.push(['p', pubkey]);
  }

  return tags;
}

export function createNip22CommentTags(input: Nip22CommentTagInput): string[][] | null {
  const parent = input.parent ?? input.root;
  if (input.root.kind === KIND_TEXT_NOTE || parent.kind === KIND_TEXT_NOTE) return null;

  const tags: string[][] = [
    createEventTag('E', input.root.id, input.relay),
    ['K', String(input.root.kind)],
    ['P', input.root.pubkey],
  ];

  if (parent.id !== input.root.id || parent.kind !== input.root.kind) {
    tags.push(createEventTag('e', parent.id, input.relay));
    tags.push(['k', String(parent.kind)]);
    tags.push(['p', parent.pubkey]);
  }

  return tags;
}

function readTargetReference(
  tags: string[][],
  eventTagName: 'E' | 'e',
  addressTagName: 'A' | 'a',
): NoteViewerTargetReference | null {
  const eventRef = readEventReference(tags.find((tag) => tag[0] === eventTagName));
  if (eventRef) return eventRef;

  const addressTag = tags.find((tag) => tag[0] === addressTagName);
  if (!addressTag || !hasValue(addressTag, 1)) return null;
  const address = addressTag[1]!;
  return {
    type: 'address',
    address,
    ...(hasValue(addressTag, 2) ? { relay: addressTag[2] } : {}),
  };
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

function isValidOpenTarget(value: unknown): value is NoteViewerOpenTarget {
  if (!isRecord(value)) return false;
  if (value.type === 'event') {
    if (!isLowerHex64(value.id)) return false;
    if ('kind' in value && !isInteger(value.kind)) return false;
    if ('pubkey' in value && !isLowerHex64(value.pubkey)) return false;
    if ('nip19' in value && typeof value.nip19 !== 'string') return false;
    return true;
  }

  if (value.type === 'address') {
    if (!isInteger(value.kind)) return false;
    if (!isLowerHex64(value.pubkey)) return false;
    if (typeof value.identifier !== 'string') return false;
    if ('nip19' in value && typeof value.nip19 !== 'string') return false;
    return true;
  }

  return false;
}

function withRelayHintedNip19(target: NoteViewerOpenTarget, relays: string[]): NoteViewerOpenTarget {
  try {
    if (target.type === 'event') {
      return {
        ...target,
        nip19: nip19.neventEncode({
          id: target.id,
          relays,
          ...(target.pubkey ? { author: target.pubkey } : {}),
          ...(target.kind !== undefined ? { kind: target.kind } : {}),
        }),
      };
    }

    return {
      ...target,
      nip19: nip19.naddrEncode({
        kind: target.kind,
        pubkey: target.pubkey,
        identifier: target.identifier,
        relays,
      }),
    };
  } catch {
    return target;
  }
}

function isLowerHex64(value: unknown): value is string {
  return typeof value === 'string' && LOWER_HEX_64.test(value);
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readEventReference(tag: string[] | undefined): EventReference | null {
  if (!tag || !hasValue(tag, 1)) return null;
  const id = tag[1]!;
  return {
    type: 'event',
    id,
    ...(hasValue(tag, 2) ? { relay: tag[2] } : {}),
    ...(hasValue(tag, 3) ? { marker: tag[3] } : {}),
  };
}

function applyKindAndPubkey<T extends NoteViewerTargetReference>(
  ref: T,
  kind: number | undefined,
  pubkey: string | undefined,
): T {
  return {
    ...ref,
    ...(kind !== undefined ? { kind } : {}),
    ...(pubkey !== undefined ? { pubkey } : {}),
  };
}

function createEventTag(name: 'e' | 'E', id: string, relay?: string, marker?: string): string[] {
  const tag = [name, id];
  if (relay || marker) tag.push(relay ?? '');
  if (marker) tag.push(marker);
  return tag;
}

function readFirstTagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find((candidate) => candidate[0] === name && hasValue(candidate, 1));
  return tag?.[1];
}

function readFirstNumberTag(tags: string[][], name: string): number | undefined {
  const value = readFirstTagValue(tags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readUniqueTagValues(tags: string[][], name: string): string[] {
  const values: string[] = [];
  for (const tag of tags) {
    if (tag[0] === name && hasValue(tag, 1)) {
      values.push(tag[1]!);
    }
  }
  return uniqueStrings(values);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function hasValue(tag: string[], index: number): tag is string[] & { [key: number]: string } {
  return typeof tag[index] === 'string' && tag[index].length > 0;
}
