# Runbook: self-hosting MorrowList

Two containers — PostgreSQL and the application — on one small box. The reminder worker
runs inside the application process, so there is no third thing to keep alive.

> **Verification status.** Everything on this page was written and reviewed statically.
> The container images have **not** been built or run: the machine the work was done on
> has no Docker installed. The two placeholders below (image size, resident memory at
> idle) are unmeasured on purpose and must be filled in by the first person who runs
> `docker compose up` for real, along with any correction this page needs.

## Requirements

- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- 1 vCPU and 1 GB of RAM is the intended floor; 2 GB is comfortable.
- A domain and a TLS-terminating reverse proxy if you expose it beyond localhost.

## First run

```bash
git clone https://github.com/morrowlist/morrowlist.git
cd morrowlist
cp infra/compose/.env.prod.example infra/compose/.env

# The two secrets the stack refuses to start without.
printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> infra/compose/.env
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> infra/compose/.env

docker compose -f infra/compose/docker-compose.prod.yml \
  --env-file infra/compose/.env up -d
```

Later edits to those values must replace the lines rather than append duplicates; the
last occurrence in the file wins, which is easy to misread.

Then wait for the application to report ready and open it:

```bash
curl -fsS http://localhost:3000/api/v1/ready
open http://localhost:3000/sign-up
```

Create the first account on that page. It is an ordinary sign-up: the account gets its own
personal workspace, an Inbox, and a default board workflow. There is no separate
administrator setup step.

To close the instance to further sign-ups afterwards, put the reverse proxy in front of
`/sign-up` and `/api/auth/sign-up/*`; the application has no invite model yet (spec 6).

### What happens on start

1. `postgres` starts and reports healthy through `pg_isready`.
2. The application container's entrypoint applies every pending migration
   (`scripts/entrypoint.sh` runs the bundled `@morrowlist/database` migration CLI over the
   reviewed SQL in `packages/database/drizzle`). Each applied file is recorded, so a
   restart re-applies nothing.
3. The Next.js standalone server starts on port 3000 and the container health check
   begins polling `GET /api/v1/health`.

The whole sequence is a pull plus a few seconds of migration on an empty database.

### If the first run fails

| Symptom                                                              | Cause                                                                  | Fix                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `AUTH_SECRET: generate one with ...` from compose                    | the variable is empty in `infra/compose/.env`                          | set it; it must be at least 32 characters                                 |
| App container restarts, log says `Invalid environment configuration` | a variable failed the typed schema at startup (spec 31.3)              | the log names every offending variable; fix them all                      |
| `migration ... failed` repeated ten times, then exit                 | the database is unreachable or the credentials are wrong               | check `docker compose logs postgres` and that `POSTGRES_PASSWORD` matches |
| Sign-up returns 403                                                  | `APP_URL` / `AUTH_TRUSTED_ORIGINS` do not match the URL in the browser | set both to the exact public origin, then `docker compose up -d` again    |

## Configuration

Every variable is validated at startup and there is no production-usable default for a
secret (spec 31.3). `infra/compose/.env.prod.example` lists them all; these are the ones
that matter most.

| Variable               | Default                 | Notes                                                 |
| ---------------------- | ----------------------- | ----------------------------------------------------- |
| `AUTH_SECRET`          | —                       | required; at least 32 characters                      |
| `POSTGRES_PASSWORD`    | —                       | required                                              |
| `APP_URL`              | `http://localhost:3000` | the origin the browser uses                           |
| `AUTH_TRUSTED_ORIGINS` | `http://localhost:3000` | must include `APP_URL`                                |
| `MORROWLIST_PORT`      | `3000`                  | host port; the container always listens on 3000       |
| `DATABASE_POOL_MAX`    | `10`                    | lower it on a 1 GB box before raising it              |
| `WORKER_MODE`          | `embedded`              | reminders run in the web process; `off` disables them |
| `RUN_MIGRATIONS`       | `true`                  | see below                                             |
| `TRASH_RETENTION_DAYS` | `30`                    | how long deleted tasks are recoverable                |

