# Live MagicBlock PER evidence

Last updated: 2026-09-27

Status: **DEPLOYED; LIVE SETUP AND TWO APPROVALS FINALIZED; SINGLE DIRECT PAYMENT ATTEMPT REJECTED AT PER INGRESS**

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

Security note: an earlier verbose CLI confirmation echoed a now-rotated environment-provided RPC URL into transient tool output. Neither the retired credential nor its replacement is present in repository files or commits.

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
| Fund isolated company with 0.02 Circle devnet USDC | `569treCJgDmWXt8DAaxs4dWcnJgBs2h1iqn73cdfAFmnJba9yJmQwWMiiwN8GXvR6gRR86QnRKGotpzcEWtHE3hB` | success | finalized |
| Initialize CompanyVault and deposit 0.02 USDC | `5M2BKzFeGaAcSDi5joNdkMwZkGhSnniaHvRnT1xHfn6wQ8ySqGDpcWj8D4RT5HzGrJzDx3Gagk7MvH6ZbiPyfT9Z` | success | finalized |
| Configure custody-eATA access | `5vtKFwZXD5eT8nyGW4neQXawqxDiTpGoTNVQeEyU7GSXkV7gTxjfvbcPWSBbut56p8achamTE9QS7DJAfioH4jH5` | success | finalized |
| Delegate custody eATA to pinned TEE | `4HDi6nPBmDn972FDYErsbQw2BRfFJSxC351Y5MTdiT5DTdqytHn7MoNZcdNSaQNDT6LzB4tYHtQKc2txzS8NQh2k` | success | finalized |
| Recipient A self-onboards and delegates its eATA | `4tvW3HkES3gWZpeE57J7dFFV8kUXWmvNeEA5sw21ArEmqnrb53Ag9wLpUaWrASCjgpHcuZD78JbZfsATLHWDW85x` | success | finalized |
| Initialize payment-A intent/receipt shells | `3WyseMBCCdrAN9yYBPASDxsd7QWNWBb85EPqFafCKWwzqGXgAHRKdSjofa4WWYLno4u6MooxeH3n2ARGQkajs3R7` | success | finalized |
| Delegate CompanyVault to pinned TEE | `5UByT5EcBAX6xat7oUiurchQCmVQsmrqZAWsAmo29CDhbKqic26X7d8BcR8nEKg3Uf4tVqZTfd1Sigh3MAG5rsC2` | success | finalized |
| Delegate payment-A intent to pinned TEE | `5TmN7XdgkR81mrGs3r8KdwqmK6CHV2YSrmB3nyULNVSVJHMyCRV5BLn5ozQspv4ML3XQp8n7Ksm1d6Ni6DoAkZge` | success | finalized |
| Delegate payment-A receipt to pinned TEE | `3ANXgF3h4xpyiRBtqKuWe9byJ5bXDLbrSNgKHubGMqnQ1kGGSU3uWEA35EKhkMi6h7KnprjzNkW2ndvvfKYoy9Qo` | success | finalized |
| Initialize recipient A canonical token view | `4qaJmxdd4NzFLq5vqfymuePeA6JQAF5Asay4XgCJWJm62WRgKLsasY24FWfyf6JzxmNRsUzsJkw8zkwzuUHTg4KD` | success | finalized |
| Configure vault private access | `4k5KFg612q2BrRrtpqWVe5ALB5E9k7MHm7Ks8aaDeF25Z1nhRx6B7nB3Je1Qk6Zgy1GK2c5Utbh8qefV7iXNgA2V` | success | finalized |
| Configure payment-A intent/receipt private access | `4A5nQnthUqwWTpE2M26HA4ER3CHSoywLhPEKZpQCQ3sbhqTcy6rduspheNScJwXoojy4MQ9TXsWbWoeZkfUskAzZ` | success | finalized |
| Bind payment A to the approved amount/recipient/revision/hash | `65X77KyYEJj8G4kLu9PaLqFUzBPA4jioHrispRsrr9bWPoFh1thniEoo2QgE1c7WXq9upGt5nMR4HRVb7ZwKuu46` | success | finalized |
| Approver one approves payment A | `5yAJWmMzsV42cfbRrJQtfC1PfidgNrTPD2DwQ6Ac93eVB6FEtCRnWLiRDDhP5QYAsQr7HzY4wfTEFtfp4xpdhdyc` | success | finalized |
| Approver two approves payment A | `HBLnf1gavgZPVeKfGt2QKcb8jD7oUeVyhyYaejMkrsNvgg9Lip4geWpVCFnSWTVRR8Rc6QtC8f35uDAbfioac9b` | success | finalized |
| Restore authority-only custody-PDA member on source eATA permission | `2Buc1NDoC4awDX6TiAuLAPp7zwTtDLDG9pTafuDVYMd8cpLutNnnAsxYKQoNqPepo4mrAyz5AR6VkqBamHDz1oGS` | success | finalized |
| Restore authority-only custody-PDA member on destination eATA permission | `iyJBDBgDWYG7LLKXc6drTeKT4gyVgWhJU5gTxo1UNRQg8JJsqMffs7RrjTU8Y8mdUYX2m7zcVJvJzockQGyKyFC` | success | finalized |
| Direct 0.01-USDC `execute_private_payment`, bypassing preflight | `32rzAV4Ddmj6JwmoSUvkvLFqetNrK84DvtcAWJ6KsDqcAi3drCiHFBBG1axuYYeFzdnBadrDgFSkmfNhbpMTWtVW` | PER ingress rejection (`HTTP 403 Access denied`); state unchanged | no signature status |

Finalized balances after that transaction:

- Deployer: 2,520,882,537 lamports
- Company: 250,000,000 lamports
- Approver one: 5,000,000 lamports
- Approver two: 5,000,000 lamports
- Recipient A: 35,000,000 lamports

