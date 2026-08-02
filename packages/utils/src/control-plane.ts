/** JSON-compatible values allowed across the control-plane transport boundary. */
export type ControlJsonValue =
  | null
  | boolean
  | number
  | string
  | ControlJsonValue[]
  | { [key: string]: ControlJsonValue };

export type ControlOperationId = string;

export interface ControlSourceDescriptor {
  domain: string;
  module: string;
  symbol: string;
}

export type ControlArgumentType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'resource'
  | 'json';

export interface ControlArgumentDescriptor {
  name: string;
  description: string;
  type: ControlArgumentType;
  option?: string;
  required?: boolean;
  default?: ControlJsonValue;
  enum?: ControlJsonValue[];
  minimum?: number;
  maximum?: number;
  repeated?: boolean;
  sensitive?: boolean;
  resource?: string;
}

export type ControlValueSchema = (
  | {
      type: 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'json';
      enum?: ControlJsonValue[];
      minimum?: number;
      maximum?: number;
    }
  | {
      type: 'array';
      items: ControlValueSchema;
      minimumItems?: number;
      maximumItems?: number;
    }
  | {
      type: 'object';
      properties: Record<string, ControlValueSchema>;
      required?: string[];
      additionalProperties?: boolean;
    }
) & { sensitive?: true };

export type ControlRenderHint =
  | { kind: 'text' | 'json' | 'record' }
  | { kind: 'table'; columns?: Array<{ key: string; label: string }> };

export interface ControlResultDescriptor {
  schema: ControlValueSchema;
  render?: ControlRenderHint;
}

export interface ControlAvailability {
  state: 'available' | 'unavailable';
  reason?: string;
}

export type ControlEffect =
  | 'read'
  | 'reversible'
  | 'destructive'
  | 'network'
  | 'publish'
  | 'device'
  | 'privileged';

export interface ControlPolicyDescriptor {
  access: 'allowed' | 'restricted' | 'denied';
  confirmation: 'never' | 'required';
  rationale?: string;
}

export interface ControlOperationDescriptor {
  id: ControlOperationId;
  source: ControlSourceDescriptor;
  summary: string;
  help: string;
  usage: string;
  examples: string[];
  arguments: ControlArgumentDescriptor[];
  result: ControlResultDescriptor;
  availability: ControlAvailability;
  effects: ControlEffect[];
  policy: ControlPolicyDescriptor;
  classification: 'control-backed' | 'pending' | 'private';
}

export interface ControlRegistrySnapshot {
  revision: number;
  operations: ControlOperationDescriptor[];
}

export interface ControlResolveRequest {
  path: string[];
}

export interface ControlResolvedOperation {
  revision: number;
  descriptor: ControlOperationDescriptor;
}

export interface ControlCompletionRequest {
  path: string[];
  argument?: string;
  query?: string;
  arguments?: Record<string, ControlJsonValue>;
}

export interface ControlCompletionItem {
  value: string;
  label?: string;
  description?: string;
  kind: 'operation' | 'argument' | 'enum' | 'resource';
}

export interface ControlCompletionResult {
  revision: number;
  items: ControlCompletionItem[];
}

export interface ControlInvocationRequest {
  operationId: ControlOperationId;
  arguments: Record<string, ControlJsonValue>;
}

export type ControlErrorCode =
  | 'unknown_operation'
  | 'invalid_arguments'
  | 'unavailable'
  | 'controller_error'
  | 'controller_contract'
  | 'cancelled'
  | 'forbidden'
  | 'confirmation_denied'
  | 'invalid_request';

export interface ControlError {
  code: ControlErrorCode;
  message: string;
  details?: ControlJsonValue;
}

export interface ControlProgress {
  message: string;
  current?: number;
  total?: number;
  data?: ControlJsonValue;
}

export interface ControlProgressEvent extends ControlProgress {
  kind: 'progress';
  invocationId: string;
  sequence: number;
  timestamp: number;
}

export interface ControlStatusEvent {
  kind: 'status';
  invocationId: string;
  sequence: number;
  timestamp: number;
  status: Exclude<ControlInvocationStatus, 'running'>;
}

export type ControlInvocationEvent = ControlProgressEvent | ControlStatusEvent;

