import { KIND_ZAP_RECEIPT, KIND_ZAP_REQUEST, type NostrEvent } from "@hyprgate/types";

export interface ParsedZapReceipt {
  id: string;
  receipt: NostrEvent;
  createdAt: number;
  providerPubkey: string;
  senderPubkey: string | null;
  recipientPubkey: string | null;
  targetEventIds: string[];
  targetAddresses: string[];
  amountMillisats: number;
  amountSats: number;
  comment: string;
  bolt11: string | null;
  preimage: string | null;
  request: NostrEvent | null;
}

export interface ZapSummary {
  count: number;
  amountMillisats: number;
  amountSats: number;
  receipts: ParsedZapReceipt[];
}

function firstTagValue(tags: string[][], name: string): string | null {
  const tag = tags.find((item) => item[0] === name && typeof item[1] === 'string' && item[1].trim().length > 0);
  return tag?.[1]?.trim() ?? null;
}

function uniqueTagValues(tags: string[][], name: string): string[] {
  return [...new Set(tags.filter((tag) => tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0).map((tag) => tag[1]!))];
}

function parseNonNegativeInteger(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseZapRequest(value: string | null): NostrEvent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<NostrEvent>;
    if (
      parsed
      && parsed.kind === KIND_ZAP_REQUEST
      && typeof parsed.pubkey === 'string'
      && Array.isArray(parsed.tags)
      && typeof parsed.content === 'string'
    ) {
      return {
        id: typeof parsed.id === 'string' ? parsed.id : '',
        pubkey: parsed.pubkey,
        created_at: typeof parsed.created_at === 'number' ? parsed.created_at : 0,
        kind: parsed.kind,
        tags: parsed.tags,
        content: parsed.content,
        sig: typeof parsed.sig === 'string' ? parsed.sig : '',
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function rootAddressForZapTarget(event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): string | null {
  const identifier = firstTagValue(event.tags, 'd');
  if (!identifier) return null;
  return `${event.kind}:${event.pubkey}:${identifier}`;
}

export function parseZapReceipt(event: NostrEvent): ParsedZapReceipt | null {
  if (event.kind !== KIND_ZAP_RECEIPT) return null;

  const request = parseZapRequest(firstTagValue(event.tags, 'description'));
  const amountMillisats = parseNonNegativeInteger(
    firstTagValue(request?.tags ?? [], 'amount') ?? firstTagValue(event.tags, 'amount'),
  );
  const targetEventIds = [...new Set([
    ...uniqueTagValues(event.tags, 'e'),
    ...uniqueTagValues(request?.tags ?? [], 'e'),
  ])];
  const targetAddresses = [...new Set([
    ...uniqueTagValues(event.tags, 'a'),
    ...uniqueTagValues(request?.tags ?? [], 'a'),
  ])];
  const recipientPubkey = firstTagValue(request?.tags ?? [], 'p') ?? firstTagValue(event.tags, 'p');

  return {
    id: event.id,
    receipt: event,
    createdAt: event.created_at,
    providerPubkey: event.pubkey,
    senderPubkey: request?.pubkey ?? null,
    recipientPubkey,
    targetEventIds,
    targetAddresses,
    amountMillisats,
    amountSats: amountMillisats / 1000,
    comment: request?.content.trim() ?? '',
    bolt11: firstTagValue(event.tags, 'bolt11'),
    preimage: firstTagValue(event.tags, 'preimage'),
    request,
  };
}

export function summarizeZapReceipts(events: Iterable<NostrEvent>): ZapSummary {
  const seen = new Set<string>();
  const receipts: ParsedZapReceipt[] = [];
  let amountMillisats = 0;

  for (const event of events) {
    if (seen.has(event.id)) continue;
    const receipt = parseZapReceipt(event);
    if (!receipt) continue;
    seen.add(event.id);
    receipts.push(receipt);
    amountMillisats += receipt.amountMillisats;
  }

  receipts.sort((a, b) => b.amountMillisats - a.amountMillisats || b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  return {
    count: receipts.length,
    amountMillisats,
    amountSats: amountMillisats / 1000,
    receipts,
  };
}

export function formatMillisatsAsSats(amountMillisats: number): string {
  const amountSats = amountMillisats / 1000;
  if (!Number.isFinite(amountSats) || amountSats <= 0) return '0 sats';
  if (Number.isInteger(amountSats)) return `${amountSats.toLocaleString()} sats`;
  return `${amountSats.toLocaleString(undefined, { maximumFractionDigits: 3 })} sats`;
}

export function zapReceiptTargetsEvent(event: NostrEvent, targetEventId: string): boolean {
  const receipt = parseZapReceipt(event);
  return receipt?.targetEventIds.includes(targetEventId) ?? false;
}

export function zapReceiptTargetsAddress(event: NostrEvent, targetAddress: string): boolean {
  const receipt = parseZapReceipt(event);
  return receipt?.targetAddresses.includes(targetAddress) ?? false;
}
