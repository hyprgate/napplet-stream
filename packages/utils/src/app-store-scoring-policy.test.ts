import { describe, expect, it } from 'vitest';
import {
  validateAppStoreScoringPolicy,
  type AppStoreScoringPolicy,
} from './app-store-scoring-policy.js';

function policy(overrides: Partial<AppStoreScoringPolicy> = {}): AppStoreScoringPolicy {
  return {
    version: 1,
    sourceTier: {
      bundled: 100,
      featured: 80,
      network: 40,
      global: -50,
    },
    weights: {
      wot: 25,
      relatr: 20,
      nip05: 10,
      profileCompletion: 10,
      listingCompletion: 15,
      reviewAggregate: 10,
      reactionAggregate: 5,
    },
    thresholds: {
      trustedMinimum: 70,
      incompletePenalty: -20,
    },
    ...overrides,
  };
}

describe('validateAppStoreScoringPolicy', () => {
  it('accepts a complete policy and clones normalized sections', () => {
    const input = policy();
    const parsed = validateAppStoreScoringPolicy(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.sourceTier).not.toBe(input.sourceTier);
    expect(parsed?.weights).not.toBe(input.weights);
    expect(parsed?.thresholds).not.toBe(input.thresholds);
  });

  it('rejects missing source tier keys', () => {
    const input = policy({
      sourceTier: {
        bundled: 100,
        featured: 80,
        network: 40,
      } as AppStoreScoringPolicy['sourceTier'],
    });

    expect(validateAppStoreScoringPolicy(input)).toBeNull();
  });

  it('rejects missing weight keys', () => {
    const input = policy({
      weights: {
        wot: 25,
        nip05: 10,
        profileCompletion: 10,
        listingCompletion: 15,
        reviewAggregate: 10,
        reactionAggregate: 5,
      } as AppStoreScoringPolicy['weights'],
    });

    expect(validateAppStoreScoringPolicy(input)).toBeNull();
  });

  it('rejects missing threshold keys', () => {
    const input = policy({
      thresholds: {
        trustedMinimum: 70,
      } as AppStoreScoringPolicy['thresholds'],
    });

    expect(validateAppStoreScoringPolicy(input)).toBeNull();
  });

  it('rejects wrong policy versions', () => {
    expect(validateAppStoreScoringPolicy({ ...policy(), version: 2 })).toBeNull();
  });

  it('rejects non-numeric or non-finite values', () => {
    expect(validateAppStoreScoringPolicy({
      ...policy(),
      weights: { ...policy().weights, relatr: 'high' },
    })).toBeNull();

    expect(validateAppStoreScoringPolicy({
      ...policy(),
      thresholds: { ...policy().thresholds, trustedMinimum: Number.POSITIVE_INFINITY },
    })).toBeNull();
  });
});
