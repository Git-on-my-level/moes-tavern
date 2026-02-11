import { describe, expect, it } from "vitest";
import { sum } from "../src/lib/sum";

describe("sum", () => {
  it("adds numbers", () => {
    expect(sum(4, 5)).toBe(9);
  });
});
