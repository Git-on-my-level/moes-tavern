import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import type { Contract, Signer } from 'ethers';

const TASK_URI = 'ipfs://task-1';
const ARTIFACT_URI = 'ipfs://artifact-1';
const ARTIFACT_HASH = ethers.keccak256(ethers.toUtf8Bytes('artifact'));

const pricingTemplate = {
  paymentToken: ethers.ZeroAddress,
  basePrice: 100n,
  unitType: ethers.keccak256(ethers.toUtf8Bytes('LOC')),
  unitPrice: 10n,
  minUnits: 1,
  maxUnits: 10,
  quoteRequired: false,
};

const policyTemplate = {
  challengeWindowSec: 3600,
  postDisputeWindowSec: 0,
  sellerBondBps: 0,
};

describe('TaskMarket', function () {
  async function deployFixture() {
    const [owner, buyer, agent, other] = await ethers.getSigners();

    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const identity = await AgentIdentityRegistry.deploy();

    const ListingRegistry = await ethers.getContractFactory('ListingRegistry');
    const listingRegistry = await ListingRegistry.deploy(identity.target);

    const TaskMarket = await ethers.getContractFactory('TaskMarket');
    const taskMarket = await TaskMarket.deploy(
      listingRegistry.target,
      identity.target,
    );

    const DisputeModule = await ethers.getContractFactory('DisputeModule');
    const disputeModule = await DisputeModule.deploy(taskMarket.target, []);
    await taskMarket.setDisputeModule(disputeModule.target);

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const token = await MockERC20.deploy('Mock USD', 'mUSD');

    await identity.connect(agent).registerAgent('ipfs://agent-1');

    return {
      owner,
      buyer,
      agent,
      other,
      identity,
      listingRegistry,
      taskMarket,
      disputeModule,
      token,
    };
  }

  async function createListing(
    listingRegistry: Contract,
    agent: Signer,
    tokenAddress: string,
    overrides?: Partial<typeof pricingTemplate>,
    policyOverrides?: Partial<typeof policyTemplate>,
  ) {
    const pricing = {
      ...pricingTemplate,
      paymentToken: tokenAddress,
      ...overrides,
    };
    const policy = { ...policyTemplate, ...policyOverrides };
    await listingRegistry
      .connect(agent)
      .createListing(1, 'ipfs://listing-1', pricing, policy);
    return { pricing, policy };
  }

  it('runs happy path quote -> fund -> accept -> submit -> settle', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { pricing } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
    const quotedTotalPrice = pricing.basePrice + 4n * pricing.unitPrice;
    const now = await time.latest();
    await taskMarket
      .connect(agent)
      .proposeQuote(1, 4, quotedTotalPrice, now + 3600);

    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
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

  it('supports implicit accept flow when quote not required', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { pricing } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 3);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    const expectedTotal = pricing.basePrice + 3n * pricing.unitPrice;
    expect(task.quotedTotalPrice).to.equal(expectedTotal);

    await token.connect(buyer).approve(taskMarket.target, expectedTotal);
    await taskMarket.connect(buyer).fundTask(1, expectedTotal);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await taskMarket.connect(buyer).acceptSubmission(1);

    const settled = await taskMarket.getTask(1);
    expect(settled.status).to.equal(5);
  });

  it('allows cancellation in OPEN or QUOTED and blocks later', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: true,
    });

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(buyer).cancelTask(1);

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(6);

    await taskMarket.connect(buyer).postTask(1, 'ipfs://task-2', 2);
    await taskMarket.connect(agent).proposeQuote(2, 2, 250n, 0);
    await taskMarket.connect(buyer).cancelTask(2);
    const task2 = await taskMarket.getTask(2);
    expect(task2.status).to.equal(6);

    await taskMarket.connect(buyer).postTask(1, 'ipfs://task-3', 2);
    await taskMarket.connect(agent).proposeQuote(3, 2, 250n, 0);
    await token.mint(buyer.address, 500n);
    await token.connect(buyer).approve(taskMarket.target, 250n);
    await taskMarket.connect(buyer).fundTask(3, 250n);
    await taskMarket.connect(buyer).acceptQuote(3);
    await expect(taskMarket.connect(buyer).cancelTask(3)).to.be.revertedWith(
      'TaskMarket: cannot cancel',
    );
  });

  it('settles after challenge window timeout', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token, other } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: false,
    });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await time.increase(policyTemplate.challengeWindowSec + 1);
    await taskMarket.connect(other).settleAfterTimeout(1);

    const settled = await taskMarket.getTask(1);
    expect(settled.status).to.equal(5);
  });

  it('rejects invalid transitions and unauthorized calls', async function () {
    const { buyer, agent, other, listingRegistry, taskMarket, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: true,
    });

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await expect(
      taskMarket.connect(other).proposeQuote(1, 1, 100n, 0),
    ).to.be.revertedWith('TaskMarket: not authorized');

    await taskMarket.connect(agent).proposeQuote(1, 1, 100n, 0);
    await expect(taskMarket.connect(other).acceptQuote(1)).to.be.revertedWith(
      'TaskMarket: buyer only',
    );

    await token.mint(buyer.address, 500n);
    await token.connect(buyer).approve(taskMarket.target, 50n);
    await expect(taskMarket.connect(buyer).fundTask(1, 50n)).to.be.revertedWith(
      'TaskMarket: amount mismatch',
    );

    await token.connect(buyer).approve(taskMarket.target, 100n);
    await taskMarket.connect(buyer).fundTask(1, 100n);
    await taskMarket.connect(buyer).acceptQuote(1);

    await expect(taskMarket.connect(buyer).acceptQuote(1)).to.be.revertedWith(
      'TaskMarket: not quoted',
    );
    await expect(
      taskMarket
        .connect(other)
        .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH),
    ).to.be.revertedWith('TaskMarket: not authorized');
  });

  it('enforces buyer-only dispute opening and resolver-only resolution', async function () {
    const {
      buyer,
      agent,
      other,
      listingRegistry,
      taskMarket,
      disputeModule,
      token,
    } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: false,
    });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);

    await expect(
      disputeModule.connect(other).openDispute(1, 'ipfs://dispute-1'),
    ).to.be.revertedWith('DisputeModule: buyer only');

    await disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-1');

    await expect(
      disputeModule.connect(other).resolveDispute(1, 0, 'ipfs://resolution-1'),
    ).to.be.revertedWith('DisputeModule: resolver only');
  });

  it('emits correct buyer in DisputeOpened event when opened via TaskMarket', async function () {
    const { buyer, agent, listingRegistry, taskMarket, disputeModule, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: false,
    });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);

    await expect(
      taskMarket
        .connect(buyer)
        .disputeSubmission(1, 'ipfs://dispute-via-taskmarket'),
    )
      .to.emit(disputeModule, 'DisputeOpened')
      .withArgs(1, buyer.address, 'ipfs://dispute-via-taskmarket');
  });

  it('splits escrow deterministically on SPLIT outcome', async function () {
    const {
      buyer,
      agent,
      listingRegistry,
      taskMarket,
      disputeModule,
      token,
      owner,
    } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: false,
    });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-2');

    await disputeModule.connect(owner).setResolver(owner.address, true);

    const buyerStart = await token.balanceOf(buyer.address);
    const agentStart = await token.balanceOf(agent.address);

    await disputeModule
      .connect(owner)
      .resolveDispute(1, 2, 'ipfs://resolution-2');

    const buyerEnd = await token.balanceOf(buyer.address);
    const agentEnd = await token.balanceOf(agent.address);

    const expectedBuyerPayout = task.quotedTotalPrice / 2n;
    const expectedSellerPayout = task.quotedTotalPrice - expectedBuyerPayout;

    expect(buyerEnd - buyerStart).to.equal(expectedBuyerPayout);
    expect(agentEnd - agentStart).to.equal(expectedSellerPayout);
  });

  it('slashes bond up to the locked amount on BUYER_WINS', async function () {
    const {
      buyer,
      agent,
      listingRegistry,
      taskMarket,
      disputeModule,
      token,
      owner,
    } = await deployFixture();
    const { policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
      { sellerBondBps: 5000 },
    );

    await token.mint(buyer.address, 10_000n);
    await token.mint(agent.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    const requiredBond =
      (task.quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(1, requiredBond);

    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-3');

    await disputeModule.connect(owner).setResolver(owner.address, true);

    const buyerStart = await token.balanceOf(buyer.address);
    const agentStart = await token.balanceOf(agent.address);

    await disputeModule
      .connect(owner)
      .resolveDispute(1, 1, 'ipfs://resolution-3');

    const buyerEnd = await token.balanceOf(buyer.address);
    const agentEnd = await token.balanceOf(agent.address);

    const expectedBuyerPayout = task.quotedTotalPrice + requiredBond;
    expect(buyerEnd - buyerStart).to.equal(expectedBuyerPayout);
    expect(agentEnd - agentStart).to.equal(0n);
  });

  it('allows acceptQuote after expiry when funded before expiry', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { pricing } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
    const quotedTotalPrice = pricing.basePrice + 4n * pricing.unitPrice;
    const now = await time.latest();
    await taskMarket
      .connect(agent)
      .proposeQuote(1, 4, quotedTotalPrice, now + 60);

    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);

    await time.increase(120);

    await taskMarket.connect(buyer).acceptQuote(1);

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(2);
  });

  it('blocks buyer funding until seller bond is funded when sellerBondBps > 0', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { pricing, policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
      { sellerBondBps: 2000 },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 5);
    const quotedTotalPrice = pricing.basePrice + 5n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 5, quotedTotalPrice, 0);

    const requiredBond =
      (quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await expect(
      taskMarket.connect(buyer).fundTask(1, quotedTotalPrice),
    ).to.be.revertedWith('TaskMarket: bond not funded');

    await token.mint(agent.address, requiredBond);
    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(1, requiredBond);

    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);

    const task = await taskMarket.getTask(1);
    expect(task.fundedAmount).to.equal(quotedTotalPrice);
    expect(task.sellerBond).to.equal(requiredBond);
  });

  it('refunds escrow and seller bond on cancellation in QUOTED', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { pricing, policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
      { sellerBondBps: 3000 },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 3);
    const quotedTotalPrice = pricing.basePrice + 3n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 3, quotedTotalPrice, 0);

    const requiredBond =
      (quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.mint(agent.address, requiredBond);
    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(1, requiredBond);

    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);

    const buyerBalanceBefore = await token.balanceOf(buyer.address);
    const agentBalanceBefore = await token.balanceOf(agent.address);

    await taskMarket.connect(buyer).cancelTask(1);

    const buyerBalanceAfter = await token.balanceOf(buyer.address);
    const agentBalanceAfter = await token.balanceOf(agent.address);
    const contractBalance = await token.balanceOf(taskMarket.target);

    expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(quotedTotalPrice);
    expect(agentBalanceAfter - agentBalanceBefore).to.equal(requiredBond);
    expect(contractBalance).to.equal(0n);

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(6);
  });
});
