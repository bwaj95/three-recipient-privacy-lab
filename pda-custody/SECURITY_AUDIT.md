# Corrected pre-deployment security and provenance audit

Date: 2026-09-26

Branch: `experiment/pda-custody-private-payment`

Result: **PASS — eligible for the bounded devnet deployment authorization**

This audit covers the size-optimized, normal production artifact. It does not
cover the separate ignored local rollback-test artifact built with
`test-failure-injection`.

## Remediated findings

The three findings in the previous audit now pass:

1. `CompanyVault.accountant` is an independent public key. The isolated state
   enforces seven distinct identities: company, accountant, two approvers, two
   recipients, and outsider. `PaymentReceipt.accountant` is copied only from
   `vault.accountant`.
2. The accountant cannot approve or execute. `approve_payment` accepts only an
   intent and a signer matching one of the two immutable approver keys stored
   in that intent. `execute_private_payment` requires the company signer.
3. Access is per resource and per payment. A recipient is absent from the
   company vault and custody eATA permissions and appears only on that
   recipient's eATA and receipt. Receipt A and receipt B have different PDAs
   and separately created permissions; selecting recipient B never updates
   receipt A's permission.

## Permission matrix

`view` is the exact flag set `TX_LOGS | TX_BALANCES | TX_MESSAGE` (`14`).
`authority+view` is `AUTHORITY | view` (`15`). No permission grants
`ACCOUNT_SIGNATURES`.

| Permissioned resource | Company | Accountant | Approver 1 | Approver 2 | Selected recipient | Other recipient / outsider |
|---|---:|---:|---:|---:|---:|---:|
| CompanyVault | authority+view | view | none | none | none | none |
| Custody eATA | authority+view | none | none | none | none | none |
| PaymentIntent A/B | authority+view | none | authority+view | authority+view | none | none |
| PaymentReceipt A/B | authority+view | view | none | none | view for that receipt only | none |
| Recipient eATA A/B | authority+view | none | none | none | authority+view for own eATA | none |

The vault permission is created once. Each intent and receipt permission is
created once at its payment-specific PDA. Recipient eATA self-onboarding uses
the selected recipient as payer and signer with the pinned SDK's eATA
initialization, permission update, and delegation instructions. This path is
locally validated but remains a live claim only after authenticated PER tests.

## Approval and execution invariants

- The payment ID is nonzero, random, and part of the intent/receipt PDA seeds.
- The intent hash commits to program, vault, payment ID, exact devnet USDC mint,
  recipient, source/destination eATAs, source/destination token views, amount,
  and wallet revision.
- Approval uses two fixed, distinct identities and a two-bit mask plus count.
  One approval stays PENDING; duplicates and unknown identities fail.
- Execution requires the exact custody PDA, its PDA-owned source token view,
  exact recipient/destination, exact Circle devnet USDC mint, exact positive
  amount, current wallet revision, matching payment ID/hash, two approvals,
  APPROVED status, unexecuted intent, and INITIALIZED receipt.
- One top-level `execute_private_payment` instruction invokes SPL Token using
  `CpiContext::new_with_signer`, then marks the intent EXECUTED and writes the
  receipt PAID. SVM rollback covers all three effects.
- The company wallet is not the source token authority and cannot directly
  sign a custody transfer.

## Production instruction inventory

The generated normal IDL contains exactly 15 instructions:

| Instruction | Transfer capability / classification |
|---|---|
| `approve_payment` | None; one immutable approver updates one intent |
| `configure_custody_eata_access` | None; custody permission update only |
| `configure_payment` | None; binds one private intent |
| `configure_payment_private_access` | None; creates one intent and one receipt permission |
| `configure_vault_private_access` | None; creates the one-time vault permission |
| `delegate_custody_eata` | None; eATA delegation only |
| `delegate_global_vault_eata` | None; shared global eATA delegation only |
| `delegate_intent` | None; state delegation only |
| `delegate_receipt` | None; state delegation only |
| `delegate_vault` | None; state delegation only |
| `execute_private_payment` | **Only custody outflow**; vault-PDA-signed SPL Token transfer after full intent validation |
| `initialize_payment_shells` | No token movement; creates sparse public state shells and funds permission rent |
| `initialize_vault` | **Inward funding/deposit only**; company funds the vault ATA and the vault signs the eSPL deposit into its own custody eATA |
| `process_undelegation` | None; SDK-generated delegation callback |
| `rotate_recipient` | None; company-only recipient/revision state update |

`execute_private_payment` is the only instruction capable of transferring
tokens outward from custody. `initialize_vault` also uses vault signer seeds in
the eSPL deposit CPI chain, but its accounts and fixed flow can only move the
company's initial funding inward into the same vault's custody. There is no
admin, recovery, withdrawal, fallback, or arbitrary-transfer instruction.

## Atomicity and negative evidence

- Rust unit/model tests cover wrong custody, source, destination, recipient,
  amount, mint, revision, payment ID, hash, approval count/mask, status,
  replay, and paid receipt rejection.
- JavaScript tests cover independent-accountant isolation, duplicate/unknown
  approvals, two recipients, stable shared custody, separate per-receipt
  permissions, and self-onboarding instruction ownership.
- Compiled local-SVM success moves exactly 10,000 base units, observes the SPL
  Token CPI at invocation depth 2, marks the intent EXECUTED, and writes the
  receipt PAID with the independent accountant.
- An insufficient-funds token CPI leaves both token accounts, intent, and
  receipt unchanged.
- A local-only post-CPI forced error rolls back the successful token CPI and
  receipt mutation.

## Production provenance

- Program keypair public key:
  `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`
- The keypair, Rust `declare_id!`, generated IDL, and both Anchor devnet/localnet
  declarations match.
- Normal size-optimized artifact:
  `pda-custody/target/deploy/pda_custody_private_payment.so`
- SHA-256:
  `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`
- Size: 460,760 bytes.
- The fixed MagicBlock devnet RPC returned genesis
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and a ProgramData rent
  estimate of 2,341,539,640 lamports for 460,805 bytes.
- The normal IDL and ELF contain no failure-injection instruction/symbol. The
  source-only rollback probe is feature-gated and exists only in a separate
  ignored local artifact.
- `.lab/`, all `target/` directories, keypairs, secrets, node modules, compiled
  `.so` files, and environment files are ignored and untracked. Local
  `*.before-*` backups are preserved and untracked.

## Pre-deployment conclusion

The source and exact production artifact pass the local security and
provenance gates. Deployment is restricted to the isolated program ID and the
verified MagicBlock/Solana devnet. No conclusion about live PER enforcement is
made here; that evidence must come from authenticated positive controls and
matched unauthorized controls after deployment and isolated setup.
