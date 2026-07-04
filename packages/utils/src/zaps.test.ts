import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { KIND_ZAP_RECEIPT, KIND_ZAP_REQUEST } from '@hyprgate/utils';
import {
  formatMillisatsAsSats,
  parseZapReceipt,
  rootAddressForZapTarget,
  summarizeZapReceipts,
  zapReceiptTargetsAddress,
  zapReceiptTargetsEvent,
} from './zaps.js';

describe('zaps', () => {
  it('parses amount, sender, target, and comment from a zap receipt description', () => {
    const receipt = zapReceipt({
      id: 'receipt-a',
      amountMillisats: '21000',
      targetId: 'note-a',
      senderPubkey: 'sender-a',
      recipientPubkey: 'recipient-a',
      comment: 'thanks',
    });

    expect(parseZapReceipt(receipt)).toMatchObject({
      id: 'receipt-a',
      providerPubkey: 'provider',
      senderPubkey: 'sender-a',
      recipientPubkey: 'recipient-a',
      targetEventIds: ['note-a'],
      amountMillisats: 21000,
      amountSats: 21,
      comment: 'thanks',
      bolt11: 'invoice',
      preimage: 'preimage',
    });
  });

  it('falls back to receipt tags for target and amount when the request is missing', () => {
    const receipt = event({
      id: 'receipt-b',
      kind: KIND_ZAP_RECEIPT,
      tags: [['e', 'note-b'], ['amount', '7000']],
    });

    expect(parseZapReceipt(receipt)).toMatchObject({
      targetEventIds: ['note-b'],
      amountMillisats: 7000,
      senderPubkey: null,
    });
  });

  it('summarizes deduped receipts by sats', () => {
    const a = zapReceipt({ id: 'a', amountMillisats: '1000', targetId: 'note' });
    const b = zapReceipt({ id: 'b', amountMillisats: '2500', targetId: 'note' });
    const summary = summarizeZapReceipts([a, b, a]);

    expect(summary.count).toBe(2);
    expect(summary.amountMillisats).toBe(3500);
    expect(summary.amountSats).toBe(3.5);
    expect(summary.receipts.map((receipt) => receipt.id)).toEqual(['b', 'a']);
  });

  it('matches event and address targets from receipt or request tags', () => {
    const root = event({ id: 'root', kind: 30023, pubkey: 'author', tags: [['d', 'article']] });
    const address = rootAddressForZapTarget(root);
    const receipt = zapReceipt({ id: 'zap-address', amountMillisats: '1000', targetId: 'root', targetAddress: address ?? undefined });

    expect(address).toBe('30023:author:article');
    expect(zapReceiptTargetsEvent(receipt, 'root')).toBe(true);
    expect(zapReceiptTargetsAddress(receipt, '30023:author:article')).toBe(true);
  });

  it('formats millisats as sats for summary surfaces', () => {
    expect(formatMillisatsAsSats(0)).toBe('0 sats');
    expect(formatMillisatsAsSats(12000)).toBe('12 sats');
    expect(formatMillisatsAsSats(1500)).toBe('1.5 sats');
  });
});

function zapReceipt(input: {
  id: string;
  amountMillisats: string;
  targetId: string;
  targetAddress?: string;
  senderPubkey?: string;
  recipientPubkey?: string;
  comment?: string;
}): NostrEvent {
  const request = event({
    id: `${input.id}-request`,
    kind: KIND_ZAP_REQUEST,
    pubkey: input.senderPubkey ?? 'sender',
    tags: [
      ['amount', input.amountMillisats],
      ['e', input.targetId],
      ...(input.targetAddress ? [['a', input.targetAddress]] : []),
      ['p', input.recipientPubkey ?? 'recipient'],
    ],
    content: input.comment ?? '',
  });

  return event({
    id: input.id,
    kind: KIND_ZAP_RECEIPT,
    pubkey: 'provider',
    tags: [
      ['description', JSON.stringify(request)],
      ['bolt11', 'invoice'],
      ['preimage', 'preimage'],
      ['e', input.targetId],
      ...(input.targetAddress ? [['a', input.targetAddress]] : []),
    ],
  });
}

function event(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}
