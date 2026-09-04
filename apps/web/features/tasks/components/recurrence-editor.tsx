"use client";

import type { RecurrenceRuleDto } from "@morrowlist/contracts";
import { Select, TextInput } from "@morrowlist/ui";
import { useState } from "react";

import {
  CUSTOM_REPEAT,
  NO_REPEAT,
  NTH_WEEKS,
  WEEKDAYS,
  presetIdFor,
  recurrencePresets,
  weekdayOf,
} from "../lib/recurrence";

/**
 * The repeat control on a task (GAP-12): a preset list for the common rules and a
 * custom form for the rest. Every change is emitted as a complete, valid rule (or null
 * for "does not repeat"): the form never lets a weekly rule lose its last weekday or a
 * monthly rule its day, so the server only ever sees something it can store.
 */

const WEEKDAY_LABELS = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
} as const;

const NTH_LABELS = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
} as const;

const FREQUENCY_UNITS = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
} as const;

export interface RecurrenceEditorProps {
  readonly id: string;
  readonly value: RecurrenceRuleDto | null;
  /** The due date the presets are anchored at, or today's date when there is none. */
  readonly anchor: string;
  readonly disabled?: boolean | undefined;
  readonly onChange: (rule: RecurrenceRuleDto | null) => void;
}

export function RecurrenceEditor({
  id,
  value,
  anchor,
  disabled,
  onChange,
}: RecurrenceEditorProps) {
  const presets = recurrencePresets(anchor);
  const [customChosen, setCustomChosen] = useState(false);
  const matched = presetIdFor(value, anchor);
  const selected = customChosen && value !== null ? CUSTOM_REPEAT : matched;
  const showCustom = selected === CUSTOM_REPEAT;

  function choose(presetId: string) {
    if (presetId === NO_REPEAT) {
      setCustomChosen(false);
      onChange(null);
      return;
    }
    if (presetId === CUSTOM_REPEAT) {
      setCustomChosen(true);
      // Start the custom form from the current rule, or from a weekly one on the anchor.
      onChange(value ?? presets[1]!.rule);
      return;
    }
    setCustomChosen(false);
    onChange(presets.find((preset) => preset.id === presetId)!.rule);
  }

  return (
    <div className="recurrence-editor">
      <Select
        id={id}
        value={selected}
        disabled={disabled}
        onChange={(event) => choose(event.target.value)}
      >
        <option value={NO_REPEAT}>Does not repeat</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        <option value={CUSTOM_REPEAT}>Custom…</option>
      </Select>

      {showCustom && value ? (
        <CustomRuleForm
          id={id}
          value={value}
          anchor={anchor}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function CustomRuleForm({
  id,
  value,
  anchor,
  disabled,
  onChange,
}: RecurrenceEditorProps & { readonly value: RecurrenceRuleDto }) {
  const ends =
    value.until !== null ? "until" : value.count !== null ? "count" : "never";

  function changeFrequency(freq: RecurrenceRuleDto["freq"]) {
    onChange({
      ...value,
      freq,
      weekdays: freq === "weekly" ? (value.weekdays ?? [weekdayOf(anchor)]) : null,
      monthDay:
        freq === "monthly" && value.nthWeekday === null
          ? (value.monthDay ?? Number(anchor.slice(8, 10)))
          : null,
      nthWeekday: freq === "monthly" ? value.nthWeekday : null,
    });
  }

  function toggleWeekday(day: (typeof WEEKDAYS)[number]) {
    const current = value.weekdays ?? [];
    const next = current.includes(day)
      ? current.filter((candidate) => candidate !== day)
      : WEEKDAYS.filter(
          (candidate) => candidate === day || current.includes(candidate),
        );
    // A weekly rule must keep at least one day.
    if (next.length === 0) return;
    onChange({ ...value, weekdays: next });
  }

  function changeEnds(kind: string) {
    onChange({
      ...value,
      until: kind === "until" ? (value.until ?? anchor) : null,
      count: kind === "count" ? (value.count ?? 5) : null,
    });
  }

  const monthForm = value.nthWeekday !== null ? "nth" : "day";
  const labelId = (name: string) => `${id}-${name}`;

  return (
    <div className="recurrence-editor__custom" role="group" aria-label="Custom repeat">
      <div className="recurrence-editor__row">
        <label className="ml-field__label" htmlFor={labelId("interval")}>
          Every
        </label>
        <TextInput
          id={labelId("interval")}
          type="number"
          min={1}
          max={365}
          value={value.interval}
          disabled={disabled}
          className="recurrence-editor__number"
          onChange={(event) => {
            const interval = Number(event.target.value);
            if (Number.isInteger(interval) && interval >= 1 && interval <= 365) {
              onChange({ ...value, interval });
            }
          }}
        />
        <label className="ml-visually-hidden" htmlFor={labelId("freq")}>
          Unit
        </label>
        <Select
          id={labelId("freq")}
          value={value.freq}
          disabled={disabled}
          onChange={(event) =>
            changeFrequency(event.target.value as RecurrenceRuleDto["freq"])
          }
        >
          {Object.entries(FREQUENCY_UNITS).map(([freq, unit]) => (
            <option key={freq} value={freq}>
              {unit}
            </option>
          ))}
        </Select>
      </div>

      {value.freq === "weekly" ? (
        <fieldset className="recurrence-editor__weekdays" disabled={disabled}>
          <legend className="ml-field__label">On</legend>
          {WEEKDAYS.map((day) => (
            <label key={day} className="recurrence-editor__weekday">
              <input
                type="checkbox"
                checked={value.weekdays?.includes(day) ?? false}
                onChange={() => toggleWeekday(day)}
              />
              {WEEKDAY_LABELS[day]}
            </label>
          ))}
        </fieldset>
      ) : null}

      {value.freq === "monthly" ? (
        <div className="recurrence-editor__row">
          <label className="ml-field__label" htmlFor={labelId("month-form")}>
            On the
          </label>
          <Select
            id={labelId("month-form")}
            value={monthForm}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.value === "nth"
                  ? {
                      ...value,
                      monthDay: null,
                      nthWeekday: { nth: 1, weekday: weekdayOf(anchor) },
                    }
                  : {
                      ...value,
                      monthDay: Number(anchor.slice(8, 10)),
                      nthWeekday: null,
                    },
              )
            }
          >
            <option value="day">day of month</option>
            <option value="nth">weekday</option>
          </Select>
          {monthForm === "day" ? (
            <>
              <label className="ml-visually-hidden" htmlFor={labelId("month-day")}>
                Day of month
              </label>
              <TextInput
                id={labelId("month-day")}
                type="number"
                min={1}
                max={31}
                value={value.monthDay ?? 1}
                disabled={disabled}
                className="recurrence-editor__number"
                onChange={(event) => {
                  const monthDay = Number(event.target.value);
                  if (Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31) {
                    onChange({ ...value, monthDay });
                  }
                }}
              />
            </>
          ) : (
            <>
              <label className="ml-visually-hidden" htmlFor={labelId("nth")}>
                Which
              </label>
              <Select
                id={labelId("nth")}
                value={String(value.nthWeekday?.nth ?? 1)}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    nthWeekday: {
                      nth: Number(event.target.value) as (typeof NTH_WEEKS)[number],
                      weekday: value.nthWeekday?.weekday ?? weekdayOf(anchor),
                    },
                  })
                }
              >
                {NTH_WEEKS.map((nth) => (
                  <option key={nth} value={String(nth)}>
                    {NTH_LABELS[nth]}
                  </option>
                ))}
              </Select>
              <label className="ml-visually-hidden" htmlFor={labelId("nth-weekday")}>
                Weekday
              </label>
              <Select
                id={labelId("nth-weekday")}
                value={value.nthWeekday?.weekday ?? "mon"}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    nthWeekday: {
                      nth: value.nthWeekday?.nth ?? 1,
                      weekday: event.target.value as (typeof WEEKDAYS)[number],
                    },
                  })
                }
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {WEEKDAY_LABELS[day]}
                  </option>
                ))}
              </Select>
            </>
          )}
        </div>
      ) : null}

      <div className="recurrence-editor__row">
        <label className="ml-field__label" htmlFor={labelId("mode")}>
          Next date from
        </label>
        <Select
          id={labelId("mode")}
          value={value.mode}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              mode: event.target.value as RecurrenceRuleDto["mode"],
            })
          }
        >
          <option value="schedule">the due date</option>
          <option value="after_completion">the completion date</option>
        </Select>
      </div>

      <div className="recurrence-editor__row">
        <label className="ml-field__label" htmlFor={labelId("ends")}>
          Ends
        </label>
        <Select
          id={labelId("ends")}
          value={ends}
          disabled={disabled}
          onChange={(event) => changeEnds(event.target.value)}
        >
          <option value="never">never</option>
          <option value="until">on a date</option>
          <option value="count">after a number of times</option>
        </Select>
        {ends === "until" ? (
          <>
            <label className="ml-visually-hidden" htmlFor={labelId("until")}>
              End date
            </label>
            <TextInput
              id={labelId("until")}
              type="date"
              value={value.until ?? ""}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.value)
                  onChange({ ...value, until: event.target.value });
              }}
            />
          </>
        ) : null}
        {ends === "count" ? (
          <>
            <label className="ml-visually-hidden" htmlFor={labelId("count")}>
              Occurrences left
            </label>
            <TextInput
              id={labelId("count")}
              type="number"
              min={1}
              max={1000}
              value={value.count ?? 1}
              disabled={disabled}
              className="recurrence-editor__number"
              onChange={(event) => {
                const count = Number(event.target.value);
                if (Number.isInteger(count) && count >= 1 && count <= 1000) {
                  onChange({ ...value, count });
                }
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
