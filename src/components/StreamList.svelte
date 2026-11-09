<script lang="ts">
  import type { RuntimePlayerStatus } from '@hyprgate/utils';
  import type { LiveStream, StreamPhase } from '../lib/stream-store';
  import type { ProfileContent } from '../lib/profile-metadata';
  import StreamCard from './StreamCard.svelte';

  interface Props {
    live: LiveStream[];
    upcoming: LiveStream[];
    ended: LiveStream[];
    loading: boolean;
    now: number;
    profiles?: Map<string, ProfileContent>;
    activeStreamId?: string | null;
    playbackState?: RuntimePlayerStatus | null;
    errorStreamId?: string | null;
    disabled?: boolean;
    onselect?: (stream: LiveStream) => void;
    onhost?: (pubkey: string) => void;
  }

  let {
    live,
    upcoming,
    ended,
    loading,
    now,
    profiles,
    activeStreamId = null,
    playbackState = null,
    errorStreamId = null,
    disabled = false,
    onselect,
    onhost,
  }: Props = $props();

  let hasAny = $derived(live.length + upcoming.length + ended.length > 0);
</script>

{#snippet section(title: string, phase: StreamPhase, streams: LiveStream[])}
  {#if streams.length > 0}
    <section class="stream-section" aria-label={title}>
      <h2 class="section-title">{title} <span class="section-count">{streams.length}</span></h2>
      <div class="stream-grid">
        {#each streams as stream (stream.id)}
          <StreamCard
            {stream}
            {phase}
            {now}
            profile={profiles?.get(stream.hostPubkey)}
            active={activeStreamId === stream.id}
            playbackState={activeStreamId === stream.id ? playbackState : null}
            error={errorStreamId === stream.id}
            {disabled}
            {onselect}
            {onhost}
          />
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

<div class="stream-list h-full overflow-y-auto p-3">
  {#if loading && !hasAny}
    <div class="stream-grid" aria-busy="true" aria-label="Looking for streams">
      {#each [1, 2, 3] as _}
        <div class="bg-bg-surface border border-border-default rounded overflow-hidden animate-pulse" aria-hidden="true">
          <div class="aspect-video bg-bg-base"></div>
          <div class="p-2 space-y-2">
            <div class="h-3 bg-bg-base rounded w-3/4"></div>
            <div class="h-3 bg-bg-base rounded w-1/2"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    {#if live.length === 0}
      <div class="none-live" class:roomy={!hasAny}>
        <p class="none-live-title">Nobody's live right now</p>
        <p class="none-live-copy">Streams show up here on their own as soon as someone goes live.</p>
      </div>
    {/if}
    {@render section('Live now', 'live', live)}
    {@render section('Upcoming', 'upcoming', upcoming)}
    {@render section('Ended', 'ended', ended)}
  {/if}
</div>

<style>
  .stream-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 14px;
  }

  .stream-section + .stream-section {
    margin-top: 22px;
  }

  .section-title {
    margin: 0 0 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--hg-text-primary, #f2efe7);
  }

  .section-count {
    font-weight: 400;
    color: var(--hg-text-muted, #b8b1a4);
  }

  .none-live {
    margin-bottom: 18px;
    padding: 14px;
    text-align: center;
    border: 1px dashed var(--hg-border-dim, #2a2a2a);
    border-radius: 6px;
  }

  .none-live.roomy {
    margin-top: 64px;
    border: none;
  }

  .none-live-title {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--hg-text-primary, #f2efe7);
  }

  .none-live-copy {
    margin: 0;
    font-size: 12px;
    color: var(--hg-text-muted, #b8b1a4);
  }
</style>
