# Production image (spec 31.2, GAP-23).
#
# Build context is the repository root:
#   docker build -f infra/docker/Dockerfile -t morrowlist .
#
# Four stages so a dependency install is not repeated on every source edit, and so the
# runtime layer carries neither the pnpm store nor a single development dependency.
# The runtime is Next.js standalone output: the tracer copies only the files the server
# actually imports, workspace packages included, into `.next/standalone`.

ARG NODE_VERSION=24.20.0

# --- base -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The version is pinned by `packageManager` in the root package.json; corepack reads it.
RUN corepack enable
WORKDIR /app

# --- deps -------------------------------------------------------------------
# Only the manifests, so the install layer is reused until a dependency changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cli/package.json apps/cli/
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/api-client/package.json packages/api-client/
COPY packages/application/package.json packages/application/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/observability/package.json packages/observability/
COPY packages/testkit/package.json packages/testkit/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app /app
COPY . .
# Standalone output is opt-in (see apps/web/next.config.ts): local development and the
# Playwright suite keep the ordinary build, and only the image asks for the traced one.
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# A self-contained migration runner (spec 31.2, 32).
#
# `pnpm db:migrate` compiles TypeScript on the fly and the runtime image has no
# toolchain; and Next's standalone output bundles `pg` and the workspace packages into
# the server chunks rather than leaving them on disk, so nothing outside that server can
# import them. Bundling the existing CLI — the same entry, the same runner, the same
# reviewed SQL — gives the entrypoint one file to run and adds no second implementation.
#
# It must land in `packages/database/dist/` because the runner locates its SQL relative
# to its own module URL (`../drizzle`), which esbuild preserves.
# The banner is the standard ESM interop shim: `pg` reaches for `require` at load time.
RUN pnpm --filter @morrowlist/web exec esbuild \
      ../../packages/database/dist/migrate-cli.js \
      --bundle --platform=node --format=esm --external:pg-native \
      --banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" \
      --outfile=../../packages/database/dist/migrate-bundle.mjs

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Health probes and the entrypoint's wait loop use wget from busybox; no extra package.
RUN addgroup -S morrow && adduser -S -G morrow -h /app morrow

# The traced server, with its own node_modules, laid out relative to the repository root.
COPY --from=build --chown=morrow:morrow /app/apps/web/.next/standalone ./
# Static assets are deliberately not traced; they are copied verbatim.
COPY --from=build --chown=morrow:morrow /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=morrow:morrow /app/apps/web/public ./apps/web/public
# The bundled migration runner and the SQL it reads, which is found relative to it.
COPY --from=build --chown=morrow:morrow /app/packages/database/dist/migrate-bundle.mjs ./packages/database/dist/migrate-bundle.mjs
COPY --from=build --chown=morrow:morrow /app/packages/database/drizzle ./packages/database/drizzle
COPY --chown=morrow:morrow scripts/entrypoint.sh ./scripts/

USER morrow
EXPOSE 3000

# `GET /api/v1/health` is unauthenticated on purpose so an orchestrator can reach it.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/v1/health" || exit 1

ENTRYPOINT ["/bin/sh", "/app/scripts/entrypoint.sh"]
CMD ["server"]
