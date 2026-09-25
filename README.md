# Three-recipient privacy lab

**Status: local application checks pass; live transfers and privacy remain unverified.**

This is the first integration probe for the payments capstone. It prepares a MagicBlock Private Ephemeral Rollup (PER) experiment with three fresh recipients and six-decimal test tokens. It does not deploy an Anchor vault, use real USDC, or establish on-chain approval enforcement. The dependency installation and live SDK runner could not be executed in the authoring environment because network requests timed out. Treat the runner as an integration candidate until it completes on a machine with devnet access.

The purpose is to answer a concrete question: can one company pay three independently private recipients, and exactly which balances and transactions can each observer read at each stage?

## The fixture

| Account | Starting private balance | Intended credit | Expected balance after three successful transfers |
| --- | ---: | ---: | ---: |
| Company | 10.00 TEST | — | 3.34 TEST |
| Alice | 0.00 TEST | 1.11 TEST | 1.11 TEST |
| Bob | 0.00 TEST | 2.22 TEST | 2.22 TEST |
| Carol | 0.00 TEST | 3.33 TEST | 3.33 TEST |

Two automatically generated local approval keys sign each exact payment tuple. These exercise the application model only: the company wallet can bypass this code and spend directly. The capstone must eventually enforce its approval policy inside its vault program or multisig.

The live transfer is signed by the company alone. If owner-only recipient permissions prevent it from executing, the probe reports the failure. It does not silently make balances public or require the recipient to co-sign.

## Run on Ubuntu

Use Node.js 24 or newer. The first two commands need no npm dependencies:

```bash
cd three-recipient-privacy-lab
npm test
npm run preflight
```

`preflight` submits no transactions. Solana devnet and the MagicBlock PER must respond. The payments API health check is informational; this runner uses the SDK directly. An alternate Solana **devnet** RPC can be supplied through `SOLANA_DEVNET_RPC`. Do not put an RPC credential into a report. The runner checks Solana's devnet genesis and the reviewed PER validator identity before sending transactions.

If both required network checks pass:

```bash
npm install
npm run inspect
npm run setup
npm run pay
```

`inspect` only builds unsigned instructions and checks their visibility flag behavior and the high-level helper's handling of a PDA sender. `setup` creates fresh wallets, a fresh test mint, token accounts, and private delegated balances. It requests devnet SOL for transaction fees. If the faucet is rate-limited, fund the printed test wallet with devnet SOL and rerun `setup`.

`pay` attempts Alice, Bob, and Carol separately. It then reads each recipient's balance and transaction evidence and writes `reports/live-observations.json`. A submission signature alone cannot mark a recipient paid.

For an unknown outcome:

```bash
npm run reconcile
npm run pay
```

`reconcile` only reads chain state. Rerunning `pay` can retransmit the **same stored signed transaction** while its blockhash remains valid. It cannot create a replacement payment for an existing attempt. An expired transaction with an unresolved outcome remains blocked for investigation. A failed recipient does not cancel the other recipients. This diagnostic runner does not implement automatic replacement after a definitive failure.

After successful private credits, test the public exit:

```bash
npm run withdraw
npm run observe
```

Withdrawal commits and undelegates each recipient balance, records a visibility snapshot, then withdraws into that recipient's ordinary Solana token account. It waits for finalized base-chain settlement and the exact expected public credit. This stage intentionally tests where privacy is lost. Rerun `withdraw` to continue from its saved operations if confirmation is delayed.

Do not delete `.lab/state.json` or edit a pending payment to force a retry. The file contains the fresh fixture's private keys, approval keys, signed transactions, and operation journal. Keep it local; share only the generated `reports/` files. A stale runner lock requires checking that no other instance is running before removing the lock file. All recipients and amounts in reports are synthetic, but the reports intentionally reveal this fixture's payment records.

## Read the evidence

| State or result | Meaning |
| --- | --- |
| `approved` | Local model has signatures; nothing has been submitted. |
| `processing` | An attempt exists; delivery is unresolved. |
| `credited_in_per` | A successful confirmed PER transaction matches the saved message, and the recipient's balance increased by the exact fixture amount. |
| `paid` | The fixture's public withdrawal is finalized and the recipient's public token balance shows the exact expected credit. |
| `failed` | The RPC reports a chain transaction error. No automatic replacement is created. |
| `request-error`, `auth-error`, `absent-or-filtered` | Inconclusive privacy evidence. An outage or missing account does not prove confidentiality. |
| `readable-balance`, `transaction-readable` | That reader could access the balance or transaction at the recorded stage. Compare the slot and account owner to distinguish stale base state from current PER state. |

For this experiment, `paid` deliberately requires a public exit. A production product may define payment as a spendable PER credit; that requires a separately agreed settlement and recovery policy.

