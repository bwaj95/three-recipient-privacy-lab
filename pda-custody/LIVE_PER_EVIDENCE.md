# Live MagicBlock PER evidence

Last updated: 2026-09-27

Status: **DEPLOYED; LIVE SETUP BLOCKED BEFORE USDC FUNDING**

## Fixed scope

- Network: Solana/MagicBlock devnet only
- Expected and observed genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`
- Base reads/writes: trusted environment-provided Solana devnet RPC; its URL and credential are intentionally not recorded
- PER: `https://devnet-tee.magicblock.app`
- TEE identity: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`
- Program: `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`
- Circle devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals)
- Artifact SHA-256: `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`
- Artifact size: 460,760 bytes

## Deployment reconciliation

- Deployment signature: `5TdXaPeBaHKCVMHY471Ykw88Jy3A38cU3T2q88Qy8AJqWE1UHXjdNMB3ahCemRAKhCkrVQRKxVXcaBJz9yeGCbR5`
- Outcome/finality: finalized success (`err: null`)
- Deployment slot: 504520046
- ProgramData: `8L3bqttWFggYQLT2vEh242BaGJE2PXhiTmtBJBywYqbF`
- Upgrade authority: `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`
- Program owner: `BPFLoaderUpgradeab1e11111111111111111111111`
- Executable: yes
- Deployed data length: 460,760 bytes
- Deployed-byte verification: `solana program dump` produced an exact byte-for-byte match with the approved local artifact and the same SHA-256.
- Known buffer `HMUJssvAgtjonKX1oHe7gXDuV88ftUDWLaurogZkfa1F` was consumed to zero by the finalized deployment.

No redeployment, upgrade, close, or modification was performed after this reconciliation.

## Fresh isolated fixture

The secret-bearing fixture is ignored at `.lab/pda-custody-live-20260927.json`, mode 0600. Secret arrays are not recorded here.

| Role/resource | Public address |
|---|---|
| Company | `7nq2ZK6CwL5NrzbgfeZMuYmNeCCTE2MDnL5vicT8dXAL` |
| Independent accountant | `FHxS1saQyLCp9Mg3NKbdkhGpmmbCsnto7zBhnidCh7jd` |
| Approver one | `EELHqnsZjy7Vy3ErLqnDAsxvZioaK5SNf9W8M1PNN3eN` |
| Approver two | `5wX1nFHpwYU4tTHJuASGMq5wdcUoZmWTPcW37aKvSc38` |
| Recipient A | `FeN2zh9NZzLCFPZ8Uo1oPFFiwtTAa3hcPvEX5LCC4pRN` |
| Unrelated recipient B control | `GKvZaEWyXAXxjz1fYjduhYUVddYqdkrKWqnrAsUvX3ka` |
| Outsider | `8dLCmnRp3XC8DHSh8q8MBLjq6faH8bzDkvzURrA3Vefr` |
| CompanyVault PDA | `GhjDy7sMFCfzt4EnrXNHv39y8yDCaeEXo7VfuTd7yE1M` |
| PaymentIntent A PDA | `3Ks7Jv86EazhKuk8T2h4ZCkuCKmnPtCkUCtj2LcWgmBw` |
| PaymentReceipt A PDA | `2Ut3YhoBgkNRnWgGynz8NqrzL58t5Up6LbWEJuLbgWqW` |

Payment A is fixed at 10,000 USDC base units (0.01 USDC). The runner is capped to one successful execution and recipient B is used only as an authenticated denial control.

## Submitted live transactions

| Semantic action | Signature | Outcome | Finality |
|---|---|---|---|
| Fund company, two approvers, and recipient A with minimal devnet SOL | `T5DsyRsMDrnpyaEG1CfJV9qZttdZhViaB1W7k55zYQ11GuemDVuw26u8KH4WQs53XGZSfH2VTvkyi2zRMoJpMh2` | success | finalized |

Finalized balances after that transaction:

- Deployer: 2,520,882,537 lamports
- Company: 250,000,000 lamports
- Approver one: 5,000,000 lamports
- Approver two: 5,000,000 lamports
- Recipient A: 35,000,000 lamports

The funding transaction was serialized and durably recorded before submission, simulated successfully, sent once, and reconciled by its exact signature.

## Current funding blocker

The deployer owns no token account for Circle devnet USDC. A read-only inventory found only two unrelated mints. The live runner therefore stopped before creating or submitting a USDC funding transaction.

Circle's official public faucet supports Solana devnet and dispenses 20 test USDC, but its request is protected by reCAPTCHA. The safe resumption is to request faucet USDC to the deployer public key `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`; the runner will then transfer only 20,000 base units (0.02 USDC) into the isolated company, within the experiment cap. The faucet credential/UI action cannot be automated or bypassed here.

## Work not yet performed

- CompanyVault/eATA initialization: not submitted
- Permission creation/delegation: not submitted
- Approvals: not submitted
- Payment execution: not submitted
- Successful private payments: 0
- Private USDC outflow: 0
- Live access-control matrix: pending
- Live negative simulations: pending

No result is claimed for PER payment atomicity or privacy until authorized positive controls and matched unauthorized controls run successfully. No mainnet action occurred.
