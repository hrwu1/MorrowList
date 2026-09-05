import { describe, expect, it } from "vitest";

import { fuzzyMatch, rankCommands } from "./match";

describe("fuzzyMatch", () => {
  it("matches characters in order, not only whole words", () => {
    expect(fuzzyMatch("cmp", "Complete or reopen the focused task")).not.toBeNull();
  });

  it("refuses a character that is not there", () => {
    expect(fuzzyMatch("zz", "Go to Today")).toBeNull();
  });

  it("matches everything when nothing has been typed", () => {
    expect(fuzzyMatch("", "Go to Inbox")).toEqual({ score: 0, ranges: [] });
  });

  it("reports the matched characters as ranges the highlighter can render", () => {
    expect(fuzzyMatch("go", "Go to Inbox")?.ranges).toEqual([{ start: 0, end: 2 }]);
  });

  it("merges neighbouring characters into one range", () => {
    expect(fuzzyMatch("inb", "Go to Inbox")?.ranges).toEqual([{ start: 6, end: 9 }]);
  });

  it("prefers a word start over a match buried mid-word", () => {
    const start = fuzzyMatch("to", "Today")?.score ?? 0;
    const buried = fuzzyMatch("to", "Custom fields")?.score ?? 0;
    expect(start).toBeGreaterThan(buried);
  });
});

describe("rankCommands", () => {
  const commands = [
    { title: "Go to Inbox" },
    { title: "Go to Today" },
    { title: "Complete or reopen the focused task", keywords: "done tick finish" },
  ];

  it("returns everything, in registry order, for an empty query", () => {
    expect(rankCommands(commands, "").map((entry) => entry.command.title)).toEqual(
      commands.map((command) => command.title),
    );
  });

  it("puts the closest title first", () => {
    expect(rankCommands(commands, "today")[0]?.command.title).toBe("Go to Today");
  });

  it("finds a command by a word that is not in its title, without highlighting", () => {
    const [first] = rankCommands(commands, "done");
    expect(first?.command.title).toBe("Complete or reopen the focused task");
    expect(first?.ranges).toEqual([]);
  });

  it("ranks a synonym hit below a title hit", () => {
    const ranked = rankCommands(
      [{ title: "Go to Inbox", keywords: "finish" }, { title: "Finish up" }],
      "finish",
    );
    expect(ranked[0]?.command.title).toBe("Finish up");
  });

  it("drops what does not match at all", () => {
    expect(rankCommands(commands, "qqq")).toEqual([]);
  });
});
