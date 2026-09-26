# Final pre-deployment security and provenance audit

Date: 2026-09-26

Branch: `experiment/pda-custody-private-payment`

Result: **FAILED — DO NOT DEPLOY THE AUDITED ARTIFACT**

This is a read-only audit of the normal production IDL and artifact. The
feature-gated rollback-test artifact is not a deployment candidate.

## Requested controls

1. **FAIL — dedicated accountant.** `CompanyVault` contains `company`, two
   approvers, and `recipient`, but no independent `accountant`. The isolated
   local identity state likewise has no accountant role. `PaymentReceipt` has
   an `accountant` field, but execution fills it from `vault.approver_one`.

2. **FAIL — accountant cannot approve.** Because the receipt's accountant is
   `approver_one`, that identity is expressly accepted by `approve_payment`.
   Only the company can invoke `execute_private_payment`, so the accountant
   cannot execute, but the required non-approver property is not met.

3. **FAIL — recipient visibility isolation.** `accounting_members` includes
   `vault.recipient`, and that same list is installed on the vault and every
   receipt by `configure_private_access`. Therefore the recipient can view the
   company vault and every receipt configured from that vault, rather than
   only the receipt for that recipient/payment.

4. **PASS — production IDL instruction inventory.** The normal IDL has exactly
   14 instructions:

   | Instruction | Token movement capability |
   |---|---|
   | `approve_payment` | None |
   | `configure_custody_eata_access` | None; permission update only |
   | `configure_payment` | None |
   | `configure_private_access` | None; permission creation only |
   | `delegate_custody_eata` | None; delegation only |
   | `delegate_global_vault_eata` | None; delegation only |
   | `delegate_intent` | None; delegation only |
   | `delegate_receipt` | None; delegation only |
   | `delegate_vault` | None; delegation only |
   | `execute_private_payment` | Yes; direct SPL Token CPI from custody to the approved recipient |
   | `initialize_payment_shells` | No token movement; System Program lamport transfer only |
   | `initialize_vault` | Yes; company-signed SPL funding transfer followed by the vault-signed eSPL deposit path |
   | `process_undelegation` | None; SDK-generated undelegation callback |
   | `rotate_recipient` | None |

5. **QUALIFIED FAIL under the literal requirement.**
   `execute_private_payment` is the only production instruction that directly
   calls `anchor_spl::token::transfer` with `CompanyVault` as authority.
   However, `initialize_vault` invokes the eSPL deposit instruction with
   `CompanyVault` signer seeds; the eSPL deposit consumes that signer while
   moving tokens into custody. It cannot pay an arbitrary recipient, but it is
   another production path that makes the vault sign a token-moving CPI chain.

6. **PASS for payment outflow bypass.** There is no recovery, withdrawal, or
   fallback instruction in the production IDL. The only test instruction is
   feature-gated and absent from the normal IDL/artifact. `rotate_recipient` is
   an administrative state instruction but cannot move tokens. The only
   custody-to-recipient outflow instruction is `execute_private_payment`, and
   it calls `validate_execution` before the CPI. That validation requires the
   exact custody PDA, USDC mint, source/destination bindings, amount, random
   payment ID, intent hash, current wallet revision, two-bit/two-count approval
   state, `APPROVED`, not executed, receipt `INITIALIZED`, and configured
   private access.

7. **PASS — no failure injection in production.** The normal IDL has no
   `test_fail_after_cpi`, and the string is absent from the normal ELF. The
   source implementation is protected by
   `#[cfg(feature = "test-failure-injection")]` and exists only in the separate
   local rollback-test artifact.

8. **PASS — program identity.** Running `solana address` against the ignored
   program keypair returned exactly
   `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`. The normal IDL address and
   Rust `declare_id!` match it.

9. **PASS — artifact provenance.** The normal deployment artifact SHA-256 is
   exactly
   `62625984161b1ee7017941387574d52a410d20953e46027ac95e3a63509b2f10`
   and its size is 521,576 bytes.

10. **PASS — sensitive/generated files are untracked.** Repository ignore
    rules cover `.lab/`, all `node_modules/`, all `target/` directories,
    `**/*keypair*.json`, `.env` files except explicit examples, and PEM files.
    `git ls-files` found no tracked `.lab`, `node_modules`, `target`, keypair,
    `.so`, wallet, or secret environment file. The only matching tracked file
    was the intentionally public `private-receipt/.env.example`.

## Deployment decision

The user's deployment approval was conditional on every requested check
passing and was bound to the audited SHA-256. Checks 1, 2, 3, and the literal
form of 5 do not pass. Therefore the artifact was not deployed and no devnet
write was attempted. Correcting these findings will change the program state
layout, IDL, ELF, and artifact hash, so a newly built artifact will require a
new explicit deployment approval.
