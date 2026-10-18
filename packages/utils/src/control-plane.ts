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

export type ControlSchemaFormat = 'uri' | 'uuid' | 'date-time';

interface ControlSchemaAnnotations {
  enum?: ControlJsonValue[];
  minimum?: number;
  maximum?: number;
  minimumLength?: number;
  maximumLength?: number;
  format?: ControlSchemaFormat;
  unit?: string;
  resource?: string;
  default?: ControlJsonValue;
  examples?: ControlJsonValue[];
  sensitive?: true;
}

export type ControlValueSchema = (
  | {
      type: 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'json';
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
      additionalProperties?: boolean | ControlValueSchema;
    }
  | {
      /** Exactly one branch must accept a value. Branches must be non-overlapping. */
      type: 'oneOf';
      schemas: ControlValueSchema[];
    }
) & ControlSchemaAnnotations;

export type ControlRenderHint =
  | { kind: 'text' | 'json' | 'record' }
  | { kind: 'table'; columns?: Array<{ key: string; label: string }> };

export interface ControlResultDescriptor {
  schema: ControlValueSchema;
  render?: ControlRenderHint;
}

/** A schema and bounded retained history for streamed operation progress. */
export interface ControlProgressDescriptor extends ControlResultDescriptor {
  historyLimit?: number;
  stream?: {
    encoding: 'json-chunks';
    chunkUnit: 'utf16-code-units';
    chunkMaximumLength: number;
    record: ControlValueSchema;
    /** Only the host stream encoder may emit these schema-redacted records. */
    redaction?: 'schema';
  };
}

export interface ControlAvailability {
  state: 'available' | 'unavailable';
  reason?: string;
  /** Owner-declared inert recovery guidance for a currently unavailable command. */
  recovery?: ControlRecoveryDescriptor;
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

/** A named input binding that can be rendered by humans and consumed by callers. */
export interface ControlCommandBinding {
  name: string;
  description: string;
  /** Whether callers may use this binding positionally, by long option, or either way. */
  mode: 'position' | 'option' | 'both';
  position?: number;
  option?: string;
  metavar?: string;
  repeated?: boolean;
  /** Static boolean value selected by a flag option; value options use `metavar` instead. */
  flagValue?: boolean;
}

/** Machine-readable projection of an executable command declaration. */
export interface ControlCommandContract {
  publicPath: string[];
  aliases: string[][];
  input: ControlValueSchema;
  result: ControlResultDescriptor;
  /** Schema for structured progress data. Omit when an operation emits no data. */
  progress?: ControlProgressDescriptor;
  bindings: ControlCommandBinding[];
  help: string;
  examples: string[];
  domainErrors: ControlDomainErrorDefinition[];
}

export interface ControlValidationIssue {
  path: string;
  code: 'invalid_type' | 'missing_required' | 'unknown_property' | 'constraint' | 'unsafe_value';
  message: string;
  constraint?: string;
  recovery?: ControlRecoveryDescriptor;
  example?: ControlJsonValue;
}

export interface ControlValidationResult {
  value?: Record<string, ControlJsonValue>;
  issues: ControlValidationIssue[];
}

export interface ControlOutputValidationResult {
  value?: ControlJsonValue;
  issues: ControlValidationIssue[];
}

export interface ControlRecoveryDescriptor {
  guidance: string;
  retry: 'never' | 'after-correction' | 'safe';
}

export interface ControlDomainErrorDefinition {
  code: string;
  message: string;
  recovery: ControlRecoveryDescriptor;
  details?: ControlValueSchema;
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
  /** Optional compiled metadata; legacy descriptors remain supported during migration. */
  command?: ControlCommandContract;
}

/**
 * Feature-owned source for a command's legacy descriptor and machine contract.
 * The registry continues to accept descriptors without this definition until Phase 209.
 */
export interface ControlCommandDefinition {
  operation: Omit<ControlOperationDescriptor, 'help' | 'usage' | 'examples' | 'arguments' | 'result' | 'command'>;
  publicPath: string[];
  aliases?: string[][];
  input: ControlValueSchema;
  result: ControlResultDescriptor;
  progress?: ControlProgressDescriptor;
  bindings: ControlCommandBinding[];
  help: string;
  examples: string[];
  domainErrors?: ControlDomainErrorDefinition[];
}

export interface CompiledControlCommandDefinition {
  descriptor: ControlOperationDescriptor;
  contract: ControlCommandContract;
}

/** Returns whether a schema can contain a sensitive value at any reachable depth. */
export function hasSensitiveSchema(schema: ControlValueSchema): boolean {
  if (schema.sensitive === true) return true;
  if (schema.type === 'array') return hasSensitiveSchema(schema.items);
  if (schema.type === 'oneOf') return schema.schemas.some(hasSensitiveSchema);
  if (schema.type === 'object') {
    return Object.values(schema.properties).some(hasSensitiveSchema) ||
      (typeof schema.additionalProperties === 'object' && hasSensitiveSchema(schema.additionalProperties));
  }
  return false;
}

function commandArgumentType(schema: ControlValueSchema): ControlArgumentType {
  if (schema.type === 'array' || schema.type === 'object' || schema.type === 'oneOf') return 'json';
  if (schema.type === 'null') return 'json';
  if (schema.type === 'string' && schema.resource) return 'resource';
  if (schema.enum) return 'enum';
  return schema.type;
}

function commandUsage(id: string, bindings: readonly ControlCommandBinding[]): string {
  return [
    id,
    ...bindings
      .filter(binding => binding.option)
      .map(binding => `${binding.option}${binding.metavar ? ` ${binding.metavar}` : ''}`),
    ...bindings
      .filter(binding => !binding.option && binding.position !== undefined)
      .sort((left, right) => left.position! - right.position!)
      .map(binding => binding.metavar ?? binding.name),
  ].join(' ');
}

const poisonKeys = new Set(['__proto__', 'prototype', 'constructor']);
const schemaFormats = new Set<ControlSchemaFormat>(['uri', 'uuid', 'date-time']);

function safeStaticString(value: unknown, allowEmpty = true): value is string {
  return typeof value === 'string' && value.length <= RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH &&
    (allowEmpty || value.length > 0);
}

function schemaIssue(path: string, message: string): ControlValidationIssue {
  return { path, code: 'constraint', message };
}

function schemaKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => required.includes(key) || optional.includes(key));
}

function semanticJsonEqual(left: ControlJsonValue, right: ControlJsonValue): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => semanticJsonEqual(item, right[index]!));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every(key =>
      Object.prototype.hasOwnProperty.call(right, key) && semanticJsonEqual(left[key]!, right[key]!));
  }
  return false;
}

function dataRecord(value: unknown): Record<string, PropertyDescriptor> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(descriptors).length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) {
    return undefined;
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (poisonKeys.has(key) || !descriptor.enumerable || !('value' in descriptor)) return undefined;
  }
  return descriptors;
}

/** Validates and clones finite owner availability before it crosses a registry boundary. */
export function normalizeControlAvailability(value: unknown): ControlAvailability | undefined {
  const availability = dataRecord(value);
  if (!availability) return undefined;
  const keys = Object.keys(availability);
  if (!['state'].every(key => key in availability) || !keys.every(key => ['state', 'reason', 'recovery'].includes(key))) return undefined;
  if (availability.state?.value !== 'available' && availability.state?.value !== 'unavailable') return undefined;
  const reason = availability.reason?.value;
  if (reason !== undefined && !safeStaticString(reason)) return undefined;
  const recoveryRecord = availability.recovery === undefined ? undefined : dataRecord(availability.recovery.value);
  if (availability.recovery !== undefined && (!recoveryRecord ||
    Object.keys(recoveryRecord).length !== 2 || !('guidance' in recoveryRecord) || !('retry' in recoveryRecord) ||
    !safeStaticString(recoveryRecord.guidance?.value, false) ||
    typeof recoveryRecord.retry?.value !== 'string' ||
    !['never', 'after-correction', 'safe'].includes(recoveryRecord.retry.value))) return undefined;
  return {
    state: availability.state.value as ControlAvailability['state'],
    ...(reason === undefined ? {} : { reason: reason as string }),
    ...(recoveryRecord === undefined ? {} : {
      recovery: { guidance: recoveryRecord.guidance!.value as string, retry: recoveryRecord.retry!.value as ControlRecoveryDescriptor['retry'] },
    }),
  };
}

