export const APP_STORE_SOURCE_TIERS = ['bundled', 'featured', 'network', 'global'] as const;
export const APP_STORE_SCORING_WEIGHT_KEYS = [
  'wot',
  'relatr',
  'nip05',
  'profileCompletion',
  'listingCompletion',
  'reviewAggregate',
  'reactionAggregate',
] as const;
export const APP_STORE_SCORING_THRESHOLD_KEYS = ['trustedMinimum', 'incompletePenalty'] as const;

export type AppStoreSourceTier = (typeof APP_STORE_SOURCE_TIERS)[number];
export type AppStoreSourceTierWeights = Record<AppStoreSourceTier, number>;
export type AppStoreScoringWeightKey = (typeof APP_STORE_SCORING_WEIGHT_KEYS)[number];
export type AppStoreScoringWeights = Record<AppStoreScoringWeightKey, number>;
export type AppStoreScoringThresholdKey = (typeof APP_STORE_SCORING_THRESHOLD_KEYS)[number];
export type AppStoreScoringThresholds = Record<AppStoreScoringThresholdKey, number>;

export interface AppStoreScoringPolicy {
  version: 1;
  sourceTier: AppStoreSourceTierWeights;
  weights: AppStoreScoringWeights;
  thresholds: AppStoreScoringThresholds;
}

export function validateAppStoreScoringPolicy(value: unknown): AppStoreScoringPolicy | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;

  const sourceTier = readNumberRecord(value.sourceTier, APP_STORE_SOURCE_TIERS);
  const weights = readNumberRecord(value.weights, APP_STORE_SCORING_WEIGHT_KEYS);
  const thresholds = readNumberRecord(value.thresholds, APP_STORE_SCORING_THRESHOLD_KEYS);
  if (!sourceTier || !weights || !thresholds) return null;

  return {
    version: 1,
    sourceTier,
    weights,
    thresholds,
  };
}

function readNumberRecord<const K extends readonly string[]>(
  value: unknown,
  keys: K,
): Record<K[number], number> | null {
  if (!isRecord(value)) return null;
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length) return null;

  const output: Partial<Record<K[number], number>> = {};
  for (const key of keys) {
    const next = value[key];
    if (typeof next !== 'number' || !Number.isFinite(next)) return null;
    output[key as K[number]] = next;
  }
  return output as Record<K[number], number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
