/**
 * Unsigned NIP-5D templates for a single-file app: a kind 5129 snapshot and a
 * kind 35129 named app with the canonical tags `d`, `title`, one `x`, `server`,
 * `R`/`O`, and on the snapshot one bare `a` lineage coordinate. Shared by the
 * shell (promotion) and the harness (drafts); `scripts/publish-draft-napplet.mjs`
 * emits the same tags for hand-published drafts.
 */
export const NAPPLET_SNAPSHOT_KIND = 5129;
export const NAPPLET_NAMED_KIND = 35129;

export interface NappletTemplateOptions {
  readonly pubkey: string;
  readonly dTag: string;
  readonly artifactHash: string;
  readonly title: string;
  readonly description: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly blossomUrl: string;
  /** Extra canonical tags appended to both events (for example provenance `p`). */
  readonly extraTags?: readonly string[][];
  readonly now?: number;
}

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface NappletTemplates {
  readonly address: string;
  readonly snapshot: EventTemplate;
  readonly named: EventTemplate;
}

export function buildNappletTemplates(options: NappletTemplateOptions): NappletTemplates {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const address = `${NAPPLET_NAMED_KIND}:${options.pubkey}:${options.dTag}`;
  const domainTags = [
    ...options.requires.map((domain) => ['R', domain]),
    ...options.optional.filter((domain) => !options.requires.includes(domain)).map((domain) => ['O', domain]),
  ];
  const extra = (options.extraTags ?? []).map((tag) => [...tag]);
  return {
    address,
    snapshot: {
      kind: NAPPLET_SNAPSHOT_KIND,
      created_at: now,
      tags: [['title', options.title], ['x', options.artifactHash], ['server', options.blossomUrl], ...domainTags, ['a', address], ...extra],
      content: options.description,
    },
    named: {
      kind: NAPPLET_NAMED_KIND,
      created_at: now,
      tags: [['d', options.dTag], ['title', options.title], ['x', options.artifactHash], ['server', options.blossomUrl], ...domainTags, ...extra],
      content: options.description,
    },
  };
}
