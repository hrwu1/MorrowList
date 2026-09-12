import { describe, expect, it, vi } from "vitest";

import { createTaskSession } from "./task-session";

describe("task session lifetime", () => {
  it("revokes old executions and ignores an old boundary's delayed cleanup", () => {
    const session = createTaskSession();
    const changed = vi.fn();
    const unsubscribe = session.subscribe(changed);
    const alice = session.begin("alice");
    const bob = session.begin("bob");
    session.end(alice);
    expect(session.isCurrent(alice)).toBe(false);
    expect(session.isCurrent(bob)).toBe(true);
    session.end(bob);
    expect(session.isCurrent(bob)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    session.begin("another");
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("keeps a newly mounted capture boundary active when the prior shell unmounts", () => {
    const session = createTaskSession();
    const shell = session.begin("alice");
    const capture = session.begin("alice");
    session.end(shell);
    expect(session.isCurrent(capture)).toBe(true);
    session.end();
    expect(session.isCurrent(capture)).toBe(false);
  });
});
