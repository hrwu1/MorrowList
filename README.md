# MorrowList

A task manager with one canonical model. Inbox, Today, and the Kanban board are views of
the same task — not separate systems that must be kept in sync.

The web app, the `morrow` CLI, and any third-party client are peers: they all speak the
same versioned REST API, so anything you can do by clicking you can do from a script.

> Status: Milestone M0 (foundation) is complete, along with a vertical slice through
> every layer — sign up, capture into the Inbox, list, complete, reopen. Projects,
> the board, Today, Upcoming, search, tags, and relationships follow in M2–M8. See
> [`.claude/plans/morrowlist-mvp.md`](.claude/plans/morrowlist-mvp.md).

## Quick start

```bash
corepack enable pnpm
pnpm setup:dev                # one-time setup; PostgreSQL must be running
pnpm dev                      # http://localhost:3000
```

Requires Node.js 24 and PostgreSQL 18. `docker compose -f infra/compose/docker-compose.yml up -d`
starts a matching database if you prefer containers. `pnpm setup:dev` installs workspace
dependencies, creates `.env` when needed, checks PostgreSQL, builds workspace packages,
and applies migrations. It is safe to rerun and never replaces an existing `.env`.

## Repository layout

```text
apps/
  web/          Next.js UI, and the composition root that wires everything together
  cli/          the `morrow` command-line application
packages/
  domain/       pure entities, invariants, and policies — no framework, no I/O
  application/  use cases and the ports they depend on
  contracts/    Zod request, response, and event schemas
  api/          Hono routes, middleware, OpenAPI composition
  api-client/   the typed client shared by web and CLI
  database/     Drizzle schema, repositories, reviewed SQL migrations
  auth/         the auth provider, behind an adapter
  ui/           design tokens and accessible primitives
  observability/ structured logging, redaction, metrics ports
  testkit/      factories and in-memory doubles
  config/       shared TypeScript, ESLint, and environment schemas
```

Dependencies flow inward: `web` and `cli` depend on the API; the API depends on the
application layer; the application layer depends on the domain. The domain depends on
nothing. `pnpm lint` fails the build when that is violated, and
`scripts/check-boundaries.mjs` fails it when the rules themselves stop working.

## Design notes worth knowing

**Manual order is authoritative.** Tasks carry a base-62 fractional rank, so inserting
between two neighbours never rewrites a column. The alphabet is ASCII-ordered, which means
rank columns must be `COLLATE "C"` — under the usual `en_US.UTF-8` collation PostgreSQL
sorts `aa` before `aZ` and two adjacent cards silently swap. Migration
`0001_rank_collation.sql` pins it; an integration test guards it.

**Every mutation is auditable.** A task change, its activity row, and its outbox event are
written in one transaction. If any part fails, none of it happened.

**Concurrency is explicit.** Tasks carry a version. A mutation may send `expectedVersion`,
and a mismatch returns `409 TASK_VERSION_CONFLICT` with the actual version rather than
overwriting someone's work.

**Workspaces are isolated.** Reaching a workspace you cannot access returns _not found_,
not _forbidden_, so a response never confirms that something exists.

## Documentation

- [Contributing](docs/contributing/README.md) — setup, architecture rules, testing
- [Rules for agent contributors](docs/contributing/agents.md)
- [Architecture decision records](docs/adr/README.md)
- [OpenAPI document](docs/api/openapi.json)
- [Product specification](MorrowList_v1.0_Product_Specification_and_Agent_Implementation_Plan.md)
