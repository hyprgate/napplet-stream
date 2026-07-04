<script lang="ts">
  /**
   * Shared note-content renderer for Hyprgate napplets.
   *
   * Parses raw note text into safe blocks and resolves nostr references, links,
   * hashtags, and media/resources. Behaviour is supplied by callbacks so each
   * napplet keeps its own navigation wiring while sharing one implementation.
   */
  import {
    parseNoteContent,
    pubkeyColorStyle,
    requestRuntimePlayback,
    resolveExternalVideoEmbed,
    resourceImage,
    resourceImageBatch,
    shouldInterceptLinkClick,
    type NoteContentBlock,
  } from '@hyprgate/utils';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
    onProfileClick?: (pubkey: string) => void;
    onReferenceClick?: (source: string) => void;
    /**
     * NAP-LINK seam: when supplied, external URLs and external-video links route
     * through the shell-owned opener (each napplet wires a handler that calls
     * `link.open()`). The handler resolves false when the open was denied, so
     * the renderer can fall back to the in-iframe anchor. When omitted, links
     * use the legacy in-iframe target='_blank' / window.open behaviour.
     */
    onOpenLink?: (url: string) => boolean | Promise<boolean>;
    detectExternalVideo?: boolean;
    resourceBatchSize?: number;
    videoTitle?: string;
  }

  let {
    content,
    emojiTags = [],
    profileLabel,
    onProfileClick,
    onReferenceClick,
    onOpenLink,
    detectExternalVideo = true,
    resourceBatchSize,
    videoTitle = 'Note video',
  }: Props = $props();

  const blocks = $derived(parseNoteContent(content, { emojiTags }));

  function shortPubkey(pubkey: string): string {
    return pubkey.length > 12 ? `${pubkey.slice(0, 8)}...` : pubkey;
  }

  function labelFor(pubkey: string): string {
    return profileLabel?.(pubkey) ?? shortPubkey(pubkey);
  }

  function shortSource(source: string): string {
    const value = source.startsWith('nostr:') ? source.slice('nostr:'.length) : source;
    return value.length > 22 ? `${value.slice(0, 18)}...` : value;
  }

  function mediaAlt(block: NoteContentBlock): string {
    if (block.type === 'resource') return 'embedded resource';
    if (block.type === 'media') return block.mediaType === 'image' ? 'embedded image' : 'video';
    return 'embedded media';
  }

  /**
   * Route an external URL through the NAP-LINK opener when wired, falling back
   * to the legacy in-iframe open. Returns true when navigation was handed off.
   */
  async function openExternalUrl(url: string): Promise<boolean> {
    if (onOpenLink) {
      try {
        return await onOpenLink(url);
      } catch (error) {
        console.warn('[note-content] link open failed', error);
        return false;
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }

  async function handleUrlClick(event: MouseEvent, url: string): Promise<void> {
    // Preserve middle-click / modifier-click + accessibility: only intercept a
    // plain left click, letting the anchor's href handle everything else.
    if (!shouldInterceptLinkClick(event)) return;
    if (!onOpenLink) return; // legacy anchor behaviour
    event.preventDefault();
    const opened = await openExternalUrl(url);
    if (!opened) {
      // Denied by policy — fall back to the in-iframe anchor navigation so the
      // user is never silently stuck.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async function playVideo(url: string): Promise<void> {
    if (detectExternalVideo && resolveExternalVideoEmbed(url)) {
      await openExternalUrl(url);
      return;
    }
    try {
      await requestRuntimePlayback({
        url,
        kind: url.toLowerCase().includes('.m3u8') ? 'hls' : 'video',
        title: videoTitle,
        capabilities: ['play', 'pause', 'stop', 'seek', 'setVolume', 'setMuted'],
        autoplay: true,
        live: false,
      });
    } catch (error) {
      console.warn('[note-content] runtime playback failed', error);
    }
  }

  function noteResourceImage(node: HTMLImageElement, source: string | null | undefined) {
    const useBatch = resourceBatchSize !== undefined;
    const action = useBatch
      ? resourceImageBatch(node, { source, chunkSize: resourceBatchSize })
      : resourceImage(node, source);

    return {
      update(nextSource: string | null | undefined): void {
        action.update?.(useBatch ? { source: nextSource, chunkSize: resourceBatchSize } : nextSource);
      },
      destroy(): void {
        action.destroy?.();
      },
    };
  }
</script>

<span class="note-content">
  {#each blocks as block}
    {#if block.type === 'text'}
      <span>{block.value}</span>
    {:else if block.type === 'profile'}
      {#if onProfileClick}
        <button type="button" class="ref mention" style={pubkeyColorStyle(block.value)} title={block.source} onclick={() => onProfileClick?.(block.value)}>
          @{labelFor(block.value)}
        </button>
      {:else}
        <span class="ref mention" style={pubkeyColorStyle(block.value)} title={block.source}>@{labelFor(block.value)}</span>
      {/if}
    {:else if block.type === 'event' || block.type === 'address'}
      {#if onReferenceClick}
        <button type="button" class="ref" title={block.source} onclick={() => onReferenceClick?.(block.source)}>[{shortSource(block.source)}]</button>
      {:else}
        <span class="ref" title={block.source}>[{shortSource(block.source)}]</span>
      {/if}
    {:else if block.type === 'hashtag'}
      <span class="ref">#{block.value}</span>
    {:else if block.type === 'url'}
      <a class="ref" href={block.value} target="_blank" rel="noopener noreferrer" onclick={(e) => void handleUrlClick(e, block.value)}>{block.value}</a>
    {:else if block.type === 'emoji'}
      <img class="custom-emoji" use:noteResourceImage={block.imageUrl} alt={block.source} title={block.source} loading="lazy" />
    {:else if block.type === 'media' && block.mediaType === 'image'}
      <img class="media" use:noteResourceImage={block.value} alt={mediaAlt(block)} loading="lazy" />
    {:else if block.type === 'resource'}
      <img class="media" use:noteResourceImage={block.value} alt={mediaAlt(block)} loading="lazy" />
    {:else if block.type === 'media' && block.mediaType === 'video'}
      <button type="button" class="ref" onclick={() => void playVideo(block.value)}>[video]</button>
    {/if}
  {/each}
</span>

<style>
  .note-content {
    display: block;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    color: inherit;
  }

  .ref {
    border: 0;
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--hg-accent-cyan, var(--accent, #82d8f7));
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }

  button.ref,
  a.ref {
    cursor: pointer;
  }

  span.ref {
    cursor: default;
  }

  .ref:hover {
    text-decoration: underline;
  }

  .media {
    display: block;
    max-width: min(100%, 640px);
    max-height: 24rem;
    object-fit: contain;
    border-radius: 4px;
    margin: 8px 0 0;
  }

  .custom-emoji {
    display: inline-block;
    width: 1.25em;
    height: 1.25em;
    margin: 0 0.08em;
    object-fit: contain;
    vertical-align: -0.2em;
  }
</style>
