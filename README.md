# MorrowList

A self-hosted task manager with one canonical model. Inbox, Today, and the Kanban board
are views of the same task — not separate systems that must be kept in sync.

The web app, the `morrow` CLI, and the MCP server for AI assistants are peers: they all
speak the same versioned REST API, so anything you can do by clicking you can do from a
script.

**Features:** projects with custom workflows, Inbox / Today / Upcoming views, Kanban
boards with WIP limits and swimlanes, subtasks, tags, relations and custom fields,
recurring tasks, reminders and web push, saved searches, imports and exports, automation
rules, webhooks, quick capture (share sheet and email), and calendar sync (an ICS feed
and a two-way CalDAV account). It works as an installable PWA.

## Choose your path

| I want to…                                  | Go to                                           |
| ------------------------------------------- | ----------------------------------------------- |
| Run MorrowList for myself on a server or PC | [Self-host with Docker](#self-host-with-docker) |
| Try it locally or change the code           | [Run from source](#run-from-source)             |
| Use it from the terminal or an AI assistant | [CLI and MCP](#cli-and-mcp)                     |

## Self-host with Docker

Needs only [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone https://github.com/hrwu1/MorrowList.git
cd MorrowList
cp infra/compose/.env.prod.example infra/compose/.env
```

Edit `infra/compose/.env` and fill in the two required secrets:

```bash
openssl rand -base64 32   # paste as AUTH_SECRET
openssl rand -hex 24      # paste as POSTGRES_PASSWORD
```

Then build and start it:

```bash
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/compose/.env up -d --build
```

The first build takes a few minutes and about 2 GB of memory; no prebuilt image is
published. Open <http://localhost:3200> and create an account. This runs two
containers (the app and PostgreSQL); migrations run on start. To reach it from other
devices, put it behind HTTPS and set `APP_URL` and `AUTH_TRUSTED_ORIGINS` to the public
URL. [`docs/runbooks/self-hosting.md`](docs/runbooks/self-hosting.md) covers reverse
proxies, upgrades, backups, and optional features (email, push, GitHub sign-in).

## Run from source

### 1. Install the prerequisites

- **Node.js 24** or newer — check with `node -v`
- **pnpm** — run `corepack enable pnpm` (Corepack ships with Node.js)
- **PostgreSQL 18** — either Docker (easiest) or a native install

### 2. Start PostgreSQL

With Docker (creates the `morrowlist`, `morrowlist_test`, and `morrowlist_e2e`
databases with user and password `postgres`, matching `.env.example`):

```bash
docker compose -f infra/compose/docker-compose.yml up -d
```

Or natively (macOS example), then create the databases:

```bash
brew install postgresql@18 && brew services start postgresql@18
createdb morrowlist && createdb morrowlist_test && createdb morrowlist_e2e
```

`.env.example` assumes user and password `postgres`. If yours differ (Homebrew uses your
macOS user with no password), `pnpm setup:dev` stops with a connection error: edit
`DATABASE_URL` and the two test URLs in the `.env` it created, then rerun it.

### 3. Set up and run

```bash
git clone https://github.com/hrwu1/MorrowList.git
cd MorrowList
pnpm setup:dev   # installs dependencies, creates .env, builds packages, migrates the database
pnpm dev         # http://localhost:3200
```

Open <http://localhost:3200> and sign up. `pnpm setup:dev` is safe to rerun and never
replaces an existing `.env`; every setting is documented in [`.env.example`](.env.example).

### Common commands

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `pnpm dev`              | Runs the web app with hot reload                    |
| `pnpm build`            | Builds every package and app                        |
| `pnpm test`             | Unit tests, no database required                    |
| `pnpm test:integration` | Database tests against `TEST_DATABASE_URL`          |
| `pnpm test:e2e`         | Playwright browser tests against `E2E_DATABASE_URL` |
| `pnpm lint`             | ESLint plus the dependency-boundary checks          |
| `pnpm typecheck`        | TypeScript across the workspace                     |
| `pnpm db:migrate`       | Applies pending migrations to `DATABASE_URL`        |

Before `pnpm test:e2e`, install the browser once with
`pnpm --filter @morrowlist/web exec playwright install chromium`.

Local servers bind to `127.0.0.1` on port 3200 (end-to-end tests use 3250, benchmarks
3299). Pass `--hostname 0.0.0.0` explicitly only when you want LAN access.

## CLI and MCP

Both need an API token: in the web app open **Settings → Calendar** and choose
**Create API token**. It is shown once, so copy it then.

**The `morrow` CLI**, built from a source checkout:

```bash
pnpm --filter @morrowlist/cli... build
cd apps/cli && npm link && cd ../..   # puts `morrow` on your PATH
pbpaste | morrow --base-url http://localhost:3200/api/v1 auth login   # reads the token from stdin
morrow auth status
morrow task add "Draft the proposal tomorrow"
morrow usage                          # every command, with examples
```

On Linux, use `xclip -o` or `wl-paste` in place of `pbpaste`. Without `npm link`, run
`node apps/cli/dist/index.js` instead of `morrow`.

**The MCP server** lets an assistant such as Claude read and change your tasks through
the same API. See [`apps/mcp/README.md`](apps/mcp/README.md) for setup.

## How it is built

```text
apps/
  web/          Next.js UI, and the composition root that wires everything together
  cli/          the `morrow` command-line application
  mcp/          bounded MCP tools through the public API
packages/
  domain/       pure entities, invariants, and policies — no framework, no I/O
  application/  use cases and the ports they depend on
  contracts/    Zod request, response, and event schemas
  api/          Hono routes, middleware, OpenAPI composition
  api-client/   the typed client shared by web and CLI
  database/     Drizzle schema, repositories, reviewed SQL migrations
  auth/         the auth provider, behind an adapter
  transports/   outbound senders and shared background-worker composition
  ui/           design tokens and accessible primitives
  observability/ structured logging, redaction, metrics ports
  testkit/      factories and in-memory doubles
  config/       shared TypeScript, ESLint, and environment schemas
```

Dependencies flow inward: `web` and `cli` depend on the API; the API depends on the
application layer; the application layer depends on the domain. The domain depends on
nothing. `pnpm lint` fails the build when that is violated, and
`scripts/check-boundaries.mjs` fails it when the rules themselves stop working.

### Design notes worth knowing

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

**Retries preserve one logical mutation.** Clients send an idempotency key; the server
commits an encrypted replay result with the command and retains it for 24 hours. A retry
must reuse the same key. Reusing it with a different request returns a conflict.

**Workspaces are isolated.** Reaching a workspace you cannot access returns _not found_,
not _forbidden_, so a response never confirms that something exists.

## Documentation

- [Contributing](docs/contributing/README.md) — setup details, architecture rules, testing
- [Rules for agent contributors](docs/contributing/agents.md)
- [Self-hosting runbook](docs/runbooks/self-hosting.md) and [quick capture](docs/runbooks/quick-capture.md)
- [Architecture decision records](docs/adr/README.md)
- [OpenAPI document](docs/api/openapi.json), [webhooks](docs/api/webhooks.md), and [automation rules](docs/api/automation-rules.md)
- [Performance at 10,000 tasks](docs/performance.md)
- [Product specification](MorrowList_v1.0_Product_Specification_and_Agent_Implementation_Plan.md)

## License

MorrowList is released under the [MIT License](LICENSE). It builds on open-source
packages that keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
