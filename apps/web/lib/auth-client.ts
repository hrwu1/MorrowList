"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth calls. The only place the provider's client SDK is referenced. */
export const authClient = createAuthClient({ basePath: "/api/auth" });
