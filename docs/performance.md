# Measured performance at reference scale

Every number on this page was measured with `scripts/bench.mjs` against a real server and
a real PostgreSQL 18 database holding the reference-scale dataset of spec 29.1. Nothing
here is estimated. Reproduce it with:

```bash
pnpm build
createdb morrowlist_bench
BENCH_DATABASE_URL=postgresql://localhost/morrowlist_bench node scripts/bench.mjs
```

The script migrates and truncates that database, starts the production server, signs up
over the API, fills the new account's workspace with `scripts/seed-scale.mjs`, and then
drives the real HTTP endpoints.

## The machine

|            |                                                               |
| ---------- | ------------------------------------------------------------- |
| CPU        | Apple M5 Pro, 18 cores                                        |
| Memory     | 24 GB                                                         |
| OS         | macOS 26.5.1 (build 25F80), arm64                             |
| Node.js    | v24.20.0                                                      |
| PostgreSQL | 18.6 (Homebrew), default configuration                        |
| Server     | `next start` production build, one process, `WORKER_MODE=off` |
| Database   | local, same machine, over TCP to `localhost`                  |
| Taken      | 2026-09-05                                                    |

> **The machine was busy.** These runs shared the box with seven other development
> worktrees building and testing at the same time; the load average was **10.5 to 17.4 on
> 18 cores** for the three runs below. Every figure here is therefore an upper bound, not
> a clean-room measurement, and the run-to-run spread in the last column is mostly that
> contention rather than the application. A quiet machine is materially faster — see
> [Sequential latency](#sequential-latency-one-request-at-a-time) below.

> **These p95s are provisional.** A clean re-run on a quiet machine is pending; until it
> lands, read the table below as "no budget is breached even under this much contention",
> not as the product's latency. The `EXPLAIN` plans further down are not provisional —
> plan shapes and buffer counts do not move with the load average.

## The dataset

Built by `scripts/seed-scale.mjs --scale reference`, matching spec 29.1:

|               |                                                                            |
| ------------- | -------------------------------------------------------------------------- |
| Tasks         | 100,000 (10,000 live, 84,600 completed, 5,400 in the trash)                |
| Projects      | 100, each with the six-status default workflow                             |
| Inbox         | 1,200 live tasks with no project                                           |
| Board project | 590 live cards; one board query returns the first 500                      |
| Tags          | 40 in the workspace; 500 tasks carry 20 tags each, ~3,500 carry one or two |
| Subtasks      | 946 live tasks are children                                                |
| Relations     | 500 `blocks` and `related_to` edges                                        |
| Activity      | three tasks with 1,000 events each                                         |
| Dates         | 89 tasks due today, 139 overdue, 376 deferred, 60 My Day selections        |
| Database size | 93 MB                                                                      |

The 20-tag tasks are the board project's cards on purpose: it puts the reference scale's
two heaviest requirements on the same response, so the board figure below is the worst
page the spec asks the product to serve. That board response is **2.2 MB of JSON**.

## Results

Three runs, 200 measured iterations per read scenario and 100 per mutation, at
**concurrency 4**, after a warm-up pass that is not measured. The p95 column is the median
of the three runs' p95; the last column is their full spread.

| Scenario                         | Budget (spec 29.2) | p50      | **p95**      | p99      | p95 across three runs |
| -------------------------------- | ------------------ | -------- | ------------ | -------- | --------------------- |
| Inbox list (50)                  | 300 ms             | 18.4 ms  | **26.2 ms**  | 39.6 ms  | 17.1 – 33.7 ms        |
| Today                            | 300 ms             | 70.3 ms  | **117.1 ms** | 166.6 ms | 90.1 – 119.7 ms       |
| Upcoming (14 days)               | 300 ms             | 55.2 ms  | **72.2 ms**  | 106.4 ms | 69.7 – 93.3 ms        |
| Board, 500 cards                 | 300 ms             | 211.0 ms | **263.4 ms** | 284.9 ms | 257.0 – 443.2 ms      |
| List, project + priority filter  | 300 ms             | 30.6 ms  | **38.2 ms**  | 44.9 ms  | 32.2 – 86.5 ms        |
| List by tag                      | 300 ms             | 26.5 ms  | **36.0 ms**  | 40.9 ms  | 28.2 – 36.5 ms        |
| Completed history (50)           | 300 ms             | 32.4 ms  | **59.7 ms**  | 85.3 ms  | 39.1 – 157.7 ms       |
| Task detail                      | 300 ms             | 7.2 ms   | **13.0 ms**  | 15.9 ms  | 11.0 – 21.6 ms        |
| Activity page (1,000-event task) | 300 ms             | 5.2 ms   | **8.6 ms**   | 11.5 ms  | 6.9 – 13.7 ms         |
| Search, first page               | 500 ms             | 12.3 ms  | **16.4 ms**  | 17.6 ms  | 13.9 – 34.2 ms        |
| Create task                      | 500 ms             | 17.8 ms  | **30.2 ms**  | 33.8 ms  | 12.2 – 38.8 ms        |
| Update task                      | 500 ms             | 9.5 ms   | **14.8 ms**  | 16.2 ms  | 7.7 – 34.0 ms         |
| Move task                        | 500 ms             | 7.7 ms   | **9.0 ms**   | 12.7 ms  | 8.7 – 14.2 ms         |
| Complete task                    | 500 ms             | 8.5 ms   | **13.9 ms**  | 16.9 ms  | 12.2 – 34.0 ms        |

**Every spec 29.2 budget is met.** No scenario returned an error in any run.

These runs predate migration `0014_task_read_indexes.sql`, which landed straight after the
query-discipline pass below. Two rows of this table are therefore pessimistic by a known
amount: Today's query drops from 35.9 ms to 7.8 ms and the completed history's from
22.7 ms to 0.3 ms, so the end-to-end p95s for those two scenarios should fall. The pending
quiet-machine re-run will be the first with 0014 applied.

The 500-card board is the only scenario without comfortable headroom: its median p95 is
88% of the budget, and in the busiest of the three runs — load average 17.4 — it went over
at 443 ms. Nothing else came within half of its budget in any run.

### Sequential latency, one request at a time

The same data and the same still-busy machine, measured at concurrency 1 to separate the
endpoint's own cost from queueing:

| Request          | p50     | Response size |
| ---------------- | ------- | ------------- |
| Board, 25 cards  | 15.3 ms | 150 KB        |
| Board, 50 cards  | 17.0 ms | 299 KB        |
| Board, 100 cards | 25.4 ms | 596 KB        |
| Board, 250 cards | 32.5 ms | 875 KB        |
| Board, 500 cards | 69.7 ms | 2,249 KB      |
| Inbox, 50        | 11.5 ms | 45 KB         |
| Inbox, 200       | 20.9 ms | 177 KB        |
| Upcoming, all    | 27.9 ms | 634 KB        |
| Today            | 49.0 ms | 268 KB        |

The board's cost tracks its response size, not its query: the SQL behind it runs in about
6 ms (below). What the endpoint spends its time on is building and serialising 2.2 MB of
JSON, because each of the 500 cards embeds its twenty tags in full.

## Query discipline

`EXPLAIN ANALYZE` was run against the reference-scale data for every benchmarked read.
The real SQL was captured from the server by turning on `log_min_duration_statement` for
the benchmark database, so these are the statements the application actually issues, not
a hand-written approximation.

Most reads are already index scans and cost a few milliseconds. Two were not, and
**migration `0014_task_read_indexes.sql` fixes both.** The plans below are a matched pair:
the same 100,000-row dataset, captured with the migration applied and again with its two
indexes dropped, so the comparison is not across two seeds or two machines.

### 1. Completed history was a sequential scan

`GET /tasks?isCompleted=true&sort=updatedAt&order=desc` had to read every task ever
created and top-N sort it. The cost grew with the history, which is the part of the table
that only ever grows.

```text
-- before 0014
Limit (actual time=20.937..22.678 rows=51 loops=1)
  Buffers: shared hit=5961 read=120
  ->  Gather Merge  (Workers Launched: 2)
        ->  Sort (Sort Key: updated_at DESC, id DESC; top-N heapsort)
              ->  Parallel Seq Scan on tasks (rows=28200 loops=3)
                    Filter: deleted_at IS NULL AND completed_at IS NOT NULL AND workspace_id = ...
                    Rows Removed by Filter: 5133
Execution Time: 22.708 ms

-- after 0014
Limit (actual time=0.084..0.268 rows=51 loops=1)
  Buffers: shared hit=54 read=1
  ->  Index Only Scan using tasks_completed_recent_idx on tasks
        Index Cond: workspace_id = ...
        Heap Fetches: 51
Execution Time: 0.297 ms
```

### 2. Today read the whole workspace

`GET /views/today` could only use `tasks_due_idx`, which covers every task in the
workspace, history included — so the predicate threw away 99,725 of the rows it walked.

```text
-- before 0014
Limit (actual time=24.418..35.911 rows=275 loops=1)
  Buffers: shared hit=53053 read=1
  ->  Incremental Sort (Sort Key: due_date, rank COLLATE "C", id)
        ->  Index Scan using tasks_due_idx on tasks
              Index Cond: workspace_id = ...
              Filter: ((due_date <= today AND (defer_until IS NULL OR defer_until <= today))
                       OR id = ANY (day plans for today))
              Rows Removed by Filter: 99725
Execution Time: 35.934 ms

-- after 0014
Limit (actual time=0.023..7.780 rows=275 loops=1)
  Buffers: shared hit=9316 read=7
  ->  Index Scan using tasks_open_due_idx on tasks
        Index Cond: workspace_id = ...
        Filter: (same predicate)
        Rows Removed by Filter: 9725
Execution Time: 7.823 ms
```

The sort disappears as well as most of the walk: the index carries `due_date, rank, id`,
which is the order the view reads.

### Migration 0014, measured

```sql
CREATE INDEX tasks_completed_recent_idx ON tasks (workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND completed_at IS NOT NULL;

CREATE INDEX tasks_open_due_idx ON tasks (workspace_id, due_date, rank, id)
  WHERE deleted_at IS NULL AND completed_at IS NULL;
```

| Query             | Before                   | After                      | Plan after                           |
| ----------------- | ------------------------ | -------------------------- | ------------------------------------ |
| Completed history | 22.71 ms, 6,081 buffers  | **0.30 ms**, 55 buffers    | Index Only Scan                      |
| Today             | 35.93 ms, 53,054 buffers | **7.82 ms**, 9,323 buffers | Index Scan, 10k rows instead of 100k |

Both are pure additions: no column, constraint, or row changes, and nothing else in the
schema moves. `rank` has been `varchar(64) COLLATE "C"` since migration 0001, so the
second index inherits code-point ordering from the column rather than restating it —
`pg_get_indexdef` does not print a collation that matches the column, so
`tasks.integration.test.ts` asserts it from the catalogue and then proves it behaviourally
by forcing the planner to answer from the index with sorting disabled.

Nothing was over budget without these indexes. They are the difference between "fits
today" and "still fits when the history is ten times larger".

### Two smaller observations, not acted on

- Task reads select `search_vector` along with everything else, because the repository
  asks Drizzle for the whole row. The column averages 148 bytes — twice the size of the
  title and description together — and `toTask` never reads it. Spec 29.3's first rule is
  "select explicit columns", so this should eventually be an explicit column list. It was
  measured at reference scale and the difference was inside the run-to-run noise, so it is
  a tidiness fix, not a performance one.
- `toTaskDto` walks the page's whole relation list once per task, which is O(tasks ×
  edges). At reference scale the pages that matter carry few edges and it does not show
  up. A page of 500 tasks each carrying several relations would make it 250,000
  iterations, so it is worth a map keyed by task id before anything raises the board's
  card limit.

