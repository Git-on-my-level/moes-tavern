// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

interface ITaskMarket {
    enum TaskStatus {
        OPEN,
        QUOTED,
        ACTIVE,
        SUBMITTED,
        DISPUTED,
        SETTLED,
        CANCELLED
    }

    enum DisputeOutcome {
        SELLER_WINS,
        BUYER_WINS,
        SPLIT,
        CANCEL
    }

    struct Task {
        uint256 id;
        uint256 listingId;
        uint256 agentId;
        address buyer;
        address seller;
        address paymentToken;
        string taskURI;
        uint32 proposedUnits;
        uint32 quotedUnits;
        uint256 quotedTotalPrice;
        uint64 quoteExpiry;
        uint256 fundedAmount;
        uint256 sellerBond;
        address bondFunder;
        string artifactURI;
        bytes32 artifactHash;
        uint64 activatedAt;
        uint64 submittedAt;
        uint64 disputedAt;
        TaskStatus status;
        bool settled;
    }

    function getTask(uint256 taskId) external view returns (Task memory);
    function listingRegistry() external view returns (address);

    function getTaskState(uint256 taskId) external view returns (TaskStatus status, uint256 listingId, address buyer, uint64 submittedAt, uint64 disputedAt);

    function markDisputed(uint256 taskId, string calldata disputeURI) external;

    function resolveDispute(uint256 taskId, DisputeOutcome outcome, string calldata resolutionURI) external;
}

interface IListingRegistry {
    struct Pricing {
        address paymentToken;
        uint256 basePrice;
        bytes32 unitType;
        uint256 unitPrice;
        uint32 minUnits;
        uint32 maxUnits;
        bool quoteRequired;
    }

    struct Policy {
        uint32 challengeWindowSec;
        uint32 postDisputeWindowSec;
        uint32 deliveryWindowSec;
        uint16 sellerBondBps;
    }

    function getListing(
        uint256 listingId
    ) external view returns (uint256 agentId, string memory listingURI, Pricing memory pricing, Policy memory policy, bool active);
}

contract DisputeModule is Ownable2Step {
    struct DisputeRecord {
        address buyer;
        bool opened;
        bool resolved;
        string disputeURI;
        string resolutionURI;
        ITaskMarket.DisputeOutcome outcome;
    }

    event DisputeOpened(uint256 indexed taskId, address indexed buyer, string disputeURI);
    event DisputeResolved(
        uint256 indexed taskId,
        address indexed resolver,
        ITaskMarket.DisputeOutcome outcome,
        string resolutionURI
    );
    event ResolverUpdated(address indexed resolver, bool allowed);

    ITaskMarket public immutable taskMarket;
    uint256 public constant MAX_URI_LENGTH = 2048;
    mapping(address => bool) public resolvers;
    mapping(uint256 => DisputeRecord) public disputes;

    modifier onlyResolver() {
        if (!resolvers[msg.sender]) {
            revert("DisputeModule: resolver only");
        }
        _;
    }

    constructor(address taskMarket_, address[] memory initialResolvers) Ownable(msg.sender) {
        if (taskMarket_ == address(0)) {
            revert("DisputeModule: zero task market");
        }
        taskMarket = ITaskMarket(taskMarket_);
        for (uint256 i = 0; i < initialResolvers.length; i++) {
            resolvers[initialResolvers[i]] = true;
            emit ResolverUpdated(initialResolvers[i], true);
        }
    }

    function setResolver(address resolver, bool allowed) external onlyOwner {
        resolvers[resolver] = allowed;
        emit ResolverUpdated(resolver, allowed);
    }

    function openDispute(uint256 taskId, string calldata disputeURI) external {
        if (bytes(disputeURI).length > MAX_URI_LENGTH) {
            revert("DisputeModule: URI too long");
        }
        DisputeRecord storage record = disputes[taskId];
        if (record.opened) {
            revert("DisputeModule: already opened");
        }
        ITaskMarket.TaskStatus status;
        uint256 listingId;
        address buyer;
        uint64 submittedAt;
        (status, listingId, buyer, submittedAt, ) = taskMarket.getTaskState(taskId);
        if (status != ITaskMarket.TaskStatus.SUBMITTED) {
            revert("DisputeModule: not submitted");
        }
        if (msg.sender != address(taskMarket) && buyer != msg.sender) {
            revert("DisputeModule: buyer only");
        }

        (, , , IListingRegistry.Policy memory policy, ) = IListingRegistry(taskMarket.listingRegistry()).getListing(
            listingId
        );
        uint256 deadline = uint256(submittedAt) + uint256(policy.challengeWindowSec);
        if (block.timestamp >= deadline) {
            revert("DisputeModule: challenge window expired");
        }

        record.opened = true;
        record.buyer = buyer;
        record.disputeURI = disputeURI;
        record.outcome = ITaskMarket.DisputeOutcome.SELLER_WINS;

        taskMarket.markDisputed(taskId, disputeURI);

        emit DisputeOpened(taskId, buyer, disputeURI);
    }

    function resolveDispute(
        uint256 taskId,
        ITaskMarket.DisputeOutcome outcome,
        string calldata resolutionURI
    ) external onlyResolver {
        if (bytes(resolutionURI).length > MAX_URI_LENGTH) {
            revert("DisputeModule: URI too long");
        }
        DisputeRecord storage record = disputes[taskId];
        (ITaskMarket.TaskStatus status, , address buyer, , ) = taskMarket.getTaskState(taskId);

        if (!record.opened) {
            if (status != ITaskMarket.TaskStatus.DISPUTED) {
                revert("DisputeModule: not opened");
            }
            record.opened = true;
            record.buyer = buyer;
            record.outcome = ITaskMarket.DisputeOutcome.SELLER_WINS;
        }
        if (record.resolved) {
            revert("DisputeModule: already resolved");
        }

        record.resolved = true;
        record.outcome = outcome;
        record.resolutionURI = resolutionURI;

        taskMarket.resolveDispute(taskId, outcome, resolutionURI);

        emit DisputeResolved(taskId, msg.sender, outcome, resolutionURI);
    }
}
