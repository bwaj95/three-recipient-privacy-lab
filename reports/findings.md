# Three-recipient workflow: findings

Evaluated 2026-09-15. **The live workflow is not yet verified.** No blockchain transaction was submitted from this workspace.

| Check | Result | What the result establishes |
| --- | --- | --- |
| Approval binding and duplicate approvers | Local tests passed | Signatures bind the local model's recipient, amount, mint, vault, revision, and payment ID. |
| Wallet replacement | Local test passed | A pre-submission replacement removes local approvals and requires a new revision. |
| Unknown outcomes and independent recipients | Local tests passed | Unknown delivery remains pending; one recipient failure does not undo the others in the model. |
| Delivery status | Local tests passed | Transaction confirmation alone does not mark a recipient paid. |
| eATA byte layout | Source review plus synthetic local test | A readable standard eATA stores its amount as a plain u64; this is not a live disclosure observation. |
| Solana and MagicBlock connectivity | Blocked | All three checked endpoints timed out; this says nothing about whether the services work from another machine. |
| Three live transfers and recipient credits | Not run | Requires devnet access and installed SDK dependencies. |
| Live observer/recipient privacy | Not run | The visibility matrix is implemented but no live observations exist. |
| Public withdrawal privacy | Structural limitation | Ordinary Solana token transfers expose destination and amount. |
| PDA vault and on-chain approvals | Not implemented in this probe | The fixture uses a wallet treasury. The local policy is bypassable by that wallet's owner. |
| Finance access, recovery, TEE attestation | Unverified | These require additional integration and threat-model checks. |

All 16 local tests passed. They are application-model tests, not deployed-program tests, an end-to-end test, or a cryptographic audit. JavaScript syntax checks pass; imported SDK compatibility remains unexecuted.

The fixture assigns Alice 1.11, Bob 2.22, and Carol 3.33 of a fresh six-decimal TEST token, leaving an expected 3.34 in the company's private balance after successful payments. These are not USDC transfers. It records PER credit separately from finalized public withdrawal.

Two source findings matter for the design. First, the SDK's intra-PER `private` option produces ordinary SPL transfer instructions whose amounts are readable from the bytes. Privacy must come from PER account and transaction access controls. Second, the high-level transfer helper derives wallet ATAs with off-curve owners disallowed. The capstone's PDA vault needs a separately verified program/CPI integration; the client helper alone does not establish it. See the [reviewed SDK source](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/958c5a1ff4fd25eea0017f90c6ef05ad14e979f0/ts/web3js/src/instructions/ephemeral-spl-token-program/ephemeralAta.ts) and [MagicBlock's program integration guide](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration).

The [documented lifecycle](https://docs.magicblock.gg/pages/ephemeral-spl-token/overview) returns eATA state to Solana and withdraws into ordinary token accounts. The live probe takes a snapshot between commit and withdrawal because commit may already reveal a current balance. A readable base balance while delegated may instead be stale; it must not be mistaken for proof that current private payments are exposed.

For the capstone, this remains a feasible experiment, with no demonstrated end-to-end privacy result yet. The immediate next step is running `npm run preflight`, installing dependencies, and running `inspect`, `setup`, and `pay` on a machine with devnet access. Then evaluate `reports/live-observations.json` before building the actual program-controlled approval vault around this provider.

The README contains the commands, retry behavior, public exit experiment, and acceptance gates. Share the generated reports to review results; keep `.lab/state.json` local because it contains the fixture's private keys.