Observers include public Solana RPC, unauthenticated PER RPC, company, each recipient, and an authenticated outsider. Both the eATA account and the remapped SPL balance RPC route are queried. Transfer receipts and logs are queried as well.

A useful privacy result requires a working positive control: Alice must successfully read her own current balance while an unauthorized reader cannot read it through the tested routes. A missing receipt, failed login, or failed RPC request is never an automatic pass. This runner records observations rather than asserting universal privacy, so `fullPrivacyPass` remains false.

Before declaring the workflow suitable, also verify the expected company remainder of 3.34 TEST and all three independent credits. Exact balance deltas are acceptable for these isolated fresh accounts; concurrent production payments need transaction-level reconciliation and an indexer.

## Acceptance gates still outstanding

1. **Transfer compatibility:** all three company-only payments execute with the intended private recipient permissions.
2. **Visibility:** each recipient can read their own data; public, outsider, and other-recipient reads reveal no protected current balance or transfer data through all tested routes. Shared setup funding and this unique test mint already make account associations public; the fixture cannot establish anonymity.
3. **Exit privacy:** measure base-chain balances immediately after commit and after withdrawal. Ordinary public token withdrawals disclose their destination and amount; preserving salary secrecy at that boundary needs a different payment/withdrawal design.
4. **Vault authorization:** an actual program-controlled vault enforces approvals, blocks direct bypass, and signs the eATA transfer through CPI. Test missing approvals, wallet replacement, replay, and a duplicate payment ID against that deployed program. Local signature tests do not satisfy this gate.
5. **Recovery and audit access:** exercise provider/RPC interruption, uncertain outcomes, employee access recovery, and narrowly scoped finance access. This probe does not independently verify TEE hardware attestation or configure a finance auditor.

If Gate 1 fails because private recipients cannot accept a company-only transfer, investigate a documented permission/transfer path before proceeding. If salary amounts must remain secret even after ordinary public withdrawal, this particular lifecycle does not meet that requirement. Do not describe a successful in-PER demo as complete end-to-end payroll privacy.

## What is implemented

- `src/core.mjs`: local approval, wallet-change, payment-state, and observation-classification model.
- `src/live.mjs`: SDK instruction inspection, devnet fixture setup, independent payment attempts, signed transaction journal, reconciliation, visibility matrix, and public withdrawals.
- `src/io.mjs`: atomic state replacement with file/directory fsync and a single-runner lock.
- `src/preflight.mjs`: bounded network checks that submit no transactions.
- `test/core.test.mjs`: 16 local tests, including one synthetic eATA byte-layout demonstration.
- `reports/local-validation.json`: executed local test and syntax results.
- `reports/preflight.json`: recorded endpoint timeouts from this environment.
- `reports/findings.md`: the evaluation and remaining decision.

The project pins SDK `0.17.0`, web3.js `1.98.4`, and SPL Token `0.4.14`. The reviewed MagicBlock repository identifies itself as `0.17.0`; registry resolution was not executed here, so no verified lockfile is included. If installation or exports differ, stop and report the error before changing versions. A successful `npm install` will generate a lockfile for the actual dependency tree.

## Source basis

Reviewed 2026-09-15. MagicBlock source commit: `958c5a1ff4fd25eea0017f90c6ef05ad14e979f0`.

- [Ephemeral SPL token model and lifecycle](https://docs.magicblock.gg/pages/ephemeral-spl-token/overview): balances are lightweight records backed by a per-mint vault; withdrawal returns tokens to ordinary Solana accounts.
- [Smart contract integration](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration): the program-owned eATA and PDA-signed CPI route. A high-level client helper rejecting an off-curve owner does not mean program integration is impossible.
- [Private payments scope](https://docs.magicblock.gg/pages/ephemeral-spl-token/private-payments): the hosted payment path and its stated privacy limits. This probe does not use its queued base-to-base payment path.
- [PER setup](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart): devnet PER and access-control setup. PER privacy uses a trusted execution environment; this is not a ZK proof implementation.
- [Reviewed SDK token instructions](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/958c5a1ff4fd25eea0017f90c6ef05ad14e979f0/ts/web3js/src/instructions/ephemeral-spl-token-program/ephemeralAta.ts): intra-PER `private` and `public` modes build ordinary SPL transfer instructions; the eATA amount is a plain u64. Confidentiality therefore depends on protected execution and RPC access, not instruction-byte encryption.
- [Reviewed commitment lookup](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/958c5a1ff4fd25eea0017f90c6ef05ad14e979f0/ts/web3js/src/utils.ts): the runner follows the two successful-transaction log lookups using HTTP polling.

## Decision

Keep MagicBlock as an experimental capstone option until the live gates pass. This package gives us a specific experiment to run; it does not establish that the private payroll workflow already works.
