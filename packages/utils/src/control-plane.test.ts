import { describe, expect, it, vi } from 'vitest';
import {
  compileControlCommandDefinition,
  RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES,
  RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH,
  hasSensitiveSchema,
  isRuntimeControlEvent,
  isRuntimeControlRequest,
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  isRuntimeControlResponse,
  normalizeControlInput,
  normalizeControlAvailability,
  projectControlSchemaToJsonSchema,
  validateControlOutput,
  validateControlCommandDefinition,
  encodeSchemaRedactedControlStream,
  type ControlCommandDefinition,
  type ControlProgressDescriptor,
  type ControlValueSchema,
} from './control-plane.js';

function definition(): ControlCommandDefinition {
  return {
    operation: {
      id: 'test.configure',
      source: { domain: 'test', module: 'control-plane.test.ts', symbol: 'definition' },
      summary: 'Configure a test command',
      availability: { state: 'available' },
      effects: ['read'],
      policy: { access: 'allowed', confirmation: 'never' },
      classification: 'control-backed',
    },
    publicPath: ['test', 'configure'],
    input: {
      type: 'object',
      properties: {
        target: { type: 'string', format: 'uri', minimumLength: 8, examples: ['https://example.test'] },
        requestId: { type: 'string', format: 'uuid' },
        scheduledAt: { type: 'string', format: 'date-time' },
        attempts: { type: 'integer', minimum: 1, maximum: 1, default: 1 },
        nested: {
          type: 'object',
          properties: { enabled: { type: 'boolean', default: true } },
          required: ['enabled'],
          additionalProperties: false,
        },
      },
      required: ['target', 'requestId', 'scheduledAt'],
      additionalProperties: false,
    },
    result: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          resources: {
            type: 'object',
            properties: {},
            additionalProperties: { type: 'string', resource: 'runtime-resource' },
          },
        },
        required: ['ok', 'resources'],
        additionalProperties: false,
      },
      render: { kind: 'record' },
    },
    bindings: [
      { name: 'target', description: 'Target URI', mode: 'option', option: '--target', metavar: 'URI' },
      { name: 'requestId', description: 'Request UUID', mode: 'option', option: '--request-id', metavar: 'UUID' },
      { name: 'scheduledAt', description: 'Scheduled time', mode: 'option', option: '--scheduled-at', metavar: 'DATE_TIME' },
      { name: 'attempts', description: 'Attempt count', mode: 'option', option: '--attempts', metavar: 'COUNT' },
      { name: 'nested', description: 'Nested request data', mode: 'option', option: '--nested', metavar: 'JSON' },
    ],
    help: 'Configure a test command.',
    examples: ['test configure --target https://example.test --request-id 123e4567-e89b-12d3-a456-426614174000 --scheduled-at 2026-10-10T00:00:00Z'],
    domainErrors: [{
      code: 'target-unavailable',
      message: 'The target is unavailable.',
      recovery: { guidance: 'Choose an available target.', retry: 'after-correction' },
      details: { type: 'object', properties: { retryAfter: { type: 'integer', minimum: 0 } }, additionalProperties: false },
    }],
  };
}

