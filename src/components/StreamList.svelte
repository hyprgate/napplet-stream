<script lang="ts">
  import type { RuntimePlayerStatus } from '@hyprgate/utils';
  import type { LiveStream } from '../lib/stream-store';
  import StreamCard from './StreamCard.svelte';

  interface Props {
    streams: LiveStream[];
    loading: boolean;
    activeStreamId?: string | null;
    playbackState?: RuntimePlayerStatus | null;
    errorStreamId?: string | null;
    disabled?: boolean;
    onselect?: (stream: LiveStream) => void;
  }

  let {
    streams,
    loading,
    activeStreamId = null,
    playbackState = null,
    errorStreamId = null,
    disabled = false,
    onselect,
  }: Props = $props();
</script>

<div class="stream-list h-full overflow-y-auto p-3">
  {#if loading && streams.length === 0}
    <!-- Loading skeletons -->
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
      {#each [1, 2, 3] as _}
        <div class="bg-bg-surface border border-border-default rounded overflow-hidden animate-pulse">
          <div class="aspect-video bg-bg-base"></div>
          <div class="p-2 space-y-2">
            <div class="h-3 bg-bg-base rounded w-3/4"></div>
            <div class="h-3 bg-bg-base rounded w-1/2"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if streams.length === 0}
    <!-- Empty state -->
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
      <div class="text-text-muted text-3xl font-mono">▓▒░</div>
      <p class="text-text-muted text-sm font-mono">no live streams found</p>
      <p class="text-text-dim text-xs font-mono">streams will appear when broadcasters go live</p>
    </div>
  {:else}
    <!-- Stream grid -->
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
      {#each streams as stream (stream.id)}
        <StreamCard
          {stream}
          active={activeStreamId === stream.id}
          playbackState={activeStreamId === stream.id ? playbackState : null}
          error={errorStreamId === stream.id}
          {disabled}
          onselect={onselect}
        />
      {/each}
    </div>
  {/if}
</div>
