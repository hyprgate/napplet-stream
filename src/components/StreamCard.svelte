<script lang="ts">
  import { pubkeyColorStyle, resourceImage } from '@hyprgate/utils';
  import type { RuntimePlayerStatus } from '@hyprgate/utils';
  import type { LiveStream } from '../lib/stream-store';

  interface Props {
    stream: LiveStream;
    active?: boolean;
    playbackState?: RuntimePlayerStatus | null;
    error?: boolean;
    disabled?: boolean;
    onselect?: (stream: LiveStream) => void;
  }

  let {
    stream,
    active = false,
    playbackState = null,
    error = false,
    disabled = false,
    onselect,
  }: Props = $props();

  function truncatePubkey(pubkey: string): string {
    if (pubkey.length <= 16) return pubkey;
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  }

  function handleClick() {
    if (disabled) return;
    onselect?.(stream);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onselect?.(stream);
    }
  }
</script>

<div
  class="stream-card bg-bg-surface border border-border-default hover:border-accent-green cursor-pointer rounded transition-colors duration-150 overflow-hidden"
  class:active
  class:error
  class:disabled
  onclick={handleClick}
  onkeydown={handleKeyDown}
  role="button"
  tabindex="0"
  aria-label="Watch {stream.title}"
>
  <!-- Thumbnail -->
  <div class="relative aspect-video bg-gradient-to-br from-bg-base to-bg-surface overflow-hidden">
    {#if stream.image}
      <img
        use:resourceImage={stream.image}
        alt={stream.title}
        class="w-full h-full object-cover"
        onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    {:else}
      <!-- Placeholder gradient with cypherpunk aesthetic -->
      <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-green/5 to-accent-green/20">
        <span class="text-accent-green/40 text-2xl font-mono">▶</span>
      </div>
    {/if}

    <!-- LIVE badge -->
    <div class="absolute top-1 left-1 bg-accent-red/90 text-bg-base text-xs font-mono px-1.5 py-0.5 rounded">
      LIVE
    </div>

    {#if active}
      <div class="media-state" aria-label={playbackState ?? 'selected'}>
        {#if error}
          !
        {:else if playbackState === 'playing' || playbackState === 'loading'}
          II
        {:else}
          >
        {/if}
      </div>
    {/if}

    <!-- Viewer count -->
    {#if stream.viewerCount > 0}
      <div class="absolute bottom-1 right-1 bg-bg-base/80 text-text-muted text-xs font-mono px-1.5 py-0.5 rounded flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {stream.viewerCount}
      </div>
    {/if}
  </div>

  <!-- Info -->
  <div class="p-2 space-y-1">
    <!-- Title (truncate to 2 lines) -->
    <div
      class="text-text-primary text-sm font-mono leading-tight overflow-hidden"
      style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;"
    >
      {stream.title}
    </div>

    <!-- Host pubkey -->
    <div class="text-xs font-mono" style={pubkeyColorStyle(stream.hostPubkey)}>
      {truncatePubkey(stream.hostPubkey)}
    </div>

    <!-- Service badge + tags row -->
    <div class="flex flex-wrap gap-1">
      {#if stream.service}
        <span class="bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs font-mono px-1 py-0.5 rounded">
          {stream.service}
        </span>
      {/if}
      {#each stream.tags.slice(0, 3) as tag}
        <span class="bg-bg-base border border-border-dim text-text-muted text-xs font-mono px-1 py-0.5 rounded">
          #{tag}
        </span>
      {/each}
    </div>
  </div>
</div>

<style>
  .stream-card.active {
    border-color: var(--hg-accent-green, #70f0a0);
    box-shadow:
      0 0 0 1px var(--hg-accent-green, #70f0a0),
      0 0 24px color-mix(in srgb, var(--hg-accent-green, #70f0a0) 34%, transparent);
  }

  .stream-card.error {
    border-color: var(--hg-accent-red, #ff6b6b);
  }

  .stream-card.disabled {
    cursor: wait;
    opacity: 0.75;
  }

  .media-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--hg-text-primary, #f2efe7);
    font-size: 28px;
    font-weight: 700;
    text-shadow: 0 2px 14px #000;
    background: color-mix(in srgb, var(--hg-bg-base, #050505) 22%, transparent);
    pointer-events: none;
  }
</style>
