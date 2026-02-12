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
  unitType: ethers.encodeBytes32String('LOC'),
  unitPrice: 10n,
  minUnits: 1,
  maxUnits: 10,
  quoteRequired: false,
};

const policyTemplate = {
  challengeWindowSec: 3600,
  postDisputeWindowSec: 0,
  deliveryWindowSec: 7200,
  sellerBondBps: 0,
  deliveryWindowSec: 86400,
};

describe('TaskMarket', function () {
  async function deployFixture() {
    const [owner, buyer, agent, other, operator] = await ethers.getSigners();

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
      operator,
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

  it('supports two-step ownership transfer for TaskMarket and DisputeModule admin controls', async function () {
    const { owner, other, taskMarket, disputeModule } = await deployFixture();

    const replacementDisputeModule = await (
      await ethers.getContractFactory('DisputeModule')
    ).deploy(taskMarket.target, []);

    await taskMarket.transferOwnership(other.address);
    await taskMarket.connect(other).acceptOwnership();
    expect(await taskMarket.owner()).to.equal(other.address);

    await expect(taskMarket.setDisputeModule(replacementDisputeModule.target))
      .to.be.revertedWithCustomError(taskMarket, 'OwnableUnauthorizedAccount')
      .withArgs(owner.address);

    await taskMarket.connect(other).setDisputeModule(replacementDisputeModule.target);
    await expect(taskMarket.connect(other).executeDisputeModuleUpdate()).to.be.revertedWith(
      'TaskMarket: update timelocked',
    );
    await time.increase(Number(await taskMarket.DISPUTE_MODULE_UPDATE_DELAY()) + 1);
    await taskMarket.connect(other).executeDisputeModuleUpdate();
    expect(await taskMarket.disputeModule()).to.equal(replacementDisputeModule.target);

    await disputeModule.transferOwnership(other.address);
    await disputeModule.connect(other).acceptOwnership();
    expect(await disputeModule.owner()).to.equal(other.address);

    await expect(disputeModule.connect(owner).setResolver(owner.address, true))
      .to.be.revertedWithCustomError(disputeModule, 'OwnableUnauthorizedAccount')
      .withArgs(owner.address);
    await disputeModule.connect(other).setResolver(other.address, true);
    expect(await disputeModule.resolvers(other.address)).to.equal(true);
  });

  it('schedules, cancels, and executes dispute module updates with delay', async function () {
    const { owner, taskMarket } = await deployFixture();
    const nextDisputeModule = await (
      await ethers.getContractFactory('DisputeModule')
    ).deploy(taskMarket.target, []);
    const replacementDisputeModule = await (
      await ethers.getContractFactory('DisputeModule')
    ).deploy(taskMarket.target, []);

    const currentDisputeModule = await taskMarket.disputeModule();
    const delay = Number(await taskMarket.DISPUTE_MODULE_UPDATE_DELAY());

    const scheduleTx = await taskMarket.setDisputeModule(nextDisputeModule.target);
    const scheduledActivation = BigInt((await time.latest()) + delay);
    await expect(scheduleTx)
      .to.emit(taskMarket, 'DisputeModuleUpdateScheduled')
      .withArgs(currentDisputeModule, nextDisputeModule.target, scheduledActivation);
    expect(await taskMarket.pendingDisputeModule()).to.equal(nextDisputeModule.target);
    expect(await taskMarket.pendingDisputeModuleActivationTime()).to.equal(
      scheduledActivation,
    );

    await expect(taskMarket.executeDisputeModuleUpdate()).to.be.revertedWith(
      'TaskMarket: update timelocked',
    );

    await expect(taskMarket.cancelDisputeModuleUpdate())
      .to.emit(taskMarket, 'DisputeModuleUpdateCancelled')
      .withArgs(nextDisputeModule.target);
    expect(await taskMarket.pendingDisputeModule()).to.equal(ethers.ZeroAddress);
    expect(await taskMarket.pendingDisputeModuleActivationTime()).to.equal(0);

    await expect(taskMarket.executeDisputeModuleUpdate()).to.be.revertedWith(
      'TaskMarket: no pending update',
    );

    const rescheduleTx = await taskMarket.setDisputeModule(replacementDisputeModule.target);
    const rescheduledActivation = BigInt((await time.latest()) + delay);
    await expect(rescheduleTx)
      .to.emit(taskMarket, 'DisputeModuleUpdateScheduled')
      .withArgs(currentDisputeModule, replacementDisputeModule.target, rescheduledActivation);

    await time.increase(delay + 1);
    await expect(taskMarket.executeDisputeModuleUpdate())
      .to.emit(taskMarket, 'DisputeModuleUpdated')
      .withArgs(currentDisputeModule, replacementDisputeModule.target);
    expect(await taskMarket.disputeModule()).to.equal(replacementDisputeModule.target);
    expect(await taskMarket.pendingDisputeModule()).to.equal(ethers.ZeroAddress);

    await expect(taskMarket.connect(owner).cancelDisputeModuleUpdate()).to.be.revertedWith(
      'TaskMarket: no pending update',
    );
  });

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

    const settleTx = await taskMarket.connect(buyer).acceptSubmission(1);

    await expect(settleTx)
      .to.emit(taskMarket, 'TaskSettledV2')
      .withArgs(
        1,
        buyer.address,
        agent.address,
        ethers.ZeroAddress,
        0,
        0,
        quotedTotalPrice,
        0,
        0,
      );

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
    ).to.be.revertedWith('TaskMarket: seller only');
  });

  it('snapshots seller on acceptQuote; transfer does not change submitter or payout', async function () {
    const {
      buyer,
      agent,
      other,
      identity,
      listingRegistry,
      taskMarket,
      token,
    } = await deployFixture();
    await createListing(listingRegistry, agent, token.target, {
      quoteRequired: false,
    });

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(agent).acceptTask(1);

    const quoted = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, quoted.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quoted.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    const active = await taskMarket.getTask(1);
    expect(active.seller).to.equal(agent.address);

    await identity
      .connect(agent)['safeTransferFrom(address,address,uint256)'](
        agent.address,
        other.address,
        1,
      );

    await expect(
      taskMarket
        .connect(other)
        .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH),
    ).to.be.revertedWith('TaskMarket: seller only');

    const agentBalanceBefore = await token.balanceOf(agent.address);
    const newOwnerBalanceBefore = await token.balanceOf(other.address);

    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);
    await taskMarket.connect(buyer).acceptSubmission(1);

    const agentBalanceAfter = await token.balanceOf(agent.address);
    const newOwnerBalanceAfter = await token.balanceOf(other.address);

    expect(agentBalanceAfter - agentBalanceBefore).to.equal(
      quoted.quotedTotalPrice,
    );
    expect(newOwnerBalanceAfter - newOwnerBalanceBefore).to.equal(0n);
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

  it('resolves an in-flight dispute after dispute module upgrade', async function () {
    const {
      owner,
      buyer,
      agent,
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

    const quotedTask = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, quotedTask.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTask.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);
    await taskMarket
      .connect(agent)
      .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH);

    await disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-upgrade');
    expect((await taskMarket.getTask(1)).status).to.equal(4);

    const DisputeModule = await ethers.getContractFactory('DisputeModule');
    const disputeModuleV2 = await DisputeModule.deploy(taskMarket.target, []);
    await disputeModuleV2.connect(owner).setResolver(owner.address, true);

    await taskMarket.connect(owner).setDisputeModule(disputeModuleV2.target);
    const delay = await taskMarket.DISPUTE_MODULE_UPDATE_DELAY();
    await time.increase(Number(delay) + 1);
    await taskMarket.connect(owner).executeDisputeModuleUpdate();

    const buyerBefore = await token.balanceOf(buyer.address);
    const agentBefore = await token.balanceOf(agent.address);

    await disputeModuleV2
      .connect(owner)
      .resolveDispute(1, 1, 'ipfs://resolution-upgrade');

    const buyerAfter = await token.balanceOf(buyer.address);
    const agentAfter = await token.balanceOf(agent.address);
    const settledTask = await taskMarket.getTask(1);
    const disputeRecord = await disputeModuleV2.disputes(1);

    expect(settledTask.status).to.equal(5);
    expect(disputeRecord.opened).to.equal(true);
    expect(disputeRecord.buyer).to.equal(buyer.address);
    expect(buyerAfter - buyerBefore).to.equal(quotedTask.quotedTotalPrice);
    expect(agentAfter - agentBefore).to.equal(0n);
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

  it('settles disputed tasks after post-dispute timeout with seller-win default, bond goes to bond funder', async function () {
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
      { postDisputeWindowSec: 300, sellerBondBps: 2500 },
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
    await disputeModule
      .connect(buyer)
      .openDispute(1, 'ipfs://dispute-timeout-1');

    const disputed = await taskMarket.getTask(1);
    expect(disputed.status).to.equal(4);
    expect(disputed.disputedAt).to.not.equal(0n);

    await expect(
      taskMarket.connect(owner).settleAfterPostDisputeTimeout(1),
    ).to.be.revertedWith('TaskMarket: post-dispute window');

    await time.increase(policy.postDisputeWindowSec + 1);

    const buyerStart = await token.balanceOf(buyer.address);
    const agentStart = await token.balanceOf(agent.address);
    const deadline =
      BigInt(disputed.disputedAt) + BigInt(policy.postDisputeWindowSec);

    await expect(taskMarket.connect(owner).settleAfterPostDisputeTimeout(1))
      .to.emit(taskMarket, 'PostDisputeTimeoutSettled')
      .withArgs(1, deadline, 0);

    const settled = await taskMarket.getTask(1);
    expect(settled.status).to.equal(5);
    expect(settled.settled).to.equal(true);
    expect(settled.bondFunder).to.equal(agent.address);

    const buyerEnd = await token.balanceOf(buyer.address);
    const agentEnd = await token.balanceOf(agent.address);

    expect(buyerEnd - buyerStart).to.equal(0n);
    expect(agentEnd - agentStart).to.equal(
      task.quotedTotalPrice + requiredBond,
    );

    await disputeModule.connect(owner).setResolver(owner.address, true);
    await expect(
      disputeModule
        .connect(owner)
        .resolveDispute(1, 1, 'ipfs://resolution-timeout-1'),
    ).to.be.revertedWith('TaskMarket: not disputed');
    await expect(
      taskMarket.connect(owner).settleAfterPostDisputeTimeout(1),
    ).to.be.revertedWith('TaskMarket: not disputed');
    await expect(
      taskMarket.connect(owner).settleAfterTimeout(1),
    ).to.be.revertedWith('TaskMarket: not submitted');
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

  it('rejects fundTask when payment token is fee-on-transfer', async function () {
    const { buyer, agent, listingRegistry, taskMarket } = await deployFixture();
    const FeeOnTransferERC20 =
      await ethers.getContractFactory('FeeOnTransferERC20');
    const feeToken = await FeeOnTransferERC20.deploy('Fee USD', 'fUSD', 100);
    const { pricing } = await createListing(
      listingRegistry,
      agent,
      feeToken.target,
      { quoteRequired: true },
    );

    await feeToken.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 5);
    const quotedTotalPrice = pricing.basePrice + 5n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 5, quotedTotalPrice, 0);

    await feeToken.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await expect(
      taskMarket.connect(buyer).fundTask(1, quotedTotalPrice),
    ).to.be.revertedWith('TaskMarket: fee-on-transfer unsupported');
  });

  it('rejects fundSellerBond when payment token is fee-on-transfer', async function () {
    const { buyer, agent, listingRegistry, taskMarket } = await deployFixture();
    const FeeOnTransferERC20 =
      await ethers.getContractFactory('FeeOnTransferERC20');
    const feeToken = await FeeOnTransferERC20.deploy('Fee USD', 'fUSD', 5000);
    const { pricing, policy } = await createListing(
      listingRegistry,
      agent,
      feeToken.target,
      { quoteRequired: true },
      { sellerBondBps: 2000 },
    );

    await feeToken.mint(buyer.address, 10_000n);
    await feeToken.mint(agent.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 5);
    const quotedTotalPrice = pricing.basePrice + 5n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 5, quotedTotalPrice, 0);

    const requiredBond =
      (quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;
    await feeToken.connect(agent).approve(taskMarket.target, requiredBond);
    await expect(
      taskMarket.connect(agent).fundSellerBond(1, requiredBond),
    ).to.be.revertedWith('TaskMarket: fee-on-transfer unsupported');
  });

  it('refunds escrow and seller bond to bond funder on cancellation in QUOTED', async function () {
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
    expect(task.bondFunder).to.equal(agent.address);
  });

  it('allows buyer to cancel ACTIVE task for non-delivery after deadline and claim bond', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
      { sellerBondBps: 2500, deliveryWindowSec: 120 },
    );

    await token.mint(buyer.address, 10_000n);
    await token.mint(agent.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 4);
    await taskMarket.connect(agent).acceptTask(1);

    const activeTask = await taskMarket.getTask(1);
    const requiredBond =
      (activeTask.quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(1, requiredBond);

    await token
      .connect(buyer)
      .approve(taskMarket.target, activeTask.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, activeTask.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    await expect(
      taskMarket.connect(buyer).cancelForNonDelivery(1),
    ).to.be.revertedWith('TaskMarket: delivery window');

    await time.increase(policy.deliveryWindowSec + 1);

    const buyerBalanceBefore = await token.balanceOf(buyer.address);
    const cancelTx = taskMarket.connect(buyer).cancelForNonDelivery(1);
    await expect(cancelTx)
      .to.emit(taskMarket, 'TaskCancelledForNonDelivery')
      .withArgs(1, activeTask.quotedTotalPrice, requiredBond);

    const buyerBalanceAfter = await token.balanceOf(buyer.address);
    expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(
      activeTask.quotedTotalPrice + requiredBond,
    );

    const task = await taskMarket.getTask(1);
    expect(task.status).to.equal(6);
    expect(task.settled).to.equal(true);
    expect(task.fundedAmount).to.equal(0n);
    expect(task.sellerBond).to.equal(0n);

    await expect(
      taskMarket.connect(buyer).cancelForNonDelivery(1),
    ).to.be.revertedWith('TaskMarket: not active');

    await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
      { sellerBondBps: 0, deliveryWindowSec: 120 },
    );

    await taskMarket.connect(buyer).postTask(2, 'ipfs://task-2', 2);
    await taskMarket.connect(agent).acceptTask(2);
    const secondTask = await taskMarket.getTask(2);
    await token
      .connect(buyer)
      .approve(taskMarket.target, secondTask.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(2, secondTask.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(2);
    await taskMarket
      .connect(agent)
      .submitDeliverable(2, ARTIFACT_URI, ARTIFACT_HASH);
    await time.increase(policy.deliveryWindowSec + 1);
    await expect(
      taskMarket.connect(buyer).cancelForNonDelivery(2),
    ).to.be.revertedWith('TaskMarket: not active');
  });

  it('allows seller to cancel quote and recover bond to bond funder when buyer never funds', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token, other } =
      await deployFixture();
    const { pricing, policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
      { sellerBondBps: 2000 },
    );

    await token.mint(agent.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 5);
    const quotedTotalPrice = pricing.basePrice + 5n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 5, quotedTotalPrice, 0);

    const requiredBond =
      (quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(1, requiredBond);

    await token.mint(buyer.address, 10_000n);
    await token.connect(buyer).approve(taskMarket.target, quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, quotedTotalPrice);

    await expect(
      taskMarket.connect(agent).sellerCancelQuote(1),
    ).to.be.revertedWith('TaskMarket: task funded');

    await taskMarket.connect(buyer).cancelTask(1);

    await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
      { sellerBondBps: 2000 },
    );

    await taskMarket.connect(buyer).postTask(2, 'ipfs://task-2', 5);
    await taskMarket.connect(agent).proposeQuote(2, 5, quotedTotalPrice, 0);

    await token.connect(agent).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(agent).fundSellerBond(2, requiredBond);

    const agentBalanceBefore = await token.balanceOf(agent.address);

    await expect(
      taskMarket.connect(other).sellerCancelQuote(2),
    ).to.be.revertedWith('TaskMarket: not authorized');

    await expect(taskMarket.connect(agent).sellerCancelQuote(2))
      .to.emit(taskMarket, 'TaskCancelled')
      .withArgs(2)
      .and.to.emit(taskMarket, 'SellerCancelledQuote')
      .withArgs(2, requiredBond);

    const agentBalanceAfter = await token.balanceOf(agent.address);
    expect(agentBalanceAfter - agentBalanceBefore).to.equal(requiredBond);

    const task = await taskMarket.getTask(2);
    expect(task.status).to.equal(6);
    expect(task.sellerBond).to.equal(0n);
    expect(task.bondFunder).to.equal(agent.address);
    expect(task.quotedUnits).to.equal(0);
    expect(task.quotedTotalPrice).to.equal(0n);
    expect(task.quoteExpiry).to.equal(0);

    await expect(
      taskMarket.connect(agent).sellerCancelQuote(2),
    ).to.be.revertedWith('TaskMarket: not quoted');
  });

  it('blocks opening dispute after challenge window expires', async function () {
    const { buyer, agent, listingRegistry, taskMarket, disputeModule, token } =
      await deployFixture();
    const { policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
      { challengeWindowSec: 3600 },
    );

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

    await time.increase(policy.challengeWindowSec);

    await expect(
      disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-expired'),
    ).to.be.revertedWith('DisputeModule: challenge window expired');

    await expect(
      taskMarket
        .connect(buyer)
        .disputeSubmission(1, 'ipfs://dispute-expired-via-market'),
    ).to.be.revertedWith('DisputeModule: challenge window expired');
  });

  it('refunds bond to operator when operator funds bond and buyer cancels task', async function () {
    const {
      buyer,
      agent,
      operator,
      identity,
      listingRegistry,
      taskMarket,
      token,
    } = await deployFixture();
    const { pricing, policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: true },
      { sellerBondBps: 2000 },
    );

    await token.mint(buyer.address, 10_000n);
    await token.mint(operator.address, 10_000n);

    await identity.connect(agent).approve(operator.address, 1);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 3);
    const quotedTotalPrice = pricing.basePrice + 3n * pricing.unitPrice;
    await taskMarket.connect(agent).proposeQuote(1, 3, quotedTotalPrice, 0);

    const requiredBond =
      (quotedTotalPrice * BigInt(policy.sellerBondBps)) / 10_000n;

    await token.connect(operator).approve(taskMarket.target, requiredBond);
    await taskMarket.connect(operator).fundSellerBond(1, requiredBond);

    const task = await taskMarket.getTask(1);
    expect(task.bondFunder).to.equal(operator.address);

    const operatorBalanceBefore = await token.balanceOf(operator.address);
    const agentBalanceBefore = await token.balanceOf(agent.address);

    await taskMarket.connect(buyer).cancelTask(1);

    const operatorBalanceAfter = await token.balanceOf(operator.address);
    const agentBalanceAfter = await token.balanceOf(agent.address);

    expect(operatorBalanceAfter - operatorBalanceBefore).to.equal(requiredBond);
    expect(agentBalanceAfter - agentBalanceBefore).to.equal(0n);

    const cancelled = await taskMarket.getTask(1);
    expect(cancelled.status).to.equal(6);
  });

  it('rejects postTask with URI exceeding MAX_URI_LENGTH', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target);

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      taskMarket.connect(buyer).postTask(1, longURI, 2),
    ).to.be.revertedWith('TaskMarket: URI too long');
  });

  it('rejects submitDeliverable with URI exceeding MAX_URI_LENGTH', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target);

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 2);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      taskMarket.connect(agent).submitDeliverable(1, longURI, ARTIFACT_HASH),
    ).to.be.revertedWith('TaskMarket: URI too long');
  });

  it('rejects openDispute with URI exceeding MAX_URI_LENGTH', async function () {
    const { buyer, agent, listingRegistry, taskMarket, disputeModule, token } =
      await deployFixture();
    await createListing(listingRegistry, agent, token.target);

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

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      disputeModule.connect(buyer).openDispute(1, longURI),
    ).to.be.revertedWith('DisputeModule: URI too long');
  });

  it('rejects resolveDispute with URI exceeding MAX_URI_LENGTH', async function () {
    const {
      buyer,
      agent,
      listingRegistry,
      taskMarket,
      disputeModule,
      token,
      owner,
    } = await deployFixture();
    await createListing(listingRegistry, agent, token.target);

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

    await disputeModule.connect(buyer).openDispute(1, 'ipfs://dispute-1');

    await disputeModule.connect(owner).setResolver(owner.address, true);

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      disputeModule.connect(owner).resolveDispute(1, 0, longURI),
    ).to.be.revertedWith('DisputeModule: URI too long');
  });

  it('rejects submission after delivery window expires', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    const activeTask = await taskMarket.getTask(1);
    expect(activeTask.status).to.equal(2);
    expect(activeTask.activatedAt).to.be.greaterThan(0);

    await time.increase(Number(policy.deliveryWindowSec) + 1);

    await expect(
      taskMarket
        .connect(agent)
        .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH),
    ).to.be.revertedWith('TaskMarket: delivery window expired');
  });

  it('rejects submission at the exact delivery deadline boundary', async function () {
    const { buyer, agent, listingRegistry, taskMarket, token } =
      await deployFixture();
    const { policy } = await createListing(
      listingRegistry,
      agent,
      token.target,
      { quoteRequired: false },
      { deliveryWindowSec: 120 },
    );

    await token.mint(buyer.address, 10_000n);

    await taskMarket.connect(buyer).postTask(1, TASK_URI, 1);
    await taskMarket.connect(agent).acceptTask(1);

    const task = await taskMarket.getTask(1);
    await token
      .connect(buyer)
      .approve(taskMarket.target, task.quotedTotalPrice);
    await taskMarket.connect(buyer).fundTask(1, task.quotedTotalPrice);
    await taskMarket.connect(buyer).acceptQuote(1);

    const activeTask = await taskMarket.getTask(1);
    const deadline = Number(activeTask.activatedAt) + Number(policy.deliveryWindowSec);

    await time.increaseTo(deadline);

    await expect(
      taskMarket
        .connect(agent)
        .submitDeliverable(1, ARTIFACT_URI, ARTIFACT_HASH),
    ).to.be.revertedWith('TaskMarket: delivery window expired');
  });
});
