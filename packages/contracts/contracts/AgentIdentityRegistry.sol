// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AgentIdentityRegistry is ERC721 {
    event AgentRegistered(address indexed owner, uint256 indexed agentId, string agentURI);
    event AgentURIUpdated(uint256 indexed agentId, string agentURI);

    uint256 public constant MAX_URI_LENGTH = 2048;
    uint256 private _nextId = 1;
    mapping(uint256 => string) private _agentURIs;

    constructor() ERC721("Moes Agent", "MOEAGENT") {}

    function registerAgent(string calldata agentURI) external returns (uint256 agentId) {
        if (bytes(agentURI).length > MAX_URI_LENGTH) {
            revert("AgentIdentityRegistry: URI too long");
        }
        agentId = _nextId++;
        _safeMint(msg.sender, agentId);
        _setAgentURI(agentId, agentURI);
        emit AgentRegistered(msg.sender, agentId, agentURI);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI) external {
        if (bytes(agentURI).length > MAX_URI_LENGTH) {
            revert("AgentIdentityRegistry: URI too long");
        }
        address owner = ownerOf(agentId);
        if (
            msg.sender != owner &&
            !isApprovedForAll(owner, msg.sender) &&
            getApproved(agentId) != msg.sender
        ) {
            revert("AgentIdentityRegistry: not authorized");
        }
        _setAgentURI(agentId, agentURI);
    }

    function getAgentURI(uint256 agentId) external view returns (string memory) {
        ownerOf(agentId);
        return _agentURIs[agentId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return _agentURIs[tokenId];
    }

    function _setAgentURI(uint256 agentId, string calldata agentURI) internal {
        _agentURIs[agentId] = agentURI;
        emit AgentURIUpdated(agentId, agentURI);
    }
}
