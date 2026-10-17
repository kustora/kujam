import * as core from '@kujam/core';
import { describe, expect, it } from 'vitest';
import { validateDocument } from './index.js';

describe('BOARD-210: @kujam/server validation', () => {
  it('re-exports the exact validateDocument used by the client', () => {
    expect(validateDocument).toBe(core.validateDocument);
  });
});