export type ControlInvocationStatus =
  | 'running'
  | 'accepted'
  | 'succeeded'
  | 'no-op'
  | 'cancelled'
  | 'failed'
  | 'unavailable';

export interface ControlInvocationSnapshot {
  id: string;
  operationId: ControlOperationId;
  operationRevision: number;
  status: ControlInvocationStatus;
  cancellable: boolean;
  startedAt: number;
  completedAt?: number;
  value?: ControlJsonValue;
  message?: string;
  error?: ControlError;
  progress: ControlProgressEvent[];
}

export const RUNTIME_CONTROL_PROTOCOL = 'hyprgate.control' as const;
export const RUNTIME_CONTROL_VERSION = 1 as const;
export const RUNTIME_CONTROL_MAX_ID_LENGTH = 128;
export const RUNTIME_CONTROL_MAX_WIRE_DEPTH = 16;
export const RUNTIME_CONTROL_MAX_WIRE_NODES = 4096;
export const RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES = 32_768;
export const RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH = 16_384;
export const RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH = 1024;

export interface RuntimeControlMethodMap {
  list: { request: Record<string, never>; response: ControlRegistrySnapshot };
  describe: { request: { operationId: string }; response: ControlOperationDescriptor | null };
  resolve: { request: ControlResolveRequest; response: ControlResolvedOperation | null };
  complete: { request: ControlCompletionRequest; response: ControlCompletionResult };
  invoke: {
    request: ControlInvocationRequest;
    response: { invocationId: string; cancellable: boolean };
  };
  cancel: { request: { invocationId: string }; response: { cancelled: boolean } };
  getInvocation: { request: { invocationId: string }; response: ControlInvocationSnapshot | null };
  subscribeRegistry: {
    request: Record<string, never>;
    response: { subscriptionId: string; snapshot: ControlRegistrySnapshot };
  };
  unsubscribeRegistry: {
    request: { subscriptionId: string };
    response: { unsubscribed: boolean };
  };
  unsubscribeInvocation: {
    request: { invocationId: string };
    response: { unsubscribed: boolean };
  };
}

export type RuntimeControlMethod = keyof RuntimeControlMethodMap;

type RuntimeControlRequestFor<M extends RuntimeControlMethod> = {
  protocol: typeof RUNTIME_CONTROL_PROTOCOL;
  version: typeof RUNTIME_CONTROL_VERSION;
  kind: 'request';
  requestId: string;
  method: M;
  payload: RuntimeControlMethodMap[M]['request'];
};

export type RuntimeControlRequest = {
  [M in RuntimeControlMethod]: RuntimeControlRequestFor<M>
}[RuntimeControlMethod];

export type RuntimeControlTransportErrorCode =
  | 'invalid_request'
  | 'unsupported_version'
  | 'unknown_method'
  | 'too_many_pending'
  | 'disconnected'
  | 'host_error';

export interface RuntimeControlTransportError {
  code: RuntimeControlTransportErrorCode;
  message: string;
}

type RuntimeControlSuccessResponseFor<M extends RuntimeControlMethod> = {
  protocol: typeof RUNTIME_CONTROL_PROTOCOL;
  version: typeof RUNTIME_CONTROL_VERSION;
  kind: 'response';
  requestId: string;
  method: M;
  ok: true;
  payload: RuntimeControlMethodMap[M]['response'];
};

export type RuntimeControlSuccessResponse = {
  [M in RuntimeControlMethod]: RuntimeControlSuccessResponseFor<M>
}[RuntimeControlMethod];

export interface RuntimeControlErrorResponse {
  protocol: typeof RUNTIME_CONTROL_PROTOCOL;
  version: typeof RUNTIME_CONTROL_VERSION;
  kind: 'response';
  requestId: string;
  method: RuntimeControlMethod;
  ok: false;
  error: RuntimeControlTransportError;
}

export type RuntimeControlResponse = RuntimeControlSuccessResponse | RuntimeControlErrorResponse;

