import * as nip19 from 'nostr-tools/nip19';

export function formatAge(unixSeconds: number, nowSeconds: number): string {
  const seconds = Math.max(0, nowSeconds - unixSeconds);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatUntil(unixSeconds: number, nowSeconds: number): string {
  const seconds = unixSeconds - nowSeconds;
  if (seconds < 60) return 'soon';
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `in ${Math.round(seconds / 3600)}h`;
  return `in ${Math.round(seconds / 86_400)}d`;
}

export function npubFor(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

/** Keeps both ends of the npub so two people with no profile stay tellable apart. */
export function shortNpub(pubkey: string): string {
  const npub = npubFor(pubkey);
  return npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub;
}

export function playbackLabel(state: string | null, error: boolean): string {
  if (error || state === 'error') return "Can't play this one";
  if (state === 'playing') return 'Now playing';
  if (state === 'loading') return 'Loading';
  if (state === 'paused') return 'Paused';
  return 'Selected';
}