describe('literal command outcome constraints', () => {
  it('derives bounded non-sensitive recovery from the executable schema only', () => {
    const schema: ControlValueSchema = {
      type: 'object',
      properties: {
        pubkey: { type: 'string', minimumLength: 64, maximumLength: 64, examples: ['a'.repeat(64)] },
        secret: { type: 'string', sensitive: true, examples: ['never-project-me'] },
      },
      required: ['pubkey', 'secret'],
      additionalProperties: false,
    };
    expect(normalizeControlInput(schema, {}).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'arguments.pubkey', code: 'missing_required', constraint: 'required',
        recovery: { guidance: 'Provide the required value (exactly 64 UTF-16 code units).', retry: 'after-correction' },
        example: 'a'.repeat(64),
      }),
      expect.objectContaining({ path: 'arguments.secret', code: 'missing_required', constraint: 'required' }),
    ]));
    expect(JSON.stringify(normalizeControlInput(schema, {}).issues)).not.toContain('never-project-me');
  });

  it('does not derive recovery through a sensitive object or array ancestor', () => {
    const schema: ControlValueSchema = {
      type: 'object',
      properties: {
        credentials: {
          type: 'object',
          sensitive: true,
          properties: { token: { type: 'string', examples: ['must-not-project'] } },
          required: ['token'],
          additionalProperties: false,
        },
      },
      required: ['credentials'],
      additionalProperties: false,
    };
    const missing = normalizeControlInput(schema, {}).issues[0]!;
    expect(missing).toMatchObject({ path: 'arguments.credentials', code: 'missing_required' });
    expect(missing.recovery).toBeUndefined();
    expect(missing.example).toBeUndefined();
    const nested = normalizeControlInput(schema, { credentials: {} }).issues[0]!;
    expect(nested).toMatchObject({ path: 'arguments.credentials.token', code: 'missing_required' });
    expect(nested.recovery).toBeUndefined();
    expect(nested.example).toBeUndefined();

    const sensitiveArray: ControlValueSchema = {
      type: 'object',
      properties: {
        credentials: { type: 'array', sensitive: true, items: { type: 'object', properties: { token: { type: 'string', examples: ['private-array'] } }, required: ['token'], additionalProperties: false } },
        publicKey: { type: 'string', examples: ['public-example'] },
      },
      required: ['credentials', 'publicKey'], additionalProperties: false,
    };
    const arrayIssues = normalizeControlInput(sensitiveArray, { credentials: [{}] }).issues;
    expect(arrayIssues.find(issue => issue.path === 'arguments.credentials[0].token')).not.toHaveProperty('example');
    expect(arrayIssues.find(issue => issue.path === 'arguments.publicKey')).toMatchObject({ example: 'public-example' });
  });

  it('keeps public sibling recovery while failing closed for sensitive, accessor, and colliding paths', () => {
    const publicKey = 'a'.repeat(64);
    const schema: ControlValueSchema = {
      type: 'object',
      properties: {
        pubkey: { type: 'string', minimumLength: 64, maximumLength: 64, examples: [publicKey] },
        token: { type: 'string', sensitive: true, examples: ['private'] },
        'a.b': { type: 'string', examples: ['ambiguous'] },
        a: { type: 'object', properties: { b: { type: 'string', examples: ['also-ambiguous'] } }, required: ['b'], additionalProperties: false },
      },
      required: ['pubkey', 'token', 'a.b', 'a'],
      additionalProperties: false,
    };
    const issues = normalizeControlInput(schema, {}).issues;
    expect(issues.find(issue => issue.path === 'arguments.pubkey')).toMatchObject({ example: publicKey });
    expect(issues.find(issue => issue.path === 'arguments.token')).not.toHaveProperty('example');
    expect(issues.filter(issue => issue.path === 'arguments.a.b')).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ example: expect.anything() })]),
    );

    let reads = 0;
    const examples: unknown[] = [];
    Object.defineProperty(examples, '0', { enumerable: true, get: () => { reads += 1; return 'getter'; } });
    Object.defineProperty(examples, 'length', { value: 1 });
    const accessorSchema: ControlValueSchema = { type: 'object', properties: { value: { type: 'string', examples: examples as never } }, required: ['value'], additionalProperties: false };
    expect(normalizeControlInput(accessorSchema, {}).issues[0]).not.toHaveProperty('example');
    expect(reads).toBe(0);

    const cyclicExample: unknown[] = [];
    cyclicExample.push(cyclicExample);
    for (const examples of [
      ['x'.repeat(RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH + 1)],
      [cyclicExample],
    ]) {
      const unsafeExampleSchema: ControlValueSchema = {
        type: 'object', properties: { value: { type: 'string', examples: examples as never } }, required: ['value'], additionalProperties: false,
      };
      expect(normalizeControlInput(unsafeExampleSchema, {}).issues[0]).not.toHaveProperty('example');
    }
  });

  it('normalizes only bounded data-only dynamic availability recovery', () => {
    expect(normalizeControlAvailability({
      state: 'unavailable', reason: 'Offline.', recovery: { guidance: 'Retry after reconnecting.', retry: 'safe' },
    })).toEqual({ state: 'unavailable', reason: 'Offline.', recovery: { guidance: 'Retry after reconnecting.', retry: 'safe' } });
    let reads = 0;
    expect(normalizeControlAvailability(Object.defineProperty({}, 'state', {
      enumerable: true, get: () => { reads += 1; return 'available'; },
    }))).toBeUndefined();
    expect(reads).toBe(0);
    const toString = vi.fn(() => 'safe');
    expect(normalizeControlAvailability({
      state: 'unavailable', recovery: { guidance: 'Retry.', retry: { toString } as never },
    })).toBeUndefined();
    expect(toString).not.toHaveBeenCalled();
    expect(normalizeControlAvailability({
      state: 'unavailable', recovery: { guidance: 'x'.repeat(RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH + 1), retry: 'safe' },
    })).toBeUndefined();
    const cyclic: { guidance: string; retry: 'safe'; self?: unknown } = { guidance: 'Retry.', retry: 'safe' };
    cyclic.self = cyclic;
    expect(normalizeControlAvailability({ state: 'unavailable', recovery: cyclic as never })).toBeUndefined();
  });

  it('describes numeric, collection, and declared resource constraints without an example', () => {
    const schema: ControlValueSchema = {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 3 },
        targets: { type: 'array', items: { type: 'string' }, minimumItems: 1, maximumItems: 2 },
        feed: { type: 'string', resource: 'feed.user' },
      },
      required: ['count', 'targets', 'feed'],
      additionalProperties: false,
    };
    expect(normalizeControlInput(schema, {}).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'arguments.count', recovery: { guidance: 'Provide the required value (at least 1, at most 3).', retry: 'after-correction' } }),
      expect.objectContaining({ path: 'arguments.targets', recovery: { guidance: 'Provide the required value (at least 1 items, at most 2 items).', retry: 'after-correction' } }),
      expect.objectContaining({ path: 'arguments.feed', recovery: { guidance: 'Provide the required value (resource feed.user).', retry: 'after-correction' } }),
    ]));
  });

  it.each([false, true])('enforces the declared %s literal for both input and output', expected => {
    const flag: ControlValueSchema = { type: 'boolean', enum: [expected] };
    const schema: ControlValueSchema = { type: 'object', properties: { flag }, required: ['flag'], additionalProperties: false };
    expect(normalizeControlInput(schema, { flag: expected })).toEqual({ value: { flag: expected }, issues: [] });
    expect(validateControlOutput(flag, expected)).toEqual({ value: expected, issues: [] });
    expect(normalizeControlInput(schema, { flag: !expected }).issues)
      .toMatchObject([{ path: 'arguments.flag', code: 'constraint', constraint: 'enum' }]);
    expect(validateControlOutput(flag, !expected).issues)
      .toMatchObject([{ path: 'result', code: 'constraint', constraint: 'enum' }]);
  });

  it('selects distinct boolean outcome branches and rejects contradictory defaults', () => {
    const schema: ControlValueSchema = { type: 'oneOf', schemas: [
      { type: 'boolean', enum: [false] }, { type: 'boolean', enum: [true] },
    ] };
    expect(validateControlOutput(schema, false)).toEqual({ value: false, issues: [] });
    expect(validateControlOutput(schema, true)).toEqual({ value: true, issues: [] });
    const source = definition();
    if (source.input.type !== 'object') throw new Error('Expected object fixture');
    source.input.properties.fixed = { type: 'boolean', enum: [false], default: true };
    expect(validateControlCommandDefinition(source).some(issue => issue.path.startsWith('input.properties.fixed'))).toBe(true);
  });

  it('enforces nullable literal enums using the same input and output contract', () => {
    expect(validateControlOutput({ type: 'null', enum: [null] }, null)).toEqual({ value: null, issues: [] });
    expect(validateControlOutput({ type: 'null', enum: [false] }, null).issues)
      .toMatchObject([{ path: 'result', code: 'constraint', constraint: 'enum' }]);
    const schema: ControlValueSchema = { type: 'object', properties: { cleared: { type: 'null', enum: [false] } },
      required: ['cleared'], additionalProperties: false };
    expect(normalizeControlInput(schema, { cleared: null }).issues)
      .toMatchObject([{ path: 'arguments.cleared', code: 'constraint', constraint: 'enum' }]);
  });
});

