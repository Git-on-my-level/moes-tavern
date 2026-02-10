import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentIdentity", function () {
  it("mints and updates agentURI", async function () {
    const [owner, other] = await ethers.getSigners();
    const AgentIdentity = await ethers.getContractFactory("AgentIdentity");
    const agent = await AgentIdentity.deploy();

    const mintTx = await agent.mint(owner.address, "ipfs://agent-1");
    await mintTx.wait();

    expect(await agent.agentURI(1)).to.equal("ipfs://agent-1");

    await expect(agent.connect(other).updateAgentURI(1, "ipfs://bad")).to.be.revertedWith(
      "AgentIdentity: not owner"
    );

    await agent.updateAgentURI(1, "ipfs://agent-1-updated");
    expect(await agent.agentURI(1)).to.equal("ipfs://agent-1-updated");
  });
});
