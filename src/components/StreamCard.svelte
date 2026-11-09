<script lang="ts">
  import { onDestroy } from 'svelte';
  import { pubkeyReadableColor, resourceImage } from '@hyprgate/utils';
  import type { RuntimePlayerStatus } from '@hyprgate/utils';
  import { isStaleLive, isWatchable, type LiveStream, type StreamPhase } from '../lib/stream-store';
  import type { ProfileContent } from '../lib/profile-metadata';
  import { formatAge, formatUntil, npubFor, playbackLabel, shortNpub } from '../lib/stream-format';

  interface Props {
    stream: LiveStream;
    phase?: StreamPhase;
    now?: number;
    profile?: ProfileContent;
    active?: boolean;
    playbackState?: RuntimePlayerStatus | null;
    error?: boolean;
    disabled?: boolean;
    onselect?: (stream: LiveStream) => void;
    onhost?: (pubkey: string) => void;
  }

  let {
    stream,
    phase = 'live',
    now = Math.floor(Date.now() / 1000),
    profile,
    active = false,
    playbackState = null,
    error = false,
    disabled = false,
    onselect,
    onhost,
  }: Props = $props();

  const IMAGE_FALLBACK_DELAY_MS = 30_000;

  let imageState = $state<'loading' | 'loaded' | 'fallback'>('fallback');
  let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearFallbackTimeout() {
    if (fallbackTimeout == null) return;
    clearTimeout(fallbackTimeout);
    fallbackTimeout = null;
  }

  function resetImageState(image: string) {
    clearFallbackTimeout();
    if (!image) {
      imageState = 'fallback';
      return;
    }

    imageState = 'loading';
    fallbackTimeout = setTimeout(() => {
      if (imageState === 'loading') imageState = 'fallback';
      fallbackTimeout = null;
    }, IMAGE_FALLBACK_DELAY_MS);
  }

  $effect(() => {
    resetImageState(stream.image);
  });

  onDestroy(clearFallbackTimeout);

  let hostName = $derived(profile?.display_name?.trim() || profile?.name?.trim() || shortNpub(stream.hostPubkey));
  let hostInitial = $derived((hostName[0] ?? '?').toUpperCase());
  let watchable = $derived(isWatchable(stream, now));
  let stale = $derived(isStaleLive(stream, now));
  let badge = $derived.by(() => {
    if (phase === 'live') return 'LIVE';
    if (phase === 'upcoming') return 'UPCOMING';
    if (stale) return 'QUIET';
    return watchable ? 'REPLAY' : 'ENDED';
  });
  let timing = $derived.by(() => {
    if (phase === 'upcoming') {
      if (stream.starts === null) return 'Start time not set';
      return stream.starts > now ? `Starts ${formatUntil(stream.starts, now)}` : `Was due ${formatAge(stream.starts, now)}`;
    }
    if (stale) return `No update for ${formatAge(stream.createdAt, now).replace(' ago', '')}`;
    if (phase === 'ended') return `Ended ${formatAge(stream.ends ?? stream.createdAt, now)}`;
    return `Started ${formatAge(stream.starts ?? stream.createdAt, now)}`;
  });
  let actionLabel = $derived(watchable ? `Watch ${stream.title}` : stream.title);

  function handleClick() {
    if (disabled || !watchable) return;
    onselect?.(stream);
  }

  function handleImageLoad() {
    clearFallbackTimeout();
    imageState = 'loaded';
  }

  function handleImageError() {
    clearFallbackTimeout();
    imageState = 'fallback';
  }
</script>

<article
  class="stream-card bg-bg-surface border border-border-default rounded transition-colors duration-150 overflow-hidden"
  class:active
  class:error
  class:disabled
  class:not-watchable={!watchable}
  data-stream-phase={phase}