function schemaDefinitionIssues(
  candidate: unknown,
  path: string,
  issues: ControlValidationIssue[],
  allowDefault: boolean,
  resultSchema: boolean,
  depth = 0,
): void {
  if (depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH || !wireRecord(candidate) || typeof candidate.type !== 'string') {
    issues.push(schemaIssue(path, 'Schema must be a finite object')); return;
  }
  const schema = candidate as Record<string, unknown>;
  const annotations = ['sensitive', 'unit', 'resource', 'default', 'examples'];
  const scalar = ['null', 'boolean', 'number', 'integer', 'string', 'json'].includes(schema.type as string);
  const expected = scalar ? ['type']
    : schema.type === 'array' ? ['type', 'items']
      : schema.type === 'object' ? ['type', 'properties']
        : schema.type === 'oneOf' ? ['type', 'schemas'] : [];
  const allowed = scalar
    ? [...annotations, 'enum', 'minimum', 'maximum', 'minimumLength', 'maximumLength', 'format']
    : schema.type === 'array'
      ? [...annotations, 'enum', 'minimumItems', 'maximumItems']
      : schema.type === 'object'
        ? [...annotations, 'enum', 'required', 'additionalProperties']
        : schema.type === 'oneOf'
          ? [...annotations, 'enum']
        : [];
  if (expected.length === 0 || !schemaKeys(schema, expected, allowed)) {
    issues.push(schemaIssue(path, 'Schema uses unsupported fields')); return;
  }
  if (schema.sensitive !== undefined && schema.sensitive !== true) issues.push(schemaIssue(`${path}.sensitive`, 'Sensitivity is annotation-only true'));
  for (const annotation of ['unit', 'resource'] as const) {
    if (schema[annotation] !== undefined && !safeStaticString(schema[annotation], false)) {
      issues.push(schemaIssue(`${path}.${annotation}`, 'Annotation must be a bounded non-empty string'));
    }
  }
  const hasDefault = Object.prototype.hasOwnProperty.call(schema, 'default');
  if (hasDefault && (schema.default === undefined || resultSchema || !allowDefault)) {
    issues.push(schemaIssue(`${path}.default`, resultSchema ? 'Result schemas cannot declare defaults' : 'Defaults are only allowed on object properties'));
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'examples') && (!Array.isArray(schema.examples) || schema.examples.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH)) {
    issues.push(schemaIssue(`${path}.examples`, 'Examples must be a bounded array'));
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH)) {
    issues.push(schemaIssue(`${path}.enum`, 'Enum must be a non-empty bounded array'));
  }
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues) {
    enumValues.forEach((value, index) => {
      if (!wireJson(value)) issues.push(schemaIssue(`${path}.enum[${index}]`, 'Enum values must be transport-safe JSON'));
      if (enumValues.slice(0, index).some(previous => wireJson(previous) && wireJson(value) && semanticJsonEqual(previous, value))) {
        issues.push(schemaIssue(`${path}.enum`, 'Enum values must be unique'));
      }
    });
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum)) ||
      schema.maximum !== undefined && (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum)) ||
      typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) {
      issues.push(schemaIssue(path, 'Numeric bounds must be finite and ordered'));
    }
  } else if (schema.minimum !== undefined || schema.maximum !== undefined) {
    issues.push(schemaIssue(path, 'Numeric bounds require a number or integer schema'));
  }
  if (schema.type === 'string') {
    if (schema.minimumLength !== undefined && !integerNonnegative(schema.minimumLength) ||
      schema.maximumLength !== undefined && !integerNonnegative(schema.maximumLength) ||
      typeof schema.minimumLength === 'number' && typeof schema.maximumLength === 'number' && schema.minimumLength > schema.maximumLength) {
      issues.push(schemaIssue(path, 'String lengths must be ordered non-negative integers'));
    }
    if (schema.format !== undefined && (!schemaFormats.has(schema.format as ControlSchemaFormat))) {
      issues.push(schemaIssue(`${path}.format`, 'Unsupported string format'));
    }
  } else if (schema.minimumLength !== undefined || schema.maximumLength !== undefined || schema.format !== undefined) {
    issues.push(schemaIssue(path, 'String constraints require a string schema'));
  }
  if (schema.type === 'array') {
    if (schema.minimumItems !== undefined && !integerNonnegative(schema.minimumItems) ||
      schema.maximumItems !== undefined && !integerNonnegative(schema.maximumItems) ||
      typeof schema.minimumItems === 'number' && typeof schema.maximumItems === 'number' && schema.minimumItems > schema.maximumItems) {
      issues.push(schemaIssue(path, 'Array bounds must be ordered non-negative integers'));
    }
    schemaDefinitionIssues(schema.items, `${path}.items`, issues, false, resultSchema, depth + 1);
  } else if (schema.type === 'object') {
    if (!wireRecord(schema.properties) || Object.getOwnPropertySymbols(schema.properties).length > 0) {
      issues.push(schemaIssue(`${path}.properties`, 'Properties must be a finite record'));
    } else {
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!safeStaticString(name, false) || poisonKeys.has(name)) {
          issues.push(schemaIssue(`${path}.properties`, 'Property names must be safe bounded strings'));
          continue;
        }
        schemaDefinitionIssues(property, `${path}.properties.${name}`, issues, true, resultSchema, depth + 1);
      }
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length ||
        !schema.required.every(name => typeof name === 'string' && wireRecord(schema.properties) && Object.prototype.hasOwnProperty.call(schema.properties, name))) {
        issues.push(schemaIssue(`${path}.required`, 'Required names must be unique declared properties'));
      }
    }
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true && schema.additionalProperties !== false) {
      schemaDefinitionIssues(schema.additionalProperties, `${path}.additionalProperties`, issues, false, resultSchema, depth + 1);
    }
  } else if (schema.type === 'oneOf') {
    if (!Array.isArray(schema.schemas) || schema.schemas.length < 2 || schema.schemas.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) {
      issues.push(schemaIssue(`${path}.schemas`, 'oneOf schemas must contain two or more bounded variants'));
    } else {
      for (const [index, variant] of schema.schemas.entries()) {
        schemaDefinitionIssues(variant, `${path}.schemas[${index}]`, issues, false, resultSchema, depth + 1);
      }
    }
  } else if (schema.minimumItems !== undefined || schema.maximumItems !== undefined) {
    issues.push(schemaIssue(path, 'Array constraints require an array schema'));
  }
}

