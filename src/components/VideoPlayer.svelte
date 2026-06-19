<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { pubkeyColorStyle, requestRuntimePlayback, releaseRuntimePlayback } from '@hyprgate/utils';
  import type { LiveStream } from '../lib/stream-store';

  interface Props {
    stream: LiveStream;
    onback?: () => void;
  }

  let { stream, onback }: Props = $props();

  let error: string | null = $state(null);
  let runtimeSessionId: string | null = null;
  let playbackRequestToken = 0;
  let destroyed = false;

  function truncatePubkey(pubkey: string): string {
    if (pubkey.length <= 16) return pubkey;
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  }

  onMount(async () => {
    const token = ++playbackRequestToken;
    try {
      const result = await requestRuntimePlayback({
        url: stream.streamUrl,
        kind: 'hls',
        title: stream.title,
        artist: stream.service || undefined,
        album: 'Live streams',
        artworkUrl: stream.image || undefined,
        context: {
          label: 'Live streams',
          detail: stream.tags.length > 0 ? stream.tags.join(', ') : stream.service || undefined,
        },
        capabilities: ['play', 'pause', 'stop', 'setVolume', 'setMuted'],
        autoplay: true,
        live: true,
      });
      if (destroyed || token !== playbackRequestToken) {
        void releaseRuntimePlayback(result.sessionId).catch((releaseError) => {
          console.warn('[livestream] stale player.release failed', releaseError);
        });
        return;
      }
      runtimeSessionId = result.sessionId;
    } catch (e) {
      if (destroyed || token !== playbackRequestToken) return;
      error = e instanceof Error ? e.message : 'runtime playback failed';
      console.warn('[livestream] player.requestPlayback failed', e);
    }
  });

  onDestroy(() => {
    destroyed = true;
    playbackRequestToken++;
    if (runtimeSessionId) void releaseRuntimePlayback(runtimeSessionId);
    runtimeSessionId = null;
  });
</script>

<div class="video-player flex flex-col h-full bg-bg-base text-text-primary font-mono">
  <!-- Back bar -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <button
      type="button"
      class="text-text-muted hover:text-accent-green text-xs font-mono transition-colors flex items-center gap-1"
      onclick={onback}
    >
      <span>←</span>
      <span>back to streams</span>
    </button>
    <div class="flex-1"></div>
    <!-- LIVE indicator -->
    <div class="flex items-center gap-1">
      <span class="w-2 h-2 bg-accent-red rounded-full animate-pulse"></span>
      <span class="text-accent-red text-xs">LIVE</span>
    </div>
  </div>

  <!-- Video area -->
  <div class="relative bg-bg-base flex-shrink-0" style="aspect-ratio: 16/9;">
    <div class="w-full h-full flex items-center justify-center text-text-muted text-xs">
      {#if error == null}
        playing
      {/if}
    </div>

    {#if error != null}
      <div class="absolute inset-0 flex items-center justify-center bg-bg-base/95">
        <div class="text-center px-4">
          <div class="text-accent-red text-sm mb-1">stream unavailable</div>
          <div class="text-text-dim text-xs mt-1">{error}</div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Stream info -->
  <div class="flex-1 overflow-y-auto p-3 space-y-2">
    <!-- Title + viewer count -->
    <div class="flex items-start justify-between gap-2">
      <h2 class="text-text-primary text-sm font-mono leading-tight">{stream.title}</h2>
      {#if stream.viewerCount > 0}
        <div class="flex items-center gap-1 text-text-muted text-xs flex-shrink-0">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {stream.viewerCount}
        </div>
      {/if}
    </div>

    <!-- Host -->
    <div class="text-text-muted text-xs">
      host: <span style={pubkeyColorStyle(stream.hostPubkey)}>{truncatePubkey(stream.hostPubkey)}</span>
    </div>

    <!-- Service -->
    {#if stream.service}
      <div class="text-text-muted text-xs">
        via: <span class="text-accent-green">{stream.service}</span>
      </div>
    {/if}

    <!-- Summary -->
    {#if stream.summary}
      <p class="text-text-muted text-xs leading-relaxed border-t border-border-dim pt-2">
        {stream.summary}
      </p>
    {/if}

    <!-- Tags -->
    {#if stream.tags.length > 0}
      <div class="flex flex-wrap gap-1 pt-1">
        {#each stream.tags as tag}
          <span class="bg-bg-surface border border-border-dim text-text-muted text-xs font-mono px-1 py-0.5 rounded">
            #{tag}
          </span>
        {/each}
      </div>
    {/if}
  </div>
</div>