describe('control command schema', () => {
  it('advertises the same defaults that normalize omitted caller input without sharing mutable values', () => {
    const source = definition();
    const defaults = { attempts: 0, enabled: false, label: '', cleared: null, options: { retries: 2 } };
    source.input = {
      type: 'object', properties: {
        attempts: { type: 'integer', minimum: 0, default: defaults.attempts },
        enabled: { type: 'boolean', default: defaults.enabled },
        label: { type: 'string', default: defaults.label },
        cleared: { type: 'null', default: defaults.cleared },
        options: { type: 'object', properties: { retries: { type: 'integer', minimum: 0 } },
          required: ['retries'], additionalProperties: false, default: defaults.options },
        optional: { type: 'string' },
      }, required: Object.keys(defaults), additionalProperties: false,
    };
    source.bindings = [...Object.keys(defaults), 'optional'].map(name => ({
      name, description: `Configure ${name}.`, mode: 'option', option: `--${name}`, metavar: 'VALUE',
    }));
    const compiled = compileControlCommandDefinition(source);
    expect(normalizeControlInput(compiled.contract.input, {})).toEqual({ value: defaults, issues: [] });
    expect(Object.fromEntries(compiled.descriptor.arguments
      .filter(argument => argument.name !== 'optional').map(argument => [argument.name, argument.default])))
      .toEqual(defaults);
    expect(compiled.descriptor.arguments.find(argument => argument.name === 'optional')).not.toHaveProperty('default');
    const advertisedOptions = compiled.descriptor.arguments.find(argument => argument.name === 'options')!.default as { retries: number };
    advertisedOptions.retries = 99;
    expect(defaults.options).toEqual({ retries: 2 });
    expect(normalizeControlInput(compiled.contract.input, {})).toMatchObject({ value: defaults });
  });

  it('preserves resource families in compiled command arguments', () => {
    const source = definition();
    if (source.input.type !== 'object') throw new Error('fixture input must be an object');
    const name = source.bindings[0]!.name;
    source.input.properties[name] = { type: 'string', resource: 'app' };
    const compiled = compileControlCommandDefinition(source);
    expect(compiled.descriptor.arguments.find(argument => argument.name === name)).toMatchObject({ type: 'resource', resource: 'app' });
    expect(compiled.descriptor.command?.input).toMatchObject({ properties: { [name]: { type: 'string', resource: 'app' } } });
  });
  it('recognizes sensitive fields through object and array schema descendants', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        credentials: {
          type: 'object' as const,
          properties: { token: { type: 'string' as const, sensitive: true as const } },
          additionalProperties: false,
        },
        batches: {
          type: 'array' as const,
          items: { type: 'object' as const, properties: {}, additionalProperties: { type: 'string' as const, sensitive: true as const } },
        },
      },
      additionalProperties: false,
    };

    expect(hasSensitiveSchema(schema)).toBe(true);
    expect(hasSensitiveSchema(schema.properties.batches)).toBe(true);
    const source = definition();
    if (source.input.type !== 'object') throw new Error('fixture input must be an object');
    source.input.properties.nested = schema.properties.credentials;
    const compiled = compileControlCommandDefinition(source);
    expect(compiled.descriptor.arguments.find(argument => argument.name === 'nested')).toMatchObject({ sensitive: true });
  });

  it('requires the explicit schema encoder for sensitive decoded stream records', () => {
    const source = definition();
    source.progress = {
      schema: { type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'], additionalProperties: false },
      stream: {
        encoding: 'json-chunks', chunkUnit: 'utf16-code-units', chunkMaximumLength: 8_000,
        record: { type: 'object', properties: { secret: { type: 'string', sensitive: true } }, required: ['secret'], additionalProperties: false },
      },
    };
    expect(validateControlCommandDefinition(source).map(issue => issue.path)).toContain('progress.stream.record');
    source.progress.stream!.redaction = 'schema';
    expect(validateControlCommandDefinition(source)).toEqual([]);
  });

  it('redacts validated logical records and input aliases before UTF-16 JSON chunking', () => {
    const secret = 'signed-private-record-'.repeat(3);
    const token = 'caller-private-token';
    const stream: NonNullable<ControlProgressDescriptor['stream']> = {
      encoding: 'json-chunks' as const, chunkUnit: 'utf16-code-units' as const, chunkMaximumLength: 7, redaction: 'schema' as const,
      record: { type: 'object' as const, properties: {
        secret: { type: 'string' as const, minimumLength: secret.length, maximumLength: secret.length, sensitive: true },
        alias: { type: 'string' as const, maximumLength: 65_536 },
        dynamic: { type: 'object' as const, properties: {}, additionalProperties: { type: 'string' as const, sensitive: true } },
      }, required: ['secret', 'alias', 'dynamic'], additionalProperties: false },
    };
    const encoded = encodeSchemaRedactedControlStream(stream, { secret, alias: `${secret}\"🙂${token}`, dynamic: { privateKey: 'private-value' } }, 'record-1', {
      schema: { type: 'object', properties: { token: { type: 'string', sensitive: true } }, required: ['token'], additionalProperties: false }, value: { token },
    });
    expect(encoded.issues).toEqual([]);
    const chunks = encoded.chunks as Array<{ payload: string; chunkIndex: number; totalChunks: number }>;
    expect(chunks.every((chunk, index) => chunk.payload.length <= 7 && chunk.chunkIndex === index && chunk.totalChunks === chunks.length)).toBe(true);
    const text = chunks.map(chunk => chunk.payload).join('');
    expect(JSON.parse(text)).toEqual({ secret: '[redacted]', alias: '[redacted]"🙂[redacted]', dynamic: '[redacted]' });
    for (const literal of [secret, token, 'privateKey', 'private-value']) expect(text).not.toContain(literal);
  });

  it('keeps public stream enums valid when input secrets collide with their literals', () => {
    const stream: NonNullable<ControlProgressDescriptor['stream']> = {
      encoding: 'json-chunks', chunkUnit: 'utf16-code-units', chunkMaximumLength: 7, redaction: 'schema',
      record: { type: 'oneOf', schemas: [{ type: 'null' }, { type: 'object', properties: {
        role: { type: 'string', enum: ['primary', 'fallback'] },
        secret: { type: 'string', enum: ['fallback'], sensitive: true },
        alias: { type: 'string' },
      }, required: ['role', 'secret', 'alias'], additionalProperties: false }] },
    };
    const input = { schema: { type: 'string' as const, sensitive: true as const }, value: 'fallback' };
    const encoded = encodeSchemaRedactedControlStream(stream, { role: 'fallback', secret: 'fallback', alias: 'echo fallback' }, 'record-1', input);
    expect(encoded.issues).toEqual([]);
    const chunks = encoded.chunks as Array<{ payload: string; chunkIndex: number; totalChunks: number }>;
    expect(chunks.every((chunk, index) => chunk.chunkIndex === index && chunk.payload.length <= 7 && chunk.totalChunks === chunks.length)).toBe(true);
    expect(JSON.parse(chunks.map(chunk => chunk.payload).join(''))).toEqual({ role: 'fallback', secret: '[redacted]', alias: 'echo [redacted]' });
    expect(encodeSchemaRedactedControlStream(stream, { role: 'unknown', secret: 'fallback', alias: 'fallback' }, 'record-1', input).chunks).toBeUndefined();
  });

  it('rejects unvalidated or unopted-in stream records without reading accessors or emitting chunks', () => {
    const stream: NonNullable<ControlProgressDescriptor['stream']> = { encoding: 'json-chunks', chunkUnit: 'utf16-code-units', chunkMaximumLength: 8_000, redaction: 'schema', record: { type: 'object', properties: { secret: { type: 'string', sensitive: true } }, required: ['secret'], additionalProperties: false } };
    let reads = 0;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { reads += 1; return 'secret'; } });
    for (const record of [accessor, { secret: 1 }, { secret: 'safe', extra: 'secret' }]) {
      expect(encodeSchemaRedactedControlStream(stream, record, 'record-1').chunks).toBeUndefined();
    }
    expect(reads).toBe(0);
    expect(encodeSchemaRedactedControlStream({ ...stream, redaction: undefined }, { secret: 'secret' }, 'record-1').chunks).toBeUndefined();
    expect(encodeSchemaRedactedControlStream(stream, { secret: 'secret' }, 'user-secret-label').chunks).toBeUndefined();
  });

  it('redacts a map with secret dynamic keys as a whole rather than merging colliding redacted keys', () => {
    const stream: NonNullable<ControlProgressDescriptor['stream']> = {
      encoding: 'json-chunks', chunkUnit: 'utf16-code-units', chunkMaximumLength: 8_000, redaction: 'schema',
      record: { type: 'object', properties: {}, additionalProperties: { type: 'integer' } },
    };
    const encoded = encodeSchemaRedactedControlStream(stream, { 'private-one': 1, 'private-two': 2 }, 'record-1', {
      schema: { type: 'array', items: { type: 'string', sensitive: true } }, value: ['private-one', 'private-two'],
    });
    expect(encoded.issues).toEqual([]);
    expect(JSON.parse((encoded.chunks![0] as { payload: string }).payload)).toBe('[redacted]');
  });

  it('projects and validates finite exactly-one nullable object variants without a JSON escape hatch', () => {
    const nullableRect = {
      type: 'oneOf' as const,
      schemas: [
        { type: 'null' as const },
        {
          type: 'object' as const,
          properties: {
            x: { type: 'integer' as const, unit: 'px' },
            y: { type: 'integer' as const, unit: 'px' },
            width: { type: 'integer' as const, minimum: 1, unit: 'px' },
            height: { type: 'integer' as const, minimum: 1, unit: 'px' },
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false,
        },
      ],
      examples: [null, { x: 0, y: 0, width: 640, height: 480 }],
    } satisfies ControlValueSchema;
    const source = definition();
    if (source.input.type !== 'object') throw new Error('fixture input must be an object');
    source.input.properties.nested = nullableRect;
    source.result.schema = nullableRect;

    expect(validateControlCommandDefinition(source)).toEqual([]);
    expect(hasSensitiveSchema({ type: 'oneOf', schemas: [{ type: 'null' }, { type: 'string', sensitive: true }] })).toBe(true);
    expect(projectControlSchemaToJsonSchema(nullableRect)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            x: { type: 'integer', 'x-hyprgate-unit': 'px' },
            y: { type: 'integer', 'x-hyprgate-unit': 'px' },
            width: { type: 'integer', minimum: 1, 'x-hyprgate-unit': 'px' },
            height: { type: 'integer', minimum: 1, 'x-hyprgate-unit': 'px' },
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false,
        },
      ],
      examples: [null, { x: 0, y: 0, width: 640, height: 480 }],
    });

    const inputSchema: ControlValueSchema = {
      type: 'object', properties: { geometry: nullableRect }, required: ['geometry'], additionalProperties: false,
    };
    expect(normalizeControlInput(inputSchema, { geometry: null })).toEqual({ value: { geometry: null }, issues: [] });
    expect(normalizeControlInput(inputSchema, { geometry: { x: 0, y: 0, width: 640, height: 480 } }).issues).toEqual([]);
    expect(normalizeControlInput(inputSchema, { geometry: { x: 0, y: 0, width: 0, height: 480, extra: true } }).issues)
      .toMatchObject([{ path: 'arguments.geometry', constraint: 'oneOf' }]);

    const hostile = { geometry: { x: 0, y: 0, width: 640, height: 480 } };
    let getterReads = 0;
    Object.defineProperty(hostile.geometry, 'width', { enumerable: true, get: () => { getterReads += 1; return 640; } });
    expect(normalizeControlInput(inputSchema, hostile).issues).toMatchObject([{ path: 'arguments.geometry', constraint: 'oneOf' }]);
    expect(getterReads).toBe(0);

    const ambiguous: ControlValueSchema = { type: 'oneOf', schemas: [{ type: 'string' }, { type: 'string' }] };
    expect(validateControlOutput(ambiguous, 'ambiguous').issues).toMatchObject([{ constraint: 'oneOf' }]);

    const defaultedVariants: ControlValueSchema = {
      type: 'oneOf',
      schemas: [
        {
          type: 'object',
          properties: { tag: { type: 'string', enum: ['A'] }, n: { type: 'integer', default: 1 } },
          required: ['tag', 'n'], additionalProperties: false,
        },
        {
          type: 'object',
          properties: { tag: { type: 'string', enum: ['B'] }, n: { type: 'integer' } },
          required: ['tag', 'n'], additionalProperties: false,
        },
      ],
    };
    const defaultedInput: ControlValueSchema = {
      type: 'object', properties: { choice: defaultedVariants }, required: ['choice'], additionalProperties: false,
    };
    const discriminated = normalizeControlInput(defaultedInput, { choice: { tag: 'A' } });
    expect(discriminated).toEqual({ value: { choice: { tag: 'A', n: 1 } }, issues: [] });
    expect(validateControlOutput(defaultedInput, discriminated.value)).toEqual({ value: { choice: { tag: 'A', n: 1 } }, issues: [] });
    expect(validateControlOutput(defaultedInput, { choice: { tag: 'A' } }).issues)
      .toMatchObject([{ path: 'result.choice', constraint: 'oneOf' }]);

    const postDefaultAmbiguous: ControlValueSchema = {
      type: 'object',
      properties: {
        choice: {
          type: 'oneOf',
          schemas: [
            { type: 'object', properties: { n: { type: 'integer', default: 1 } }, required: ['n'], additionalProperties: false },
            { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false },
          ],
        },
      },
      required: ['choice'], additionalProperties: false,
    };
    expect(normalizeControlInput(postDefaultAmbiguous, { choice: {} }).issues)
      .toMatchObject([{ path: 'arguments.choice', constraint: 'oneOf' }]);
    expect(validateControlOutput(postDefaultAmbiguous, { choice: { n: 1 } }).issues)
      .toMatchObject([{ path: 'result.choice', constraint: 'oneOf' }]);

    const malformed = definition();
    if (malformed.input.type !== 'object') throw new Error('fixture input must be an object');
    malformed.input.properties.nested = { type: 'oneOf', schemas: [] } as never;
    expect(validateControlCommandDefinition(malformed).map(issue => issue.path)).toContain('input.properties.nested.schemas');

    const compiled = compileControlCommandDefinition(source);
    const response = {
      protocol: 'hyprgate.control', version: 1, kind: 'response', requestId: 'describe-one-of', method: 'describe', ok: true,
      payload: { revision: 1, registrationRevision: 1, descriptor: structuredClone(compiled.descriptor) },
    };
    expect(isRuntimeControlResponse(response)).toBe(true);
    const contract = response.payload.descriptor.command;
    if (!contract || contract.input.type !== 'object') throw new Error('expected command contract');
    contract.input.properties.nested = { type: 'oneOf', schemas: [] } as never;
    expect(isRuntimeControlResponse(response)).toBe(false);
  });

  it('projects the documented finite Draft 2020-12 subset and keeps compiled metadata wire-safe', () => {
    const source = definition();
    expect(validateControlCommandDefinition(source)).toEqual([]);
    expect(projectControlSchemaToJsonSchema(source.input)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        target: {
          type: 'string', format: 'uri', examples: ['https://example.test'],
          'x-hyprgate-minLength': 8, 'x-hyprgate-lengthUnit': 'utf16-code-units',
        },
        requestId: { type: 'string', format: 'uuid' },
        scheduledAt: { type: 'string', format: 'date-time' },
        attempts: { type: 'integer', minimum: 1, maximum: 1, default: 1 },
        nested: {
          type: 'object',
          properties: { enabled: { type: 'boolean', default: true } },
          required: ['enabled'],
          additionalProperties: false,
        },
      },
      required: ['target', 'requestId', 'scheduledAt'],
      additionalProperties: false,
    });

    const compiled = compileControlCommandDefinition(source);
    const response = {
      protocol: 'hyprgate.control', version: 1, kind: 'response', requestId: 'describe-1', method: 'describe', ok: true,
      payload: {
        revision: 1,
        registrationRevision: 1,
        descriptor: structuredClone(compiled.descriptor),
      },
    };
    expect(isRuntimeControlResponse(response)).toBe(true);
  });

  it('keeps UTF-16 field bounds descriptive and executes every additional-property policy', () => {
    const open: ControlValueSchema = {
      type: 'object',
      properties: { title: { type: 'string', minimumLength: 2, maximumLength: 2 } },
      required: ['title'],
      additionalProperties: true,
    };
    expect(projectControlSchemaToJsonSchema(open)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        title: {
          type: 'string',
          'x-hyprgate-minLength': 2,
          'x-hyprgate-maxLength': 2,
          'x-hyprgate-lengthUnit': 'utf16-code-units',
        },
      },
      required: ['title'],
      additionalProperties: true,
    });
    const supplementary = { title: '😀', metadata: { source: 'fixture' } };
    expect(normalizeControlInput(open, supplementary)).toEqual({ value: supplementary, issues: [] });
    expect(validateControlOutput(open, supplementary)).toEqual({ value: supplementary, issues: [] });

    const oneUtf16Unit: ControlValueSchema = {
      type: 'object', properties: { title: { type: 'string', maximumLength: 1 } }, required: ['title'], additionalProperties: true,
    };
    expect(projectControlSchemaToJsonSchema(oneUtf16Unit)).toMatchObject({
      properties: { title: { 'x-hyprgate-maxLength': 1, 'x-hyprgate-lengthUnit': 'utf16-code-units' } },
    });
    expect(normalizeControlInput(oneUtf16Unit, { title: 'a' })).toEqual({ value: { title: 'a' }, issues: [] });
    expect(validateControlOutput(oneUtf16Unit, { title: '😀' }).issues)
      .toMatchObject([{ path: 'result.title', constraint: 'length' }]);

    const typed: ControlValueSchema = {
      type: 'object', properties: {}, additionalProperties: { type: 'string', minimumLength: 2, maximumLength: 2 },
    };
    expect(projectControlSchemaToJsonSchema(typed)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {},
      additionalProperties: {
        type: 'string',
        'x-hyprgate-minLength': 2,
        'x-hyprgate-maxLength': 2,
        'x-hyprgate-lengthUnit': 'utf16-code-units',
      },
    });
    expect(normalizeControlInput(typed, { first: '😀' })).toEqual({ value: { first: '😀' }, issues: [] });
    expect(validateControlOutput(typed, { first: 'a' }).issues)
      .toMatchObject([{ path: 'result.*', constraint: 'length' }]);

    const closed: ControlValueSchema = { type: 'object', properties: {}, additionalProperties: false };
    expect(normalizeControlInput(closed, { extra: true }).issues)
      .toMatchObject([{ path: 'arguments', constraint: 'additionalProperties' }]);
    let getterReads = 0;
    const hostile = Object.defineProperty({ title: 'ok' }, 'extra', {
      enumerable: true, get: () => { getterReads += 1; return 'unsafe'; },
    });
    expect(normalizeControlInput(open, hostile).issues).toMatchObject([{ path: 'arguments', constraint: 'type' }]);
    expect(getterReads).toBe(0);
    const cyclic: { title: string; extra?: unknown } = { title: 'ok' };
    cyclic.extra = cyclic;
    expect(normalizeControlInput(open, cyclic).issues).toMatchObject([{ path: 'arguments.*', constraint: 'transport' }]);
    expect(normalizeControlInput(open, { title: 'ok', extra: 'x'.repeat(RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH + 1) }).issues)
      .toMatchObject([{ path: 'arguments.*', constraint: 'transport' }]);
  });

  it('accepts dense bounded registry snapshots while preserving per-entry and aggregate wire limits', () => {
    const compiled = compileControlCommandDefinition(definition());
    const denseOperations = Array.from({ length: 40 }, (_, index) => {
      const descriptor = structuredClone(compiled.descriptor);
      descriptor.id = `dense-${index}`;
      descriptor.arguments = Array.from({ length: 1024 }, (_, argumentIndex) => ({
        name: `argument-${argumentIndex}`,
        description: 'Finite dense discovery argument.',
        type: 'string' as const,
      }));
      return descriptor;
    });
    const response = {
      protocol: 'hyprgate.control', version: 1, kind: 'response', requestId: 'dense-list', method: 'list', ok: true,
      payload: { revision: 1, operations: denseOperations },
    };
    expect(isRuntimeControlResponse(response)).toBe(true);

    const tooManyOperations = structuredClone(response);
    tooManyOperations.payload.operations = Array.from({ length: 1025 }, (_, index) => ({
      ...structuredClone(compiled.descriptor), id: `many-${index}`,
    }));
    expect(isRuntimeControlResponse(tooManyOperations)).toBe(false);

    const oversizedAggregate = structuredClone(response);
    oversizedAggregate.payload.operations = Array.from({ length: 1024 }, (_, index) => ({
      ...structuredClone(compiled.descriptor),
      id: `bytes-${index}`,
      // Exactly 16,384 UTF-16 units: multi-byte characters and JSON escapes
      // make the aggregate UTF-8 envelope exceed 16 MiB.
      summary: '😀\\"'.repeat(4096),
    }));
    expect(isRuntimeControlResponse(oversizedAggregate)).toBe(false);
    expect(isRuntimeControlResponse({
      ...response,
      method: 'subscribeRegistry',
      payload: { subscriptionId: 'bytes-subscription', snapshot: oversizedAggregate.payload },
    })).toBe(false);
    expect(isRuntimeControlEvent({
      protocol: 'hyprgate.control',
      version: 1,
      kind: 'event',
      event: 'registry',
      subscriptionId: 'bytes-subscription',
      snapshot: oversizedAggregate.payload,
    })).toBe(false);

    const oversizedDescriptor = structuredClone(compiled.descriptor);
    if (!oversizedDescriptor.command) throw new Error('compiled descriptor must include a command contract');
    oversizedDescriptor.command.input = {
      type: 'oneOf',
      schemas: Array.from({ length: 64 }, () => ({
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [
          `property-${index}`,
          { type: 'string' },
        ])),
        additionalProperties: false,
      })),
    } as never;
    expect(isRuntimeControlResponse({
      ...response,
      payload: { revision: 1, operations: [oversizedDescriptor] },
    })).toBe(false);

    const descriptorWithAccessor = structuredClone(compiled.descriptor);
    let getterReads = 0;
    Object.defineProperty(descriptorWithAccessor, 'summary', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return 'getter must not be evaluated';
      },
    });
    expect(isRuntimeControlResponse({
      ...response,
      payload: { revision: 1, operations: [descriptorWithAccessor] },
    })).toBe(false);
    expect(getterReads).toBe(0);

    const descriptorWithToJson = structuredClone(compiled.descriptor) as unknown as Record<string, unknown>;
    let toJsonCalls = 0;
    descriptorWithToJson.toJSON = () => {
      toJsonCalls += 1;
      return {};
    };
    expect(isRuntimeControlResponse({
      ...response,
      payload: { revision: 1, operations: [descriptorWithToJson] },
    })).toBe(false);
    expect(toJsonCalls).toBe(0);

    const descriptorWithCycle = structuredClone(compiled.descriptor);
    (descriptorWithCycle.source as unknown as { module: unknown }).module = descriptorWithCycle.source;
    expect(isRuntimeControlResponse({
      ...response,
      payload: { revision: 1, operations: [descriptorWithCycle] },
    })).toBe(false);

    const descriptorWithDeepSchema = structuredClone(compiled.descriptor);
    if (!descriptorWithDeepSchema.command) throw new Error('compiled descriptor must include a command contract');
    let nestedSchema: Record<string, unknown> = { type: 'string' };
    for (let depth = 0; depth <= 24; depth += 1) nestedSchema = { type: 'array', items: nestedSchema };
    descriptorWithDeepSchema.command.input = nestedSchema as never;
    expect(isRuntimeControlResponse({
      ...response,
      payload: { revision: 1, operations: [descriptorWithDeepSchema] },
    })).toBe(false);
  });

  it('validates repeated dense registry updates without allocating UTF-8 arrays for every JSON token', () => {
    const compiled = compileControlCommandDefinition(definition());
    const operations = Array.from({ length: 12 }, (_, index) => ({
      ...structuredClone(compiled.descriptor), id: `allocation-${index}`,
      arguments: Array.from({ length: 64 }, (_, argumentIndex) => ({
        name: `argument-${argumentIndex}`, description: 'Bounded registry argument.', type: 'string' as const,
      })),
    }));
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      for (let revision = 1; revision <= 3; revision += 1) {
        expect(isRuntimeControlEvent({
          protocol: 'hyprgate.control', version: 1, kind: 'event', event: 'registry',
          subscriptionId: 'allocation-proof', snapshot: { revision, operations },
        })).toBe(true);
      }
      expect(encode.mock.calls.length).toBeLessThan(100);
    } finally { encode.mockRestore(); }
  });

  it('validates and measures registry data in one safe property traversal', () => {
    const compiled = compileControlCommandDefinition(definition());
    const operation = compiled.descriptor;
    const inspect = vi.spyOn(Object, 'getOwnPropertyNames');
    try {
      expect(isRuntimeControlResponse({
        protocol: 'hyprgate.control', version: 1, kind: 'response', method: 'list',
        requestId: 'single-traversal', ok: true, payload: { revision: 1, operations: [operation] },
      })).toBe(true);
      expect(inspect.mock.calls.filter(([value]) => value === operation)).toHaveLength(1);
    } finally { inspect.mockRestore(); }
  });

  it('rejects oversized registry keys before serializing them for the byte budget', () => {
    const operation = compileControlCommandDefinition(definition()).descriptor;
    const key = 'x'.repeat(RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH + 1);
    Object.defineProperty(operation, key, { enumerable: true, value: 'invalid' });
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      expect(isRuntimeControlResponse({
        protocol: 'hyprgate.control', version: 1, kind: 'response', method: 'list',
        requestId: 'oversized-key', ok: true, payload: { revision: 1, operations: [operation] },
      })).toBe(false);
      expect(stringify.mock.calls.some(([value]) => value === key)).toBe(false);
    } finally { stringify.mockRestore(); }
  });

  it('keeps the exact aggregate UTF-8 limit for Unicode, escaped JSON and lone surrogates', () => {
    const compiled = compileControlCommandDefinition(definition());
    const snapshot = {
      revision: 1,
      operations: Array.from({ length: 1024 }, (_, index) => ({
        ...structuredClone(compiled.descriptor), id: `unicode-${index}`,
        summary: 'Aé中😀\\"\n\ud800|\udc00'.repeat(32),
      })),
    };
    const encoder = new TextEncoder();
    let remaining = RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES - encoder.encode(JSON.stringify(snapshot)).byteLength;
    expect(remaining).toBeGreaterThan(0);
    for (const operation of snapshot.operations) {
      const padding = Math.min(remaining, RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH - operation.summary.length);
      operation.summary += 'x'.repeat(padding);
      remaining -= padding;
    }
    expect(remaining).toBe(0);
    expect(encoder.encode(JSON.stringify(snapshot)).byteLength).toBe(RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES);
    const response = {
      protocol: 'hyprgate.control', version: 1, kind: 'response', method: 'list',
      requestId: 'unicode-byte-boundary', ok: true, payload: snapshot,
    };
    expect(isRuntimeControlResponse(response)).toBe(true);
    const spare = snapshot.operations.find(operation => operation.summary.length < RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH)!;
    expect(spare).toBeDefined();
    spare.summary += 'x';
    expect(encoder.encode(JSON.stringify(snapshot)).byteLength).toBe(RUNTIME_CONTROL_MAX_REGISTRY_SNAPSHOT_UTF8_BYTES + 1);
    expect(isRuntimeControlResponse(response)).toBe(false);
  });

  it('rejects unsupported schema constructs, inconsistent bounds, malformed recovery, duplicate enum values, and result defaults', () => {
    const invalid = definition();
    if (invalid.input.type !== 'object') throw new Error('fixture input must be an object');
    invalid.input.properties.target = { type: 'string', format: 'email' as never };
    invalid.input.properties.attempts = { type: 'integer', minimum: 2, maximum: 1 };
    invalid.input.properties.requestId = { type: 'string', enum: ['same', 'same'] };
    invalid.result.schema = { type: 'object', properties: { ok: { type: 'boolean', default: true } } };
    invalid.domainErrors = [{
      code: 'Bad_Code',
      message: 'x',
      recovery: { guidance: 'x', retry: 'eventually' as never, extra: true } as never,
    }];

    expect(validateControlCommandDefinition(invalid).map(issue => issue.path)).toEqual(expect.arrayContaining([
      'input.properties.target.format',
      'input.properties.attempts',
      'input.properties.requestId.enum',
      'result.schema.properties.ok.default',
      'domainErrors[0].code',
      'domainErrors[0].recovery',
    ]));
  });

  it('rejects malformed binding modes, public aliases, positions, option grammar, and schema mismatches', () => {
    const invalid = definition();
    if (invalid.input.type !== 'object') throw new Error('fixture input must be an object');
    invalid.aliases = [['test', 'configure'], ['test', 'configure']];
    invalid.bindings = [
      { name: 'target', description: 'Target URI', mode: 'position', position: 1, option: '--target', metavar: 'lower' },
      { name: 'requestId', description: 'Request UUID', mode: 'position', position: 3, repeated: true },
      { name: 'scheduledAt', description: 'Scheduled time', mode: 'option', option: '--Bad', flagValue: true },
      { name: 'attempts', description: 'Attempts', mode: 'option', option: '--attempts', metavar: 'ATTEMPTS', repeated: true },
    ];

    expect(validateControlCommandDefinition(invalid).map(issue => issue.path)).toEqual(expect.arrayContaining([
      'aliases[0]',
      'aliases[1]',
      'bindings[0].position',
      'bindings[0].option',
      'bindings[0].metavar',
      'bindings[1].position',
      'bindings[1].repeated',
      'bindings[2].option',
      'bindings[2].flagValue',
      'bindings[3].repeated',
      'input.properties.nested',
    ]));
  });

  it('reserves --help before declarations reach Terminal while compiling ordinary bindings', () => {
    const reserved = definition();
    reserved.bindings[0] = {
      ...reserved.bindings[0]!,
      mode: 'option',
      option: '--help',
      metavar: 'URI',
    };

    expect(validateControlCommandDefinition(reserved)).toContainEqual(expect.objectContaining({
      path: 'bindings[0].option',
      message: 'The --help option is reserved for Terminal help; choose a different long option',
    }));
    expect(() => compileControlCommandDefinition(reserved)).toThrow(
      'Invalid control command definition: bindings[0].option: The --help option is reserved for Terminal help; choose a different long option',
    );

    const compiled = compileControlCommandDefinition(definition());
    expect(compiled.descriptor.command?.bindings[0]).toMatchObject({
      name: 'target', mode: 'option', option: '--target', metavar: 'URI',
    });
  });
});

