// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
        address paymentToken;
        string taskURI;
        uint32 proposedUnits;
        uint32 quotedUnits;
        uint256 quotedTotalPrice;
        uint64 quoteExpiry;
        uint256 fundedAmount;
        uint256 sellerBond;
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

contract DisputeModule {
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

    address public owner;
    ITaskMarket public immutable taskMarket;
    mapping(address => bool) public resolvers;
    mapping(uint256 => DisputeRecord) public disputes;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert("DisputeModule: owner only");
        }
        _;
    }

    modifier onlyResolver() {
        if (!resolvers[msg.sender]) {
            revert("DisputeModule: resolver only");
        }
        _;
    }

    constructor(address taskMarket_, address[] memory initialResolvers) {
        if (taskMarket_ == address(0)) {
            revert("DisputeModule: zero task market");
        }
        owner = msg.sender;
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
        DisputeRecord storage record = disputes[taskId];
        if (record.opened) {
            revert("DisputeModule: already opened");
        }
        ITaskMarket.Task memory task = taskMarket.getTask(taskId);
        if (task.status != ITaskMarket.TaskStatus.SUBMITTED) {
            revert("DisputeModule: not submitted");
        }
        if (msg.sender != address(taskMarket) && task.buyer != msg.sender) {
            revert("DisputeModule: buyer only");
        }

        (, , , IListingRegistry.Policy memory policy, ) = IListingRegistry(taskMarket.listingRegistry()).getListing(task.listingId);
        uint256 deadline = uint256(task.submittedAt) + uint256(policy.challengeWindowSec);
        if (block.timestamp > deadline) {
            revert("DisputeModule: challenge window expired");
        }

        record.opened = true;
        record.buyer = task.buyer;
        record.disputeURI = disputeURI;
        record.outcome = ITaskMarket.DisputeOutcome.SELLER_WINS;

        taskMarket.markDisputed(taskId, disputeURI);

        emit DisputeOpened(taskId, task.buyer, disputeURI);
    }

    function resolveDispute(
        uint256 taskId,
        ITaskMarket.DisputeOutcome outcome,
        string calldata resolutionURI
    ) external onlyResolver {
        DisputeRecord storage record = disputes[taskId];
        if (!record.opened) {
            revert("DisputeModule: not opened");
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
