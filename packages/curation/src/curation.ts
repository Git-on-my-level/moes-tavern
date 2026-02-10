import fs from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";

export type ListingMetadata = {
  title: string;
  description: string;
  tags: string[];
  [key: string]: unknown;
};

export type ListingMetadataLintResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  spamSignals: string[];
};

export type EndpointCheck = {
  url: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  responseTimeMs: number | null;
};

export type EndpointHealthReport = {
  total: number;
  okCount: number;
  failedCount: number;
  checkedAt: number;
  checks: EndpointCheck[];
};

export type ProbeResult = {
  probeScore: number;
  probeEvidenceURI: string;
  probeId?: string;
};

export type CurationBadges = {
  metadata_validated: boolean;
  endpoint_verified: boolean;
  probe_passed: boolean;
};

export type RiskScoreInput = {
  nowMs: number;
  createdAtMs: number | null;
  probeScore: number;
  disputeRate: number;
  silentAutoReleaseFrequency: number;
  newnessWindowDays?: number;
};

const DEFAULT_NEWNESS_WINDOW_DAYS = 30;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeText = (value: string) => value.trim().toLowerCase();

const tokenize = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const hasKeywordStuffing = (text: string) => {
  const tokens = tokenize(text);
  if (tokens.length < 8) return false;
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let maxCount = 0;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }
  const ratio = maxCount / tokens.length;
  return maxCount >= 4 && ratio >= 0.35;
};

export function lintListingMetadata(metadata: unknown): ListingMetadataLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const spamSignals: string[] = [];

  if (!metadata || typeof metadata !== "object") {
    errors.push("metadata_not_object");
    return { valid: false, errors, warnings, spamSignals };
  }

  const record = metadata as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  const tags = Array.isArray(record.tags) ? record.tags : null;

  if (!title) errors.push("title_missing");
  if (!description) errors.push("description_missing");
  if (!tags) errors.push("tags_missing");

  if (title && normalizeText(title).length === 0) errors.push("title_empty");
  if (description && normalizeText(description).length === 0) errors.push("description_empty");

  if (tags) {
    const normalizedTags = tags
      .filter((tag) => typeof tag === "string")
      .map((tag) => normalizeText(tag))
      .filter((tag) => tag.length > 0);
    if (normalizedTags.length === 0) errors.push("tags_empty");
    const deduped = new Set(normalizedTags);
    if (deduped.size !== normalizedTags.length) spamSignals.push("duplicate_tags");
  } else if (record.tags !== undefined) {
    errors.push("tags_not_array");
  }

  if (title && description) {
    if (normalizeText(title) === normalizeText(description)) {
      spamSignals.push("duplicate_title_description");
    }
    if (hasKeywordStuffing(`${title} ${description}`)) {
      spamSignals.push("keyword_stuffing");
    }
  }

  if (spamSignals.length > 0) {
    warnings.push(...spamSignals);
  }

  return { valid: errors.length === 0, errors, warnings, spamSignals };
}

export function extractEndpointsFromRegistration(registration: unknown): string[] {
  if (!registration || typeof registration !== "object") return [];
  const record = registration as Record<string, unknown>;
  const raw = record.endpoints ?? record.endpoint ?? record.urls ?? null;
  if (!Array.isArray(raw)) return [];
  const endpoints = raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string") {
        return (entry as { url: string }).url;
      }
      return null;
    })
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const filtered = endpoints.filter((value) => value.startsWith("http://") || value.startsWith("https://"));
  return Array.from(new Set(filtered));
}

export async function checkEndpoints(
  endpoints: string[],
  options: { timeoutMs?: number } = {}
): Promise<EndpointHealthReport> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const checks: EndpointCheck[] = [];
  for (const url of endpoints) {
    checks.push(await requestEndpoint(url, timeoutMs));
  }
  const okCount = checks.filter((check) => check.ok).length;
  return {
    total: checks.length,
    okCount,
    failedCount: checks.length - okCount,
    checkedAt: Date.now(),
    checks
  };
}

async function requestEndpoint(url: string, timeoutMs: number): Promise<EndpointCheck> {
  const start = Date.now();
  try {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    return await new Promise<EndpointCheck>((resolve) => {
      const req = client.request(
        parsed,
        {
          method: "GET",
          headers: { "user-agent": "moes-curation-healthcheck" }
        },
        (res) => {
          res.resume();
          const statusCode = res.statusCode ?? null;
          const ok = statusCode !== null && statusCode >= 200 && statusCode < 400;
          resolve({
            url,
            ok,
            statusCode,
            error: ok ? null : `status_${statusCode ?? "unknown"}`,
            responseTimeMs: Date.now() - start
          });
        }
      );

      req.on("error", (error) => {
        resolve({
          url,
          ok: false,
          statusCode: null,
          error: error instanceof Error ? error.message : "request_error",
          responseTimeMs: Date.now() - start
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("timeout"));
      });
      req.end();
    });
  } catch {
    return {
      url,
      ok: false,
      statusCode: null,
      error: "invalid_url",
      responseTimeMs: Date.now() - start
    };
  }
}

export async function runProbeFixture(fixturePath: string): Promise<ProbeResult> {
  const raw = await fs.readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as {
    probeScore?: number;
    score?: number;
    evidence?: string;
    id?: string;
  };

  const probeScore = clamp01(parsed.probeScore ?? parsed.score ?? 0);
  const probeEvidenceURI = parsed.evidence ? String(parsed.evidence) : fixturePath;
  const probeId = parsed.id ? String(parsed.id) : undefined;
  return { probeScore, probeEvidenceURI, probeId };
}

export function computeCurationBadges(
  lint: ListingMetadataLintResult,
  endpointReport: EndpointHealthReport,
  probeScore: number,
  options: { probePassThreshold?: number } = {}
): CurationBadges {
  const threshold = options.probePassThreshold ?? 0.7;
  return {
    metadata_validated: lint.valid,
    endpoint_verified: endpointReport.total > 0 && endpointReport.okCount === endpointReport.total,
    probe_passed: clamp01(probeScore) >= threshold
  };
}

export function computeRiskScore(input: RiskScoreInput): number {
  const probePenalty = 1 - clamp01(input.probeScore);
  const disputePenalty = clamp01(input.disputeRate);
  const silentPenalty = clamp01(input.silentAutoReleaseFrequency);
  const newnessWindow = input.newnessWindowDays ?? DEFAULT_NEWNESS_WINDOW_DAYS;

  let newnessPenalty = 0.5;
  if (input.createdAtMs !== null) {
    const ageDays = (input.nowMs - input.createdAtMs) / (1000 * 60 * 60 * 24);
    newnessPenalty = clamp01(1 - ageDays / newnessWindow);
  }

  const risk =
    disputePenalty * 0.35 +
    silentPenalty * 0.25 +
    probePenalty * 0.2 +
    newnessPenalty * 0.2;

  return Math.round(clamp01(risk) * 100);
}
