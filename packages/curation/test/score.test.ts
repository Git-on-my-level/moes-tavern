import { describe, expect, it } from "vitest";
import { scoreListing } from "../src/score";

describe("scoreListing", () => {
  it("weights signals", () => {
    const score = scoreListing({
      acceptRate: 0.8,
      disputeRate: 0.1,
      priceScore: 0.6
    });

    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(0.9);
  });
});
