/**
 * Fractional ranking for manual ordering (spec 24.1).
 *
 * Implements the "order key" scheme popularised by David Greenspan's *Implementing
 * Fractional Indexing*: a key is a length-encoding integer part followed by an optional
 * fractional part, over a base-62 alphabet. Inserting between two neighbours produces a
 * new key without rewriting the column, and appending at either end stays O(1) in length
 * rather than growing one character per insert.
 *
 * The alphabet is ordered by ASCII code point, so rank columns MUST be declared
 * `COLLATE "C"` in PostgreSQL. Under a locale-aware collation such as en_US.UTF-8, 'a'
 * sorts before 'B' and the ordering guarantee is lost.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST_DIGIT = DIGITS[0] as string;
const LARGEST_DIGIT = DIGITS[DIGITS.length - 1] as string;

/** The key used when a scope is empty. Chosen mid-range so both ends stay cheap. */
export const INITIAL_RANK = `a${SMALLEST_DIGIT}`;

export class InvalidRankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRankError";
  }
}

function digitAt(key: string, index: number): string {
  const char = key[index];
  if (char === undefined) {
    throw new InvalidRankError(`rank "${key}" is shorter than expected`);
  }
  return char;
}

/**
 * The integer part's length is encoded in its first character: 'a'..'z' mean 2..27
 * characters of positive magnitude, 'Z'..'A' mean 2..27 of negative magnitude.
 */
function integerLength(head: string): number {
  if (head >= "a" && head <= "z") {
    return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  }
  if (head >= "A" && head <= "Z") {
    return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  }
  throw new InvalidRankError(`invalid rank head: "${head}"`);
}

function integerPart(key: string): string {
  const length = integerLength(digitAt(key, 0));
  if (length > key.length) {
    throw new InvalidRankError(`invalid rank: "${key}"`);
  }
  return key.slice(0, length);
}

function assertValidInteger(integer: string): void {
  if (integer.length !== integerLength(digitAt(integer, 0))) {
    throw new InvalidRankError(`invalid integer part of rank: "${integer}"`);
  }
}

function incrementInteger(integer: string): string | null {
  assertValidInteger(integer);
  const head = digitAt(integer, 0);
  const digits = integer.slice(1).split("");

  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i] as string) + 1;
    if (next === DIGITS.length) {
      digits[i] = SMALLEST_DIGIT;
    } else {
      digits[i] = DIGITS[next] as string;
      carry = false;
    }
  }

  if (!carry) return head + digits.join("");

  // Overflow: widen the integer part by moving to the next head character.
  if (head === "Z") return `a${SMALLEST_DIGIT}`;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(SMALLEST_DIGIT);
  else digits.pop();
  return nextHead + digits.join("");
}

function decrementInteger(integer: string): string | null {
  assertValidInteger(integer);
  const head = digitAt(integer, 0);
  const digits = integer.slice(1).split("");

  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i] as string) - 1;
    if (next === -1) {
      digits[i] = LARGEST_DIGIT;
    } else {
      digits[i] = DIGITS[next] as string;
      borrow = false;
    }
  }

  if (!borrow) return head + digits.join("");

  if (head === "a") return `Z${LARGEST_DIGIT}`;
  if (head === "A") return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < "Z") digits.push(LARGEST_DIGIT);
  else digits.pop();
  return prevHead + digits.join("");
}

