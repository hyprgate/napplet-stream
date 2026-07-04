// feed-class.test.ts — feed-class window detector (Phase 89, Plan 01).
//
// A feed-class window is either the launcher-opened `feed` napplet window or an
// intent-spawned `feed-<seq>` window. Sibling napplets that merely share the
// `feed-` prefix (e.g. `feed-builder`) are NOT feed-class windows.

import { describe, it, expect } from 'vitest';
import { FEED_CLASS_PREFIX, FEED_BASE_CLASS, isFeedWindowClass } from './feed-class.js';

describe('isFeedWindowClass', () => {
  it('exports the canonical prefix and base class', () => {
    expect(FEED_CLASS_PREFIX).toBe('feed-');
    expect(FEED_BASE_CLASS).toBe('feed');
  });

  it('returns true for the launcher-opened feed napplet window', () => {
    expect(isFeedWindowClass('feed')).toBe(true);
  });

  it('returns true for an intent-spawned feed-<seq> window', () => {
    expect(isFeedWindowClass('feed-3')).toBe(true);
    expect(isFeedWindowClass('feed-12')).toBe(true);
  });

  it('returns false for the feed-builder ("Feeds & Filters") napplet', () => {
    expect(isFeedWindowClass('feed-builder')).toBe(false);
  });

  it('returns false for the bare prefix with no sequence', () => {
    expect(isFeedWindowClass('feed-')).toBe(false);
  });

  it('returns false for a non-feed window class', () => {
    expect(isFeedWindowClass('runtime-video-ws-1')).toBe(false);
    expect(isFeedWindowClass('settings')).toBe(false);
  });

  it('returns false for an empty class', () => {
    expect(isFeedWindowClass('')).toBe(false);
  });
});
