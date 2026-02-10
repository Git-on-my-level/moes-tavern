import { describe, expect, it } from "vitest";
import { formatAgentId } from "../src/ids";

describe("formatAgentId", () => {
  it("formats numeric ids", () => {
    expect(formatAgentId(7)).toBe("agent-7");
  });
});