/** Validates a command declaration without creating a second command catalog. */
export function validateControlCommandDefinition(definition: ControlCommandDefinition): ControlValidationIssue[] {
  const issues: ControlValidationIssue[] = [];
  try {
    if (definition.input.type !== 'object') issues.push(schemaIssue('input', 'Control command input must be an object schema'));
    const publicPaths = [
      ['publicPath', definition.publicPath] as const,
      ...((definition.aliases ?? []).map((path, index) => [`aliases[${index}]`, path] as const)),
    ];
    const seenPaths = new Set<string>();
    for (const [path, words] of publicPaths) {
      if (!Array.isArray(words) || words.length === 0 || words.length > 32 ||
        words.some(word => !/^[a-z][a-z0-9-]*$/.test(word)) || new Set(words).size !== words.length) {
        issues.push(schemaIssue(path, 'Public paths must contain unique lowercase command words'));
        continue;
      }
      const key = words.join('\u0000');
      if (seenPaths.has(key)) issues.push(schemaIssue(path, 'Public paths and aliases must be unique'));
      seenPaths.add(key);
    }
    schemaDefinitionIssues(definition.input, 'input', issues, false, false);
    schemaDefinitionIssues(definition.result.schema, 'result.schema', issues, false, true);
    if (definition.progress) schemaDefinitionIssues(definition.progress.schema, 'progress.schema', issues, false, true);
    if (definition.progress?.historyLimit !== undefined && (!integerNonnegative(definition.progress.historyLimit) || definition.progress.historyLimit > 100)) {
      issues.push(schemaIssue('progress.historyLimit', 'Progress history limit must be an integer from 0 to 100'));
    }
    if (definition.progress?.stream) {
      const stream = definition.progress.stream;
      if (stream.encoding !== 'json-chunks' || stream.chunkUnit !== 'utf16-code-units' || !integerNonnegative(stream.chunkMaximumLength) || stream.chunkMaximumLength === 0 || stream.chunkMaximumLength > RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH) {
        issues.push(schemaIssue('progress.stream', 'Progress streams require a positive UTF-16 JSON chunk limit'));
      }
      schemaDefinitionIssues(stream.record, 'progress.stream.record', issues, false, true);
      if (stream.redaction !== undefined && stream.redaction !== 'schema') {
        issues.push(schemaIssue('progress.stream.redaction', 'Unknown stream redaction mode'));
      }
      if (hasSensitiveSchema(stream.record) && stream.redaction !== 'schema') {
        issues.push(schemaIssue('progress.stream.record', 'Streamed logical records cannot contain sensitive fields before a shared redaction encoder exists'));
      }
    }
    const bound = new Set<string>();
    const options = new Set<string>();
    const positions = new Map<number, { path: string; required: boolean; repeated: boolean }>();
    const inputProperties = definition.input.type === 'object' ? definition.input.properties : undefined;
    const required = new Set(definition.input.type === 'object' ? definition.input.required ?? [] : []);
    for (const [index, binding] of definition.bindings.entries()) {
      const path = `bindings[${index}]`;
      if (!wireRecord(binding) || !schemaKeys(binding, ['name', 'description', 'mode'], [
        'position', 'option', 'metavar', 'repeated', 'flagValue',
      ]) || !safeStaticString(binding.name, false) || !safeStaticString(binding.description, false) ||
        !['position', 'option', 'both'].includes(String(binding.mode)) || bound.has(binding.name) ||
        !inputProperties || !Object.prototype.hasOwnProperty.call(inputProperties, binding.name)) {
        issues.push(schemaIssue(path, 'Bindings require a unique declared name, description, mode, and input property'));
        continue;
      }
      bound.add(binding.name);
      const property = inputProperties[binding.name]!;
      const positional = binding.mode === 'position' || binding.mode === 'both';
      const option = binding.mode === 'option' || binding.mode === 'both';
      if ((positional && !integerNonnegative(binding.position)) || (!positional && binding.position !== undefined)) {
        issues.push(schemaIssue(`${path}.position`, 'Positional bindings need a non-negative position only in positional modes'));
      } else if (positional) {
        const position = binding.position!;
        if (positions.has(position)) issues.push(schemaIssue(`${path}.position`, 'Positional indexes must be unique'));
        positions.set(position, {
          path,
          required: required.has(binding.name) && property.default === undefined,
          repeated: binding.repeated === true,
        });
      }
      if (option && binding.option === '--help') {
        issues.push(schemaIssue(`${path}.option`, 'The --help option is reserved for Terminal help; choose a different long option'));
      } else if ((option && (!safeStaticString(binding.option, false) || !/^--[a-z][a-z0-9-]*$/.test(binding.option))) ||
        (!option && binding.option !== undefined)) {
        issues.push(schemaIssue(`${path}.option`, 'Option bindings need a lower-kebab long option only in option modes'));
      } else if (option) {
        if (options.has(binding.option!)) issues.push(schemaIssue(`${path}.option`, 'Long options must be unique'));
        options.add(binding.option!);
      }
      if (binding.repeated !== undefined && typeof binding.repeated !== 'boolean') {
        issues.push(schemaIssue(`${path}.repeated`, 'Repeated must be a boolean'));
      }
      if (binding.repeated === true && property.type !== 'array') {
        issues.push(schemaIssue(`${path}.repeated`, 'Repeated bindings require an array input field'));
      }
      if (Object.prototype.hasOwnProperty.call(binding, 'flagValue')) {
        if (!option || typeof binding.flagValue !== 'boolean' || property.type !== 'boolean' || binding.metavar !== undefined) {
          issues.push(schemaIssue(`${path}.flagValue`, 'Flag options require a boolean field, static value, and no metavar'));
        }
      } else if (option && (!safeStaticString(binding.metavar, false) || !/^[A-Z][A-Z0-9_]*$/.test(binding.metavar))) {
        issues.push(schemaIssue(`${path}.metavar`, 'Value options require an upper-snake metavar'));
      } else if (!option && binding.metavar !== undefined && (!safeStaticString(binding.metavar, false) || !/^[A-Z][A-Z0-9_]*$/.test(binding.metavar))) {
        issues.push(schemaIssue(`${path}.metavar`, 'Metavariables must use upper-snake tokens'));
      }
    }
    if (inputProperties) {
      for (const name of Object.keys(inputProperties)) {
        if (!bound.has(name)) issues.push(schemaIssue(`input.properties.${name}`, 'Each input property requires one command binding'));
      }
    }
    const sortedPositions = [...positions.entries()].sort(([left], [right]) => left - right);
    for (const [expected, [actual, item]] of sortedPositions.entries()) {
      if (actual !== expected) issues.push(schemaIssue(`${item.path}.position`, 'Positional indexes must be contiguous from zero'));
      if (item.repeated && expected !== sortedPositions.length - 1) {
        issues.push(schemaIssue(`${item.path}.repeated`, 'Repeated positional bindings must be final'));
      }
      if (expected > 0 && !sortedPositions[expected - 1]![1].required && item.required) {
        issues.push(schemaIssue(`${item.path}.position`, 'Required positional bindings must precede optional or defaulted bindings'));
      }
    }
    const codes = new Set<string>();
    for (const [index, domainError] of (definition.domainErrors ?? []).entries()) {
      const path = `domainErrors[${index}]`;
      if (!/^[a-z][a-z0-9-]*$/.test(domainError.code) || codes.has(domainError.code)) issues.push(schemaIssue(`${path}.code`, 'Domain error codes must be unique lower-kebab tokens'));
      codes.add(domainError.code);
      if (!safeStaticString(domainError.message, false)) issues.push(schemaIssue(`${path}.message`, 'Domain errors need a bounded static message'));
      const recovery = domainError.recovery as unknown;
      if (!wireRecord(recovery) || !schemaKeys(recovery, ['guidance', 'retry']) || !safeStaticString(recovery.guidance, false) ||
        typeof recovery.retry !== 'string' || !['never', 'after-correction', 'safe'].includes(recovery.retry)) {
        issues.push(schemaIssue(`${path}.recovery`, 'Domain recovery must have bounded guidance and supported retry semantics'));
      }
      if (domainError.details !== undefined) schemaDefinitionIssues(domainError.details, `${path}.details`, issues, false, true);
    }
    if (issues.length === 0) {
      schemaSampleIssues(definition.input, 'input', issues);
      schemaSampleIssues(definition.result.schema, 'result.schema', issues);
      for (const [index, domainError] of (definition.domainErrors ?? []).entries()) {
        if (domainError.details) schemaSampleIssues(domainError.details, `domainErrors[${index}].details`, issues);
      }
    }
  } catch {
    issues.push(schemaIssue('definition', 'Command declaration must contain only own data values'));
  }
  return issues;
}

function projectSchema(schema: ControlValueSchema): ControlJsonValue {
  const result: Record<string, ControlJsonValue> = Object.create(null);
  if (schema.type !== 'json' && schema.type !== 'oneOf') result.type = schema.type;
  if (schema.enum !== undefined) result.enum = structuredClone(schema.enum);
  if (schema.minimum !== undefined) result.minimum = schema.minimum;
  if (schema.maximum !== undefined) result.maximum = schema.maximum;
  if (schema.minimumLength !== undefined) result['x-hyprgate-minLength'] = schema.minimumLength;
  if (schema.maximumLength !== undefined) result['x-hyprgate-maxLength'] = schema.maximumLength;
  if (schema.minimumLength !== undefined || schema.maximumLength !== undefined) {
    result['x-hyprgate-lengthUnit'] = 'utf16-code-units';
  }
  if (schema.format !== undefined) result.format = schema.format;
  if (schema.default !== undefined) result.default = structuredClone(schema.default);
  if (schema.examples !== undefined) result.examples = structuredClone(schema.examples);
  if (schema.sensitive) result['x-hyprgate-sensitive'] = true;
  if (schema.unit !== undefined) result['x-hyprgate-unit'] = schema.unit;
  if (schema.resource !== undefined) result['x-hyprgate-resource'] = schema.resource;
  if (schema.type === 'array') {
    result.items = projectSchema(schema.items);
    if (schema.minimumItems !== undefined) result.minItems = schema.minimumItems;
    if (schema.maximumItems !== undefined) result.maxItems = schema.maximumItems;
  }
  if (schema.type === 'object') {
    const properties: Record<string, ControlJsonValue> = Object.create(null);
    for (const [name, property] of Object.entries(schema.properties)) properties[name] = projectSchema(property);
    result.properties = properties;
    if (schema.required !== undefined) result.required = structuredClone(schema.required);
    result.additionalProperties = schema.additionalProperties === undefined || typeof schema.additionalProperties === 'boolean'
      ? schema.additionalProperties ?? false
      : projectSchema(schema.additionalProperties);
  }
  if (schema.type === 'oneOf') result.oneOf = schema.schemas.map(projectSchema);
  return result;
}

/**
 * Projects the documented local schema subset into descriptive Draft 2020-12
 * metadata. Local UTF-16 string bounds remain vendor annotations because the
 * standard keywords count JSON characters differently.
 */
export function projectControlSchemaToJsonSchema(schema: ControlValueSchema): ControlJsonValue {
  const result = projectSchema(schema) as Record<string, ControlJsonValue>;
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...result };
}

