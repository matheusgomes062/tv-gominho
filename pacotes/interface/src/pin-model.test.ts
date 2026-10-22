import { describe, expect, it } from 'vitest';
import { PIN_LENGTH, pairOutcome, pinComplete, typePin, writeOutcome } from './pin-model';

describe('typePin', () => {
  it('adds digits up to the PIN length and ignores other keys', () => {
    let pin = '';
    for (const key of ['1', 'a', '2', 'Enter', '3', '4', '5', '6', '7']) pin = typePin(pin, key);
    expect(pin).toBe('123456');
    expect(pin).toHaveLength(PIN_LENGTH);
    expect(pinComplete(pin)).toBe(true);
  });

  it('deletes the last digit', () => {
    expect(typePin('123', 'delete')).toBe('12');
    expect(typePin('', 'delete')).toBe('');
    expect(pinComplete('12345')).toBe(false);
  });
});

describe('server answers', () => {
  it.each([
    [200, 'paired'],
    [403, 'wrong'],
    [429, 'locked'],
    [500, 'failed'],
    [405, 'failed'],
  ] as const)('pairing %i is %s', (status, outcome) => {
    expect(pairOutcome(status)).toBe(outcome);
  });

  it.each([
    [201, 'written'],
    [200, 'written'],
    [401, 'needs-pin'],
    [403, 'needs-pin'],
    [409, 'exists'],
    [400, 'failed'],
    [413, 'failed'],
    [405, 'failed'],
  ] as const)('writing %i is %s', (status, outcome) => {
    expect(writeOutcome(status)).toBe(outcome);
  });
});
