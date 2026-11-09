import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_NIP5D_NAMED,
  KIND_NIP5D_ROOT,
  KIND_NIP5D_SNAPSHOT,
  KIND_SOFTWARE_APPLICATION,
} from './nip-constants.js';

export type DraftAppStoreListingParseFailureReason =
  | 'wrong-kind'
  | 'invalid-publisher'
  | 'incomplete-listing';

export interface DraftAppStoreListingParseFailure {
  ok: false;
  reason: DraftAppStoreListingParseFailureReason;
  issues: string[];
}

export interface DraftAppStoreRootReference {
  type: 'root';
  kind: typeof KIND_NIP5D_ROOT;
  pubkey: string;
  relays: string[];
}

export interface DraftAppStoreNamedReference {
  type: 'named';
  kind: typeof KIND_NIP5D_NAMED;
  pubkey: string;
  dTag: string;
  relays: string[];
}

export interface DraftAppStoreSnapshotReference {
  type: 'snapshot';
  kind: typeof KIND_NIP5D_SNAPSHOT;
  eventId: string;
  relays: string[];
  /** Hyprgate-local draft marker until upstream snapshot reference language exists. */
  marker: 'nip5d:snapshot';
}

export type DraftAppStoreNip5dReference =
  | DraftAppStoreRootReference
  | DraftAppStoreNamedReference
  | DraftAppStoreSnapshotReference;

export interface DraftAppStoreGeneratedReference {
  type: 'generated';
  id: string;
  tag: string[];
}

export type DraftAppStoreListingIssue =
  | 'missing-summary'
  | 'missing-description'
  | 'missing-screenshot'
  | 'missing-label-or-topic'
  | 'missing-app-reference';

export interface DraftAppStoreListing {
  address: string;
  publisher: string;
  dTag: string;
  name: string;
  summary: string;
  description: string;
  /** NIP-82 `icon` URL when present and http(s). */
  icon?: string;
  screenshots: string[];
  labels: string[];
  labelNamespaces: string[];
  topics: string[];
  /** NIP-82 `url` website. */
  website?: string;
  /** NIP-82 `repository` clone URL. */
  repository?: string;
  /** NIP-82 `a` pointer to a NIP-34 repository announcement. */
  repositoryAddress?: string;
  /** NIP-82 SPDX `license` identifier. */
  license?: string;
  /** NIP-82 `f` platform identifiers. */
  platforms: string[];
  /** Draft `version` label. */
  version?: string;
  nip5dReferences: DraftAppStoreNip5dReference[];
  generatedReferences: DraftAppStoreGeneratedReference[];
  provisionalTags: string[][];
  /**
   * Recommended fields that are absent. The listing is still usable; the App
   * Store uses these to score listing completeness.
   */
  issues: DraftAppStoreListingIssue[];
  event: NostrEvent;
}

export type DraftAppStoreListingParseResult =
  | { ok: true; listing: DraftAppStoreListing }
  | DraftAppStoreListingParseFailure;

