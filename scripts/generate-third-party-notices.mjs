#!/usr/bin/env node
/**
 * Regenerate THIRD_PARTY_NOTICES.md: `pnpm licenses:notices`.
 *
 * MorrowList is MIT-licensed, but the production image redistributes its runtime
 * dependencies, and their licenses (MIT, ISC, BSD, Apache-2.0, MPL-2.0 for ical.js,
 * LGPL-3.0 for sharp's libvips binary, ...) require their notices to travel with them.
 * This collects each production dependency's own license text. Run it after changing
 * production dependencies and commit the result.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "THIRD_PARTY_NOTICES.md");

const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}

const packages = Object.values(JSON.parse(result.stdout))
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name));

function licenseText(directory) {
  const file = readdirSync(directory).find((name) =>
    /^(licen[cs]e|copying)/i.test(name),
  );
  return file ? readFileSync(join(directory, file), "utf8").trim() : null;
}

const rows = packages.map(
  (pkg) =>
    `| ${pkg.name} | ${pkg.versions.join(", ")} | ${pkg.license} | ${pkg.homepage ?? ""} |`,
);

const texts = packages.map((pkg) => {
  const text = licenseText(pkg.paths[0]);
  const body = text
    ? "```text\n" + text.replaceAll("```", "ʼʼʼ") + "\n```"
    : `No license file is shipped with the package; it declares \`${pkg.license}\`` +
      (pkg.author ? ` (${pkg.author})` : "") +
      ". See its homepage for the full terms.";
  return `### ${pkg.name} ${pkg.versions.join(", ")}\n\n${body}`;
});

writeFileSync(
  output,
  `# Third-party notices

MorrowList itself is licensed under the MIT License (see [LICENSE](LICENSE)). It depends
on the open-source packages below, each under its own license. This file lists the
production dependencies resolved on the machine that generated it, which may include
platform-specific binaries. Regenerate it with \`pnpm licenses:notices\`.

| Package | Version | License | Homepage |
| ------- | ------- | ------- | -------- |
${rows.join("\n")}

## License texts

${texts.join("\n\n")}
`,
);

console.log(`Wrote ${packages.length} packages to THIRD_PARTY_NOTICES.md`);
