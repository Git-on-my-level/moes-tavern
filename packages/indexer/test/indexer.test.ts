import { describe, expect, it } from "vitest";
import type { IndexerEvent, ListingCuration } from "../src/indexer";
import { Indexer } from "../src/indexer";

describe("Indexer", () => {
  it("computes per-agent metrics and query results", () => {
    const events: IndexerEvent[] = [
      {
        type: "ListingCreated",
        blockNumber: 1,
        logIndex: 0,
        timestamp: 10,
        listingId: 1,
        agentId: 1,
        listingURI: "ipfs://listing-1",
        pricing: {
          paymentToken: "0xToken",
          basePrice: 100,
          unitType: "LOC",
          unitPrice: 10,
          minUnits: 1,
          maxUnits: 100,
          quoteRequired: false
        },
        policy: {
          challengeWindowSec: 3600,
          postDisputeWindowSec: 0,
          sellerBondBps: 0
        },
        active: true
      },
      {
        type: "ListingCreated",
        blockNumber: 1,
        logIndex: 1,
        timestamp: 11,
        listingId: 2,
        agentId: 2,
        listingURI: "ipfs://listing-2",
        pricing: {
          paymentToken: "0xToken",
          basePrice: 200,
          unitType: "LOC",
          unitPrice: 20,
          minUnits: 1,
          maxUnits: 100,
          quoteRequired: true
        },
        policy: {
          challengeWindowSec: 3600,
          postDisputeWindowSec: 0,
          sellerBondBps: 0
        },
        active: true
      },
      {
        type: "TaskPosted",
        blockNumber: 2,
        logIndex: 0,
        timestamp: 100,
        taskId: 1,
        listingId: 1,
        agentId: 1,
        buyer: "0xBuyer",
        taskURI: "ipfs://task-1",
        proposedUnits: 10
      },
      {
        type: "TaskAccepted",
        blockNumber: 2,
        logIndex: 1,
        timestamp: 120,
        taskId: 1
      },
      {
        type: "DeliverableSubmitted",
        blockNumber: 3,
        logIndex: 0,
        timestamp: 200,
        taskId: 1,
        artifactURI: "ipfs://artifact-1",
        artifactHash: "0xhash1"
      },
      {
        type: "SubmissionAccepted",
        blockNumber: 4,
        logIndex: 0,
        timestamp: 210,
        taskId: 1
      },
      {
        type: "TaskSettled",
        blockNumber: 4,
        logIndex: 1,
        timestamp: 220,
        taskId: 1,
        buyerPayout: 100,
        sellerBondRefund: 0
      },
      {
        type: "TaskPosted",
        blockNumber: 5,
        logIndex: 0,
        timestamp: 300,
        taskId: 2,
        listingId: 1,
        agentId: 1,
        buyer: "0xBuyer",
        taskURI: "ipfs://task-2",
        proposedUnits: 5
      },
      {
        type: "QuoteProposed",
        blockNumber: 5,
        logIndex: 1,
        timestamp: 310,
        taskId: 2,
        quotedUnits: 5,
        quotedTotalPrice: 50,
        expiry: 0
      },
      {
        type: "QuoteAccepted",
        blockNumber: 6,
        logIndex: 0,
        timestamp: 320,
        taskId: 2
      },
      {
        type: "DeliverableSubmitted",
        blockNumber: 7,
        logIndex: 0,
        timestamp: 360,
        taskId: 2,
        artifactURI: "ipfs://artifact-2",
        artifactHash: "0xhash2"
      },
      {
        type: "SubmissionDisputed",
        blockNumber: 8,
        logIndex: 0,
        timestamp: 400,
        taskId: 2,
        disputeURI: "ipfs://dispute-2"
      },
      {
        type: "TaskSettled",
        blockNumber: 9,
        logIndex: 0,
        timestamp: 450,
        taskId: 2,
        buyerPayout: 50,
        sellerBondRefund: 0
      },
      {
        type: "TaskPosted",
        blockNumber: 10,
        logIndex: 0,
        timestamp: 500,
        taskId: 3,
        listingId: 1,
        agentId: 1,
        buyer: "0xBuyer",
        taskURI: "ipfs://task-3",
        proposedUnits: 3
      },
      {
        type: "TaskAccepted",
        blockNumber: 10,
        logIndex: 1,
        timestamp: 520,
        taskId: 3
      },
      {
        type: "DeliverableSubmitted",
        blockNumber: 11,
        logIndex: 0,
        timestamp: 540,
        taskId: 3,
        artifactURI: "ipfs://artifact-3",
        artifactHash: "0xhash3"
      },
      {
        type: "TaskSettled",
        blockNumber: 12,
        logIndex: 0,
        timestamp: 700,
        taskId: 3,
        buyerPayout: 30,
        sellerBondRefund: 0
      },
      {
        type: "TaskPosted",
        blockNumber: 13,
        logIndex: 0,
        timestamp: 800,
        taskId: 4,
        listingId: 2,
        agentId: 2,
        buyer: "0xBuyer",
        taskURI: "ipfs://task-4",
        proposedUnits: 2
      },
      {
        type: "TaskCancelled",
        blockNumber: 13,
        logIndex: 1,
        timestamp: 820,
        taskId: 4
      },
      {
        type: "ListingUpdated",
        blockNumber: 14,
        logIndex: 0,
        timestamp: 900,
        listingId: 2,
        agentId: 2,
        listingURI: "ipfs://listing-2-updated",
        active: false
      }
    ];

    const indexer = new Indexer();
    indexer.ingest(events);

    const agent1 = indexer.getAgentMetrics(1);
    expect(agent1.postedCount).toBe(3);
    expect(agent1.acceptedCount).toBe(3);
    expect(agent1.submittedCount).toBe(3);
    expect(agent1.disputeCount).toBe(1);
    expect(agent1.settledCount).toBe(3);
    expect(agent1.autoReleaseCount).toBe(1);
    expect(agent1.cancelCount).toBe(0);
    expect(agent1.acceptRate).toBe(1);
    expect(agent1.disputeRate).toBeCloseTo(1 / 3, 6);
    expect(agent1.silentAutoReleaseFrequency).toBeCloseTo(1 / 3, 6);
    expect(agent1.avgTimeToSubmitSec).toBeCloseTo(140 / 3, 6);

    const agent2 = indexer.getAgentMetrics(2);
    expect(agent2.postedCount).toBe(1);
    expect(agent2.acceptedCount).toBe(0);
    expect(agent2.submittedCount).toBe(0);
    expect(agent2.disputeCount).toBe(0);
    expect(agent2.settledCount).toBe(0);
    expect(agent2.autoReleaseCount).toBe(0);
    expect(agent2.cancelCount).toBe(1);
    expect(agent2.acceptRate).toBe(0);
    expect(agent2.disputeRate).toBe(0);
    expect(agent2.silentAutoReleaseFrequency).toBe(0);
    expect(agent2.avgTimeToSubmitSec).toBe(0);

    const listingsActive = indexer.getListings({ active: true });
    expect(listingsActive).toHaveLength(1);
    expect(listingsActive[0]?.listingId).toBe(1);

    const listingsAgent2 = indexer.getListings({ agentId: 2 });
    expect(listingsAgent2).toHaveLength(1);
    expect(listingsAgent2[0]?.listingURI).toBe("ipfs://listing-2-updated");

    const tasksAgent1 = indexer.getTasksByAgent(1);
    expect(tasksAgent1.map((task) => task.taskId)).toEqual([1, 2, 3]);
  });

  it("persists listing curation outputs", () => {
    const indexer = new Indexer();
    indexer.ingest([
      {
        type: "ListingCreated",
        blockNumber: 1,
        logIndex: 0,
        timestamp: 10,
        listingId: 99,
        agentId: 9,
        listingURI: "ipfs://listing-99",
        pricing: {
          paymentToken: "0xToken",
          basePrice: 100,
          unitType: "LOC",
          unitPrice: 10,
          minUnits: 1,
          maxUnits: 100,
          quoteRequired: false
        },
        policy: {
          challengeWindowSec: 3600,
          postDisputeWindowSec: 0,
          sellerBondBps: 0
        },
        active: true
      }
    ]);

    const curation: ListingCuration = {
      updatedAt: 1234,
      badges: {
        metadata_validated: true,
        endpoint_verified: false,
        probe_passed: true
      },
      riskScore: 42,
      probeScore: 0.8,
      probeEvidenceURI: "fixtures/probe.json",
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
        checkedAt: 1234
      }
    };

    indexer.setListingCuration(99, curation);
    const listing = indexer.getListings({ listingIds: [99] })[0];
    expect(listing?.curation).toEqual(curation);
  });
});