/** Midpoint of two fractional parts. `upper === null` means "unbounded above". */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new InvalidRankError(`"${lower}" is not below "${upper}"`);
  }
  if (lower.endsWith(SMALLEST_DIGIT) || upper?.endsWith(SMALLEST_DIGIT)) {
    throw new InvalidRankError("fractional part must not end with the smallest digit");
  }

  if (upper !== null) {
    // Copy the shared prefix, then split the first position where the two differ.
    let shared = 0;
    while ((lower[shared] ?? SMALLEST_DIGIT) === upper[shared]) shared++;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }

  const lowerDigit = lower ? DIGITS.indexOf(digitAt(lower, 0)) : 0;
  const upperDigit = upper !== null ? DIGITS.indexOf(digitAt(upper, 0)) : DIGITS.length;

  if (upperDigit - lowerDigit > 1) {
    return DIGITS[Math.round(0.5 * (lowerDigit + upperDigit))] as string;
  }
  // Digits are consecutive: there is no room at this position.
  if (upper !== null && upper.length > 1) {
    return upper.slice(0, 1);
  }
  return (DIGITS[lowerDigit] as string) + midpoint(lower.slice(1), null);
}

function assertValidRank(key: string): void {
  if (key.length === 0) {
    throw new InvalidRankError("rank must not be empty");
  }
  if (key === `A${SMALLEST_DIGIT.repeat(26)}`) {
    throw new InvalidRankError(`"${key}" is the reserved lower bound`);
  }
  const integer = integerPart(key);
  if (key.slice(integer.length).endsWith(SMALLEST_DIGIT)) {
    throw new InvalidRankError(`invalid rank: "${key}"`);
  }
}

/**
 * Produce a rank strictly between `before` and `after`.
 *
 * Pass `null` for either bound to place at the start or end of the scope. Ranks are
 * computed on the server only (spec 24.1).
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null) assertValidRank(before);
  if (after !== null) assertValidRank(after);
  if (before !== null && after !== null && before >= after) {
    throw new InvalidRankError(`"${before}" is not below "${after}"`);
  }

  if (before === null) {
    if (after === null) return INITIAL_RANK;

    const integer = integerPart(after);
    const fraction = after.slice(integer.length);
    if (integer === `A${SMALLEST_DIGIT.repeat(26)}`) {
      return integer + midpoint("", fraction);
    }
    if (integer < after) return integer;
    const decremented = decrementInteger(integer);
    if (decremented === null) {
      throw new InvalidRankError("rank space exhausted below; rebalance required");
    }
    return decremented;
  }

  if (after === null) {
    const integer = integerPart(before);
    const fraction = before.slice(integer.length);
    const incremented = incrementInteger(integer);
    return incremented === null ? integer + midpoint(fraction, null) : incremented;
  }

  const beforeInteger = integerPart(before);
  const beforeFraction = before.slice(beforeInteger.length);
  const afterInteger = integerPart(after);
  const afterFraction = after.slice(afterInteger.length);

  if (beforeInteger === afterInteger) {
    return beforeInteger + midpoint(beforeFraction, afterFraction);
  }

  const incremented = incrementInteger(beforeInteger);
  if (incremented === null) {
    throw new InvalidRankError("rank space exhausted above; rebalance required");
  }
  return incremented < after ? incremented : beforeInteger + midpoint(beforeFraction, null);
}

/**
 * Produce `count` evenly spread ranks between two bounds, for seeding or for a
 * transactional rebalance of a scope (spec 24.1).
 */
export function ranksBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new InvalidRankError("count must be a non-negative integer");
  }
  if (count === 0) return [];
  if (count === 1) return [rankBetween(before, after)];

  if (after === null) {
    let cursor = before;
    return Array.from({ length: count }, () => {
      cursor = rankBetween(cursor, null);
      return cursor;
    });
  }
  if (before === null) {
    let cursor = after;
    const result = Array.from({ length: count }, () => {
      cursor = rankBetween(null, cursor);
      return cursor;
    });
    return result.reverse();
  }

  // Split around the middle so the recursion stays balanced and keys stay short.
  const mid = Math.floor(count / 2);
  const middle = rankBetween(before, after);
  return [
    ...ranksBetween(before, middle, mid),
    middle,
    ...ranksBetween(middle, after, count - mid - 1),
  ];
}

/** True when a string is a well-formed rank. Used at trust boundaries. */
export function isValidRank(value: string): boolean {
  try {
    assertValidRank(value);
    return true;
  } catch {
    return false;
  }
}
