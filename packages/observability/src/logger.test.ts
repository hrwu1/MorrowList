import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";
import { REDACTED } from "./redact.js";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    write: (line: string) => lines.push(line),
  };
}

describe("createLogger", () => {
  it("emits one JSON object per line", () => {
    const sink = capture();
    const logger = createLogger({ write: sink.write, now: () => new Date(0) });

    logger.info("task created", { taskId: "t1" });

    expect(sink.parsed()[0]).toEqual({
      level: "info",
      time: "1970-01-01T00:00:00.000Z",
      message: "task created",
      taskId: "t1",
    });
  });

  it("filters below the configured level", () => {
    const sink = capture();
    const logger = createLogger({ level: "warn", write: sink.write });

    logger.debug("noise");
    logger.info("noise");
    logger.warn("kept");

    expect(sink.lines).toHaveLength(1);
  });

  it("merges child context into every line", () => {
    const sink = capture();
    const logger = createLogger({ write: sink.write }).child({ requestId: "req_1" });

    logger.info("first");
    logger.info("second", { taskId: "t2" });

    expect(sink.parsed().every((entry) => entry.requestId === "req_1")).toBe(true);
    expect(sink.parsed()[1]?.taskId).toBe("t2");
  });

  it("redacts secrets and content in fields and child context", () => {
    const sink = capture();
    const logger = createLogger({ write: sink.write }).child({ apiKey: "secret" });

    logger.info("done", { title: "Private task" });

    expect(sink.parsed()[0]?.apiKey).toBe(REDACTED);
    expect(sink.parsed()[0]?.title).toBe(REDACTED);
  });
});
