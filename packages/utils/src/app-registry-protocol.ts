export const APP_REGISTRY_SNAPSHOT_TOPIC = 'app-registry:snapshot' as const;
export const APP_REGISTRY_SET_DEFAULT_TOPIC = 'app-registry:set-default' as const;
export const APP_REGISTRY_SET_APP_ENABLED_TOPIC = 'app-registry:set-app-enabled' as const;
export const APP_REGISTRY_SET_ACTION_ENABLED_TOPIC = 'app-registry:set-action-enabled' as const;
export const APP_REGISTRY_OPEN_ADVANCED_TOPIC = 'app-registry:open-advanced' as const;
export const APP_REGISTRY_RESULT_TOPIC = 'app-registry:result' as const;

export type AppRegistrySource = 'bundled' | 'installed' | 'runtime' | 'native' | 'custom';

export interface ActionRoute {
  key: string;
  label: string;
  enabled: boolean;
  defaultAppId: string | null;
  apps: string[];
}

export interface AppRouteHandler {
  id: string;
  title: string;
  dTag: string | null;
  author?: string | null;
  relayHints?: string[];
  source: AppRegistrySource;
  reference?: string | null;
  referenceType?: string | null;
  enabled: boolean;
  available: boolean;
  favorite?: boolean;
  actions: string[];
  routeKeys: string[];
}

export interface AppRegistrySnapshotDto {
  actions: ActionRoute[];
  apps: AppRouteHandler[];
}

export interface AppRegistrySetDefaultPayload {
  routeKey: string;
  appId: string | null;
}

export interface AppRegistryEnabledPayload {
  key: string;
  enabled: boolean;
}

export interface AppRegistryResultMessage {
  type: typeof APP_REGISTRY_RESULT_TOPIC;
  id: string;
  ok: boolean;
  snapshot?: AppRegistrySnapshotDto;
  error?: string;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeKey(value: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(nonEmptyString)
    .filter((item): item is string => item !== null && safeKey(item));
}

function normalizeLooseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(nonEmptyString)
    .filter((item): item is string => item !== null);
}

function normalizeSource(value: unknown): AppRegistrySource {
  if (
    value === 'bundled'
    || value === 'installed'
    || value === 'runtime'
    || value === 'native'
    || value === 'custom'
  ) {
    return value;
  }
  return 'custom';
}

export function parseAppRegistrySetDefaultPayload(value: unknown): AppRegistrySetDefaultPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppRegistrySetDefaultPayload>;
  const routeKey = nonEmptyString(candidate.routeKey);
  if (!routeKey || !safeKey(routeKey)) return null;
  if (candidate.appId === null) return { routeKey, appId: null };
  const appId = nonEmptyString(candidate.appId);
  if (!appId || !safeKey(appId)) return null;
  return { routeKey, appId };
}

export function parseAppRegistryEnabledPayload(value: unknown): AppRegistryEnabledPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppRegistryEnabledPayload>;
  const key = nonEmptyString(candidate.key);
  if (!key || !safeKey(key) || typeof candidate.enabled !== 'boolean') return null;
  return { key, enabled: candidate.enabled };
}

export function normalizeAppRegistrySnapshot(value: unknown): AppRegistrySnapshotDto | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppRegistrySnapshotDto>;
  if (!Array.isArray(candidate.actions) || !Array.isArray(candidate.apps)) return null;

  const actions = candidate.actions
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const route = item as Partial<ActionRoute>;
      const key = nonEmptyString(route.key);
      const label = nonEmptyString(route.label);
      if (!key || !safeKey(key) || !label || typeof route.enabled !== 'boolean') return null;
      const defaultAppId = route.defaultAppId === null ? null : nonEmptyString(route.defaultAppId);
      if (defaultAppId !== null && defaultAppId !== undefined && !safeKey(defaultAppId)) return null;
      return {
        key,
        label,
        enabled: route.enabled,
        defaultAppId: defaultAppId ?? null,
        apps: normalizeStringArray(route.apps),
      };
    })
    .filter((item): item is ActionRoute => item !== null);

  const apps = candidate.apps
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const app = item as Partial<AppRouteHandler>;
      const id = nonEmptyString(app.id);
      const title = nonEmptyString(app.title);
      if (!id || !safeKey(id) || !title) return null;
      const dTag = app.dTag === null ? null : nonEmptyString(app.dTag);
      if (dTag !== null && dTag !== undefined && !safeKey(dTag)) return null;
      const author = app.author === null ? null : nonEmptyString(app.author);
      const reference = app.reference === null ? null : nonEmptyString(app.reference);
      const referenceType = app.referenceType === null ? null : nonEmptyString(app.referenceType);
      const relayHints = normalizeLooseStringArray(app.relayHints);
      const normalized: AppRouteHandler = {
        id,
        title,
        dTag: dTag ?? null,
        source: normalizeSource(app.source),
        enabled: app.enabled === true,
        available: app.available === true,
        actions: normalizeStringArray(app.actions),
        routeKeys: normalizeStringArray(app.routeKeys),
      };
      if (typeof app.favorite === 'boolean') normalized.favorite = app.favorite;
      if (author !== null) normalized.author = author;
      if (relayHints.length > 0) normalized.relayHints = relayHints;
      if (reference !== null) normalized.reference = reference;
      if (referenceType !== null) normalized.referenceType = referenceType;
      return normalized;
    })
    .filter((item): item is AppRouteHandler => item !== null);

  return { actions, apps };
}
