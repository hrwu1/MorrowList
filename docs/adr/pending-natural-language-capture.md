# ADR-pending — Natural-language capture is in scope, parsed on the client

**Status:** Accepted

**Date:** 2026-09-05 (GAP-15)

## Context

Spec §10.1 says plainly that "natural-language syntax such as `tomorrow #research
!high` is explicitly deferred so that unexpected parsing never slows basic capture", and
§2.4 lists it among the MVP non-goals. The competitor gap analysis
(`docs/research/competitor-gap-analysis.md`) calls it the signature strength of the
category leader: the reason capture is one keystroke rather than a form. The roadmap's
closing note moves recurrence, reminders, calendar, start/defer dates and
natural-language capture out of §2.4 ahead of the graph view; ADR-012, ADR-013 and
ADR-014 cover the first three, and this record covers capture.

The spec's worry is the right one. What makes parsing unwelcome is not that it exists but
that it is invisible: text disappears from the title, a date lands that nobody asked for,
and there is no way to say "I meant the word". So the decision below is mostly a set of
rules that make the parse visible and reversible, not a bigger grammar.

## Decision

1. **§10.1 and §2.4 are amended:** typing `Call Sam tomorrow 5pm p1 #launch @phone` in
   quick add or `morrow task add` sets those fields. The spec file itself is not edited.

2. **One parser, in the domain, used by both products.** `parseCapture` in
   `packages/domain/src/task/capture.ts` is pure and deterministic: it takes the text and
   `{ today, projects, tags }` and returns the create-task fields plus the character
   spans each was read from. `apps/web` and `apps/cli` both call it, and
   `CAPTURE_EXAMPLES` in the same file is the fixture all three test suites run, so a
   phrase cannot come to mean two things.

3. **The server never parses.** The request quick add sends is built from the parse
   result; `POST /tasks` sees ordinary fields and is unchanged. No contract, schema or
   migration is involved, and an API client that wants literal text simply gets it.

4. **The parse is shown before it is committed.** Quick add renders one chip per matched
   run, labelled with what it resolved to ("Planned 2026-09-06 at 17:00", "Every week on
   Mon"), and each chip removes its own text from the field. A backslash escapes a token
   (`\#12`), and a per-device settings toggle turns parsing off entirely.

5. **Rules over cleverness.** The first occurrence of each single-valued field wins;
   a weekday resolves forward; a time with no date is today; an unknown `#project` or
   `@tag` stays in the title and is offered for creation; nothing may be parsed away
   entirely, so a line that is only "tomorrow" is a task called "tomorrow"; a line that
   parses nothing is stored exactly as typed, whitespace included. Capture never fails:
   an unreadable value is text, and the worst outcome is a longer title.

6. **The grammar is one table, and it is shared with the grammars already here.**
   `every …` phrases go through `parseRecurrencePhrase` (ADR-012) rather than a second
   recurrence parser, `priority:` and `tag:` go through `parseSearchQuery` (GAP-02), and
   defer and deadline phrases set the ADR-013 fields. Nothing is locale-dependent:
   English words and ISO dates only, so `9/5` is text.

## Consequences

- Capture stays one keystroke. Because the parse is visible and every chip is removable,
  the failure mode the spec feared — silently losing words — costs one click, and the
  toggle costs nothing at all.
- The parser is a table, so extending it (a new date word, a new priority spelling) is a
  domain change with a fixture row, never a migration or a contract change.
- The web resolves relative dates against the workspace's calendar date from `/me`; the
  CLI has no such context in a single command and uses the host's local date. A phrase
  typed near midnight in a workspace whose timezone differs from the shell's can
  therefore land a day apart between the two. `--due` and the other flags are exact and
  always win over a parsed value, which is the way out.
- `#project` and `@tag` need the workspace's names to resolve, so quick add uses the
  lists it already caches and the CLI fetches them only when the text contains a marker.
  A caller that passes no names resolves nothing and keeps the markers in the title,
  which is the safe default for an agent building a request by hand.
- Growing the grammar toward a model, other locales, or server-side parsing would each
  need their own record; none of them is implied by this one.