/**
 * Produces the transport descriptor and machine metadata from the feature-owned
 * declaration. The compiler deliberately keeps the existing dotted descriptor
 * identity so current discovery, resolve, and runtime-control callers stay compatible.
 */
export function compileControlCommandDefinition(
  definition: ControlCommandDefinition,
): CompiledControlCommandDefinition {
  const conformance = validateControlCommandDefinition(definition);
  if (conformance.length > 0) {
    const issue = conformance[0]!;
    throw new Error(`Invalid control command definition: ${issue.path}: ${issue.message}`);
  }
  if (definition.input.type !== 'object') throw new Error('Control command input must be an object schema');
  const input = definition.input;
  const required = new Set(input.required ?? []);
  const boundNames = new Set<string>();
  const arguments_ = definition.bindings.map((binding) => {
    if (!binding.name || !binding.description || (!binding.option && binding.position === undefined)) {
      throw new Error('Control command bindings require a name, description, and position or option');
    }
    if (boundNames.has(binding.name)) throw new Error(`Control command binding already exists: ${binding.name}`);
    boundNames.add(binding.name);
    const schema = input.properties[binding.name];
    if (!schema) throw new Error(`Control command binding has no input schema: ${binding.name}`);
    return {
      name: binding.name,
      description: binding.description,
      type: commandArgumentType(schema),
      sensitive: hasSensitiveSchema(schema),
      ...(schema.default === undefined ? {} : { default: structuredClone(schema.default) }),
      ...(schema.resource === undefined ? {} : { resource: schema.resource }),
      ...(binding.option === undefined ? {} : { option: binding.option }),
      ...(required.has(binding.name) ? { required: true } : {}),
      ...(binding.repeated === undefined ? {} : { repeated: binding.repeated }),
      ...(!('enum' in schema) || schema.enum === undefined ? {} : { enum: structuredClone(schema.enum) }),
      ...(schema.type === 'number' || schema.type === 'integer'
        ? {
            ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
            ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
          }
        : {}),
    } satisfies ControlArgumentDescriptor;
  });
  const contract: ControlCommandContract = {
    publicPath: structuredClone(definition.publicPath),
    aliases: structuredClone(definition.aliases ?? []),
    input: structuredClone(input),
    result: structuredClone(definition.result),
    ...(definition.progress === undefined ? {} : { progress: structuredClone(definition.progress) }),
    bindings: structuredClone(definition.bindings),
    help: definition.help,
    examples: structuredClone(definition.examples),
    domainErrors: structuredClone(definition.domainErrors ?? []),
  };
  return {
    contract,
    descriptor: {
      ...structuredClone(definition.operation),
      help: definition.help,
      usage: commandUsage(definition.operation.id, definition.bindings),
      examples: structuredClone(definition.examples),
      arguments: arguments_,
      result: structuredClone(definition.result),
      command: contract,
    },
  };
}

function validationIssue(
  path: string,
  code: ControlValidationIssue['code'],
  message: string,
  constraint?: string,
): ControlValidationIssue {
  return { path, code, message, ...(constraint === undefined ? {} : { constraint }) };
}

function schemaAtValidationPath(
  schema: ControlValueSchema,
  path: string,
): { schema: ControlValueSchema; sensitive: boolean } | undefined {
  const prefix = 'arguments.';
  if (!path.startsWith(prefix)) return undefined;
  let remaining = path.slice(prefix.length);
  let current: ControlValueSchema | undefined = schema;
  let sensitive = schema.sensitive === true;
  while (remaining.length > 0) {
    if (!current || current.type !== 'object') return undefined;
    const keys: string[] = Object.keys(current.properties)
      .filter(candidate => remaining === candidate || remaining.startsWith(`${candidate}.`) || remaining.startsWith(`${candidate}[`))
      .sort((left, right) => right.length - left.length);
    // Validation paths are display strings. If two schema keys serialize to the
    // same display path, recovery must fail closed rather than pick a sibling.
    if (keys.length !== 1) return undefined;
    const key: string = keys[0]!;
    current = current.properties[key];
    if (!current) return undefined;
    sensitive ||= current.sensitive === true;
    remaining = remaining.slice(key.length);
    while (remaining.startsWith('[')) {
      const match = /^\[\d+\]/u.exec(remaining);
      if (!match || current.type !== 'array') return undefined;
      remaining = remaining.slice(match[0].length);
      if (current.type !== 'array') return undefined;
      current = current.items;
      sensitive ||= current.sensitive === true;
    }
    if (remaining.startsWith('.')) remaining = remaining.slice(1);
    else if (remaining.length > 0) return undefined;
  }
  return current ? { schema: current, sensitive: sensitive || hasSensitiveSchema(current) } : undefined;
}

function recoveryForSchema(
  target: { schema: ControlValueSchema; sensitive: boolean },
  issue: ControlValidationIssue,
): ControlValidationIssue {
  const { schema } = target;
  if (target.sensitive) return issue;
  const constraints: string[] = [];
  if (schema.type === 'string') {
    if (schema.minimumLength !== undefined && schema.maximumLength === schema.minimumLength) constraints.push(`exactly ${schema.minimumLength} UTF-16 code units`);
    else {
      if (schema.minimumLength !== undefined) constraints.push(`at least ${schema.minimumLength} UTF-16 code units`);
      if (schema.maximumLength !== undefined) constraints.push(`at most ${schema.maximumLength} UTF-16 code units`);
    }
    if (schema.format !== undefined) constraints.push(`format ${schema.format}`);
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined) constraints.push(`at least ${schema.minimum}`);
    if (schema.maximum !== undefined) constraints.push(`at most ${schema.maximum}`);
  }
  if (schema.type === 'array') {
    if (schema.minimumItems !== undefined) constraints.push(`at least ${schema.minimumItems} items`);
    if (schema.maximumItems !== undefined) constraints.push(`at most ${schema.maximumItems} items`);
  }
  if (schema.resource !== undefined) constraints.push(`resource ${schema.resource}`);
  if (schema.enum?.length) constraints.push(`one of the declared values`);
  const guidance = issue.code === 'missing_required'
    ? `Provide the required value${constraints.length ? ` (${constraints.join(', ')})` : ''}.`
    : constraints.length
      ? `Correct the value to satisfy ${constraints.join(', ')}.`
      : undefined;
  const example = firstSafeSchemaExample(schema);
  return {
    ...issue,
    ...(guidance === undefined ? {} : { recovery: { guidance, retry: 'after-correction' as const } }),
    ...(example === undefined ? {} : { example }),
  };
}

/** Reads an authored example only through own data descriptors. */
function firstSafeSchemaExample(schema: ControlValueSchema): ControlJsonValue | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(schema, 'examples');
  if (!descriptor || !('value' in descriptor) || !Array.isArray(descriptor.value)) return undefined;
  const examples = descriptor.value;
  if (Object.getOwnPropertySymbols(examples).length > 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(examples);
  if (Object.keys(descriptors).length !== examples.length + 1) return undefined;
  const first = descriptors['0'];
  if (!first || !first.enumerable || !('value' in first)) return undefined;
  const state: ValidationState = {
    nodes: 0,
    maximumStringLength: RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH,
    seen: new Set(),
    issues: [],
    defaults: false,
  };
  return cloneJsonValue(first.value, state, 'example');
}

interface ValidationState {
  nodes: number;
  maximumStringLength: number;
  seen: Set<object>;
  issues: ControlValidationIssue[];
  defaults: boolean;
}

function unsafe(state: ValidationState, path: string): undefined {
  state.issues.push(validationIssue(path, 'unsafe_value', 'Value is not transport-safe', 'transport'));
  return undefined;
}

function enter(state: ValidationState, value: unknown, path: string): boolean {
  state.nodes += 1;
  if (state.nodes > RUNTIME_CONTROL_MAX_WIRE_NODES) {
    unsafe(state, path); return false;
  }
  if (value !== null && typeof value === 'object') {
    if (state.seen.has(value)) { unsafe(state, path); return false; }
    state.seen.add(value);
  }
  return true;
}

function leave(state: ValidationState, value: unknown): void {
  if (value !== null && typeof value === 'object') state.seen.delete(value);
}

