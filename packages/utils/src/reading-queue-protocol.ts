export const READING_QUEUE_ADD_TOPIC = 'reading-queue:add' as const;
export const READING_QUEUE_PROTOCOL = 'NAP-05' as const;

export type ReadingQueueItemType = 'note' | 'profile' | 'relay' | 'media' | 'app';

export interface ReadingQueueAddPayload {
  type: ReadingQueueItemType;
  target: string;
  title?: string;
  summary?: string;
  source?: {
    napplet?: string;
    windowId?: string;
    requestId?: string;
  };
}

const VALID_TYPES = new Set<ReadingQueueItemType>(['note', 'profile', 'relay', 'media', 'app']);

export function createReadingQueueAddPayload(input: ReadingQueueAddPayload): ReadingQueueAddPayload | null {
  if (!VALID_TYPES.has(input.type)) return null;
  const target = input.target.trim();
  if (!target) return null;
  return {
    type: input.type,
    target,
    ...(cleanString(input.title) ? { title: cleanString(input.title) } : {}),
    ...(cleanString(input.summary) ? { summary: cleanString(input.summary) } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
}

export function parseReadingQueueAddPayload(value: unknown): ReadingQueueAddPayload | null {
  if (!isRecord(value)) return null;
  if (!VALID_TYPES.has(value.type as ReadingQueueItemType)) return null;
  if (typeof value.target !== 'string' || !value.target.trim()) return null;
  return createReadingQueueAddPayload({
    type: value.type as ReadingQueueItemType,
    target: value.target,
    title: typeof value.title === 'string' ? value.title : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    source: isRecord(value.source) ? readSource(value.source) : undefined,
  });
}

function readSource(value: Record<string, unknown>): ReadingQueueAddPayload['source'] {
  return {
    ...(typeof value.napplet === 'string' && value.napplet.trim() ? { napplet: value.napplet } : {}),
    ...(typeof value.windowId === 'string' && value.windowId.trim() ? { windowId: value.windowId } : {}),
    ...(typeof value.requestId === 'string' && value.requestId.trim() ? { requestId: value.requestId } : {}),
  };
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
