# PDA-custody private payment experiment

> **Deployment blocked:** the final read-only audit found that the current
> artifact conflates the accountant with `approver_one` and grants the
> recipient vault-wide visibility. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
> Do not deploy this artifact.

This isolated Anchor workspace implements the program-owned eATA architecture
from MagicBlock's current [Smart Contract Integration](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration)
documentation. It does not modify or upgrade the completed `FnKaj...`
wallet-owned experiment.

## Trust and atomicity boundary

- `CompanyVault`: PDA at `["company_vault", company]`; it is the SPL Token
  authority for the custody balance. The company wallet is not the token
  authority and cannot sign a direct withdrawal.
- Custody eATA: PDA at `[CompanyVault, Circle devnet USDC mint]` under the
  Ephemeral SPL Token program. In the PER, it is presented to the application
  at the vault PDA's canonical ATA address.
- `PaymentIntent`: PDA at `["payment_intent", CompanyVault, payment_id]`.
  It commits to the random payment ID, exact mint, recipient, source and
  destination eATAs/token views, amount, wallet revision, and domain-separated
  intent hash. Two distinct configured approvers must write independent
  approval bits before its status becomes `APPROVED`.
- `PaymentReceipt`: PDA at `["payment_receipt", CompanyVault, payment_id]`.
  It begins as a sparse shell and receives accounting details only inside the
  private rollup.
- `execute_private_payment`: one top-level SVM instruction validates every
  approved binding, invokes the SPL Token Program with `CompanyVault` signer
  seeds, marks the intent `EXECUTED`, and writes the receipt `PAID`. Any error
  rolls all three effects back.

Vault, receipt, and custody permissions make the company the only write
authority. The two approvers have write authority only on the intent. Company,
both approvers, and recipient have the required private transaction-view
flags; other viewers are omitted. Live enforcement still requires deployment
and authenticated PER verification.

## Safe local commands

```sh
cargo test --workspace
npm test
anchor build
node tests/local-svm.integration.mjs
node scripts/pda-custody-private-payment.mjs check
node scripts/pda-custody-private-payment.mjs plan
```

The client intentionally exposes no send command. `check` performs read-only
devnet identity/genesis/mint/program queries. The local-SVM test starts a
temporary validator, simulates the compiled program, verifies a real
PDA-signed Token CPI, and proves rollback both when the token CPI fails and
when a later state update fails.

## Approval boundaries

The normal deployment candidate is
`target/deploy/pda_custody_private_payment.so`, program ID
`AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`. Deployment requires explicit
user approval. Setup/payment transaction submission requires a separate later
approval, with devnet genesis verification and signature reconciliation before
every subsequent write.
