import { describe, expect, it } from 'vitest';
import { escapeLike } from '../../src/modules/logs/infrastructure/prisma-log-repository.js';

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('leaves other text untouched', () => {
    expect(escapeLike('plain text')).toBe('plain text');
  });
});
