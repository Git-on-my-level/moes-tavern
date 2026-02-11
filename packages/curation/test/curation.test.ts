import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkEndpoints,
  computeCurationBadges,
  computeRiskScore,
  extractEndpointsFromRegistration,
  lintListingMetadata,
  runProbeFixture
} from "../src/curation";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("curation", () => {
  let server: http.Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.statusCode = 200;
        res.end("ok");
        return;
      }
      res.statusCode = 500;
      res.end("nope");
    });

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server?.address();
    if (typeof address === "object" && address?.port) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    baseUrl = "";
  });

  it("lints metadata and flags spam signals", () => {
    const result = lintListingMetadata({
      title: "Fast agent",
      description: "Fast agent",
      tags: ["fast", "fast", "agent"]
    });

    expect(result.valid).toBe(true);
    expect(result.spamSignals).toContain("duplicate_tags");
    expect(result.spamSignals).toContain("duplicate_title_description");
  });

  it("rejects missing required fields", () => {
    const result = lintListingMetadata({ title: "", tags: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("description_missing");
    expect(result.errors).toContain("title_empty");
    expect(result.errors).toContain("tags_empty");
  });

  it("extracts endpoints from registration", () => {
    const endpoints = extractEndpointsFromRegistration({
      endpoints: [
        "https://example.com/api",
        { url: "http://localhost:3000/health" },
        { url: "ftp://nope" },
        123
      ]
    });
    expect(endpoints).toEqual([
      "https://example.com/api",
      "http://localhost:3000/health"
    ]);
  });

  it("checks endpoint health with local server", async () => {
    const report = await checkEndpoints([`${baseUrl}/ok`, `${baseUrl}/bad`], {
      timeoutMs: 1000
    });

    expect(report.total).toBe(2);
    expect(report.okCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(report.checks[0]?.ok).toBe(true);
    expect(report.checks[1]?.ok).toBe(false);
  });

  it("runs probe fixtures and computes badges", async () => {
    const fixturePath = path.join(__dirname, "fixtures", "probe-pass.json");
    const probe = await runProbeFixture(fixturePath);
    const lint = lintListingMetadata({
      title: "Agent",
      description: "Does work",
      tags: ["agent"]
    });
    const report = await checkEndpoints([`${baseUrl}/ok`]);
    const badges = computeCurationBadges(lint, report, probe.probeScore, {
      probePassThreshold: 0.75
    });

    expect(probe.probeScore).toBe(0.9);
    expect(badges.metadata_validated).toBe(true);
    expect(badges.endpoint_verified).toBe(true);
    expect(badges.probe_passed).toBe(true);
  });

  it("computes risk score with penalties", () => {
    const score = computeRiskScore({
      nowMs: 1000 * 60 * 60 * 24 * 40,
      createdAtMs: 0,
      probeScore: 0.5,
      disputeRate: 0.2,
      silentAutoReleaseFrequency: 0.4,
      newnessWindowDays: 30
    });

    expect(score).toBeGreaterThan(20);
    expect(score).toBeLessThan(80);
  });
});
