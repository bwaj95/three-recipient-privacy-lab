# PDA-custody private payment experiment

This isolated Anchor workspace implements MagicBlock's documented
[program-owned eATA custody](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration)
architecture. It never modifies or upgrades the completed `FnKaj...`
wallet-owned experiment.

## Trust and atomicity boundary

- `CompanyVault`: PDA at `["company_vault", company]`; it is the SPL Token
  authority for the custody balance. The company wallet cannot sign a direct
  custody withdrawal.
- Custody eATA: PDA at `[CompanyVault, Circle devnet USDC mint]` under the
  Ephemeral SPL Token program. Inside the PER, the program receives the vault
  PDA's canonical ATA as the token-account view.
- `PaymentIntent`: PDA at `["payment_intent", CompanyVault, payment_id]`.
  It commits to the random payment ID, exact mint, recipient, source and
  destination eATAs/token views, amount, wallet revision, and domain-separated
  intent hash. Two distinct immutable approvers must set independent approval
  bits before status becomes APPROVED.
- `PaymentReceipt`: PDA at `["payment_receipt", CompanyVault, payment_id]`.
  It starts as a sparse public shell. Sensitive accounting fields are written
  only after delegation, inside the private rollup.
- `execute_private_payment`: one top-level SVM instruction validates every
  approved binding, invokes SPL Token with `CompanyVault` signer seeds, marks
  the intent EXECUTED, and writes the receipt PAID. Any error rolls all effects
  back.

## Least-privilege private access

- Vault: company authority; independent accountant view-only.
- Custody eATA: company authority only.
- Each intent: company plus two approvers; no accountant or recipient.
- Each receipt: company authority, independent accountant view-only, and only
  that payment's recipient view-only.
- Each recipient eATA: company and that recipient only. The recipient pays and
  signs its own initialization/delegation path.

The vault and custody are reused for repeated payments. Each payment uses a
new random ID and distinct intent/receipt PDAs and permissions, so configuring
recipient B cannot broaden or alter receipt A.

## Local validation

```sh
cargo fmt --all
cargo test --workspace
npm test
anchor build --no-idl -- --optimize-size
anchor idl build -p pda_custody_private_payment \
  -o target/idl/pda_custody_private_payment.json \
  -t target/types/pda_custody_private_payment.ts
node tests/local-svm.integration.mjs
node scripts/pda-custody-private-payment.mjs check
node scripts/pda-custody-private-payment.mjs plan
```

The local-SVM suite exercises the compiled program and proves successful
PDA-signed CPI plus rollback both when the token CPI fails and when a later
feature-only state update fails. The normal production IDL/ELF excludes that
failure-injection instruction.

## Deployment identity

- Program: `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`
- Network: MagicBlock/Solana devnet only
- Mint: Circle devnet USDC
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- TEE validator:
  `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`

The exact corrected production hash, security conclusions, and deployment
gate are recorded in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Live signatures,
balances, private account contents, access controls, and negative simulations
are recorded separately in `LIVE_PER_EVIDENCE.md` after execution.
