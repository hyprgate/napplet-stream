import { describe, it, expect } from 'vitest';
import {
  NAPP_SPEC_REVISION,
  KIND_NSITE_MANIFEST,
  KIND_NSITE_INDEX,
  KIND_NAPP_LISTING,
  KIND_METADATA,
  KIND_NOTE,
  KIND_CONTACTS,
  KIND_DELETION,
  KIND_RELAY_LIST,
  KIND_FOLLOW_PACK,
} from './napp-spec.js';

describe('napp-spec kind constants', () => {
  it('KIND_NSITE_MANIFEST is 34128', () => {
    expect(KIND_NSITE_MANIFEST).toBe(34128);
  });

  it('KIND_NSITE_INDEX is 35128', () => {
    expect(KIND_NSITE_INDEX).toBe(35128);
  });

  it('KIND_NAPP_LISTING is 37348', () => {
    expect(KIND_NAPP_LISTING).toBe(37348);
  });

  it('KIND_METADATA is 0', () => {
    expect(KIND_METADATA).toBe(0);
  });

  it('KIND_NOTE is 1', () => {
    expect(KIND_NOTE).toBe(1);
  });

  it('KIND_CONTACTS is 3', () => {
    expect(KIND_CONTACTS).toBe(3);
  });

  it('KIND_DELETION is 5', () => {
    expect(KIND_DELETION).toBe(5);
  });

  it('KIND_RELAY_LIST is 10002', () => {
    expect(KIND_RELAY_LIST).toBe(10002);
  });

  it('KIND_FOLLOW_PACK is 39089', () => {
    expect(KIND_FOLLOW_PACK).toBe(39089);
  });
});

describe('NAPP_SPEC_REVISION', () => {
  it('starts with "draft-"', () => {
    expect(NAPP_SPEC_REVISION).toMatch(/^draft-/);
  });

  it('contains a date suffix', () => {
    // e.g. draft-2026-03-21
    expect(NAPP_SPEC_REVISION).toMatch(/^draft-\d{4}-\d{2}-\d{2}$/);
  });
});

describe('all exports are named constants (no raw integers elsewhere)', () => {
  it('all kind exports are numbers', () => {
    const kinds = [
      KIND_NSITE_MANIFEST,
      KIND_NSITE_INDEX,
      KIND_NAPP_LISTING,
      KIND_METADATA,
      KIND_NOTE,
      KIND_CONTACTS,
      KIND_DELETION,
      KIND_RELAY_LIST,
      KIND_FOLLOW_PACK,
    ];
    for (const kind of kinds) {
      expect(typeof kind).toBe('number');
    }
  });
});
