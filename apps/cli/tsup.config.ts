import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // A single file with a shebang so `morrow` runs from a global install without
  // requiring the workspace to be present (CLI-009).
  banner: { js: "#!/usr/bin/env node" },
});