function cloneJsonValue(value: unknown, state: ValidationState, path: string, depth = 0): ControlJsonValue | undefined {
  if (depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH || !enter(state, value, path)) return undefined;
  try {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : unsafe(state, path);
    if (typeof value === 'string') return value.length <= state.maximumStringLength ? value : unsafe(state, path);
    if (typeof value !== 'object') return unsafe(state, path);
    if (Array.isArray(value)) {
      if (value.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH || Object.getOwnPropertySymbols(value).length > 0) return unsafe(state, path);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length !== value.length + 1) return unsafe(state, path);
      const result: ControlJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return unsafe(state, path);
        const item = cloneJsonValue(descriptor.value, state, `${path}[${index}]`, depth + 1);
        if (item === undefined) return undefined;
        result.push(item);
      }
      return result;
    }
    const descriptors = dataRecord(value);
    if (!descriptors) return unsafe(state, path);
    const result: Record<string, ControlJsonValue> = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const item = cloneJsonValue(descriptor.value, state, `${path}.*`, depth + 1);
      if (item === undefined) return undefined;
      result[key] = item;
    }
    return result;
  } finally {
    leave(state, value);
  }
}

function validDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const numericYear = Number(year); const numericMonth = Number(month); const numericDay = Number(day);
  return numericMonth >= 1 && numericMonth <= 12 && numericDay >= 1 &&
    numericDay <= new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate() &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

function validFormat(format: ControlSchemaFormat, value: string): boolean {
  if (format === 'uri') return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  return validDateTime(value);
}

function walkControlValue(
  schema: ControlValueSchema,
  value: unknown,
  path: string,
  state: ValidationState,
  depth = 0,
): ControlJsonValue | undefined {
  if (schema.type === 'json') {
    const result = cloneJsonValue(value, state, path, depth);
    if (result === undefined) return undefined;
    if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, result))) {
      state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined;
    }
    return result;
  }
  if (schema.type === 'oneOf') {
    if (depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH) return unsafe(state, path);
    state.nodes += 1;
    if (state.nodes > RUNTIME_CONTROL_MAX_WIRE_NODES) return unsafe(state, path);
    const matches: ControlJsonValue[] = [];
    for (const variant of schema.schemas) {
      const variantState: ValidationState = {
        nodes: state.nodes,
        seen: state.seen,
        issues: [],
        defaults: state.defaults,
        maximumStringLength: state.maximumStringLength,
      };
      const normalized = walkControlValue(variant, value, path, variantState, depth + 1);
      state.nodes = variantState.nodes;
      if (variantState.issues.length === 0 && normalized !== undefined) matches.push(normalized);
    }
    if (matches.length !== 1) {
      state.issues.push(validationIssue(path, 'constraint', 'Value must match exactly one oneOf variant', 'oneOf'));
      return undefined;
    }
    const result = matches[0]!;
    if (state.defaults) {
      let normalizedMatches = 0;
      for (const variant of schema.schemas) {
        // The candidate was already cloned and bounded from caller input above.
        // This semantic parity pass must not charge a second traversal against
        // the caller's outer node budget, but still uses the same walker with
        // defaults disabled so a produced value cannot become oneOf-ambiguous.
        const normalizedState: ValidationState = {
          nodes: 0,
          seen: new Set(),
          issues: [],
          defaults: false,
          maximumStringLength: state.maximumStringLength,
        };
        const normalized = walkControlValue(variant, result, path, normalizedState, depth + 1);
        if (normalizedState.issues.length === 0 && normalized !== undefined) normalizedMatches += 1;
      }
      if (normalizedMatches !== 1) {
        state.issues.push(validationIssue(path, 'constraint', 'Value must match exactly one oneOf variant', 'oneOf'));
        return undefined;
      }
    }
    if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, result))) {
      state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined;
    }
    return result;
  }
  if (depth > RUNTIME_CONTROL_MAX_WIRE_DEPTH || !enter(state, value, path)) return undefined;
  try {
  if (schema.type === 'null') {
      if (value !== null) { state.issues.push(validationIssue(path, 'invalid_type', 'Value must be null', 'type')); return undefined; }
      if (schema.enum && !schema.enum.includes(null)) {
        state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined;
      }
      return null;
  }
  if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') { state.issues.push(validationIssue(path, 'invalid_type', 'Value must be a boolean', 'type')); return undefined; }
      if (schema.enum && !schema.enum.includes(value)) {
        state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined;
      }
      return value;
  }
  if (schema.type === 'string') {
      if (typeof value !== 'string') { state.issues.push(validationIssue(path, 'invalid_type', 'Value must be a string', 'type')); return undefined; }
      if (value.length > state.maximumStringLength) return unsafe(state, path);
      if (schema.minimumLength !== undefined && value.length < schema.minimumLength || schema.maximumLength !== undefined && value.length > schema.maximumLength) {
        state.issues.push(validationIssue(path, 'constraint', 'String length is outside its declared bounds', 'length')); return undefined;
      }
      if (schema.format && !validFormat(schema.format, value)) { state.issues.push(validationIssue(path, 'constraint', 'String does not match its declared format', 'format')); return undefined; }
      if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, value))) { state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined; }
      return value;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
        state.issues.push(validationIssue(path, 'invalid_type', `Value must be a ${schema.type}`, 'type')); return undefined;
    }
      if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) {
        state.issues.push(validationIssue(path, 'constraint', 'Number is outside its declared bounds', 'bounds')); return undefined;
      }
      if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, value))) { state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined; }
      return value;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
        state.issues.push(validationIssue(path, 'invalid_type', 'Value must be an array', 'type')); return undefined;
    }
      if (value.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) return unsafe(state, path);
      if (schema.minimumItems !== undefined && value.length < schema.minimumItems || schema.maximumItems !== undefined && value.length > schema.maximumItems) {
        state.issues.push(validationIssue(path, 'constraint', 'Array length is outside its declared bounds', 'items')); return undefined;
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(descriptors).length !== value.length + 1) return unsafe(state, path);
      const result: ControlJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return unsafe(state, path);
        const item = walkControlValue(schema.items, descriptor.value, `${path}[${index}]`, state, depth + 1);
        if (item === undefined) return undefined;
        result.push(item);
      }
      if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, result))) { state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined; }
      return result;
  }
    if (schema.type !== 'object') return unsafe(state, path);
    const objectSchema = schema;
    const descriptors = dataRecord(value);
    if (!descriptors) { state.issues.push(validationIssue(path, 'invalid_type', 'Value must be a transport-safe object', 'type')); return undefined; }
    const result: Record<string, ControlJsonValue> = Object.create(null);
    const required = new Set(objectSchema.required ?? []);
    for (const [name, property] of Object.entries(objectSchema.properties)) {
      const descriptor = descriptors[name];
      if (!descriptor) {
        if (state.defaults && property.default !== undefined) {
          const defaultState: ValidationState = { nodes: state.nodes, maximumStringLength: state.maximumStringLength, seen: state.seen, issues: state.issues, defaults: false };
          const normalized = walkControlValue(property, property.default, `${path}.${name}`, defaultState, depth + 1);
          state.nodes = defaultState.nodes;
          if (normalized !== undefined) result[name] = normalized;
        } else if (required.has(name)) state.issues.push(validationIssue(`${path}.${name}`, 'missing_required', 'Value is required', 'required'));
        continue;
      }
      const normalized = walkControlValue(property, descriptor.value, `${path}.${name}`, state, depth + 1);
      if (normalized !== undefined) result[name] = normalized;
    }
    const unknown = Object.keys(descriptors).filter(name => !Object.prototype.hasOwnProperty.call(objectSchema.properties, name));
    if (unknown.length > 0) {
      if (objectSchema.additionalProperties === true || (objectSchema.additionalProperties && typeof objectSchema.additionalProperties === 'object')) {
        for (const name of unknown) {
          if (poisonKeys.has(name)) return unsafe(state, path);
          const propertySchema = objectSchema.additionalProperties === true
            ? { type: 'json' as const }
            : objectSchema.additionalProperties;
          const normalized = walkControlValue(propertySchema, descriptors[name]!.value, `${path}.*`, state, depth + 1);
          if (normalized !== undefined) result[name] = normalized;
        }
      } else {
        state.issues.push(validationIssue(path, 'unknown_property', 'Object contains undeclared properties', 'additionalProperties'));
      }
    }
    if (schema.enum && !schema.enum.some(item => semanticJsonEqual(item, result))) { state.issues.push(validationIssue(path, 'constraint', 'Value is not an allowed option', 'enum')); return undefined; }
    return result;
  } finally {
    leave(state, value);
  }
}

