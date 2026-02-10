// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AgentIdentity is ERC721 {
    event AgentURIUpdated(uint256 indexed agentId, string agentURI);

    uint256 private _nextId = 1;
    mapping(uint256 => string) private _agentURIs;

    constructor() ERC721("Moes Agent", "MOEAGENT") {}

    function mint(address to, string memory agentURI) external returns (uint256) {
        uint256 tokenId = _nextId++;
        _safeMint(to, tokenId);
        _setAgentURI(tokenId, agentURI);
        return tokenId;
    }

    function agentURI(uint256 agentId) external view returns (string memory) {
        require(_ownerOf(agentId) != address(0), "AgentIdentity: unknown agent");
        return _agentURIs[agentId];
    }

    function updateAgentURI(uint256 agentId, string memory agentURI) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentity: not owner");
        _setAgentURI(agentId, agentURI);
    }

    function _setAgentURI(uint256 agentId, string memory agentURI) internal {
        _agentURIs[agentId] = agentURI;
        emit AgentURIUpdated(agentId, agentURI);
    }
}
