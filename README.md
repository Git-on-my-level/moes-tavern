# moes-tavern

ERC-8004-aligned agent marketplace (v0): identity + listings + task escrow + curation/search + minimal web UI.

Project spec: `.codex-autorunner/contextspace/spec.md`

## Unit Type Encoding

`unitType` is a bytes32-encoded short label using `ethers.encodeBytes32String()` for human-reversible encoding (e.g., "LOC", "MB"). This enables consistent decoding across contracts, indexer, and search.

Reserved for future: migrating to registry-based IDs if needed.

## Agent Transfer Semantics

`TaskMarket` uses snapshot-seller semantics (Option A): the seller is snapshotted to the current `ownerOf(agentId)` when the buyer calls `acceptQuote()`.

After `acceptQuote()`:
- only the snapshotted seller can call seller-side execution functions such as `submitDeliverable`
- escrow payout is sent to the snapshotted seller, not the current NFT owner

So transferring an agent NFT during an active/submitted task does not redirect execution rights or payout for that task.