Every submitted setup transaction was serialized and durably recorded before submission, sent once, and reconciled by its exact signature. All 18 setup signatures remain finalized successes; none is unknown. The direct payment transaction was also signed and durably recorded before networking, then submitted exactly once with `skipPreflight: true` and `maxRetries: 0`. Its precomputed signature has no PER status and its state remained unchanged, so it is classified as a PER ingress rejection rather than an SVM failure. No replacement transaction was constructed.

Finalized Circle-USDC balances after funding:

- Deployer: 19.98 USDC
- Isolated company: 0.02 USDC before the program deposit

## Final account-by-account PER probe

The company authenticated through the documented signed-challenge flow. Every request below reached `https://devnet-tee.magicblock.app`; every required account was returned and none was filtered.

| Role | Address | Returned | PER owner | Relevant private permission |
|---|---|---:|---|---|
| CompanyVault | `GhjDy7sMFCfzt4EnrXNHv39y8yDCaeEXo7VfuTd7yE1M` | yes | `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo` | program `0`; company `15`; accountant `14` |
| Source custody eATA | `DF8HFeS1wqKefrQMv2mxkZHLJTYhAo3vzdRDq2Yc62wk` | yes | `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2` | Delegation Program `0`; company `15`; vault PDA `1` |
| Source custody PER token view | `CRSEsAaPyxFjP865Nj5jtNBQcKzcJ2dyRqFkiXebA4P8` | yes | Token Program | same source-eATA permission |
| PaymentIntent | `3Ks7Jv86EazhKuk8T2h4ZCkuCKmnPtCkUCtj2LcWgmBw` | yes | isolated program | program `0`; company `15`; approver one `15`; approver two `15` |
| PaymentReceipt | `2Ut3YhoBgkNRnWgGynz8NqrzL58t5Up6LbWEJuLbgWqW` | yes | isolated program | program `0`; company `15`; accountant `14`; recipient A `14` |
| Destination recipient eATA | `AbwrpUUoT31AngPnx8aEkEfgKQkG5QgzwB4p3wMCtb2a` | yes | eSPL Token Program | Delegation Program `0`; company `15`; recipient A `15`; vault PDA `1` |
| Destination recipient PER token view | `dnSo4DZTMn9eCANBubYDcampZbspaA6Pt97iBUgBLvt` | yes | Token Program | same destination-eATA permission |

Associated permission addresses:

| Resource | Permission | Base | Authenticated PER |
|---|---|---|---|
| CompanyVault | `21dpzCnXEspUEWccSZsBE32wFJow3zaPdvBtrDDaabxw` | absent, as expected for ER-only permission | returned; private; exact members above |
| Source custody eATA | `7ka51nn41qkrfgSfwpx2WvEQiaoDvgkt3zq1TL2fofqj` | returned | returned; byte-equivalent decoded members/flags |
| PaymentIntent | `6BreWVV8ihzF1wd2p3f4KNkJGMWXWmySfqz9wyNxbveN` | absent, as expected for ER-only permission | returned; private; exact members above |
| PaymentReceipt | `8sdAQbjnZnbCfdpJfJVcxT7PrjfWWtDRq3TCp4a1LzMW` | absent, as expected for ER-only permission | returned; private; exact members above |
| Destination recipient eATA | `A8kdUTXLB9mKrsvkNJAMsjMnfZJYJ2PaGXhHSP96j4FK` | returned | returned; byte-equivalent decoded members/flags |

No inaccessible individual account or stale base/PER permission was found. Company already has destination-eATA visibility from the previously finalized configuration; no additional access was granted during this diagnosis.

## Execution result and blocker

The earlier exact valid `execute_private_payment` simulation returned PER HTTP 403 `Access denied` before SVM execution. Under the later one-attempt authorization, the same fixed 10,000-base-unit payment was constructed with a fresh PER blockhash and submitted directly once, without another simulation and with `skipPreflight: true`, `preflightCommitment: confirmed`, and `maxRetries: 0`.

Direct-attempt evidence:

- precomputed signature: `32rzAV4Ddmj6JwmoSUvkvLFqetNrK84DvtcAWJ6KsDqcAi3drCiHFBBG1axuYYeFzdnBadrDgFSkmfNhbpMTWtVW`
- last valid block height: 377068403
- block height at reconciliation: 377062940
- submission attempts: exactly one
- PER submission response: HTTP 403 `Access denied`
- authenticated PER signature status: absent
- PER transaction/log record: absent
- isolated program invocation/success: absent
- SPL Token CPI invocation/success: absent
- custody balance before/after: 20,000 / 20,000 base units
- recipient-A balance before/after: 0 / 0 base units
- PaymentIntent before/after: APPROVED, approval mask 3, approval count 2, not executed
- PaymentReceipt before/after: INITIALIZED, amount 0
- serialized signed transaction: retained only in the ignored mode-0600 fixture; not printed or committed

This matches the prescribed `HTTP 403 + no signature status + unchanged state` classification: **PER ingress rejection before SVM**. It is not evidence of a program failure or token-CPI failure. Because every required account and permission succeeds individually, the remaining limitation is an undocumented transaction-level PER ingress or account-combination rule. No permission was broadened, no second transaction was constructed, and no retry was attempted.

Current state remains:

- custody: 20,000 USDC base units
- recipient A: 0
- PaymentIntent: APPROVED with two distinct approvals; not executed
- PaymentReceipt: INITIALIZED; amount 0
- successful payment executions: 0
- private USDC outflow: 0

The final replay/changed-amount/wrong-recipient-or-destination/insufficient-approval simulations and post-payment access matrix cannot be truthfully completed until a valid transaction reaches SVM. No mainnet action occurred.
