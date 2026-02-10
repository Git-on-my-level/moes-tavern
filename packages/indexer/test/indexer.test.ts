import { describe, expect, it } from "vitest";
import { countStatus, TaskEvent } from "../src/indexer";

describe("countStatus", () => {
  it("counts matching task states", () => {
    const events: TaskEvent[] = [
      { taskId: 1, status: "OPEN" },
      { taskId: 1, status: "ACTIVE" },
      { taskId: 2, status: "OPEN" }
    ];

    expect(countStatus(events, "OPEN")).toBe(2);
    expect(countStatus(events, "ACTIVE")).toBe(1);
  });
});
