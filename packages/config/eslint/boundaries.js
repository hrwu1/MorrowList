import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The allowed dependency matrix, shared by lint and its executable fixtures. */
export const allowedDependencies = {
  domain: [],
  contracts: [],
  application: ["domain", "contracts", "observability"],
  database: ["application", "domain", "config"],
  auth: ["application", "database", "domain", "observability", "config"],
  api: ["application", "auth", "contracts", "domain", "observability"],
  "api-client": ["contracts"],
  transports: ["application", "contracts", "domain", "observability"],
  ui: [],
  observability: [],
  testkit: ["application", "domain"],
  config: [],
  web: ["api-client", "contracts", "domain", "ui", "config"],
  cli: ["api-client", "contracts", "domain"],
  mcp: ["api-client", "contracts"],
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const publicExports = new Map();
for (const name of readdirSync(resolve(root, "packages"))) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages", name, "package.json"), "utf8"),
  );
  publicExports.set(name, new Set(Object.keys(manifest.exports ?? { ".": true })));
}

const framework = /^(next|react|react-dom|hono|drizzle-orm|better-auth|pg)(\/|$)/;
const serverFramework = /^(next|hono|drizzle-orm|better-auth|pg)(\/|$)/;
const ioModule = /^(node:)?(fs|http|https|http2|net|tls|dns|dgram|child_process)(\/|$)/;
const ownerOf = (path) => /^(?:apps|packages)\/([^/]+)(?:\/|$)/.exec(path)?.[1];
const normalize = (path) => path.replaceAll("\\", "/");
const specifierOf = (node) =>
  typeof node?.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : null;

export const architecturePlugin = {
  rules: {
    dependencies: {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          forbidden:
            "{{source}} cannot import {{target}}; use its declared ports or public client (architecture dependency matrix).",
          private:
            "Cross-package imports must use a declared public entry point; relative paths and private subpaths bypass the architecture.",
          framework: "{{source}} must stay framework-free and keep I/O in adapters.",
        },
      },
      create(context) {
        const filename = context.filename;
        const path = normalize(relative(root, filename));
        const source = ownerOf(path);
        const allowed = allowedDependencies[source];
        if (!allowed) return {};
        const isTest =
          /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("/testing/");
        const isConfig =
          /^(apps|packages)\/[^/]+\/[^/]+\.config\.[cm]?[jt]s$/.test(path) ||
          /^packages\/config\/vitest\//.test(path);
        const isComposition = path === "apps/web/lib/server.ts";
        const isDatabaseHarness = path === "apps/web/e2e/global-setup.ts";

        function ambient(node, name) {
          for (
            let scope = context.sourceCode.getScope(node);
            scope;
            scope = scope.upper
          ) {
            const variable = scope.set.get(name);
            if (variable) return variable.defs.length === 0;
          }
          return true;
        }

        function check(node, value) {
          if (!value) return;
          let target;
          let crossPath = false;
          if (value.startsWith("@morrowlist/")) {
            const [, name, ...subpath] = value.split("/");
            target = name;
            const entry = subpath.length ? `./${subpath.join("/")}` : ".";
            if (!publicExports.get(name)?.has(entry)) {
              context.report({ node, messageId: "private" });
              return;
            }
          } else if (
            value.startsWith(".") ||
            isAbsolute(value) ||
            value.startsWith("@/") ||
            value.startsWith("file:")
          ) {
            const absolute = value.startsWith("@/")
              ? resolve(root, "apps/web", value.slice(2))
              : value.startsWith("file:")
                ? fileURLToPath(value)
                : resolve(dirname(filename), value);
            target = ownerOf(normalize(relative(root, absolute)));
            crossPath = target !== undefined && target !== source;
          }
          if (crossPath) {
            context.report({ node, messageId: "private" });
            return;
          }
          if (target && target !== source) {
            const testDependency =
              isTest &&
              target === "testkit" &&
              !["domain", "contracts", "config", "observability"].includes(source);
            const configDependency = isConfig && target === "config";
            const harnessDependency =
              (isDatabaseHarness || (isTest && source === "api")) &&
              target === "database";
            if (
              !isComposition &&
              !allowed.includes(target) &&
              !testDependency &&
              !configDependency &&
              !harnessDependency
            ) {
              context.report({
                node,
                messageId: "forbidden",
                data: { source, target },
              });
            }
          }
          const pure = ["domain", "contracts", "application", "observability"].includes(
            source,
          );
          const client = ["cli", "mcp", "api-client", "ui"].includes(source);
          if (
            !isComposition &&
            ((pure && framework.test(value)) ||
              (pure && !isTest && ioModule.test(value)) ||
              (client && serverFramework.test(value)) ||
              (source === "web" &&
                !isDatabaseHarness &&
                /^(drizzle-orm|pg)(\/|$)/.test(value)))
          ) {
            context.report({ node, messageId: "framework", data: { source } });
          }
        }
        return {
          ImportDeclaration: (node) => check(node.source, specifierOf(node.source)),
          ExportNamedDeclaration: (node) =>
            check(node.source, specifierOf(node.source)),
          ExportAllDeclaration: (node) => check(node.source, specifierOf(node.source)),
          ImportExpression: (node) => check(node.source, specifierOf(node.source)),
          CallExpression: (node) => {
            if (node.callee.type === "Identifier" && node.callee.name === "require")
              check(node, specifierOf(node.arguments[0]));
            if (
              ["domain", "contracts", "application", "observability"].includes(
                source,
              ) &&
              !isTest &&
              ((node.callee.type === "Identifier" &&
                node.callee.name === "fetch" &&
                ambient(node, "fetch")) ||
                (node.callee.type === "MemberExpression" &&
                  node.callee.object.type === "Identifier" &&
                  ["globalThis", "window", "self"].includes(node.callee.object.name) &&
                  ambient(node, node.callee.object.name) &&
                  (node.callee.computed
                    ? specifierOf(node.callee.property) === "fetch"
                    : node.callee.property.name === "fetch")))
            )
              context.report({ node, messageId: "framework", data: { source } });
          },
        };
      },
    },
  },
};