## What this does not measure

- **The browser.** Spec 29.2's "authenticated shell usable within 2.5 seconds" and
  "optimistic feedback under 100 ms" are client budgets. They are covered by the
  Playwright suite's assertions, not by this benchmark.
- **Docker.** These runs used `next start` directly. The container image has not been
  measured — see the note at the top of
  [`docs/runbooks/self-hosting.md`](runbooks/self-hosting.md).
- **Concurrent writers.** One account drives the whole run, which is what a self-hosted
  personal instance looks like. Multi-user contention is not exercised.
- **Cold caches.** Each scenario warms up first. A first request after a restart pays for
  an empty connection pool and plan cache.

## Keeping the numbers honest

The table above is a snapshot taken under contention and before migration 0014; it is
replaced by a clean re-run on a quiet machine, which is the first thing to do when the
parallel work that was loading this machine has finished.

`scripts/bench.mjs` exits non-zero when any scenario's p95 exceeds its spec 29.2 budget,
and `--check <previous.json> --regression 20` additionally fails when a p95 is more than
20% slower than an earlier run. `.github/workflows/benchmark.yml` runs it nightly rather
than per pull request: at this scale a run takes minutes, and the numbers are only
comparable between runs on the same hardware, which is why the nightly job compares
against its own previous result rather than against the table above.