export type RuntimeControlEvent =
  | {
      protocol: typeof RUNTIME_CONTROL_PROTOCOL;
      version: typeof RUNTIME_CONTROL_VERSION;
      kind: 'event';
      event: 'registry';
      subscriptionId: string;
      snapshot: ControlRegistrySnapshot;
    }
  | {
      protocol: typeof RUNTIME_CONTROL_PROTOCOL;
      version: typeof RUNTIME_CONTROL_VERSION;
      kind: 'event';
      event: 'invocation';
      invocationId: string;
      payload: ControlInvocationEvent;
    }
  | {
      protocol: typeof RUNTIME_CONTROL_PROTOCOL;
      version: typeof RUNTIME_CONTROL_VERSION;
      kind: 'event';
      event: 'invocation-result';
      invocationId: string;
      snapshot: ControlInvocationSnapshot;
    };

function wireRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => required.includes(key) || optional.includes(key));
}

interface WireBudget {
  nodes: number;
  seen: Set<object>;
}

function wireString(value: unknown, allowEmpty = true): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) &&
    value.length <= RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH;
}

function wireJson(
  value: unknown,
  budget: WireBudget = { nodes: 0, seen: new Set() },
  depth = 0,
  maxNodes = RUNTIME_CONTROL_MAX_WIRE_NODES,
): value is ControlJsonValue {
  budget.nodes += 1;
  if (budget.nodes > maxNodes || depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return wireString(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || budget.seen.has(value)) return false;
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(descriptors).length !== value.length + 1) {
        return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable ||
          !wireJson(descriptor.value, budget, depth + 1, maxNodes)) return false;
      }
      return true;
    }
    if (!wireRecord(value)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (Object.getOwnPropertySymbols(value).length > 0 ||
      keys.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) return false;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!wireString(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable ||
        !wireJson(descriptor.value, budget, depth + 1, maxNodes)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    budget.seen.delete(value);
  }
}

function wireId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= RUNTIME_CONTROL_MAX_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function stringPath(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(wireId);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function integerNonnegative(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function requestPayload(method: RuntimeControlMethod, payload: unknown): boolean {
  if (!wireRecord(payload)) return false;
  switch (method) {
    case 'list':
    case 'subscribeRegistry':
      return exactKeys(payload, []);
    case 'describe':
      return exactKeys(payload, ['operationId']) && wireId(payload.operationId);
    case 'resolve':
      return exactKeys(payload, ['path']) && stringPath(payload.path);
    case 'complete':
      return exactKeys(payload, ['path'], ['argument', 'query', 'arguments']) &&
        stringPath(payload.path) &&
        (payload.argument === undefined || wireId(payload.argument)) &&
        (payload.query === undefined || typeof payload.query === 'string') &&
        (payload.arguments === undefined || (wireRecord(payload.arguments) && wireJson(payload.arguments)));
    case 'invoke':
      return exactKeys(payload, ['operationId', 'arguments']) && wireId(payload.operationId) &&
        wireRecord(payload.arguments) && wireJson(payload.arguments);
    case 'cancel':
    case 'getInvocation':
    case 'unsubscribeInvocation':
      return exactKeys(payload, ['invocationId']) && wireId(payload.invocationId);
    case 'unsubscribeRegistry':
      return exactKeys(payload, ['subscriptionId']) && wireId(payload.subscriptionId);
  }
}

function runtimeMethod(value: unknown): value is RuntimeControlMethod {
  return typeof value === 'string' && [
    'list', 'describe', 'resolve', 'complete', 'invoke', 'cancel', 'getInvocation',
    'subscribeRegistry', 'unsubscribeRegistry', 'unsubscribeInvocation',
  ].includes(value);
}

export function isRuntimeControlRequest(value: unknown): value is RuntimeControlRequest {
  try {
    if (!wireJson(value) || !wireRecord(value) || !exactKeys(value, [
      'protocol', 'version', 'kind', 'requestId', 'method', 'payload',
    ])) return false;
    return value.protocol === RUNTIME_CONTROL_PROTOCOL && value.version === RUNTIME_CONTROL_VERSION &&
      value.kind === 'request' && wireId(value.requestId) && runtimeMethod(value.method) &&
      requestPayload(value.method, value.payload);
  } catch {
    return false;
  }
}

function sourceDescriptorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['domain', 'module', 'symbol']) &&
    wireString(value.domain, false) && wireString(value.module, false) && wireString(value.symbol, false);
}

