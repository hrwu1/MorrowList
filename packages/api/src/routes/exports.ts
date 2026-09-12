import {
  EXPORT_ARRAY_SECTIONS,
  exportTasksCsvQuerySchema,
  exportWorkspaceQuerySchema,
  type WorkspaceExport,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseQuery } from "../middleware/validate.js";
import { parseTaskQuery } from "../task-query.js";

import { requireWorkspace } from "./workspace.js";

/**
 * Data portability (spec 30, GAP-07).
 *
 * Both endpoints answer a file rather than an envelope: a browser saves them straight to
 * disk and `curl -O` does the right thing. The archive is serialised section by section
 * into a `ReadableStream`, so a workspace with ten thousand tasks never becomes one
 * multi-megabyte string in memory before the first byte is sent.
 */
export function exportRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/exports/workspace.json", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), exportWorkspaceQuerySchema);
      const workspaceId = requireWorkspace(
        c.req.query("workspaceId"),
        actor.workspaceIds,
      );

      // Read first: a failure has to become a JSON error, not a truncated download.
      const archive = await deps.exportService.workspace(actor, workspaceId, query);

      return new Response(serializeArchive(archive), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${archiveFilename(archive)}"`,
          "cache-control": "no-store",
        },
      });
    })

    .get("/exports/tasks.csv", async (c) => {
      const actor = c.get("actor");
      const query = parseTaskQuery(c.req.query(), exportTasksCsvQuerySchema);
      const workspaceId = requireWorkspace(
        c.req.query("workspaceId"),
        actor.workspaceIds,
      );

      const csv = await deps.exportService.tasksCsv(actor, { ...query, workspaceId });

      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="morrowlist-tasks-${today()}.csv"`,
          "cache-control": "no-store",
        },
      });
    });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function archiveFilename(archive: WorkspaceExport): string {
  const slug = archive.workspace.slug.replace(/[^a-z0-9-]/gi, "") || "workspace";
  return `morrowlist-${slug}-${archive.exportedAt.slice(0, 10)}.json`;
}

/**
 * The archive as a stream of JSON chunks, one array element at a time. The section order
 * is `EXPORT_ARRAY_SECTIONS`, which is also the order the schema declares, so the file a
 * person opens reads top to bottom the way the documentation describes it.
 */
function serializeArchive(archive: WorkspaceExport): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  async function* chunks(): AsyncGenerator<string> {
    yield `{"format":${JSON.stringify(archive.format)}`;
    yield `,"schemaVersion":${JSON.stringify(archive.schemaVersion)}`;
    yield `,"exportedAt":${JSON.stringify(archive.exportedAt)}`;
    yield `,"workspace":${JSON.stringify(archive.workspace)}`;

    for (const section of EXPORT_ARRAY_SECTIONS) {
      yield `,${JSON.stringify(section)}:[`;
      const items = archive[section];
      for (const [index, item] of items.entries()) {
        yield index === 0 ? JSON.stringify(item) : `,${JSON.stringify(item)}`;
      }
      yield "]";
    }
    yield "}";
  }

  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
  });
}
