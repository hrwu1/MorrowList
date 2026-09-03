import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every `--tag-<token>-bg` / `--tag-<token>-text` pair must read at WCAG AA (4.5:1) in
 * both themes (spec 14, GAP-03). The check parses tokens.css itself, so a colour tweak
 * that breaks contrast fails here rather than in a screen reader user's report.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

const TAG_TOKENS = [
  "neutral",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
];

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open, index);
  }
  throw new Error(`unterminated ${selector} block`);
}

function oklch(source: string, name: string): [number, number, number] {
  const match = new RegExp(
    `${name}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`,
  ).exec(source);
  if (!match) throw new Error(`${name} is not an oklch() literal`);
  return [Number(match[1]) / 100, Number(match[2]), Number(match[3])];
}

/** OKLCH → linear sRGB (Björn Ottosson's reference matrices). */
function toLinearRgb([L, C, h]: [number, number, number]): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(bg: [number, number, number], fg: [number, number, number]): number {
  const [light, dark] = [luminance(bg), luminance(fg)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe.each([
  ["light", ":root {"],
  ["dark (system)", "@media (prefers-color-scheme: dark)"],
  ["dark (explicit)", ':root[data-theme="dark"]'],
])("tag tokens in the %s theme", (_theme, selector) => {
  const source = block(selector);

  it.each(TAG_TOKENS)("--tag-%s passes 4.5:1 and stays inside sRGB", (token) => {
    const bg = toLinearRgb(oklch(source, `--tag-${token}-bg`));
    const text = toLinearRgb(oklch(source, `--tag-${token}-text`));

    // A colour outside sRGB is clipped by the browser, which would change the ratio.
    for (const channel of [...bg, ...text]) {
      expect(channel).toBeGreaterThanOrEqual(-0.001);
      expect(channel).toBeLessThanOrEqual(1.001);
    }
    expect(contrast(bg, text)).toBeGreaterThanOrEqual(4.5);
  });
});