function argumentDescriptorValue(value: unknown): boolean {
  if (!wireRecord(value) || !exactKeys(value, ['name', 'description', 'type'], [
    'option', 'required', 'default', 'enum', 'minimum', 'maximum', 'repeated', 'sensitive', 'resource',
  ]) || !wireString(value.name, false) || !wireString(value.description) ||
    !['string', 'number', 'integer', 'boolean', 'enum', 'resource', 'json'].includes(String(value.type))) {
    return false;
  }
  return (value.option === undefined || wireString(value.option, false)) &&
    (value.required === undefined || typeof value.required === 'boolean') &&
    (value.default === undefined || wireJson(value.default)) &&
    (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
    (value.minimum === undefined || typeof value.minimum === 'number' && Number.isFinite(value.minimum)) &&
    (value.maximum === undefined || typeof value.maximum === 'number' && Number.isFinite(value.maximum)) &&
    (value.repeated === undefined || typeof value.repeated === 'boolean') &&
    (value.sensitive === undefined || typeof value.sensitive === 'boolean') &&
    (value.resource === undefined || wireString(value.resource, false));
}

function valueSchemaValue(value: unknown, depth = 0): boolean {
  if (depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH || !wireRecord(value) || typeof value.type !== 'string') return false;
  const sensitive = value.sensitive === undefined || value.sensitive === true;
  if (!sensitive) return false;
  if (['null', 'boolean', 'number', 'integer', 'string', 'json'].includes(value.type)) {
    return exactKeys(value, ['type'], ['enum', 'minimum', 'maximum', 'sensitive']) &&
      (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
      (value.minimum === undefined || typeof value.minimum === 'number' && Number.isFinite(value.minimum)) &&
      (value.maximum === undefined || typeof value.maximum === 'number' && Number.isFinite(value.maximum));
  }
  if (value.type === 'array') {
    return exactKeys(value, ['type', 'items'], ['minimumItems', 'maximumItems', 'sensitive']) &&
      valueSchemaValue(value.items, depth + 1) &&
      (value.minimumItems === undefined || integerNonnegative(value.minimumItems)) &&
      (value.maximumItems === undefined || integerNonnegative(value.maximumItems));
  }
  if (value.type === 'object') {
    if (!exactKeys(value, ['type', 'properties'], ['required', 'additionalProperties', 'sensitive']) ||
      !wireRecord(value.properties) ||
      (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') ||
      (value.required !== undefined &&
        (!Array.isArray(value.required) || !value.required.every(item => wireString(item))))) {
      return false;
    }
    return Object.entries(value.properties).every(([key, schema]) =>
      wireString(key, false) && valueSchemaValue(schema, depth + 1));
  }
  return false;
}

function renderHintValue(value: unknown): boolean {
  if (!wireRecord(value) || typeof value.kind !== 'string') return false;
  if (['text', 'json', 'record'].includes(value.kind)) return exactKeys(value, ['kind']);
  if (value.kind !== 'table' || !exactKeys(value, ['kind'], ['columns'])) return false;
  return value.columns === undefined || (Array.isArray(value.columns) && value.columns.every(column =>
    wireRecord(column) && exactKeys(column, ['key', 'label']) &&
    wireString(column.key, false) && wireString(column.label)));
}

function resultDescriptorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['schema'], ['render']) && valueSchemaValue(value.schema) &&
    (value.render === undefined || renderHintValue(value.render));
}

function availabilityValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['state'], ['reason']) &&
    ['available', 'unavailable'].includes(String(value.state)) &&
    (value.reason === undefined || wireString(value.reason));
}

function policyValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['access', 'confirmation'], ['rationale']) &&
    ['allowed', 'restricted', 'denied'].includes(String(value.access)) &&
    ['never', 'required'].includes(String(value.confirmation)) &&
    (value.rationale === undefined || wireString(value.rationale));
}

function operationDescriptorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, [
    'id', 'source', 'summary', 'help', 'usage', 'examples', 'arguments', 'result',
    'availability', 'effects', 'policy', 'classification',
  ]) && wireId(value.id) && sourceDescriptorValue(value.source) && wireString(value.summary) &&
    wireString(value.help) && wireString(value.usage) && Array.isArray(value.examples) &&
    value.examples.every(example => wireString(example)) && Array.isArray(value.arguments) &&
    value.arguments.every(argumentDescriptorValue) && resultDescriptorValue(value.result) &&
    availabilityValue(value.availability) && Array.isArray(value.effects) && value.effects.every(effect =>
      ['read', 'reversible', 'destructive', 'network', 'publish', 'device', 'privileged'].includes(String(effect))) &&
    policyValue(value.policy) && ['control-backed', 'pending', 'private'].includes(String(value.classification));
}

function registrySnapshotValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['revision', 'operations']) &&
    integerNonnegative(value.revision) &&
    Array.isArray(value.operations) && value.operations.every(operationDescriptorValue);
}

function resolvedOperationValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['revision', 'descriptor']) &&
    integerNonnegative(value.revision) && operationDescriptorValue(value.descriptor);
}

function completionResultValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['revision', 'items']) && integerNonnegative(value.revision) &&
    Array.isArray(value.items) && value.items.every(item => (
      wireRecord(item) && exactKeys(item, ['value', 'kind'], ['label', 'description']) &&
      wireString(item.value) && ['operation', 'argument', 'enum', 'resource'].includes(String(item.kind)) &&
      (item.label === undefined || wireString(item.label)) &&
      (item.description === undefined || wireString(item.description))
    ));
}

function invocationEventValue(value: unknown): boolean {
  if (!wireRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'progress') {
    return exactKeys(value, ['kind', 'invocationId', 'sequence', 'timestamp', 'message'], [
      'current', 'total', 'data',
    ]) && wireId(value.invocationId) && integerNonnegative(value.sequence) &&
      finiteNonnegative(value.timestamp) && wireString(value.message) &&
      (value.current === undefined || finiteNonnegative(value.current)) &&
      (value.total === undefined || finiteNonnegative(value.total)) &&
      (value.data === undefined || wireJson(value.data));
  }
  if (value.kind === 'status') {
    return exactKeys(value, ['kind', 'invocationId', 'sequence', 'timestamp', 'status']) &&
      wireId(value.invocationId) && integerNonnegative(value.sequence) && finiteNonnegative(value.timestamp) &&
      ['accepted', 'succeeded', 'no-op', 'cancelled', 'failed', 'unavailable'].includes(String(value.status));
  }
  return false;
}

function invocationErrorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['code', 'message'], ['details']) &&
    ['unknown_operation', 'invalid_arguments', 'unavailable', 'controller_error', 'controller_contract',
      'cancelled', 'forbidden', 'confirmation_denied', 'invalid_request'].includes(String(value.code)) &&
    wireString(value.message) && (value.details === undefined || wireJson(value.details));
}

function invocationSnapshotValue(value: unknown): boolean {
  if (!wireRecord(value) || !exactKeys(value, [
    'id', 'operationId', 'operationRevision', 'status', 'cancellable', 'startedAt', 'progress',
  ], ['completedAt', 'value', 'message', 'error']) || !wireId(value.id) || !wireId(value.operationId) ||
    !integerNonnegative(value.operationRevision) ||
    !['running', 'accepted', 'succeeded', 'no-op', 'cancelled', 'failed', 'unavailable']
      .includes(String(value.status)) || typeof value.cancellable !== 'boolean' ||
    !finiteNonnegative(value.startedAt) ||
    (value.completedAt !== undefined && !finiteNonnegative(value.completedAt)) ||
    (value.value !== undefined && !wireJson(value.value)) ||
    (value.message !== undefined && !wireString(value.message)) ||
    (value.error !== undefined && !invocationErrorValue(value.error)) || !Array.isArray(value.progress)) {
    return false;
  }

  const terminal = value.status !== 'running';
  if ((!terminal && (value.completedAt !== undefined || value.error !== undefined)) ||
    (terminal && value.completedAt === undefined) ||
    (value.completedAt !== undefined && (value.completedAt as number) < (value.startedAt as number)) ||
    (value.error !== undefined && !['failed', 'unavailable', 'cancelled'].includes(String(value.status)))) {
    return false;
  }

  let previousSequence = -1;
  for (const event of value.progress) {
    if (!invocationEventValue(event) || !wireRecord(event) || event.kind !== 'progress' ||
      event.invocationId !== value.id || (event.sequence as number) <= previousSequence) return false;
    previousSequence = event.sequence as number;
  }
  return true;
}

