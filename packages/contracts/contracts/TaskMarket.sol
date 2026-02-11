// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

interface IAgentIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);

    function getApproved(uint256 agentId) external view returns (address);

    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IDisputeModule {
    function openDispute(uint256 taskId, string calldata disputeURI) external;
}

contract TaskMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
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
    event SellerBondFunded(uint256 indexed taskId, uint256 amount);
    event TaskSettled(uint256 indexed taskId, uint256 buyerPayout, uint256 sellerBondRefund);
    event TaskCancelled(uint256 indexed taskId);
    event TaskCancelledForNonDelivery(
        uint256 indexed taskId,
        uint256 escrowRefund,
        uint256 sellerBondPenalty
    );
    event SellerCancelledQuote(uint256 indexed taskId, uint256 bondRefund);

    IListingRegistry public immutable listingRegistry;
    IAgentIdentityRegistry public immutable identityRegistry;
    address public disputeModule;
    address public owner;

    uint256 private _nextTaskId = 1;
    mapping(uint256 => Task) private _tasks;
    mapping(uint256 => bool) private _taskExists;

    constructor(address listingRegistry_, address identityRegistry_) {
        if (listingRegistry_ == address(0) || identityRegistry_ == address(0)) {
            revert("TaskMarket: zero registry");
        }
        listingRegistry = IListingRegistry(listingRegistry_);
        identityRegistry = IAgentIdentityRegistry(identityRegistry_);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert("TaskMarket: owner only");
        }
        _;
    }

    modifier onlyDisputeModule() {
        if (msg.sender != disputeModule) {
            revert("TaskMarket: dispute module only");
        }
        _;
    }

    function setDisputeModule(address disputeModule_) external onlyOwner {
        if (disputeModule_ == address(0)) {
            revert("TaskMarket: zero dispute module");
        }
        if (disputeModule != address(0)) {
            revert("TaskMarket: dispute module already set");
        }
        disputeModule = disputeModule_;
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
        if (task.fundedAmount == 0 || task.fundedAmount != task.quotedTotalPrice) {
            revert("TaskMarket: not funded");
        }
        if (_requiredSellerBond(task) != 0 && task.sellerBond != _requiredSellerBond(task)) {
            revert("TaskMarket: bond not funded");
        }
        task.status = TaskStatus.ACTIVE;
        task.activatedAt = uint64(block.timestamp);

        emit QuoteAccepted(taskId);
    }

    function fundSellerBond(uint256 taskId, uint256 amount) external nonReentrant {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: not quoted");
        }
        _requireAgentAuthorized(task.agentId);
        uint256 requiredBond = _requiredSellerBond(task);
        if (requiredBond == 0) {
            revert("TaskMarket: bond disabled");
        }
        if (task.sellerBond != 0) {
            revert("TaskMarket: bond already funded");
        }
        if (amount != requiredBond) {
            revert("TaskMarket: bond amount mismatch");
        }
        task.sellerBond = amount;
        IERC20(task.paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        emit SellerBondFunded(taskId, amount);
    }

    function sellerCancelQuote(uint256 taskId) external nonReentrant {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: not quoted");
        }
        if (task.fundedAmount != 0) {
            revert("TaskMarket: task funded");
        }
        _requireAgentAuthorized(task.agentId);
        uint256 refund = task.sellerBond;
        task.sellerBond = 0;
        task.quotedUnits = 0;
        task.quotedTotalPrice = 0;
        task.quoteExpiry = 0;
        task.status = TaskStatus.CANCELLED;
        if (refund > 0) {
            IERC20(task.paymentToken).safeTransfer(_agentOwner(task.agentId), refund);
        }

        emit SellerCancelledQuote(taskId, refund);
    }

    function fundTask(uint256 taskId, uint256 amount) external nonReentrant {
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
        if (_requiredSellerBond(task) != 0 && task.sellerBond != _requiredSellerBond(task)) {
            revert("TaskMarket: bond not funded");
        }
        if (task.quoteExpiry != 0 && block.timestamp > task.quoteExpiry) {
            revert("TaskMarket: quote expired");
        }
        task.fundedAmount = amount;
        IERC20(task.paymentToken).safeTransferFrom(msg.sender, address(this), amount);

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

    function acceptSubmission(uint256 taskId) external nonReentrant {
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
        if (disputeModule == address(0)) {
            revert("TaskMarket: dispute module unset");
        }
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.SUBMITTED) {
            revert("TaskMarket: not submitted");
        }
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        IDisputeModule(disputeModule).openDispute(taskId, disputeURI);
    }

    function settleAfterTimeout(uint256 taskId) external nonReentrant {
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

    function markDisputed(uint256 taskId, string calldata disputeURI) external onlyDisputeModule {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.SUBMITTED) {
            revert("TaskMarket: not submitted");
        }
        task.status = TaskStatus.DISPUTED;
        emit SubmissionDisputed(taskId, disputeURI);
    }

    function resolveDispute(
        uint256 taskId,
        DisputeOutcome outcome,
        string calldata
    ) external onlyDisputeModule nonReentrant {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.status != TaskStatus.DISPUTED) {
            revert("TaskMarket: not disputed");
        }

        uint256 buyerEscrowPayout;
        uint256 buyerBondPayout;
        if (outcome == DisputeOutcome.SELLER_WINS) {
            buyerEscrowPayout = 0;
            buyerBondPayout = 0;
        } else if (outcome == DisputeOutcome.BUYER_WINS) {
            buyerEscrowPayout = task.fundedAmount;
            buyerBondPayout = task.sellerBond;
        } else if (outcome == DisputeOutcome.SPLIT) {
            buyerEscrowPayout = task.fundedAmount / 2;
            buyerBondPayout = 0;
        } else {
            buyerEscrowPayout = task.fundedAmount;
            buyerBondPayout = 0;
        }

        _settleWithPayouts(task, buyerEscrowPayout, buyerBondPayout);
    }

    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        if (task.status != TaskStatus.OPEN && task.status != TaskStatus.QUOTED) {
            revert("TaskMarket: cannot cancel");
        }
        task.status = TaskStatus.CANCELLED;
        if (task.fundedAmount != 0) {
            uint256 refund = task.fundedAmount;
            task.fundedAmount = 0;
            IERC20(task.paymentToken).safeTransfer(task.buyer, refund);
        }
        if (task.sellerBond != 0) {
            uint256 refund = task.sellerBond;
            task.sellerBond = 0;
            IERC20(task.paymentToken).safeTransfer(_agentOwner(task.agentId), refund);
        }

        emit TaskCancelled(taskId);
    }

    function cancelForNonDelivery(uint256 taskId) external nonReentrant {
        Task storage task = _getTaskOrRevert(taskId);
        if (task.buyer != msg.sender) {
            revert("TaskMarket: buyer only");
        }
        if (task.status != TaskStatus.ACTIVE) {
            revert("TaskMarket: not active");
        }
        if (task.fundedAmount == 0) {
            revert("TaskMarket: not funded");
        }
        if (task.submittedAt != 0) {
            revert("TaskMarket: already submitted");
        }
        (, , , IListingRegistry.Policy memory policy, ) = listingRegistry.getListing(task.listingId);
        uint256 deadline = uint256(task.activatedAt) + uint256(policy.deliveryWindowSec);
        if (block.timestamp < deadline) {
            revert("TaskMarket: delivery window");
        }

        uint256 escrowRefund = task.fundedAmount;
        uint256 sellerBondPenalty = task.sellerBond;
        task.fundedAmount = 0;
        task.sellerBond = 0;
        task.status = TaskStatus.CANCELLED;
        task.settled = true;

        IERC20(task.paymentToken).safeTransfer(task.buyer, escrowRefund + sellerBondPenalty);

        emit TaskCancelled(taskId);
        emit TaskCancelledForNonDelivery(taskId, escrowRefund, sellerBondPenalty);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _getTaskOrRevert(taskId);
    }

    function _settle(Task storage task) internal {
        _settleWithPayouts(task, 0, 0);
    }

    function _settleWithPayouts(Task storage task, uint256 buyerEscrowPayout, uint256 buyerBondPayout) internal {
        if (task.settled) {
            revert("TaskMarket: already settled");
        }
        if (buyerEscrowPayout > task.fundedAmount) {
            revert("TaskMarket: buyer payout exceeds escrow");
        }
        if (buyerBondPayout > task.sellerBond) {
            revert("TaskMarket: buyer payout exceeds bond");
        }
        task.settled = true;
        task.status = TaskStatus.SETTLED;

        uint256 sellerEscrowPayout = task.fundedAmount - buyerEscrowPayout;
        uint256 sellerBondRefund = task.sellerBond - buyerBondPayout;
        uint256 buyerTotal = buyerEscrowPayout + buyerBondPayout;
        uint256 sellerTotal = sellerEscrowPayout + sellerBondRefund;

        if (buyerTotal > 0) {
            IERC20(task.paymentToken).safeTransfer(task.buyer, buyerTotal);
        }
        if (sellerTotal > 0) {
            IERC20(task.paymentToken).safeTransfer(_agentOwner(task.agentId), sellerTotal);
        }

        emit TaskSettled(task.id, buyerTotal, sellerBondRefund);
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

    function _requiredSellerBond(Task storage task) internal view returns (uint256) {
        (, , , IListingRegistry.Policy memory policy, ) = listingRegistry.getListing(task.listingId);
        if (policy.sellerBondBps == 0) {
            return 0;
        }
        return (task.quotedTotalPrice * uint256(policy.sellerBondBps)) / 10_000;
    }
}
