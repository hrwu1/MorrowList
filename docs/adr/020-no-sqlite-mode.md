# ADR-020: No SQLite mode; PostgreSQL stays the only database

**Status:** Proposed

**Date:** 2026-09-05

## Decision

**Decision:** MorrowList supports exactly one database, PostgreSQL 18. A SQLite mode is
not built, and the reason is not that SQLite is unsuitable for a personal task manager —
it is that the measured problem it would solve does not exist.

The self-hosting story stays two containers, one command: PostgreSQL and the application,
started by `infra/compose/docker-compose.prod.yml` (GAP-23). If SQLite is revisited, it
must come with a portable answer for full-text search and for claiming rows in the
reminder worker, and a decision about whether the repository layer grows a second dialect
or a second implementation.

## Reasoning

The GAP-23 plan deferred this decision until the benchmark existed, "so decide with data
rather than assume". The data is in [`docs/performance.md`](../performance.md); it was
taken on 100,000 tasks, 10,000 of them live, across 100 projects.

**The database is not the bottleneck.** All fourteen benchmarked scenarios meet their spec
29.2 budget with headroom. Ten of the fourteen are under a fifth of their budget. The one
scenario without comfortable headroom is the 500-card board — and its SQL takes about
6 ms of a 70 ms sequential request, the rest being the construction and serialisation of a
2.2 MB JSON response in Node. Swapping the database engine would not move that number. A
SQLite mode would be a rewrite bought for a speed-up the profile says is not available.

**The footprint argument is smaller than it looks.** The stated appeal of SQLite for
self-hosters is "no database to run". What it actually removes here is one
`postgres:18-alpine` container from a compose file the user never edits, and one volume
they would still have to back up either way. It does not remove a command: `docker compose
up` is already the whole install. The whole reference-scale dataset is 93 MB.

**What it would cost, counted rather than estimated.** The database package is ten
repository files and 550 lines of reviewed migration SQL, and the PostgreSQL-specific
surface is not incidental:

- **Full-text search has no equivalent.** `tasks.search_vector` is a stored generated
  `tsvector`, indexed with GIN, and search ranks results with `setweight`, `to_tsquery`
  and `ts_rank_cd` so a title hit outranks a description hit (spec 9.8). SQLite's answer
  is FTS5, a separate virtual table kept in step with triggers, with a different relevance
  function. That is a second representation of a task's text — the thing ADR-001 exists to
  prevent — and two search behaviours to specify, document and test.
- **The reminder worker claims rows with `FOR UPDATE SKIP LOCKED`** (ADR-014), which is
  what lets several workers run without delivering a reminder twice. SQLite has no row
  locks and one writer at a time; the claim would have to be redesigned, and the
  `WORKER_MODE=external` option would lose its point.
- **Rank ordering depends on collation.** `COLLATE "C"` appears throughout the schema and
  migration 0001 exists solely to pin it (ADR-009). SQLite's default `BINARY` collation
  happens to give the same order, so this one is a cheap port — but it is also the reason
  the plan flagged the area: a silent collation difference reorders a user's board.
- **Types and dialect.** `uuid`, `timestamptz`, `date`, `time`, `jsonb`, partial indexes,
  generated columns, and casts like `::uuid` and `::real` are spread across every
  repository; 23 hand-written SQL fragments live in the task repository alone. Drizzle
  models PostgreSQL and SQLite as different dialects with different schema builders, so
  this is a parallel implementation, not a configuration flag.
- **Every test would double.** The integration suite exists precisely to catch what
  in-memory doubles cannot — constraints, collation, concurrent number allocation,
  transactional rollback (spec 28.1). A second engine that is not covered by that suite is
  a second engine nobody can trust; covering it means running the suite twice.

Set against a measured speed-up of zero, that is a poor trade. ADR-003 chose a modular
monolith to keep the number of moving parts low; a second database engine adds one of the
most expensive kinds of moving part there is.

## Consequences

- The specification's deployment section keeps PostgreSQL 18 as a requirement, and
  `docs/runbooks/self-hosting.md` documents backup and restore in PostgreSQL's terms only.
- Repositories may continue to use PostgreSQL features freely — partial indexes, generated
  columns, `SKIP LOCKED`, full-text search — without a portability caveat. The two partial
  indexes added by migration `0014_task_read_indexes.sql` are an example of exactly that:
  neither predicate has a portable equivalent worth writing.
- Self-hosters who genuinely cannot run PostgreSQL are not served. The honest answer to
  them is the compose file, which asks them to run a container rather than install a
  database.
- What this makes harder: an embedded single-file distribution — a desktop build, or a
  "download one binary" story — now needs this decision reversed rather than a flag
  flipped. The reversal is a real project: a search design, a claim design, and a second
  tested dialect. It should be triggered by demand for that distribution, not by the wish
  to run one fewer container.
- This record is not a judgement on SQLite. If the profile ever changes — if a personal
  instance turns out to be dominated by database latency rather than by response
  construction — it should be reopened with new numbers, the same way it was closed.