function responsePayload(method: RuntimeControlMethod, payload: unknown): boolean {
  if (method === 'describe' || method === 'resolve' || method === 'getInvocation') {
    if (payload === null) return true;
    if (method === 'describe') return operationDescriptorValue(payload);
    if (method === 'resolve') return resolvedOperationValue(payload);
    return invocationSnapshotValue(payload);
  }
  const maxNodes = method === 'list' || method === 'subscribeRegistry'
    ? RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES
    : RUNTIME_CONTROL_MAX_WIRE_NODES;
  if (!wireRecord(payload) || !wireJson(payload, { nodes: 0, seen: new Set() }, 0, maxNodes)) return false;
  switch (method) {
    case 'invoke':
      return exactKeys(payload, ['invocationId', 'cancellable']) && wireId(payload.invocationId) &&
        typeof payload.cancellable === 'boolean';
    case 'cancel':
      return exactKeys(payload, ['cancelled']) && typeof payload.cancelled === 'boolean';
    case 'subscribeRegistry':
      return exactKeys(payload, ['subscriptionId', 'snapshot']) && wireId(payload.subscriptionId) &&
        registrySnapshotValue(payload.snapshot);
    case 'unsubscribeRegistry':
    case 'unsubscribeInvocation':
      return exactKeys(payload, ['unsubscribed']) && typeof payload.unsubscribed === 'boolean';
    default:
      if (method === 'list') return registrySnapshotValue(payload);
      if (method === 'complete') return completionResultValue(payload);
      return true;
  }
}

export function isRuntimeControlResponse(value: unknown): value is RuntimeControlResponse {
  try {
    if (!wireRecord(value) || value.protocol !== RUNTIME_CONTROL_PROTOCOL ||
      value.version !== RUNTIME_CONTROL_VERSION || value.kind !== 'response' ||
      !wireId(value.requestId) || !runtimeMethod(value.method) || typeof value.ok !== 'boolean') return false;
    const maxNodes = value.ok && (value.method === 'list' || value.method === 'subscribeRegistry')
      ? RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES
      : RUNTIME_CONTROL_MAX_WIRE_NODES;
    if (!wireJson(value, { nodes: 0, seen: new Set() }, 0, maxNodes)) return false;
    if (value.ok) {
      return exactKeys(value, ['protocol', 'version', 'kind', 'requestId', 'method', 'ok', 'payload']) &&
        responsePayload(value.method, value.payload);
    }
    return exactKeys(value, ['protocol', 'version', 'kind', 'requestId', 'method', 'ok', 'error']) &&
      wireRecord(value.error) && exactKeys(value.error, ['code', 'message']) &&
      ['invalid_request', 'unsupported_version', 'unknown_method', 'too_many_pending', 'disconnected', 'host_error']
        .includes(String(value.error.code)) && wireString(value.error.message);
  } catch {
    return false;
  }
}

export function isRuntimeControlEvent(value: unknown): value is RuntimeControlEvent {
  try {
    if (!wireRecord(value) || value.protocol !== RUNTIME_CONTROL_PROTOCOL ||
      value.version !== RUNTIME_CONTROL_VERSION || value.kind !== 'event' || typeof value.event !== 'string') {
      return false;
    }
    const maxNodes = value.event === 'registry'
      ? RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES
      : RUNTIME_CONTROL_MAX_WIRE_NODES;
    if (!wireJson(value, { nodes: 0, seen: new Set() }, 0, maxNodes)) return false;
    if (value.event === 'registry') {
      return exactKeys(value, ['protocol', 'version', 'kind', 'event', 'subscriptionId', 'snapshot']) &&
        wireId(value.subscriptionId) && registrySnapshotValue(value.snapshot);
    }
    if (value.event === 'invocation') {
      return exactKeys(value, ['protocol', 'version', 'kind', 'event', 'invocationId', 'payload']) &&
        wireId(value.invocationId) && invocationEventValue(value.payload) &&
        wireRecord(value.payload) && value.payload.invocationId === value.invocationId;
    }
    if (value.event === 'invocation-result') {
      return exactKeys(value, ['protocol', 'version', 'kind', 'event', 'invocationId', 'snapshot']) &&
        wireId(value.invocationId) && invocationSnapshotValue(value.snapshot) &&
        wireRecord(value.snapshot) && value.snapshot.id === value.invocationId && value.snapshot.status !== 'running';
    }
    return false;
  } catch {
    return false;
  }
}
