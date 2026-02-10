import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const TASK_URI = "ipfs://task-1";
const ARTIFACT_URI = "ipfs://artifact-1";
const ARTIFACT_HASH = ethers.keccak256(ethers.toUtf8Bytes("artifact"));

const pricingTemplate = {
  paymentToken: ethers.ZeroAddress,
  basePrice: 100n,
  unitType: ethers.keccak256(ethers.toUtf8Bytes("LOC")),
  unitPrice: 10n,
  minUnits: 1,
  maxUnits: 10,
  quoteRequired: false
};

const policyTemplate = {
  challengeWindowSec: 3600,
  postDisputeWindowSec: 0,
  sellerBondBps: 0
};

describe("TaskMarket", function () {
  async function deployFixture() {
    const [owner, buyer, agent, other] = await ethers.getSigners();

    const AgentIdentityRegistry = await ethers.getContractFactory("AgentIdentityRegistry");
    const identity = await AgentIdentityRegistry.deploy();

    const ListingRegistry = await ethers.getContractFactory("ListingRegistry");
    const listingRegistry = await ListingRegistry.deploy(identity.target);

    const TaskMarket = await ethers.getContractFactory("TaskMarket");
    const taskMarket = await TaskMarket.deploy(listingRegistry.target, identity.target);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USD", "mUSD");

    await identity.connect(agent).registerAgent("ipfs://agent-1");

    return { owner, buyer, agent, other, identity, listingRegistry, taskMarket, token };
  }

  async function createListing(listingRegistry: any, agent: any, tokenAddress: string, overrides?: Partial<typeof pricingTemplate>) {
    const pricing = { ...pricingTemplate, paymentToken: tokenAddress, ...overrides };
    const policy = { ...policyTemplate };
    await listingRegistry.connect(agent).createListing(1, "ipfs://listing-1", pricing, policy);
    return { pricing, policy };
  }

  it("runs happy path quote -> fund -> accept -> submit -> settle", async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } = await deployFixture();
    const { pricing } = await createListing(listingRegistry, agent, token.target, { quoteRequired: true });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
    const quotedTotalPrice = pricing.basePrice + 4n * pricing.unitPrice;
    const now = await time.latest();
    await taskMarket.connect(agent).proposeQuote(1, 4, quotedTotalPrice, now + 3600);

    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket.connect(agent).submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await taskMarket.connect(buyer).acceptSubmission(1);

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(5);

    const buyerBalance = await token.balanceOf(buyer.address);
    const agentBalance = await token.balanceOf(agent.address);
    const contractBalance = await token.balanceOf(taskMarket.target);

    expect(buyerBalance).to.equal(10_000n - quotedTotalPrice);
    expect(agentBalance).to.equal(quotedTotalPrice);
    expect(contractBalance).to.equal(0n);
  });

  it("supports implicit accept flow when quote not required", async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } = await deployFixture();
    const { pricing } = await createListing(listingRegistry, agent, token.target, { quoteRequired: false });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 3);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    const expectedTotal = pricing.basePrice + 3n * pricing.unitPrice;
    expect(task.quotedTotalPrice).to.equal(expectedTotal);

    await token.connect(buyer).approve(taskMarket.target, expectedTotal);
    await taskMarket.connect(buyer).fundTask(1, expectedTotal);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket.connect(agent).submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await taskMarket.connect(buyer).acceptSubmission(1);

    const settled = await taskMarket.getTask(1);
    expect(settled.status).to.equal(5);
  });

  it("allows cancellation in OPEN or QUOTED and blocks later", async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, { quoteRequired: true });

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(buyer).cancelTask(1);

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(6);

    await taskMarket.connect(buyer).postTask(1, "ipfs://task-2", 2);
    await taskMarket.connect(agent).proposeQuote(2, 2, 250n, 0);
    await taskMarket.connect(buyer).cancelTask(2);
    const task2 = await taskMarket.getTask(2);
    expect(task2.status).to.equal(6);

    await taskMarket.connect(buyer).postTask(1, "ipfs://task-3", 2);
    await taskMarket.connect(agent).proposeQuote(3, 2, 250n, 0);
    await token.mint(buyer.address, 500n);
    await token.connect(buyer).approve(taskMarket.target, 250n);
    await taskMarket.connect(buyer).fundTask(3, 250n);
    await taskMarket.connect(buyer).acceptQuote(3);
    await expect(taskMarket.connect(buyer).cancelTask(3)).to.be.revertedWith("TaskMarket: cannot cancel");
  });

  it("settles after challenge window timeout", async function () {
    const { buyer, agent, listingRegistry, taskMarket, token, other } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, { quoteRequired: false });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token.connect(buyer).approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket.connect(agent).submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await time.increase(policyTemplate.challengeWindowSec + 1);
    await taskMarket.connect(other).settleAfterTimeout(1);

    const settled = await taskMarket.getTask(1);
    expect(settled.status).to.equal(5);
  });

  it("rejects invalid transitions and unauthorized calls", async function () {
    const { buyer, agent, other, listingRegistry, taskMarket, token } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, { quoteRequired: true });

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await expect(taskMarket.connect(other).proposeQuote(1, 1, 100n, 0)).to.be.revertedWith(
      "TaskMarket: not authorized"
    );

    await taskMarket.connect(agent).proposeQuote(1, 1, 100n, 0);
    await expect(taskMarket.connect(other).acceptQuote(1)).to.be.revertedWith("TaskMarket: buyer only");

    await token.mint(buyer.address, 500n);
    await token.connect(buyer).approve(taskMarket.target, 50n);
    await expect(taskMarket.connect(buyer).fundTask(1, 50n)).to.be.revertedWith("TaskMarket: amount mismatch");

    await token.connect(buyer).approve(taskMarket.target, 100n);
    await taskMarket.connect(buyer).fundTask(1, 100n);
    await taskMarket.connect(buyer).acceptQuote(1);

    await expect(taskMarket.connect(buyer).acceptQuote(1)).to.be.revertedWith("TaskMarket: not quoted");
    await expect(taskMarket.connect(other).submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH)).to.be.revertedWith(
      "TaskMarket: not authorized"
    );
  });
});