>
  <button
    type="button"
    class="card-main"
    onclick={handleClick}
    disabled={!watchable}
    aria-pressed={watchable ? active : undefined}
    aria-label={actionLabel}
  >
    <span class="thumb relative block aspect-video bg-gradient-to-br from-bg-base to-bg-surface overflow-hidden">
      {#if stream.image && imageState !== 'fallback'}
        <img
          use:resourceImage={stream.image}
          alt=""
          class="stream-thumbnail w-full h-full object-cover"
          class:loaded={imageState === 'loaded'}
          loading="lazy"
          decoding="async"
          data-stream-thumbnail
          onload={handleImageLoad}
          onerror={handleImageError}
        />
      {/if}

      {#if imageState !== 'loaded'}
        <span
          class="stream-thumbnail-placeholder"
          data-stream-thumbnail-placeholder
          data-thumbnail-state={imageState}
          aria-hidden="true"
        >
          <span class="stream-placeholder-mark">
            <span></span>
            <span></span>
          </span>
        </span>
      {/if}

      <span class="phase-badge" data-badge={badge}>{badge}</span>

      {#if active || error}
        <span class="media-state" data-playback-state={playbackState ?? 'selected'}>
          <span class="state-pill">{playbackLabel(playbackState, error)}</span>
        </span>
      {/if}

      {#if stream.viewerCount > 0 && phase === 'live'}
        <span class="viewers" aria-label="{stream.viewerCount} watching">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {stream.viewerCount}
        </span>
      {/if}
    </span>

    <span class="stream-title">{stream.title}</span>
    {#if stream.summary}
      <span class="stream-summary">{stream.summary}</span>
    {/if}
  </button>

  <div class="stream-foot">
    <button
      type="button"
      class="host"
      title={npubFor(stream.hostPubkey)}
      onclick={() => onhost?.(stream.hostPubkey)}
    >
      <span class="avatar-shell" aria-hidden="true">
        <span class="avatar avatar-fallback" style="background:{pubkeyReadableColor(stream.hostPubkey)}">{hostInitial}</span>
        {#if profile?.picture}
          <img use:resourceImage={profile.picture} alt="" class="avatar" />
        {/if}
      </span>
      <span class="host-name">{hostName}</span>
    </button>
    <span class="timing">{timing}</span>
  </div>

  {#if stream.service || stream.tags.length > 0}
    <div class="stream-tags">
      {#if stream.service}
        <span class="stream-tag service">{stream.service}</span>
      {/if}
      {#each stream.tags.slice(0, 3) as tag}
        <span class="stream-tag">#{tag}</span>
      {/each}
    </div>
  {/if}
</article>

<style>
  .stream-card:hover:not(.not-watchable) {
    border-color: var(--hg-accent-green, #70f0a0);
  }

  .stream-card.active {
    border-color: var(--hg-accent-green, #70f0a0);
    box-shadow: 0 0 0 1px var(--hg-accent-green, #70f0a0);
  }

  .stream-card.error {
    border-color: var(--hg-accent-red, #ff6b6b);
  }

  .stream-card.error .state-pill {
    color: var(--hg-accent-red, #ff6b6b);
  }

  .stream-card.disabled .card-main {
    cursor: wait;
  }

  .card-main {
    display: block;
    width: 100%;
    padding: 0;
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }

  .card-main:disabled {
    cursor: default;
  }

  .card-main:focus-visible,
  .host:focus-visible {
    outline: 2px solid var(--hg-accent-green, #70f0a0);
    outline-offset: -2px;
  }

  .not-watchable .thumb,
  [data-stream-phase='ended'] .thumb {
    filter: saturate(0.55);
    opacity: 0.8;
  }

  .phase-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--hg-text-primary, #f2efe7);
    background: color-mix(in srgb, var(--hg-bg-base, #050505) 82%, transparent);
  }

  .phase-badge[data-badge='LIVE'] {
    color: var(--hg-bg-base, #050505);
    background: var(--hg-accent-red, #ff6b6b);
  }

  .viewers {
    position: absolute;
    right: 6px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    color: var(--hg-text-primary, #f2efe7);
    background: color-mix(in srgb, var(--hg-bg-base, #050505) 82%, transparent);
  }

  .stream-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 8px 10px 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--hg-text-primary, #f2efe7);
  }

  .stream-summary {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 4px 10px 0;
    font-size: 12px;
    line-height: 1.35;
    color: var(--hg-text-muted, #b8b1a4);
  }

  .stream-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px 10px;
    min-width: 0;
  }

  .host {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--hg-text-muted, #b8b1a4);
    background: none;
    border: none;
    cursor: pointer;
  }

  .host:hover .host-name {
    color: var(--hg-text-primary, #f2efe7);
    text-decoration: underline;
  }

  .host-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .avatar-shell {
    display: grid;
    flex: none;
    width: 22px;
    height: 22px;
  }

  .avatar {
    grid-area: 1 / 1;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-fallback {
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--hg-bg-base, #050505);
  }

  .timing {
    flex: none;
    font-size: 11px;
    color: var(--hg-text-muted, #b8b1a4);
    opacity: 0.8;
  }

  .stream-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 10px 10px;
  }

  .stream-tag {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    color: var(--hg-text-muted, #b8b1a4);
    border: 1px solid var(--hg-border-dim, #2a2a2a);
  }

  .stream-tag.service {
    color: var(--hg-accent-green, #70f0a0);
    border-color: color-mix(in srgb, var(--hg-accent-green, #70f0a0) 30%, transparent);
  }

  .stream-thumbnail {
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .stream-thumbnail.loaded {
    opacity: 1;
  }

  .stream-thumbnail-placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 50% 46%, color-mix(in srgb, var(--hg-text-muted, #7d8491) 8%, transparent), transparent 36%),
      color-mix(in srgb, var(--hg-bg-surface, #151820) 94%, var(--hg-text-muted, #7d8491) 6%);
  }

  .stream-placeholder-mark {
    position: relative;
    width: 48px;
    height: 30px;
    opacity: 0.28;
  }

  .stream-placeholder-mark span {
    position: absolute;
    inset-inline: 0;
    height: 9px;
    border: 3px solid var(--hg-text-muted, #7d8491);
    border-radius: 999px;
    transform: skewX(-28deg) rotate(-8deg);
  }

  .stream-placeholder-mark span:first-child {
    top: 2px;
  }

  .stream-placeholder-mark span:last-child {
    bottom: 2px;
  }

  .media-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    padding: 6px;
    background: color-mix(in srgb, var(--hg-bg-base, #050505) 22%, transparent);
    pointer-events: none;
  }

  .state-pill {
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: var(--hg-text-primary, #f2efe7);
    background: color-mix(in srgb, var(--hg-bg-base, #050505) 82%, transparent);
  }
</style>
