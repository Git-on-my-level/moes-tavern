// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);

    function getApproved(uint256 agentId) external view returns (address);

    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

contract ListingRegistry {
    struct Pricing {
        // Must be a standard ERC20 with exact transfer semantics.
        // Fee-on-transfer / deflationary tokens are unsupported by TaskMarket escrow.
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
        // If non-zero, DISPUTED tasks may be permissionlessly settled after this window.
        uint32 postDisputeWindowSec;
        uint32 deliveryWindowSec;
        uint16 sellerBondBps;
    }

    struct Listing {
        uint256 agentId;
        string listingURI;
        Pricing pricing;
        Policy policy;
        bool active;
    }

    event ListingCreated(
        uint256 indexed listingId,
        uint256 indexed agentId,
        string listingURI,
        address paymentToken,
        uint256 basePrice,
        bytes32 unitType,
        uint256 unitPrice,
        uint32 minUnits,
        uint32 maxUnits,
        bool quoteRequired,
        uint32 challengeWindowSec,
        uint32 postDisputeWindowSec,
        uint32 deliveryWindowSec,
        uint16 sellerBondBps,
        bool active
    );

    event ListingUpdated(
        uint256 indexed listingId,
        uint256 indexed agentId,
        string listingURI,
        bool active
    );

    IAgentIdentityRegistry public immutable identityRegistry;

    uint256 private _nextListingId = 1;
    mapping(uint256 => Listing) private _listings;
    mapping(uint256 => bool) private _listingExists;

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) {
            revert("ListingRegistry: zero identity registry");
        }
        identityRegistry = IAgentIdentityRegistry(identityRegistry_);
    }

    function createListing(
        uint256 agentId,
        string calldata listingURI,
        Pricing calldata pricing,
        Policy calldata policy
    ) external returns (uint256 listingId) {
        _requireAuthorized(agentId);

        if (pricing.paymentToken == address(0)) {
            revert("ListingRegistry: zero payment token");
        }
        if (pricing.maxUnits == 0) {
            revert("ListingRegistry: maxUnits must be positive");
        }
        if (pricing.minUnits == 0) {
            revert("ListingRegistry: minUnits must be positive");
        }
        if (pricing.minUnits > pricing.maxUnits) {
            revert("ListingRegistry: minUnits greater than maxUnits");
        }
        if (policy.sellerBondBps > 10_000) {
            revert("ListingRegistry: sellerBondBps exceeds 10000");
        }
        if (policy.challengeWindowSec == 0) {
            revert("ListingRegistry: challengeWindow must be positive");
        }
        if (policy.deliveryWindowSec == 0) {
            revert("ListingRegistry: deliveryWindow must be positive");
        }

        listingId = _nextListingId++;

        Listing storage listing = _listings[listingId];
        listing.agentId = agentId;
        listing.listingURI = listingURI;
        listing.pricing = pricing;
        listing.policy = policy;
        listing.active = true;
        _listingExists[listingId] = true;

        emit ListingCreated(
            listingId,
            agentId,
            listingURI,
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
            true
        );
    }

    function updateListing(uint256 listingId, string calldata listingURI, bool active) external {
        Listing storage listing = _getListingOrRevert(listingId);
        _requireAuthorized(listing.agentId);

        listing.listingURI = listingURI;
        listing.active = active;

        emit ListingUpdated(listingId, listing.agentId, listingURI, active);
    }

    function getListing(
        uint256 listingId
    ) external view returns (uint256 agentId, string memory listingURI, Pricing memory pricing, Policy memory policy, bool active) {
        Listing storage listing = _getListingOrRevert(listingId);
        return (listing.agentId, listing.listingURI, listing.pricing, listing.policy, listing.active);
    }

    function _getListingOrRevert(uint256 listingId) internal view returns (Listing storage listing) {
        if (!_listingExists[listingId]) {
            revert("ListingRegistry: listing not found");
        }
        return _listings[listingId];
    }

    function _requireAuthorized(uint256 agentId) internal view {
        address owner = identityRegistry.ownerOf(agentId);
        if (
            msg.sender != owner &&
            !identityRegistry.isApprovedForAll(owner, msg.sender) &&
            identityRegistry.getApproved(agentId) != msg.sender
        ) {
            revert("ListingRegistry: not authorized");
        }
    }
}
