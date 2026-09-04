import { parseServerEnv } from "@morrowlist/config/env";

import { backfillStatusIntervals } from "./backfill-flow.js";
import { createDatabase } from "./client.js";

/** `pnpm db:backfill-flow` — rebuilds task_status_intervals from activity_events. */
const env = parseServerEnv();
const handle = createDatabase({ connectionString: env.DATABASE_URL, max: 1 });
try {
  await backfillStatusIntervals(handle.db, { log: (message) => console.log(message) });
} finally {
  await handle.close();
}