export function parseDraftAppStoreListingEvent(event: NostrEvent): DraftAppStoreListingParseResult {
  if (event.kind !== KIND_SOFTWARE_APPLICATION) {
    return { ok: false, reason: 'wrong-kind', issues: [`expected-kind-${KIND_SOFTWARE_APPLICATION}`] };
  }

  if (!isLowerHex64(event.pubkey)) {
    return { ok: false, reason: 'invalid-publisher', issues: ['invalid-publisher-pubkey'] };
  }

  const dTag = firstTag(event, 'd');
  const name = firstTag(event, 'name');
  const summary = firstTag(event, 'summary') ?? '';
  const description = trimmed(event.content) ?? '';
  const icon = httpUrl(firstTag(event, 'icon'));
  const screenshots = tagValues(event, 'image').concat(tagValues(event, 'screenshot')).filter((url) => httpUrl(url));
  const labels = tagValues(event, 'l');
  const labelNamespaces = tagValues(event, 'L');
  const topics = tagValues(event, 't');
  const website = httpUrl(firstTag(event, 'url'));
  const repository = firstTag(event, 'repository');
  const repositoryAddress = event.tags.find((tag) => tag[0] === 'a' && /^30617:[0-9a-f]{64}:/.test(tag[1] ?? ''))?.[1];
  const license = firstTag(event, 'license');
  const platforms = tagValues(event, 'f');
  const version = firstTag(event, 'version');
  const nip5dReferences = parseNip5dReferences(event);
  const generatedReferences = parseGeneratedReferences(event);
  const issues: DraftAppStoreListingIssue[] = [];

  // NIP-82 requires only `d` and `name`; everything else is recommended.
  const missing: string[] = [];
  if (!dTag) missing.push('missing-d');
  if (!name) missing.push('missing-name');
  if (!summary) issues.push('missing-summary');
  if (!description) issues.push('missing-description');
  if (screenshots.length === 0) issues.push('missing-screenshot');
  if (labels.length === 0 && topics.length === 0) issues.push('missing-label-or-topic');
  if (nip5dReferences.length === 0 && generatedReferences.length === 0) issues.push('missing-app-reference');

  if (missing.length > 0 || !dTag || !name) {
    return { ok: false, reason: 'incomplete-listing', issues: [...missing, ...issues] };
  }

  return {
    ok: true,
    listing: {
      address: `${KIND_SOFTWARE_APPLICATION}:${event.pubkey}:${dTag}`,
      publisher: event.pubkey,
      dTag,
      name,
      summary,
      description,
      ...(icon ? { icon } : {}),
      screenshots,
      labels,
      labelNamespaces,
      topics,
      ...(website ? { website } : {}),
      ...(repository ? { repository } : {}),
      ...(repositoryAddress ? { repositoryAddress } : {}),
      ...(license ? { license } : {}),
      platforms,
      ...(version ? { version } : {}),
      nip5dReferences,
      generatedReferences,
      provisionalTags: event.tags.filter((tag) => tag[0]?.startsWith('hyprgate:')).map((tag) => [...tag]),
      issues,
      event,
    },
  };
}

function httpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseNip5dReferences(event: NostrEvent): DraftAppStoreNip5dReference[] {
  const references: DraftAppStoreNip5dReference[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'a') {
      const address = tag[1];
      if (!address) continue;
      const [kindText, pubkey, ...dTagParts] = address.split(':');
      const kind = Number(kindText);
      const dTag = dTagParts.join(':');
      if (!isLowerHex64(pubkey)) continue;
      if (kind === KIND_NIP5D_ROOT && dTag === '') {
        references.push({ type: 'root', kind: KIND_NIP5D_ROOT, pubkey, relays: tag.slice(2).filter(isRelayHint) });
        continue;
      }
      if (kind === KIND_NIP5D_NAMED && dTag) {
        references.push({ type: 'named', kind: KIND_NIP5D_NAMED, pubkey, dTag, relays: tag.slice(2).filter(isRelayHint) });
      }
      continue;
    }

    if (tag[0] === 'e' && isLowerHex64(tag[1])) {
      const markerIndex = tag.indexOf('nip5d:snapshot', 2);
      if (markerIndex === -1) continue;
      references.push({
        type: 'snapshot',
        kind: KIND_NIP5D_SNAPSHOT,
        eventId: tag[1],
        relays: tag.slice(2, markerIndex).filter(isRelayHint),
        marker: 'nip5d:snapshot',
      });
    }
  }
  return references;
}

function parseGeneratedReferences(event: NostrEvent): DraftAppStoreGeneratedReference[] {
  const references: DraftAppStoreGeneratedReference[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'hyprgate:registry') continue;
    const id = trimmed(tag[1]);
    if (!isGeneratedRegistryId(id)) continue;
    references.push({ type: 'generated', id, tag: [...tag] });
  }
  return references;
}

function firstTag(event: NostrEvent, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== name) continue;
    const value = trimmed(tag[1]);
    if (value) return value;
  }
  return null;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === name)
    .map((tag) => trimmed(tag[1]))
    .filter((value): value is string => value != null);
}

function trimmed(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

function isLowerHex64(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGeneratedRegistryId(value: string | null): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isRelayHint(value: string): boolean {
  return value.startsWith('wss://') || value.startsWith('ws://');
}