### Behind a reverse proxy

Terminate TLS at the proxy, forward to `MORROWLIST_PORT`, and set `APP_URL` and
`AUTH_TRUSTED_ORIGINS` to the public `https://` origin. Sign-in is rejected from any
origin not on that list, which is the single most common misconfiguration.

## Upgrading

```bash
cd morrowlist
git pull                       # only for the compose file; the image comes from the registry
docker compose -f infra/compose/docker-compose.prod.yml \
  --env-file infra/compose/.env pull
docker compose -f infra/compose/docker-compose.prod.yml \
  --env-file infra/compose/.env up -d
```

Take a backup first (below). Migrations are forward-only and expand/migrate/contract
(spec 32); the application tolerates the previous schema during a rolling deploy, but a
single-container upgrade is a short restart either way.

Pin `MORROWLIST_IMAGE` to a released tag rather than `latest` once the instance matters.

### More than one application container

Then migrations must not race. Set `RUN_MIGRATIONS=false` on the application service and
run the migration role once per release before starting the new containers (spec 31.2):

```bash
docker compose -f infra/compose/docker-compose.prod.yml \
  --env-file infra/compose/.env run --rm app migrate
```

## Backup and restore

A backup is not valid until a restore has succeeded (spec 30.3). Test it.

```bash
# Dump (compressed custom format, restorable table by table).
docker compose -f infra/compose/docker-compose.prod.yml exec -T postgres \
  pg_dump -U morrowlist -Fc morrowlist > morrowlist-$(date +%F).dump

# Restore into an empty database.
docker compose -f infra/compose/docker-compose.prod.yml exec -T postgres \
  pg_restore -U morrowlist -d morrowlist --clean --if-exists < morrowlist-2026-09-05.dump
```

- Encrypt the dumps at rest and keep them off the same disk as the volume.
- Take one immediately before any upgrade that includes a migration.
- For a production instance, enable PostgreSQL point-in-time recovery as well; a nightly
  dump means a day of lost work in the worst case.
- Users can also export their own data as a JSON archive (spec 30.1); that is a user
  feature, not an operational backup, and it does not capture auth records.

## Operations

| Task                            | Command                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Logs                            | `docker compose -f infra/compose/docker-compose.prod.yml logs -f app`                                 |
| Health                          | `curl -fsS http://localhost:3000/api/v1/health`                                                       |
| Readiness (checks the database) | `curl -fsS http://localhost:3000/api/v1/ready`                                                        |
| Restart                         | `docker compose -f infra/compose/docker-compose.prod.yml restart app`                                 |
| Stop, keeping data              | `docker compose -f infra/compose/docker-compose.prod.yml down`                                        |
| Stop and **delete** data        | `... down -v`                                                                                         |
| Database shell                  | `docker compose -f infra/compose/docker-compose.prod.yml exec postgres psql -U morrowlist morrowlist` |

The application handles `SIGTERM`: the entrypoint `exec`s the server so it is PID 1, and
Next closes its listener and finishes in-flight requests before exiting.

## Footprint

| Measurement                         | Value                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| Compressed image size (linux/amd64) | **unmeasured** — no Docker on the machine this was written on |
| Compressed image size (linux/arm64) | **unmeasured**                                                |
| Application container RSS at idle   | **unmeasured**                                                |
| PostgreSQL container RSS at idle    | **unmeasured**                                                |

Fill these in from a real run:

```bash
docker image ls ghcr.io/morrowlist/morrowlist --format '{{.Size}}'
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
```

Measured performance at the reference scale of spec 29.1 — 100 projects, 10,000 live
tasks, 100,000 rows including history — is in [`docs/performance.md`](../performance.md).
That page's numbers were taken outside Docker, against the same code and PostgreSQL
version.

## Building the image yourself

```bash
docker build -f infra/docker/Dockerfile -t morrowlist:local .
```

The build context is the repository root. `infra/compose/docker-compose.prod.yml` also
carries a `build:` section, so `docker compose ... build app` does the same thing and then
runs what it built.
