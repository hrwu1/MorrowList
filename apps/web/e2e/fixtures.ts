import { createHash } from "node:crypto";

import { test as base } from "@playwright/test";

export {
  devices,
  expect,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * Independent users must not share Better Auth's production per-IP sign-up quota.
 * Give each test attempt its own client address, as if served behind a proxy. Requests
 * within that test still share a quota; production rate limiting stays enabled.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    const address = createHash("sha256")
      .update(`${testInfo.testId}:${testInfo.retry}:${testInfo.repeatEachIndex}`)
      .digest();
    await use({
      ...extraHTTPHeaders,
      "x-forwarded-for": `10.${address[0]}.${address[1]}.${address[2]}`,
    });
  },
});
