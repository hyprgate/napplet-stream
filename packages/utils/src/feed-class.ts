// feed-class.ts — feed-class window detection (Phase 89, Plan 01).
//
// Two kinds of window run the feed napplet and must show the shell feed bar:
//   - the launcher-opened feed napplet, stamped `class: 'feed'` (= the registry
//     id, see Launcher.svelte openNapplet)
//   - each intent-opened feed window, stamped `feed-<seq>` by the intent
//     controller (intent-window-controller.ts), where <seq> is a number.
//
// A naive `startsWith('feed-')` prefix test was WRONG on both ends: it MISSED
// the launcher feed window (`feed`, no dash) and FALSE-MATCHED `feed-builder`
// (the "Feeds & Filters" napplet), which mounted the feed bar on the wrong
// window and never on the actual feed. Match the two real shapes exactly.

/** The class prefix stamped on intent-opened feed-archetype windows. */
export const FEED_CLASS_PREFIX = 'feed-';

/** The class stamped on the launcher-opened feed napplet window. */
export const FEED_BASE_CLASS = 'feed';

/** Intent windows: `feed-` followed by the numeric controller sequence. */
const FEED_INTENT_CLASS = /^feed-\d+$/;

/**
 * Whether `c` is a feed-class window: the base `feed` napplet window or an
 * intent-spawned `feed-<seq>` window. Deliberately excludes sibling napplets
 * like `feed-builder` whose class merely shares the `feed-` prefix.
 */
export function isFeedWindowClass(c: string): boolean {
  return c === FEED_BASE_CLASS || FEED_INTENT_CLASS.test(c);
}
