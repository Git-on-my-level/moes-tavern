// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
        uint16 sellerBondBps;
    }

    function getListing(
        uint256 listingId
    ) external view returns (uint256 agentId, string memory listingURI, Pricing memory pricing, Policy memory policy, bool active);
}

interface IAgentIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);

    function getApproved(uint256 agentId) external view returns (address);

    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IERC20Minimal {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract TaskMarket {
    enum TaskStatus {
        OPEN,
        QUOTED,
        ACTIVE,
        SUBMITTED,
        DISPUTED,
        SETTLED,
        CANCELLED
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
        uint64 submittedAt;
        TaskStatus status;
        bool settled;
    }

    event TaskPosted(
        uint256 indexed taskId,
        uint256 indexed listingId,
        uint256 indexed agentId,
        address buyer,
        string taskURI,
        uint32 proposedUnits
    );

    event QuoteProposed(
        uint256 indexed taskId,
        uint32 quotedUnits,
        uint256 quotedTotalPrice,
        uint64 expiry
    );

    event QuoteAccepted(uint256 indexed taskId);
    event TaskFunded(uint256 indexed taskId, uint256 amount);
    event TaskAccepted(uint256 indexed taskId);
    event DeliverableSubmitted(uint256 indexed taskId, string artifactURI, bytes32 artifactHash);
    event SubmissionAccepted(uint256 indexed taskId);
    event SubmissionDisputed(uint256 indexed taskId, string disputeURI);
    event TaskSettled(uint256 indexed taskId, uint256 buyerPayout, uint256 sellerBondRefund);
    event TaskCancelled(uint256 indexed taskId);

    IListingRegistry public immutable listingRegistry;
    IAgentIdentityRegistry public immutable identityRegistry;

    uint256 private _nextTaskId = 1;
    mapping(uint256 => Task) private _tasks;
    mapping(uint256 => bool) private _taskExists;

    constructor(address listingRegistry_, address identityRegistry_) {
        if (listingRegistry_ == address(0) || identityRegistry_ == address(0)) {
            revert("TaskMarket: zero registry");
        }
        listingRegistry = IListingRegistry(listingRegistry_);
        identityRegistry = IAgentIdentityRegistry(identityRegistry_);
    }

    function postTask(uint256 listingId, string calldata taskURI, uint32 proposedUnits) external returns (uint256 taskId) {
        (uint256 agentId, , IListingRegistry.Pricing memory pricing, , bool active) = listingRegistry.getListing(
            listingId
        );
        if (!active) {
            revert("TaskMarket: listing inactive");
        }
        if (proposedUnits < pricing.minUnits || proposedUnits > pricing.maxUnits) {
            revert("TaskMarket: units out of range");
        }
        if (pricing.paymentToken == address(0)) {
            revert("TaskMarket: payment token required");
        }

        taskId = _nextTaskId++;
        Task storage task = _tasks[taskId];
        task.id = taskId;
        task.listingId = listingId;
        task.agentId = agentId;
        task.buyer = msg.sender;
        task.paymentToken = pricing.paymentToken;
        task.taskURI = taskURI;
        task.proposedUnits = proposedUnits;
        task.status = TaskStatus.OPEN;
        _taskExists[taskId] = true;

        emit TaskPosted(taskId, listingId, agentId, msg.sender, taskURI, proposedUnits);
    }

    function proposeQuote(
        uint256 taskId,
        uint32 quotedUnits,
        uint256 quotedTotalPrice,
        uint64 expiry
    ) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.OPEN) {
            revert("TaskMarket: not open");
        }
        _requireAgentAuthorized(task.agentId);
        (, , IListingRegistry.Pricing memory pricing, , bool active) = listingRegistry.getListing(task.listingId);
        if (!active) {
            revert("TaskMarket: listing inactive");
        }
        if (quotedUnits == 0 || quotedUnits < pricing.minUnits || quotedUnits > pricing.maxUnits) {
            revert("TaskMarket: invalid quote");
        }
        task.quotedUnits = quotedUnits;
        task.quotedTotalPrice = quotedTotalPrice;
        task.quoteExpiry = expiry;
        task.status = TaskStatus.QUOTED;

        emit QuoteProposed(taskId, quotedUnits, quotedTotalPrice, expiry);
    }

    function acceptQuote(uint256 taskId) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: not quoted");
        }
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        if (task.quoteExpiry != 0 && block.timestamp > task.quoteExpiry) {
            revert("TaskMarket: quote expired");
        }
        if (task.fundedAmount == 0 || task.fundedAmount != task.quotedTotalPrice) {
            revert("TaskMarket: not funded");
        }
        task.status = TaskStatus.ACTIVE;

        emit QuoteAccepted(taskId);
    }

    function fundTask(uint256 taskId, uint256 amount) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        if (task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: not quoted");
        }
        if (amount == 0) {
            revert("TaskMarket: amount zero");
        }
        if (task.fundedAmount != 0) {
            revert("TaskMarket: already funded");
        }
        if (task.quotedTotalPrice == 0 || amount != task.quotedTotalPrice) {
            revert("TaskMarket: amount mismatch");
        }
        if (task.quoteExpiry != 0 && block.timestamp > task.quoteExpiry) {
            revert("TaskMarket: quote expired");
        }
        task.fundedAmount = amount;
        if (!IERC20Minimal(task.paymentToken).transferFrom(msg.sender, address(this), amount)) {
            revert("TaskMarket: transfer failed");
        }

        emit TaskFunded(taskId, amount);
    }

    function acceptTask(uint256 taskId) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.OPEN) {
            revert("TaskMarket: not open");
        }
        _requireAgentAuthorized(task.agentId);

        (, , IListingRegistry.Pricing memory pricing, , bool active) = listingRegistry.getListing(task.listingId);
        if (!active) {
            revert("TaskMarket: listing inactive");
        }
        if (pricing.quoteRequired) {
            revert("TaskMarket: quote required");
        }

        uint256 totalPrice = pricing.basePrice + (uint256(task.proposedUnits) * pricing.unitPrice);
        task.quotedUnits = task.proposedUnits;
        task.quotedTotalPrice = totalPrice;
        task.status = TaskStatus.QUOTED;

        emit TaskAccepted(taskId);
    }

    function submitDeliverable(uint256 taskId, string calldata artifactURI, bytes32 artifactHash) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.ACTIVE) {
            revert("TaskMarket: not active");
        }
        _requireAgentAuthorized(task.agentId);
        if (task.fundedAmount == 0) {
            revert("TaskMarket: not funded");
        }

        task.artifactURI = artifactURI;
        task.artifactHash = artifactHash;
        task.submittedAt = uint64(block.timestamp);
        task.status = TaskStatus.SUBMITTED;

        emit DeliverableSubmitted(taskId, artifactURI, artifactHash);
    }

    function acceptSubmission(uint256 taskId) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.SUBMITTED) {
            revert("TaskMarket: not submitted");
        }
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        _settle(task);
        emit SubmissionAccepted(taskId);
    }

    function disputeSubmission(uint256 taskId, string calldata disputeURI) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.SUBMITTED) {
            revert("TaskMarket: not submitted");
        }
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        task.status = TaskStatus.DISPUTED;

        emit SubmissionDisputed(taskId, disputeURI);
    }

    function settleAfterTimeout(uint256 taskId) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.SUBMITTED) {
            revert("TaskMarket: not submitted");
        }
        (, , , IListingRegistry.Policy memory policy, ) = listingRegistry.getListing(task.listingId);
        uint256 deadline = uint256(task.submittedAt) + uint256(policy.challengeWindowSec);
        if (block.timestamp < deadline) {
            revert("TaskMarket: challenge window");
        }
        _settle(task);
    }

    function cancelTask(uint256 taskId) external {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        if (task.status != TaskStatus.OPEN && task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: cannot cancel");
        }
        if (task.fundedAmount != 0) {
            revert("TaskMarket: funded");
        }
        task.status = TaskStatus.CANCELLED;

        emit TaskCancelled(taskId);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _getTaskOrRevert(taskId);
    }

    function _settle(Task storage task) internal {
        if (task.settled) {
            revert("TaskMarket: already settled");
        }
        task.settled = true;
        task.status = TaskStatus.SETTLED;

        uint256 payout = task.fundedAmount;
        if (payout > 0) {
            if (!IERC20Minimal(task.paymentToken).transfer(_agentOwner(task.agentId), payout)) {
                revert("TaskMarket: payout failed");
            }
        }

        emit TaskSettled(task.id, payout, 0);
    }

    function _getTaskOrRevert(uint256 taskId) internal view returns (Task storage task) {
        if (!_taskExists[taskId]) {
            revert("TaskMarket: task not found");
        }
        return _tasks[taskId];
    }

    function _requireAgentAuthorized(uint256 agentId) internal view {
        address owner = identityRegistry.ownerOf(agentId);
        if (
            msg.sender != owner &&
            !identityRegistry.isApprovedForAll(owner, msg.sender) &&
            identityRegistry.getApproved(agentId) != msg.sender
        ) {
            revert("TaskMarket: not authorized");
        }
    }

    function _agentOwner(uint256 agentId) internal view returns (address) {
        return identityRegistry.ownerOf(agentId);
    }
}
