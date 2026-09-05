#!/bin/sh
# Container entrypoint (GAP-23). Two roles from one image:
#
#   server   apply migrations, then run the web server (default)
#   migrate  apply migrations and exit — the separate release step of spec 31.2
#
# A single-container self-hoster wants one command, so `server` migrates on start. A
# deployment running more than one web replica must set RUN_MIGRATIONS=false and run the
# `migrate` role once per release instead, so two replicas never migrate concurrently.
#
# There is no `worker` role: the image runs the reminder loop inside the web process
# (WORKER_MODE=embedded, the default). `pnpm worker` — the separate process for
# WORKER_MODE=external — needs the workspace installed, which this image does not carry.
set -eu

APP_ROOT="${APP_ROOT:-/app}"
cd "$APP_ROOT"

run_migrations() {
  # The database may still be accepting connections a moment after it reports healthy,
  # and a self-hoster's `docker compose up` should not fail on that race.
  attempt=1
  max_attempts="${MIGRATION_ATTEMPTS:-10}"
  while :; do
    if node packages/database/dist/migrate-bundle.mjs; then
      return 0
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "entrypoint: migrations failed after ${attempt} attempts" >&2
      return 1
    fi
    echo "entrypoint: migration attempt ${attempt} failed; retrying in 3s" >&2
    attempt=$((attempt + 1))
    sleep 3
  done
}

role="${1:-server}"

case "$role" in
  migrate)
    run_migrations
    ;;
  server)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      run_migrations
    else
      echo "entrypoint: RUN_MIGRATIONS=false; expecting migrations to have run already"
    fi
    # exec so the server is PID 1 and receives SIGTERM directly: Next closes its
    # listener and finishes in-flight requests rather than being killed mid-response.
    exec node apps/web/server.js
    ;;
  *)
    # Anything else is run verbatim, which keeps `docker run <image> node --version`
    # and one-off maintenance commands available without a second image.
    exec "$@"
    ;;
esac
