# Live MagicBlock PER evidence

Last updated: 2026-09-26T17:43:26Z

Status: **BLOCKED BEFORE DEPLOYMENT — no on-chain experiment transaction has been submitted**

## Fixed scope

- Network: Solana/MagicBlock devnet only
- Expected genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`
- Base RPC: `https://rpc.magicblock.app/devnet`
- PER: `https://devnet-tee.magicblock.app`
- TEE identity: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`
- Program: `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`
- Circle devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Artifact SHA-256: `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`
- Artifact size: 460,760 bytes
- Expected upgrade authority: `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`

## Successful read-only gate

Before the loader was invoked, read-only checks returned the exact expected
genesis, TEE validator, mint, six decimals, program ID, and program absence.
The deployer held 5,160,560,297 devnet lamports. The RPC returned these rent
values:

- ProgramData (460,805 bytes): 2,341,539,640 lamports
- Program account: 833,120 lamports
- Temporary buffer: 2,341,499,000 lamports

The net deployment plus bounded setup fits the 3.5 SOL spend limit, and the
temporary peak allocation fits the deployer balance.

## Deployment delivery and reconciliation

1. A guarded command timed out during a read-only account check before the
   loader command was reached. Shell short-circuiting prevented any write.
2. After reconciling zero program/buffer balances, one loader invocation was
   made through the fixed RPC with `--use-rpc`, a dedicated known buffer,
   `--max-sign-attempts 1`, and the exact artifact/program keypair.
3. The CLI returned `AccountNotFound ... error sending request` before
   producing any transaction signature.
4. Immediate reconciliation at the same current devnet slot showed:
   - program balance: 0 lamports;
   - dedicated buffer balance: 0 lamports;
   - deployer balance: unchanged at 5,160,560,297 lamports.

Those three independent state checks prove no buffer creation/upload, program
deployment, fee debit, or other blockchain write landed. There is no unknown
signature and no deployment signature/slot/ProgramData account to report.

## External blocker

The fixed base RPC currently answers genesis and balance requests, but
`getAccountInfo` and `getMultipleAccounts` repeatedly time out for absent
accounts, the System Program, and the existing USDC mint across base64,
jsonParsed, processed, and confirmed variants. The Solana upgradeable-loader
CLI requires those account reads, so deployment, post-deployment byte
verification, funding, setup, and PER testing cannot safely proceed.

No alternate RPC was used because the authorization pins all blockchain
activity to `https://rpc.magicblock.app/devnet`. No custom loader was attempted
because it would bypass the required reconciliation safeguards while the same
account-read outage prevents verification.

## Current live results

- Deployment: not landed; no signature
- Setup/delegation signatures: none
- Approval signatures: none
- Payment execution signatures: none
- Successful private payments: 0
- Private USDC outflow: 0
- Access-control matrix: not run on live accounts
- Live negative simulations: not run
- Recipient self-onboarding: locally constructed and tested; not yet proven live
- Mainnet actions: none

## Exact safe resumption point

Wait until `getAccountInfo` succeeds on the fixed base RPC. Then reverify the
exact genesis, artifact/keypair, zero program balance, zero known-buffer
balance, deployer balance, and expected authority. Only after those checks may
the same loader command be invoked again. After deployment, reconcile its
signature and deployed bytes before any funding or setup transaction.
