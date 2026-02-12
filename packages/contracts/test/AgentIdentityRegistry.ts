import { expect } from 'chai';
import { ethers } from 'hardhat';

const DEFAULT_URI = 'ipfs://agent-1';

describe('AgentIdentityRegistry', function () {
  it('registers agents and tracks ownership', async function () {
    const [owner] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    const tx = await registry.registerAgent(DEFAULT_URI);
    await expect(tx)
      .to.emit(registry, 'AgentRegistered')
      .withArgs(owner.address, 1, DEFAULT_URI);

    expect(await registry.ownerOf(1)).to.equal(owner.address);
    expect(await registry.getAgentURI(1)).to.equal(DEFAULT_URI);
    expect(await registry.tokenURI(1)).to.equal(DEFAULT_URI);
  });

  it('allows approved operators to update agentURI', async function () {
    const [, operator] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    await registry.registerAgent(DEFAULT_URI);

    await registry.setApprovalForAll(operator.address, true);
    await expect(
      registry.connect(operator).setAgentURI(1, 'ipfs://agent-1-updated'),
    )
      .to.emit(registry, 'AgentURIUpdated')
      .withArgs(1, 'ipfs://agent-1-updated');

    expect(await registry.getAgentURI(1)).to.equal('ipfs://agent-1-updated');
    expect(await registry.tokenURI(1)).to.equal('ipfs://agent-1-updated');
  });

  it('rejects non-owner updates', async function () {
    const [, other] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    await registry.registerAgent(DEFAULT_URI);

    await expect(
      registry.connect(other).setAgentURI(1, 'ipfs://bad'),
    ).to.be.revertedWith('AgentIdentityRegistry: not authorized');

    await registry.setAgentURI(1, 'ipfs://agent-1-updated');
    expect(await registry.getAgentURI(1)).to.equal('ipfs://agent-1-updated');
  });

  it('supports single-token approvals', async function () {
    const [, operator] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    await registry.registerAgent(DEFAULT_URI);
    await registry.approve(operator.address, 1);

    await registry.connect(operator).setAgentURI(1, 'ipfs://agent-1-approved');
    expect(await registry.getAgentURI(1)).to.equal('ipfs://agent-1-approved');
  });

  it('rejects registerAgent with URI exceeding MAX_URI_LENGTH', async function () {
    const [owner] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      registry.connect(owner).registerAgent(longURI),
    ).to.be.revertedWith('AgentIdentityRegistry: URI too long');
  });

  it('rejects setAgentURI with URI exceeding MAX_URI_LENGTH', async function () {
    const [owner] = await ethers.getSigners();
    const AgentIdentityRegistry = await ethers.getContractFactory(
      'AgentIdentityRegistry',
    );
    const registry = await AgentIdentityRegistry.deploy();

    await registry.registerAgent(DEFAULT_URI);

    const longURI = 'ipfs://' + 'a'.repeat(2100);

    await expect(
      registry.connect(owner).setAgentURI(1, longURI),
    ).to.be.revertedWith('AgentIdentityRegistry: URI too long');
  });
});
