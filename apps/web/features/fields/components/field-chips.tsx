"use client";

import type { FieldValuesDto } from "@morrowlist/contracts";

import { useFields } from "../hooks/use-fields";
import { cardFieldValues, formatFieldValue } from "../lib/field-filters";

/**
 * The flagged field values of a card or a row (GAP-24): one line, at most two fields.
 * The cap is deliberate — a card that lists every field is a spreadsheet row.
 */
export function FieldChips({ values }: { readonly values: FieldValuesDto }) {
  const fields = useFields();
  const shown = cardFieldValues(values, fields.data?.data ?? []);
  if (shown.length === 0) return null;

  return (
    <span className="field-chips">
      {shown.map(({ definition, value }) => (
        <span className="field-chip" key={definition.id}>
          <span className="field-chip__name">{definition.name}</span>
          <span className="field-chip__value">{formatFieldValue(value)}</span>
        </span>
      ))}
    </span>
  );
}
