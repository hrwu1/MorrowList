import { randomFillSync } from "node:crypto";

/**
 * UUIDv7 generation (spec 8.1, 18.2): time-ordered identifiers so primary keys cluster by
 * creation time, which keeps activity and outbox inserts append-friendly.
 *
 * Layout per RFC 9562: 48-bit big-endian Unix millisecond timestamp, 4-bit version, 12
 * bits of monotonic sequence, 2-bit variant, 62 bits of randomness. The sequence keeps
 * identifiers minted inside the same millisecond strictly increasing.
 */

const bytes = new Uint8Array(16);
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/**
 * Ambient-clock state. Kept separate from the explicit-timestamp state so a test or a
 * backfill cannot perturb the identifiers minted from the wall clock, or vice versa.
 */
let ambientEmitted = -1;
let ambientSequence = 0;

/** Explicit-timestamp state: the last requested value, what was emitted for it, and the sequence. */
let explicitRequested = -1;
let explicitEmitted = -1;
let explicitSequence = 0;

function mint(timestamp: number, sequence: number): string {
  randomFillSync(bytes, 8);

  const ms = BigInt(timestamp);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | ((bytes[8] as number) & 0x3f);

  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i] as number];
  }
  return out;
}

/**
 * Mint an identifier from the ambient clock. A backwards clock step does not produce an
 * out-of-order identifier: generation continues from the last emitted millisecond.
 */
export function uuidv7(): string {
  const now = Date.now();
  if (now > ambientEmitted) {
    ambientEmitted = now;
    ambientSequence = 0;
  } else {
    ambientSequence += 1;
    // 12 bits of sequence space. On exhaustion borrow the next millisecond rather than
    // emitting a duplicate; identifiers stay unique and ordered.
    if (ambientSequence > 0xfff) {
      ambientEmitted += 1;
      ambientSequence = 0;
    }
  }
  return mint(ambientEmitted, ambientSequence);
}

/**
 * Mint an identifier for an explicit millisecond timestamp, for tests and for backfilling
 * historical rows. The timestamp is honoured exactly. More than 4096 identifiers for the
 * same timestamp spill into the following millisecond so ordering and uniqueness hold.
 */
export function uuidv7At(timestamp: number): string {
  if (timestamp !== explicitRequested) {
    explicitRequested = timestamp;
    explicitEmitted = timestamp;
    explicitSequence = 0;
  } else {
    explicitSequence += 1;
    if (explicitSequence > 0xfff) {
      explicitEmitted += 1;
      explicitSequence = 0;
    }
  }
  return mint(explicitEmitted, explicitSequence);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Extract the embedded timestamp. Returns null for a UUID that is not version 7. */
export function uuidv7Timestamp(value: string): Date | null {
  if (!isUuid(value)) return null;
  const hex = value.replace(/-/g, "");
  if (hex[12] !== "7") return null;
  return new Date(Number.parseInt(hex.slice(0, 12), 16));
}
