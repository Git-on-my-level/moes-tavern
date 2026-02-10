import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { IndexerEvent, ListingCuration } from "../../indexer/src/indexer";

const TASK_URI = "ipfs://task-1";
const ARTIFACT_URI = "ipfs://artifact-1";
const ARTIFACT_HASH = ethers.keccak256(ethers.toUtf8Bytes("artifact"));

const listingMetadataById = new Map<number, { title: string; description: string; tags: string[] }>([
  [1, { title: "Agent build assistant", description: "Prototype build + QA support", tags: ["ai", "dev"] }],
  [2, { title: "Prompt review", description: "Review prompts for clarity", tags: ["review", "prompt"] }]
]);

const toNumber = (value: bigint | number | string) => Number(value);

const dynamicImport = (modulePath: string) =>
  new Function("modulePath", "return import(modulePath);")(
    pathToFileURL(modulePath).href
  ) as Promise<any>;

async function main() {
  const { Indexer } = await dynamicImport(
    path.resolve(__dirname, "../../indexer/src/indexer.ts")
  );
  const {
    checkEndpoints,
    computeCurationBadges,
    computeRiskScore,
    lintListingMetadata,
    runProbeFixture
  } = await dynamicImport(path.resolve(__dirname, "../../curation/src/curation.ts"));

  const [owner, buyer, agent, other] = await ethers.getSigners();

  const AgentIdentityRegistry = await ethers.getContractFactory("AgentIdentityRegistry");
  const identity = await AgentIdentityRegistry.deploy();
  await identity.waitForDeployment();

  const ListingRegistry = await ethers.getContractFactory("ListingRegistry");
  const listingRegistry = await ListingRegistry.deploy(identity.target);
  await listingRegistry.waitForDeployment();

  const TaskMarket = await ethers.getContractFactory("TaskMarket");
  const taskMarket = await TaskMarket.deploy(listingRegistry.target, identity.target);
  await taskMarket.waitForDeployment();

  const DisputeModule = await ethers.getContractFactory("DisputeModule");
  const disputeModule = await DisputeModule.deploy(taskMarket.target, []);
  await disputeModule.waitForDeployment();
  await taskMarket.setDisputeModule(disputeModule.target);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Mock USD", "mUSD");
  await token.waitForDeployment();

  await identity.connect(agent).registerAgent("ipfs://agent-1");

  const pricingBase = {
    paymentToken: token.target,
    basePrice: 100n,
    unitType: ethers.keccak256(ethers.toUtf8Bytes("LOC")),
    unitPrice: 10n,
    minUnits: 1,
    maxUnits: 10,
    quoteRequired: true
  };

  const policyBase = {
    challengeWindowSec: 10,
    postDisputeWindowSec: 0,
    sellerBondBps: 0
  };

  await listingRegistry.connect(agent).createListing(1, "ipfs://listing-1", pricingBase, policyBase);
  await listingRegistry
    .connect(agent)
    .createListing(1, "ipfs://listing-2", { ...pricingBase, quoteRequired: false }, policyBase);

  await token.mint(buyer.address, 10_000n);

  await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
  const quotedTotalPrice = pricingBase.basePrice + 4n * pricingBase.unitPrice;
  const now = await time.latest();
  await taskMarket.connect(agent).proposeQuote(1, 4, quotedTotalPrice, now + 3600);

  await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
  await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);
  await taskMarket.connect(buyer).acceptQuote(1);

  await taskMarket.connect(agent).submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
  await time.increase(policyBase.challengeWindowSec + 1);
  await taskMarket.connect(other).settleAfterTimeout(1);

  const settledLogs = await taskMarket.queryFilter(taskMarket.filters.TaskSettled(1));
  assert.equal(settledLogs.length, 1, "escrow should settle exactly once");

  const buyerBalance = await token.balanceOf(buyer.address);
  const agentBalance = await token.balanceOf(agent.address);
  const contractBalance = await token.balanceOf(taskMarket.target);
  assert.equal(buyerBalance, 10_000n - quotedTotalPrice, "buyer balance should reflect escrow payout");
  assert.equal(agentBalance, quotedTotalPrice, "agent should receive payout");
  assert.equal(contractBalance, 0n, "escrow contract balance should be zero");

  const provider = ethers.provider;
  const blockTimestamps = new Map<number, number>();
  const getTimestamp = async (blockNumber: number) => {
    const cached = blockTimestamps.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await provider.getBlock(blockNumber);
    assert.ok(block, `missing block ${blockNumber}`);
    blockTimestamps.set(blockNumber, block.timestamp);
    return block.timestamp;
  };

  const toBase = async (log: { blockNumber: number; index?: number; logIndex?: number }) => {
    const timestamp = await getTimestamp(log.blockNumber);
    return {
      blockNumber: log.blockNumber,
      logIndex: log.index ?? log.logIndex ?? 0,
      timestamp
    };
  };

  const events: IndexerEvent[] = [];
  const listingCreatedLogs = await listingRegistry.queryFilter(listingRegistry.filters.ListingCreated());
  for (const log of listingCreatedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "ListingCreated",
      listingId: toNumber(args.listingId),
      agentId: toNumber(args.agentId),
      listingURI: args.listingURI,
      pricing: {
        paymentToken: args.paymentToken,
        basePrice: toNumber(args.basePrice),
        unitType: args.unitType,
        unitPrice: toNumber(args.unitPrice),
        minUnits: toNumber(args.minUnits),
        maxUnits: toNumber(args.maxUnits),
        quoteRequired: args.quoteRequired
      },
      policy: {
        challengeWindowSec: toNumber(args.challengeWindowSec),
        postDisputeWindowSec: toNumber(args.postDisputeWindowSec),
        sellerBondBps: toNumber(args.sellerBondBps)
      },
      active: args.active,
      ...base
    });
  }

  const listingUpdatedLogs = await listingRegistry.queryFilter(listingRegistry.filters.ListingUpdated());
  for (const log of listingUpdatedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "ListingUpdated",
      listingId: toNumber(args.listingId),
      agentId: toNumber(args.agentId),
      listingURI: args.listingURI,
      active: args.active,
      ...base
    });
  }

  const taskPostedLogs = await taskMarket.queryFilter(taskMarket.filters.TaskPosted());
  for (const log of taskPostedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "TaskPosted",
      taskId: toNumber(args.taskId),
      listingId: toNumber(args.listingId),
      agentId: toNumber(args.agentId),
      buyer: args.buyer,
      taskURI: args.taskURI,
      proposedUnits: toNumber(args.proposedUnits),
      ...base
    });
  }

  const quoteProposedLogs = await taskMarket.queryFilter(taskMarket.filters.QuoteProposed());
  for (const log of quoteProposedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "QuoteProposed",
      taskId: toNumber(args.taskId),
      quotedUnits: toNumber(args.quotedUnits),
      quotedTotalPrice: toNumber(args.quotedTotalPrice),
      expiry: toNumber(args.expiry),
      ...base
    });
  }

  const quoteAcceptedLogs = await taskMarket.queryFilter(taskMarket.filters.QuoteAccepted());
  for (const log of quoteAcceptedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({ type: "QuoteAccepted", taskId: toNumber(args.taskId), ...base });
  }

  const taskFundedLogs = await taskMarket.queryFilter(taskMarket.filters.TaskFunded());
  for (const log of taskFundedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({ type: "TaskFunded", taskId: toNumber(args.taskId), amount: toNumber(args.amount), ...base });
  }

  const taskAcceptedLogs = await taskMarket.queryFilter(taskMarket.filters.TaskAccepted());
  for (const log of taskAcceptedLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({ type: "TaskAccepted", taskId: toNumber(args.taskId), ...base });
  }

  const deliverableLogs = await taskMarket.queryFilter(taskMarket.filters.DeliverableSubmitted());
  for (const log of deliverableLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "DeliverableSubmitted",
      taskId: toNumber(args.taskId),
      artifactURI: args.artifactURI,
      artifactHash: args.artifactHash,
      ...base
    });
  }

  const settledTaskLogs = await taskMarket.queryFilter(taskMarket.filters.TaskSettled());
  for (const log of settledTaskLogs) {
    const base = await toBase(log);
    const args = log.args;
    if (!args) continue;
    events.push({
      type: "TaskSettled",
      taskId: toNumber(args.taskId),
      buyerPayout: toNumber(args.buyerPayout),
      sellerBondRefund: toNumber(args.sellerBondRefund),
      ...base
    });
  }

  const indexer = new Indexer();
  indexer.ingest(events);

  const listings = indexer.getListings();
  assert.equal(listings.length, 2, "indexer should ingest listings");

  const latestBlock = await provider.getBlock("latest");
  const nowMs = (latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  const probeFixturePath = path.resolve(__dirname, "../../curation/test/fixtures/probe-pass.json");
  const probe = await runProbeFixture(probeFixturePath);
  const endpointReport = await checkEndpoints([]);

  for (const listing of listings) {
    const metadata = listingMetadataById.get(listing.listingId);
    assert.ok(metadata, `missing metadata for listing ${listing.listingId}`);
    const lint = lintListingMetadata(metadata);
    const badges = computeCurationBadges(lint, endpointReport, probe.probeScore);
    const metrics = indexer.getAgentMetrics(listing.agentId);
    const riskScore = computeRiskScore({
      nowMs,
      createdAtMs: listing.createdAt ? listing.createdAt * 1000 : null,
      probeScore: probe.probeScore,
      disputeRate: metrics.disputeRate,
      silentAutoReleaseFrequency: metrics.silentAutoReleaseFrequency
    });

    const curation: ListingCuration = {
      updatedAt: nowMs,
      badges,
      riskScore,
      probeScore: probe.probeScore,
      probeEvidenceURI: probe.probeEvidenceURI,
      lint,
      endpointHealth: {
        total: endpointReport.total,
        okCount: endpointReport.okCount,
        failedCount: endpointReport.failedCount,
        checkedAt: endpointReport.checkedAt
      }
    };
    indexer.setListingCuration(listing.listingId, curation);
  }

  const curatedListings = indexer.getListings();
  assert.ok(
    curatedListings.every((listing) => listing.curation && listing.curation.badges),
    "curation badges should exist for listings"
  );

  const tasksByAgent = indexer.getTasksByAgent(1);
  assert.equal(tasksByAgent.length, 1, "indexer should ingest task events");
  const task = tasksByAgent[0];
  assert.equal(task.status, "SETTLED", "task should settle via timeout");

  const metrics = indexer.getAgentMetrics(1);
  console.log(
    "demo:smoke summary",
    JSON.stringify(
      {
        listingIds: curatedListings.map((listing) => listing.listingId),
        taskId: task.taskId,
        settlement: task.status,
        agentMetrics: metrics
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
