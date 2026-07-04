export const WORKSPACE_JOURNAL_CAPTURE_TOPIC = 'journal:capture' as const;
export const WORKSPACE_JOURNAL_PROTOCOL = 'NAP-06' as const;

export interface WorkspaceJournalCapturePayload {
  title: string;
  body: string;
  refs?: string[];
  source?: {
    napplet?: string;
    windowId?: string;
    requestId?: string;
  };
}

export function createWorkspaceJournalCapturePayload(input: WorkspaceJournalCapturePayload): WorkspaceJournalCapturePayload | null {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return null;
  return {
    title,
    body,
    refs: normalizeRefs(input.refs),
    ...(input.source ? { source: input.source } : {}),
  };
}

export function parseWorkspaceJournalCapturePayload(value: unknown): WorkspaceJournalCapturePayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== 'string' || typeof value.body !== 'string') return null;
  return createWorkspaceJournalCapturePayload({
    title: value.title,
    body: value.body,
    refs: Array.isArray(value.refs) ? value.refs.filter((ref): ref is string => typeof ref === 'string') : undefined,
    source: isRecord(value.source) ? readSource(value.source) : undefined,
  });
}

function normalizeRefs(refs: string[] | undefined): string[] {
  return Array.from(new Set((refs ?? []).map((ref) => ref.trim()).filter(Boolean)));
}

function readSource(value: Record<string, unknown>): WorkspaceJournalCapturePayload['source'] {
  return {
    ...(typeof value.napplet === 'string' && value.napplet.trim() ? { napplet: value.napplet } : {}),
    ...(typeof value.windowId === 'string' && value.windowId.trim() ? { windowId: value.windowId } : {}),
    ...(typeof value.requestId === 'string' && value.requestId.trim() ? { requestId: value.requestId } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
