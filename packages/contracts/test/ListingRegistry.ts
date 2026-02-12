import { expect } from 'chai';
import { ethers } from 'hardhat';

const LISTING_URI = 'ipfs://listing-1';
const UPDATED_URI = 'ipfs://listing-1-updated';

describe('ListingRegistry', function () {
  async function deployFixture() {
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const identity = await AgentIdentityRegistry.deploy();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const paymentToken = await MockERC20.deploy('MockToken', 'MOCK');

    const ListingRegistry = await ethers.getContractFactory('ListingRegistry');
    const listingRegistry = await ListingRegistry.deploy(identity.target);

    return { identity, listingRegistry, paymentToken };
  }

  function getPricing(paymentToken: string) {
    return {
      paymentToken,
      basePrice: 1000n,
      unitType: ethers.encodeBytes32String('LOC'),
      unitPrice: 250n,
      minUnits: 1,
      maxUnits: 10,
      quoteRequired: false,
    };
  }

  function getPolicy() {
    return {
      challengeWindowSec: 3600,
      postDisputeWindowSec: 7200,
      deliveryWindowSec: 86400,
      sellerBondBps: 250,
    };
  }

  it('allows agent owner to create and update listings', async function () {
    const [owner] = await ethers.getSigners();
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();

    const createTx = await listingRegistry.createListing(
      1,
      LISTING_URI,
      pricing,
      policy,
    );
    await expect(createTx)
      .to.emit(listingRegistry, 'ListingCreated')
      .withArgs(
        1,
        1,
        LISTING_URI,
        pricing.paymentToken,
        pricing.basePrice,
        pricing.unitType,
        pricing.unitPrice,
        pricing.minUnits,
        pricing.maxUnits,
        pricing.quoteRequired,
        policy.challengeWindowSec,
        policy.postDisputeWindowSec,
        policy.deliveryWindowSec,
        policy.sellerBondBps,
        true,
      );

    const updateTx = await listingRegistry.updateListing(1, UPDATED_URI, false);
    await expect(updateTx)
      .to.emit(listingRegistry, 'ListingUpdated')
      .withArgs(1, 1, UPDATED_URI, false);

    const [agentId, listingURI, storedPricing, storedPolicy, active] =
      await listingRegistry.getListing(1);
    expect(agentId).to.equal(1);
    expect(listingURI).to.equal(UPDATED_URI);
    expect(active).to.equal(false);

    expect(storedPricing[0]).to.equal(pricing.paymentToken);
    expect(storedPricing[1]).to.equal(pricing.basePrice);
    expect(storedPricing[2]).to.equal(pricing.unitType);
    expect(storedPricing[3]).to.equal(pricing.unitPrice);
    expect(storedPricing[4]).to.equal(pricing.minUnits);
    expect(storedPricing[5]).to.equal(pricing.maxUnits);
    expect(storedPricing[6]).to.equal(pricing.quoteRequired);

    expect(storedPolicy[0]).to.equal(policy.challengeWindowSec);
    expect(storedPolicy[1]).to.equal(policy.postDisputeWindowSec);
    expect(storedPolicy[2]).to.equal(policy.deliveryWindowSec);
    expect(storedPolicy[3]).to.equal(policy.sellerBondBps);

    expect(await identity.ownerOf(1)).to.equal(owner.address);
  });

  it('allows approved operators to create and update listings', async function () {
    const [, operator] = await ethers.getSigners();
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');
    await identity.setApprovalForAll(operator.address, true);

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();

    await listingRegistry
      .connect(operator)
      .createListing(1, LISTING_URI, pricing, policy);
    await listingRegistry.connect(operator).updateListing(1, UPDATED_URI, true);

    const [agentId, listingURI, , , active] =
      await listingRegistry.getListing(1);
    expect(agentId).to.equal(1);
    expect(listingURI).to.equal(UPDATED_URI);
    expect(active).to.equal(true);
  });

  it('rejects unauthorized listing changes', async function () {
    const [owner, other] = await ethers.getSigners();
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();

    await expect(
      listingRegistry
        .connect(other)
        .createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: not authorized');

    await listingRegistry
      .connect(owner)
      .createListing(1, LISTING_URI, pricing, policy);
    await expect(
      listingRegistry.connect(other).updateListing(1, UPDATED_URI, false),
    ).to.be.revertedWith('ListingRegistry: not authorized');
  });

  it('rejects zero payment token', async function () {
    const { identity, listingRegistry } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(ethers.ZeroAddress);
    const policy = getPolicy();

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: zero payment token');
  });

  it('rejects zero maxUnits', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    pricing.maxUnits = 0;
    const policy = getPolicy();

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: maxUnits must be positive');
  });

  it('rejects zero minUnits', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    pricing.minUnits = 0;
    const policy = getPolicy();

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: minUnits must be positive');
  });

  it('rejects minUnits greater than maxUnits', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    pricing.minUnits = 20;
    pricing.maxUnits = 10;
    const policy = getPolicy();

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: minUnits greater than maxUnits');
  });

  it('rejects sellerBondBps exceeding 10000', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();
    policy.sellerBondBps = 10001;

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: sellerBondBps exceeds 10000');
  });

  it('rejects zero challengeWindow', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();
    policy.challengeWindowSec = 0;

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: challengeWindow must be positive');
  });

  it('rejects createListing with URI exceeding MAX_URI_LENGTH', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      listingRegistry.createListing(1, longURI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: URI too long');
  });

  it('rejects updateListing with URI exceeding MAX_URI_LENGTH', async function () {
    const [owner] = await ethers.getSigners();
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();

    await listingRegistry.createListing(1, LISTING_URI, pricing, policy);

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      listingRegistry.connect(owner).updateListing(1, longURI, false),
    ).to.be.revertedWith('ListingRegistry: URI too long');
  });

  it('rejects zero deliveryWindow', async function () {
    const { identity, listingRegistry, paymentToken } = await deployFixture();

    await identity.registerAgent('ipfs://agent-1');

    const pricing = getPricing(paymentToken.target);
    const policy = getPolicy();
    policy.deliveryWindowSec = 0;

    await expect(
      listingRegistry.createListing(1, LISTING_URI, pricing, policy),
    ).to.be.revertedWith('ListingRegistry: deliveryWindow must be positive');
  });
});