function schemaSampleIssues(schema: ControlValueSchema, path: string, issues: ControlValidationIssue[]): void {
  const samples: Array<[string, ControlJsonValue]> = [];
  if (Object.prototype.hasOwnProperty.call(schema, 'default') && schema.default !== undefined) samples.push(['default', schema.default]);
  for (const [index, example] of (schema.examples ?? []).entries()) samples.push([`examples[${index}]`, example]);
  for (const [samplePath, sample] of samples) {
    const state: ValidationState = { nodes: 0, maximumStringLength: RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH, seen: new Set(), issues: [], defaults: false };
    walkControlValue(schema, sample, path, state);
    if (state.issues.length > 0) issues.push(schemaIssue(`${path}.${samplePath}`, 'Declared sample must satisfy its local schema'));
  }
  if (schema.type === 'array') schemaSampleIssues(schema.items, `${path}.items`, issues);
  if (schema.type === 'object') {
    for (const [name, property] of Object.entries(schema.properties)) schemaSampleIssues(property, `${path}.properties.${name}`, issues);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      schemaSampleIssues(schema.additionalProperties, `${path}.additionalProperties`, issues);
    }
  }
  if (schema.type === 'oneOf') {
    for (const [index, variant] of schema.schemas.entries()) {
      schemaSampleIssues(variant, `${path}.schemas[${index}]`, issues);
    }
  }
}

/** Normalizes named machine input against a compiled command's authoritative schema. */
export function normalizeControlInput(
  schema: ControlValueSchema,
  input: unknown,
): ControlValidationResult {
  const state: ValidationState = { nodes: 0, maximumStringLength: RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH, seen: new Set(), issues: [], defaults: true };
  const value = walkControlValue(schema, input, 'arguments', state);
  const issues = state.issues.map(issue => {
    const target = schemaAtValidationPath(schema, issue.path);
    return target ? recoveryForSchema(target, issue) : issue;
  });
  return state.issues.length > 0 || value === undefined || Array.isArray(value) || value === null || typeof value !== 'object'
    ? { issues }
    : { value: value as Record<string, ControlJsonValue>, issues: [] };
}

/** Optional bounds for logical streamed records, which are validated before chunking.
 * Ordinary invocation values always use the stricter runtime-wire default. */
export interface ControlOutputValidationOptions {
  readonly maximumStringLength?: number;
}

/** Validates and clones controller output without applying input defaults. */
export function validateControlOutput(
  schema: ControlValueSchema,
  output: unknown,
  options: ControlOutputValidationOptions = {},
): ControlOutputValidationResult {
  const maximumStringLength = options.maximumStringLength ?? RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH;
  if (!Number.isInteger(maximumStringLength) || maximumStringLength < 1 || maximumStringLength > RUNTIME_CONTROL_MAX_LOGICAL_STREAM_STRING_LENGTH) {
    return { issues: [validationIssue('result', 'constraint', 'Maximum string length must be within the logical stream bound', 'maximumStringLength')] };
  }
  const state: ValidationState = { nodes: 0, maximumStringLength, seen: new Set(), issues: [], defaults: false };
  const value = walkControlValue(schema, output, 'result', state);
  return state.issues.length > 0 || value === undefined ? { issues: state.issues } : { value, issues: [] };
}

function selectControlStreamSchema(schema: ControlValueSchema, value: ControlJsonValue): ControlValueSchema | undefined {
  return schema.type === 'oneOf'
    ? schema.schemas.find(candidate => validateControlOutput(candidate, value, {
      maximumStringLength: RUNTIME_CONTROL_MAX_LOGICAL_STREAM_STRING_LENGTH,
    }).issues.length === 0)
    : schema;
}

/** Collects secret literals from validated, cloned JSON before owners split large values into records. */
export function collectControlSensitiveLiterals(
  schema: ControlValueSchema,
  value: ControlJsonValue,
): ReadonlySet<string> {
  const literals = new Set<string>();
  const collectStrings = (value: ControlJsonValue): void => {
    if (typeof value === 'string' && value.length > 0) literals.add(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => { literals.add(key); collectStrings(item); });
  };
  const collect = (schema: ControlValueSchema, value: ControlJsonValue): void => {
    if (schema.sensitive) { collectStrings(value); return; }
    const selected = selectControlStreamSchema(schema, value);
    if (!selected) return;
    if (selected !== schema) { collect(selected, value); return; }
    if (schema.type === 'array' && Array.isArray(value)) value.forEach(item => collect(schema.items, item));
    else if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, item] of Object.entries(value)) {
        const field = schema.properties[key] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined);
        if (field) {
          if (schema.properties[key] === undefined && hasSensitiveSchema(field)) literals.add(key);
          collect(field, item);
        }
      }
    }
  };
  collect(schema, value);
  return literals;
}

/** Validates the logical record, redacts secrets and aliases, then encodes bounded JSON chunks. */
export function encodeSchemaRedactedControlStream(
  stream: NonNullable<ControlProgressDescriptor['stream']>,
  record: unknown,
  streamId: string,
  input?: Readonly<{ schema: ControlValueSchema; value: ControlJsonValue }>,
): Readonly<{ chunks?: readonly ControlJsonValue[]; issues: readonly ControlValidationIssue[] }> {
  const invalid = () => ({ issues: [validationIssue('progress.stream', 'unsafe_value', 'Invalid schema-redacted stream record', 'transport')] });
  if (stream.redaction !== 'schema' || stream.encoding !== 'json-chunks' || stream.chunkUnit !== 'utf16-code-units' ||
    !Number.isInteger(stream.chunkMaximumLength) || stream.chunkMaximumLength < 1 ||
    stream.chunkMaximumLength > RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH || !/^record-[1-9][0-9]*$/.test(streamId)) return invalid();
  const options = { maximumStringLength: RUNTIME_CONTROL_MAX_LOGICAL_STREAM_STRING_LENGTH };
  const validated = validateControlOutput(stream.record, record, options);
  if (validated.value === undefined) return { issues: validated.issues };
  const literals = new Set(collectControlSensitiveLiterals(stream.record, validated.value));
  if (input) {
    const checked = validateControlOutput(input.schema, input.value, options);
    if (checked.value === undefined) return invalid();
    for (const literal of collectControlSensitiveLiterals(input.schema, checked.value)) literals.add(literal);
  }
  const ordered = [...literals].sort((left, right) => right.length - left.length);
  const scrub = (value: string): string => {
    // Match against the original string so replacement text is never processed as another secret.
    let output = ''; let index = 0;
    while (index < value.length) {
      const match = ordered.find(literal => value.startsWith(literal, index));
      if (match) { output += '[redacted]'; index += match.length; }
      else { output += value[index]; index += 1; }
    }
    return output;
  };
  const project = (schema: ControlValueSchema, value: ControlJsonValue): ControlJsonValue => {
    if (schema.sensitive) return '[redacted]';
    const selected = selectControlStreamSchema(schema, value);
    if (!selected) return '[redacted]';
    if (selected !== schema) return project(selected, value);
    // Preserve advertised public protocol enums; sensitive fields still redact.
    if (schema.type === 'string' && typeof value === 'string' && schema.enum?.includes(value)) return value;
    if (schema.type === 'array' && Array.isArray(value)) return value.map(item => project(schema.items, item));
    if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const additional = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined;
      if (additional && hasSensitiveSchema(additional)) return '[redacted]';
      if (Object.keys(value).some(key => schema.properties[key] === undefined && scrub(key) !== key)) return '[redacted]';
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        const field = schema.properties[key] ?? additional;
        return [schema.properties[key] ? key : scrub(key), field ? project(field, item) : '[redacted]'];
      }));
    }
    return typeof value === 'string' ? scrub(value) : value;
  };
  const state: ValidationState = { nodes: 0, maximumStringLength: RUNTIME_CONTROL_MAX_LOGICAL_STREAM_STRING_LENGTH, seen: new Set(), issues: [], defaults: false };
  const redacted = cloneJsonValue(project(stream.record, validated.value), state, 'progress.stream.record');
  if (redacted === undefined || state.issues.length > 0) return invalid();
  const serialized = JSON.stringify(redacted);
  const totalChunks = Math.max(1, Math.ceil(serialized.length / stream.chunkMaximumLength));
  const chunks = Array.from({ length: totalChunks }, (_, chunkIndex) => ({
    streamId, chunkIndex, totalChunks,
    payload: serialized.slice(chunkIndex * stream.chunkMaximumLength, (chunkIndex + 1) * stream.chunkMaximumLength),
  }));
  return { chunks, issues: [] };
}

export interface ControlRegistrySnapshot {
  revision: number;
  operations: ControlOperationDescriptor[];
}

export interface ControlResolveRequest {
  path: string[];
}

/** A safety-filtered descriptor paired with both registry and registration generations. */
export interface ControlDescribedOperation {
  revision: number;
  registrationRevision: number;
  descriptor: ControlOperationDescriptor;
}

