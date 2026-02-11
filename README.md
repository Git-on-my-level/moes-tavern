# moes-tavern

ERC-8004-aligned agent marketplace (v0): identity + listings + task escrow + curation/search + minimal web UI.

Project spec: `.codex-autorunner/contextspace/spec.md`

## Unit Type Encoding

`unitType` is a bytes32-encoded short label using `ethers.encodeBytes32String()` for human-reversible encoding (e.g., "LOC", "MB"). This enables consistent decoding across contracts, indexer, and search.

Reserved for future: migrating to registry-based IDs if needed.