describe('control value validation modes', () => {
  const inputSchema = {
    type: 'object' as const,
    properties: {
      request: {
        type: 'object' as const,
        properties: {
          enabled: { type: 'boolean' as const, default: true },
          attempts: { type: 'integer' as const, minimum: 1, default: 1 },
        },
        required: ['enabled', 'attempts'],
        additionalProperties: false,
      },
    },
    required: ['request'],
    additionalProperties: false,
  };

  const outputSchema = {
    type: 'object' as const,
    properties: {
      payload: {
        type: 'object' as const,
        properties: {
          count: { type: 'integer' as const, minimum: 0 },
          when: { type: 'string' as const, format: 'date-time' as const },
        },
        required: ['count', 'when'],
        additionalProperties: false,
      },
    },
    required: ['payload'],
    additionalProperties: false,
  };

  it('applies nested defaults only to absent input properties and returns a clone', () => {
    const normalized = normalizeControlInput(inputSchema, { request: {} });
    expect(normalized).toEqual({ value: { request: { enabled: true, attempts: 1 } }, issues: [] });
    if (!normalized.value) throw new Error('expected normalized value');
    expect(normalized.value).not.toBe(inputSchema);

    const undefinedInput = normalizeControlInput(inputSchema, { request: { enabled: undefined, attempts: 1 } });
    expect(undefinedInput.value).toBeUndefined();
    expect(undefinedInput.issues).toMatchObject([{ path: 'arguments.request.enabled', code: 'invalid_type' }]);
  });

  it('enforces only the documented URI, UUID, and zone-bearing date-time formats', () => {
    const formatSchema = {
      type: 'object' as const,
      properties: {
        uri: { type: 'string' as const, format: 'uri' as const },
        uuid: { type: 'string' as const, format: 'uuid' as const },
        when: { type: 'string' as const, format: 'date-time' as const },
      },
      required: ['uri', 'uuid', 'when'],
      additionalProperties: false,
    };
    expect(normalizeControlInput(formatSchema, {
      uri: 'wss://relay.example',
      uuid: '123E4567-E89B-12D3-A456-426614174000',
      when: '2024-02-29T12:00:00Z',
    }).issues).toEqual([]);
    expect(normalizeControlInput(formatSchema, {
      uri: '/relative',
      uuid: '123e4567e89b12d3a456426614174000',
      when: '2026-02-29T12:00:00',
    }).issues).toMatchObject([
      { path: 'arguments.uri', constraint: 'format' },
      { path: 'arguments.uuid', constraint: 'format' },
      { path: 'arguments.when', constraint: 'format' },
    ]);
  });

  it('validates output with the same finite semantics without manufacturing missing values', () => {
    const valid = validateControlOutput(outputSchema, {
      payload: { count: 1, when: '2026-10-10T12:00:00+01:00' },
    });
    expect(valid).toEqual({ value: { payload: { count: 1, when: '2026-10-10T12:00:00+01:00' } }, issues: [] });

    const invalid = validateControlOutput(outputSchema, {
      payload: { count: -1, when: '2026-10-10T12:00:00', extra: 'secret' },
    });
    expect(invalid.value).toBeUndefined();
    expect(invalid.issues).toMatchObject([
      { path: 'result.payload.count', code: 'constraint', constraint: 'bounds' },
      { path: 'result.payload.when', code: 'constraint', constraint: 'format' },
      { path: 'result.payload', code: 'unknown_property' },
    ]);
    expect(JSON.stringify(invalid.issues)).not.toContain('secret');

    const missing = validateControlOutput(outputSchema, { payload: { count: 1 } });
    expect(missing.value).toBeUndefined();
    expect(missing.issues).toMatchObject([{ path: 'result.payload.when', code: 'missing_required' }]);
  });

  it('does not execute hostile accessors or retain unsafe dynamic records', () => {
    let getterReads = 0;
    const hostile = { request: { attempts: 1 } } as Record<string, unknown>;
    Object.defineProperty(hostile.request as object, 'enabled', {
      enumerable: true,
      get() { getterReads += 1; return true; },
    });
    const hostileResult = normalizeControlInput(inputSchema, hostile);
    expect(getterReads).toBe(0);
    expect(hostileResult.value).toBeUndefined();
    expect(hostileResult.issues).toMatchObject([{ code: 'invalid_type' }]);

    const dynamicSchema = {
      type: 'object' as const,
      properties: {},
      additionalProperties: { type: 'string' as const },
    };
    const dynamic = normalizeControlInput(dynamicSchema, { label: 'safe' });
    expect(dynamic.value).toEqual({ label: 'safe' });
    expect(Object.getPrototypeOf(dynamic.value!)).toBeNull();

    const poisoned = JSON.parse('{"__proto__":"unsafe"}');
    const poisonedResult = normalizeControlInput(dynamicSchema, poisoned);
    expect(poisonedResult.value).toBeUndefined();
    expect(JSON.stringify(poisonedResult.issues)).not.toContain('__proto__');
  });
});

describe('required selected invoke revision', () => {
  const request = (payload: unknown) => ({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'request', requestId: 'selected-revision', method: 'invoke', payload });
  it('rejects missing or invalid revisions while accepting an exact positive integer', () => {
    const input = { operationId: 'test.configure', arguments: {} };
    expect(isRuntimeControlRequest(request(input))).toBe(false);
    for (const expectedRegistrationRevision of [undefined, null, 0, -1, 1.5, NaN, Infinity, '7', true]) {
      expect(isRuntimeControlRequest(request({ ...input, expectedRegistrationRevision }))).toBe(false);
    }
    expect(isRuntimeControlRequest(request({ ...input, expectedRegistrationRevision: 7 }))).toBe(true);
  });
});