export interface ControlResolvedOperation {
  revision: number;
  registrationRevision: number;
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
  /** Revision of the selected descriptor; stale requests require an explicit retry. */
  expectedRegistrationRevision: number;
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
  | 'stale_descriptor'
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
// A production registry includes the full finite command contracts for every
// installed owner. Keep its wider discovery envelope separate from invocation
// values, which remain deliberately small and shallow.
export const RUNTIME_CONTROL_MAX_REGISTRY_WIRE_DEPTH = 24;
/** Per-descriptor node budget; discovery snapshots validate each entry independently. */
export const RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES = 128_000;
/** Bounded UTF-8 envelope for an entire registry list, subscription, or update event. */
export const RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES = 16 * 1024 * 1024;
export const RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH = 16_384;
/** Largest decoded logical record accepted before it is split into wire chunks. */
export const RUNTIME_CONTROL_MAX_LOGICAL_STREAM_STRING_LENGTH = 65_536;
export const RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH = 1024;

export interface RuntimeControlMethodMap {
  list: { request: Record<string, never>; response: ControlRegistrySnapshot };
  describe: { request: { operationId: string }; response: ControlDescribedOperation | null };
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

/**
 * Checks that record properties are enumerable data properties before any field
 * access. Registry discovery must not invoke accessors while validating remote
 * metadata.
 */
function wireDataRecord(value: unknown): value is Record<string, unknown> {
  if (!wireRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.values(descriptors).every(descriptor => 'value' in descriptor && descriptor.enumerable);
}

function wireDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH ||
    Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
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
  maxDepth = RUNTIME_CONTROL_MAX_WIRE_DEPTH,
  byteBudget?: WireJsonByteBudget,
): value is ControlJsonValue {
  budget.nodes += 1;
  if (budget.nodes > maxNodes || depth > maxDepth) return false;
  if (value === null || typeof value === 'boolean') return !byteBudget || addWireJsonBytes(byteBudget, JSON.stringify(value));
  if (typeof value === 'string') return wireString(value) && (!byteBudget || addWireJsonBytes(byteBudget, JSON.stringify(value)));
  if (typeof value === 'number') return Number.isFinite(value) && (!byteBudget || addWireJsonBytes(byteBudget, JSON.stringify(value)));
  if (typeof value !== 'object' || budget.seen.has(value)) return false;
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) return false;
      const keys = Object.getOwnPropertyNames(value);
      if (Object.getOwnPropertySymbols(value).length > 0 || keys.length !== value.length + 1) {
        return false;
      }
      if (byteBudget && !addWireJsonBytes(byteBudget, '[')) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (byteBudget && index > 0 && !addWireJsonBytes(byteBudget, ',')) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable ||
          !wireJson(descriptor.value, budget, depth + 1, maxNodes, maxDepth, byteBudget)) return false;
      }
      return !byteBudget || addWireJsonBytes(byteBudget, ']');
    }
    if (!wireRecord(value)) return false;
    const keys = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0 ||
      keys.length > RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH) return false;
    if (byteBudget && !addWireJsonBytes(byteBudget, '{')) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (!wireString(key)) return false;
      if (byteBudget && ((index > 0 && !addWireJsonBytes(byteBudget, ',')) ||
        !addWireJsonBytes(byteBudget, JSON.stringify(key)) || !addWireJsonBytes(byteBudget, ':'))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable ||
        !wireJson(descriptor.value, budget, depth + 1, maxNodes, maxDepth, byteBudget)) return false;
    }
    return !byteBudget || addWireJsonBytes(byteBudget, '}');
  } catch {
    return false;
  } finally {
    budget.seen.delete(value);
  }
}

/**
 * Count serialized UTF-8 bytes during validation, using the same safe property
 * descriptors instead of reflecting over the entire catalog a second time.
 */
interface WireJsonByteBudget {
  readonly maximum: number;
  bytes: number;
}

function addWireJsonBytes(budget: WireJsonByteBudget, text: string): boolean {
  // Registry snapshots contain many tiny JSON tokens. Count UTF-8 directly
  // instead of allocating an encoded array for each token.
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) budget.bytes += 1;
    else if (unit < 0x800) budget.bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      budget.bytes += 4;
      index += 1;
    } else budget.bytes += 3;
    if (budget.bytes > budget.maximum) return false;
  }
  return budget.bytes <= budget.maximum;
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
      return exactKeys(payload, ['operationId', 'arguments', 'expectedRegistrationRevision']) &&
        wireId(payload.operationId) && wireRecord(payload.arguments) && wireJson(payload.arguments) &&
        Number.isInteger(payload.expectedRegistrationRevision) && (payload.expectedRegistrationRevision as number) > 0;
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
  if (depth > RUNTIME_CONTROL_MAX_REGISTRY_WIRE_DEPTH || !wireRecord(value) || typeof value.type !== 'string') return false;
  const sensitive = value.sensitive === undefined || value.sensitive === true;
  const annotations = (value.sensitive === undefined || value.sensitive === true) &&
    (value.unit === undefined || wireString(value.unit, false)) &&
    (value.resource === undefined || wireString(value.resource, false)) &&
    (value.default === undefined || wireJson(value.default)) &&
    (value.examples === undefined || (Array.isArray(value.examples) && value.examples.length <= RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH && value.examples.every(example => wireJson(example))));
  if (!sensitive) return false;
  if (['null', 'boolean', 'number', 'integer', 'string', 'json'].includes(value.type)) {
    return annotations && exactKeys(value, ['type'], [
      'enum', 'minimum', 'maximum', 'minimumLength', 'maximumLength', 'format',
      'sensitive', 'unit', 'resource', 'default', 'examples',
    ]) &&
      (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
      (value.minimum === undefined || typeof value.minimum === 'number' && Number.isFinite(value.minimum)) &&
      (value.maximum === undefined || typeof value.maximum === 'number' && Number.isFinite(value.maximum)) &&
      (value.minimumLength === undefined || integerNonnegative(value.minimumLength)) &&
      (value.maximumLength === undefined || integerNonnegative(value.maximumLength)) &&
      (value.format === undefined || ['uri', 'uuid', 'date-time'].includes(String(value.format)));
  }
  if (value.type === 'array') {
    return annotations && exactKeys(value, ['type', 'items'], [
      'enum', 'minimumItems', 'maximumItems', 'sensitive', 'unit', 'resource', 'default', 'examples',
    ]) &&
      (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
      valueSchemaValue(value.items, depth + 1) &&
      (value.minimumItems === undefined || integerNonnegative(value.minimumItems)) &&
      (value.maximumItems === undefined || integerNonnegative(value.maximumItems));
  }
  if (value.type === 'object') {
    if (!annotations || !exactKeys(value, ['type', 'properties'], [
      'enum', 'required', 'additionalProperties', 'sensitive', 'unit', 'resource', 'default', 'examples',
    ]) ||
      !wireRecord(value.properties) ||
      (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean' && !valueSchemaValue(value.additionalProperties, depth + 1)) ||
      (value.required !== undefined &&
        (!Array.isArray(value.required) || !value.required.every(item => wireString(item))))) {
      return false;
    }
    return (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
      Object.entries(value.properties).every(([key, schema]) =>
      wireString(key, false) && valueSchemaValue(schema, depth + 1));
  }
  if (value.type === 'oneOf') {
    return annotations && exactKeys(value, ['type', 'schemas'], [
      'enum', 'sensitive', 'unit', 'resource', 'default', 'examples',
    ]) &&
      (value.enum === undefined || (Array.isArray(value.enum) && value.enum.every(item => wireJson(item)))) &&
      Array.isArray(value.schemas) && value.schemas.length >= 2 &&
      value.schemas.length <= RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH &&
      value.schemas.every(schema => valueSchemaValue(schema, depth + 1));
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

function progressDescriptorValue(value: unknown): boolean {
  const stream = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).stream
    : undefined;
  return wireRecord(value) && exactKeys(value, ['schema'], ['historyLimit', 'stream']) && resultDescriptorValue({ schema: value.schema }) &&
    (value.historyLimit === undefined || integerNonnegative(value.historyLimit) && value.historyLimit <= 100) &&
    (stream === undefined || wireRecord(stream) && exactKeys(stream, ['encoding', 'chunkUnit', 'chunkMaximumLength', 'record'], ['redaction']) &&
      (stream.redaction === undefined || stream.redaction === 'schema') &&
      stream.encoding === 'json-chunks' && stream.chunkUnit === 'utf16-code-units' && integerNonnegative(stream.chunkMaximumLength) && stream.chunkMaximumLength > 0 && valueSchemaValue(stream.record));
}

function commandBindingValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['name', 'description', 'mode'], [
    'position', 'option', 'metavar', 'repeated', 'flagValue',
  ]) && wireString(value.name, false) && wireString(value.description, false) &&
    ['position', 'option', 'both'].includes(String(value.mode)) &&
    (value.position === undefined || integerNonnegative(value.position)) &&
    (value.option === undefined || wireString(value.option, false)) &&
    (value.metavar === undefined || wireString(value.metavar, false)) &&
    (value.repeated === undefined || typeof value.repeated === 'boolean') &&
    (value.flagValue === undefined || typeof value.flagValue === 'boolean');
}

function recoveryDescriptorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['guidance', 'retry']) && wireString(value.guidance, false) &&
    typeof value.retry === 'string' && ['never', 'after-correction', 'safe'].includes(value.retry);
}

function domainErrorValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['code', 'message', 'recovery'], ['details']) &&
    typeof value.code === 'string' && /^[a-z][a-z0-9-]*$/.test(value.code) && wireString(value.message, false) &&
    recoveryDescriptorValue(value.recovery) && (value.details === undefined || valueSchemaValue(value.details));
}

function commandContractValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, [
    'publicPath', 'aliases', 'input', 'result', 'bindings', 'help', 'examples', 'domainErrors',
  ], ['progress']) && stringPath(value.publicPath) && Array.isArray(value.aliases) && value.aliases.every(stringPath) &&
    valueSchemaValue(value.input) && resultDescriptorValue(value.result) &&
    (value.progress === undefined || progressDescriptorValue(value.progress)) &&
    Array.isArray(value.bindings) && value.bindings.every(commandBindingValue) &&
    wireString(value.help) && Array.isArray(value.examples) && value.examples.every(example => wireString(example)) &&
    Array.isArray(value.domainErrors) && value.domainErrors.every(domainErrorValue);
}

function availabilityValue(value: unknown): boolean {
  return normalizeControlAvailability(value) !== undefined;
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
  ], ['command']) && wireId(value.id) && sourceDescriptorValue(value.source) && wireString(value.summary) &&
    wireString(value.help) && wireString(value.usage) && Array.isArray(value.examples) &&
    value.examples.every(example => wireString(example)) && Array.isArray(value.arguments) &&
    value.arguments.every(argumentDescriptorValue) && resultDescriptorValue(value.result) &&
    availabilityValue(value.availability) && Array.isArray(value.effects) && value.effects.every(effect =>
      ['read', 'reversible', 'destructive', 'network', 'publish', 'device', 'privileged'].includes(String(effect))) &&
    policyValue(value.policy) && ['control-backed', 'pending', 'private'].includes(String(value.classification)) &&
    (value.command === undefined || commandContractValue(value.command));
}

function registrySnapshotValue(value: unknown, snapshotDepth: number): boolean {
  if (!wireDataRecord(value) || !exactKeys(value, ['revision', 'operations']) ||
    !integerNonnegative(value.revision) || !wireDataArray(value.operations)) {
    return false;
  }
  const operationDepth = snapshotDepth + 2;
  const byteBudget: WireJsonByteBudget = {
    maximum: RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES,
    bytes: 0,
  };
  // Snapshot keys are fixed. Account for them before measuring each validated
  // descriptor so an oversized aggregate stops before visiting later entries.
  if (!addWireJsonBytes(byteBudget, '{"revision":') ||
    !addWireJsonBytes(byteBudget, JSON.stringify(value.revision)) ||
    !addWireJsonBytes(byteBudget, ',"operations":[')) {
    return false;
  }
  for (const [index, operation] of value.operations.entries()) {
    if (index > 0 && !addWireJsonBytes(byteBudget, ',')) return false;
    if (!wireJson(
      operation,
      { nodes: 0, seen: new Set() },
      operationDepth,
      RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES,
      RUNTIME_CONTROL_MAX_REGISTRY_WIRE_DEPTH,
      byteBudget,
    ) || !operationDescriptorValue(operation)) {
      return false;
    }
  }
  return addWireJsonBytes(byteBudget, ']}');
}

function resolvedOperationValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['revision', 'registrationRevision', 'descriptor']) &&
    integerNonnegative(value.revision) && integerNonnegative(value.registrationRevision) &&
    operationDescriptorValue(value.descriptor);
}

function describedOperationValue(value: unknown): boolean {
  return wireRecord(value) && exactKeys(value, ['revision', 'registrationRevision', 'descriptor']) &&
    integerNonnegative(value.revision) && integerNonnegative(value.registrationRevision) &&
    operationDescriptorValue(value.descriptor);
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
  if (!wireRecord(value) || !exactKeys(value, ['code', 'message'], ['details']) || !wireString(value.message)) return false;
  if (value.code === 'stale_descriptor') {
    return wireRecord(value.details) && exactKeys(value.details, ['revision', 'guidance']) &&
      integerNonnegative(value.details.revision) && wireString(value.details.guidance, false);
  }
  return ['unknown_operation', 'invalid_arguments', 'unavailable', 'controller_error', 'controller_contract',
    'cancelled', 'forbidden', 'confirmation_denied', 'invalid_request'].includes(String(value.code)) &&
    (value.details === undefined || wireJson(value.details));
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

function registryResponseMethod(method: RuntimeControlMethod): boolean {
  return method === 'list' || method === 'subscribeRegistry' || method === 'describe' || method === 'resolve';
}

function responsePayload(method: RuntimeControlMethod, payload: unknown): boolean {
  if (method === 'describe' || method === 'resolve' || method === 'getInvocation') {
    if (payload === null) return true;
    if (method === 'describe') return describedOperationValue(payload);
    if (method === 'resolve') return resolvedOperationValue(payload);
    return invocationSnapshotValue(payload);
  }
  if (method === 'list') return registrySnapshotValue(payload, 1);
  if (method === 'subscribeRegistry') {
    return wireDataRecord(payload) && exactKeys(payload, ['subscriptionId', 'snapshot']) &&
      wireId(payload.subscriptionId) && registrySnapshotValue(payload.snapshot, 2);
  }
  const maxNodes = RUNTIME_CONTROL_MAX_WIRE_NODES;
  const maxDepth = RUNTIME_CONTROL_MAX_WIRE_DEPTH;
  if (!wireRecord(payload) || !wireJson(payload, { nodes: 0, seen: new Set() }, 0, maxNodes, maxDepth)) return false;
  switch (method) {
    case 'invoke':
      return exactKeys(payload, ['invocationId', 'cancellable']) && wireId(payload.invocationId) &&
        typeof payload.cancellable === 'boolean';
    case 'cancel':
      return exactKeys(payload, ['cancelled']) && typeof payload.cancelled === 'boolean';
    case 'unsubscribeRegistry':
    case 'unsubscribeInvocation':
      return exactKeys(payload, ['unsubscribed']) && typeof payload.unsubscribed === 'boolean';
    default:
      if (method === 'complete') return completionResultValue(payload);
      return true;
  }
}

export function isRuntimeControlResponse(value: unknown): value is RuntimeControlResponse {
  try {
    if (!wireDataRecord(value) || value.protocol !== RUNTIME_CONTROL_PROTOCOL ||
      value.version !== RUNTIME_CONTROL_VERSION || value.kind !== 'response' ||
      !wireId(value.requestId) || !runtimeMethod(value.method) || typeof value.ok !== 'boolean') return false;
    const registrySnapshot = value.ok && (value.method === 'list' || value.method === 'subscribeRegistry');
    if (registrySnapshot) {
      return exactKeys(value, ['protocol', 'version', 'kind', 'requestId', 'method', 'ok', 'payload']) &&
        responsePayload(value.method, value.payload);
    }
    const descriptorPayload = value.ok && (value.method === 'describe' || value.method === 'resolve');
    const maxNodes = descriptorPayload
      ? RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES
      : RUNTIME_CONTROL_MAX_WIRE_NODES;
    const maxDepth = descriptorPayload
      ? RUNTIME_CONTROL_MAX_REGISTRY_WIRE_DEPTH
      : RUNTIME_CONTROL_MAX_WIRE_DEPTH;
    if (!wireJson(value, { nodes: 0, seen: new Set() }, 0, maxNodes, maxDepth)) return false;
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
    if (!wireDataRecord(value) || value.protocol !== RUNTIME_CONTROL_PROTOCOL ||
      value.version !== RUNTIME_CONTROL_VERSION || value.kind !== 'event' || typeof value.event !== 'string') {
      return false;
    }
    if (value.event === 'registry') {
      return exactKeys(value, ['protocol', 'version', 'kind', 'event', 'subscriptionId', 'snapshot']) &&
        wireId(value.subscriptionId) && registrySnapshotValue(value.snapshot, 1);
    }
    if (!wireJson(value, { nodes: 0, seen: new Set() }, 0, RUNTIME_CONTROL_MAX_WIRE_NODES, RUNTIME_CONTROL_MAX_WIRE_DEPTH)) return false;
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
