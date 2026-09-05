/**
 * A minimal RFC 4180 codec (GAP-07).
 *
 * Export writes it and import reads it, so the two live together and a round trip is a
 * unit test rather than a hope. Quoted fields may contain commas, quotes (doubled) and
 * newlines; `\r\n` and `\n` both end a record.
 *
 * This is a format, not a business rule, but it is pure and both the archive and the
 * importer need the same one, so it belongs in the innermost layer.
 */

const QUOTE = '"';

/** True when a value has to be quoted to survive a round trip. */
function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value);
}

export function encodeCsvField(value: string): string {
  if (!needsQuoting(value)) return value;
  return `${QUOTE}${value.replaceAll(QUOTE, `${QUOTE}${QUOTE}`)}${QUOTE}`;
}

/** Rows to CSV text with `\r\n` line endings, which every spreadsheet accepts. */
export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(encodeCsvField).join(",")).join("\r\n");
}

/**
 * CSV text to rows. A trailing newline does not produce an empty final record, and a
 * completely blank line is dropped, because spreadsheets add both.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = () => {
    endField();
    // A line that held nothing at all is spreadsheet padding, not a record.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    started = false;
  };

  // The leading byte-order mark Excel writes is not part of the first column's name.
  const source = text.startsWith("﻿") ? text.slice(1) : text;

  for (let index = 0; index < source.length; index++) {
    const character = source[index] as string;

    if (quoted) {
      if (character !== QUOTE) {
        field += character;
        continue;
      }
      if (source[index + 1] === QUOTE) {
        field += QUOTE;
        index += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (character === QUOTE && field === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (character === ",") {
      endField();
      continue;
    }
    if (character === "\r") {
      if (source[index + 1] === "\n") index += 1;
      endRow();
      continue;
    }
    if (character === "\n") {
      endRow();
      continue;
    }
    field += character;
    started = true;
  }

  if (started || field !== "" || row.length > 0) endRow();
  return rows;
}
