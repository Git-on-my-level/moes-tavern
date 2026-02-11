import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchListings } from "../src/search";
import type { SearchListing } from "../src/search";

const fixtures: SearchListing[] = [
  {
    listingId: 1,
    agentId: 11,
    metadata: {
      title: "Rust API Agent",
      description: "Build and maintain high-performance Rust APIs.",
      tags: ["rust", "api", "backend"]
    },
    pricing: {
      unitType: "LOC",
      unitPrice: 120,
      basePrice: 100,
      minUnits: 10,
      maxUnits: 200
    },
    metrics: {
      agentId: 11,
      postedCount: 12,
      acceptedCount: 10,
      submittedCount: 9,
      disputeCount: 1,
      settledCount: 9,
      autoReleaseCount: 1,
      cancelCount: 1,
      acceptRate: 0.9,
      disputeRate: 0.05,
      cancelRate: 0.08,
      silentAutoReleaseFrequency: 0.1,
      avgTimeToSubmitSec: 3600
    },
    curation: {
      updatedAt: 1700000000,
      badges: {
        metadata_validated: true,
        endpoint_verified: true,
        probe_passed: true
      },
      riskScore: 0.1,
      probeScore: 0.8,
      probeEvidenceURI: "ipfs://probe-1",
      lint: {
        valid: true,
        errors: [],
        warnings: [],
        spamSignals: []
      },
      endpointHealth: {
        total: 2,
        okCount: 2,
        failedCount: 0,
        checkedAt: 1700000000
      }
    }
  },
  {
    listingId: 2,
    agentId: 22,
    metadata: {
      title: "Rust API Consultant",
      description: "API design, load testing, and backend review.",
      tags: ["rust", "api", "review"]
    },
    pricing: {
      unitType: "LOC",
      unitPrice: 80,
      basePrice: 50,
      minUnits: 5,
      maxUnits: 120
    },
    metrics: {
      agentId: 22,
      postedCount: 20,
      acceptedCount: 12,
      submittedCount: 11,
      disputeCount: 2,
      settledCount: 10,
      autoReleaseCount: 2,
      cancelCount: 2,
      acceptRate: 0.6,
      disputeRate: 0.2,
      cancelRate: 0.1,
      silentAutoReleaseFrequency: 0.3,
      avgTimeToSubmitSec: 7200
    },
    curation: {
      updatedAt: 1700000000,
      badges: {
        metadata_validated: true,
        endpoint_verified: false,
        probe_passed: false
      },
      riskScore: 0.4,
      probeScore: 0.4,
      probeEvidenceURI: "ipfs://probe-2",
      lint: {
        valid: true,
        errors: [],
        warnings: [],
        spamSignals: []
      },
      endpointHealth: {
        total: 1,
        okCount: 0,
        failedCount: 1,
        checkedAt: 1700000000
      }
    }
  },
  {
    listingId: 3,
    agentId: 33,
    metadata: {
      title: "Solidity Audit",
      description: "Manual smart contract security reviews.",
      tags: ["solidity", "audit"]
    },
    pricing: {
      unitType: "AUDIT",
      unitPrice: 500,
      basePrice: 500,
      minUnits: 1,
      maxUnits: 10
    },
    metrics: {
      agentId: 33,
      postedCount: 5,
      acceptedCount: 4,
      submittedCount: 4,
      disputeCount: 0,
      settledCount: 4,
      autoReleaseCount: 0,
      cancelCount: 0,
      acceptRate: 0.8,
      disputeRate: 0,
      cancelRate: 0,
      silentAutoReleaseFrequency: 0,
      avgTimeToSubmitSec: 18000
    },
    curation: {
      updatedAt: 1700000000,
      badges: {
        metadata_validated: true,
        endpoint_verified: true,
        probe_passed: true
      },
      riskScore: 0.2,
      probeScore: 0.9,
      probeEvidenceURI: "ipfs://probe-3",
      lint: {
        valid: true,
        errors: [],
        warnings: [],
        spamSignals: []
      },
      endpointHealth: {
        total: 1,
        okCount: 1,
        failedCount: 0,
        checkedAt: 1700000000
      }
    }
  },
  {
    listingId: 4,
    agentId: 44,
    metadata: {
      title: "Rust Bugfix",
      description: "Targeted bug fixes for Rust services.",
      tags: ["rust", "bugfix"]
    },
    pricing: {
      unitType: "LOC",
      unitPrice: 60,
      basePrice: 40,
      minUnits: 5,
      maxUnits: 80
    },
    metrics: {
      agentId: 44,
      postedCount: 6,
      acceptedCount: 3,
      submittedCount: 3,
      disputeCount: 1,
      settledCount: 2,
      autoReleaseCount: 1,
      cancelCount: 1,
      acceptRate: 0.5,
      disputeRate: 0.33,
      cancelRate: 0.16,
      silentAutoReleaseFrequency: 0.5,
      avgTimeToSubmitSec: 10000
    },
    curation: {
      updatedAt: 1700000000,
      badges: {
        metadata_validated: true,
        endpoint_verified: false,
        probe_passed: false
      },
      riskScore: 0.6,
      probeScore: 0.2,
      probeEvidenceURI: "ipfs://probe-4",
      lint: {
        valid: true,
        errors: [],
        warnings: [],
        spamSignals: []
      },
      endpointHealth: {
        total: 1,
        okCount: 0,
        failedCount: 1,
        checkedAt: 1700000000
      }
    }
  }
];

describe("searchListings", () => {
  it("ranks results using relevance + trust + economics", () => {
    const index = buildSearchIndex(fixtures);
    const response = searchListings(index, { text: "rust api" });

    const ordered = response.results.map((result) => result.listingId);
    expect(ordered).toEqual([1, 2, 4]);
    expect(response.results[0]?.score).toBeGreaterThan(response.results[1]?.score ?? 0);
  });

  it("returns facets and respects filters", () => {
    const index = buildSearchIndex(fixtures);
    const response = searchListings(index, { text: "rust" });

    expect(response.facets.unitType).toEqual({ LOC: 3 });
    expect(response.facets.priceBucket["50-100"]).toBe(2);
    expect(response.facets.priceBucket["100-250"]).toBe(1);

    const filtered = searchListings(index, {
      text: "rust",
      unitType: "LOC",
      priceBucket: "50-100"
    });

    expect(filtered.results.map((result) => result.listingId)).toEqual([2, 4]);
  });
});
