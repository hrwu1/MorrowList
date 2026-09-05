import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // A single file with a shebang so an MCP client can spawn `morrow-mcp` directly.
  banner: { js: "#!/usr/bin/env node" },
});
