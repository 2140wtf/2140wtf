// src/lib/errors.test.ts
//
// errorMessage() normalizes any thrown value into a display string.
// Consumers rely on: Error → .message, non-Error → String(value),
// and never an exception from the normalizer itself.

import { describe, expect, it } from 'vitest';

import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('extracts .message from Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('keeps subclass messages (TypeError, custom errors)', () => {
    expect(errorMessage(new TypeError('not a function'))).toBe('not a function');
    class GateError extends Error {
      code = 'ESCROW_TOKEN_INVALID';
    }
    expect(errorMessage(new GateError('gate rejected'))).toBe('gate rejected');
  });

  it('stringifies non-Error throwables and primitives', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(true)).toBe('true');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('stringifies objects via their toString (never throws on weird shapes)', () => {
    expect(errorMessage({ code: 'X' })).toBe('[object Object]');
    expect(errorMessage(['a', 'b'])).toBe('a,b');
    // String(sym) is legal (unlike template interpolation) - normalizer survives
    expect(errorMessage(Symbol('nope'))).toBe('Symbol(nope)');
  });
});
