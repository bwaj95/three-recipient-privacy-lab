# PDA Custody Private Payment Status

## Safety guardrails

- Devnet only; never use mainnet.
- Do not print `.lab` contents, secret keys, seed phrases, or authentication tokens.
- No deployment or program upgrade without explicit user approval.
- No real transaction submission without separate explicit user approval.
- Simulations and read-only RPC calls are allowed.
- Preserve the completed wallet-owned experiment and its transaction history.
- Reconcile every submitted signature before considering another submission.

## Scope

- Branch: `experiment/pda-custody-private-payment`.
- Objective: prove the documented program-owned eATA custody architecture with a new program ID and isolated state, two-approver `PaymentIntent`, PDA-signed USDC CPI, and atomic private `PaymentReceipt` update.
- Existing program `FnKajG15Hu4tTENtENAHCau4krTWJUyXUGgdVuLpbTzq` is out of scope and must not be modified or upgraded.

## Activity log

### 2026-09-26 — Baseline verification and branch isolation

- Files inspected:
  - Full `DEBUG_STATUS.md` history.
  - Root Git status, commit history, tracked-file inventory, `.gitignore`, reports, backup inventory, and `.lab` file metadata only.
  - MagicBlock skill instructions plus its architecture, security, and Ephemeral SPL Token references.
- Evidence:
  - `main` and `origin/main` both point to commit `6aea403` (`feat: atomic private USDC payment with private receipt`).
  - No tracked or staged changes existed before branching.
  - Untracked `.agents/` and `skills-lock.json` are skill-installation artifacts and are being preserved outside experiment changes.
  - The completed wallet-owned payment is committed and documented; its ignored `.lab` history remains present and was not read or modified.
  - The previous 403 isolated canonical wallet ATAs passed to a custom program. The new target is the distinct documented direct eATA model derived under the Ephemeral SPL Token program for a program PDA owner.
- Commands run:
  - `git rev-parse --show-toplevel`; `git status --short --branch`; `git log`; `git diff --stat`; tracked/report/backup inventories; read-only status and source searches.
  - Read the complete `magicblock` skill and required local architecture/security/eSPL references.
  - Created branch `experiment/pda-custody-private-payment` (the sandboxed attempt could not write `.git`; the approved Git-only retry succeeded).
- Changes made:
  - Created this status file on the isolated branch. No existing experiment source or `.lab` state changed.
- Tests/simulations:
  - None yet for the new experiment.
- Current blocker:
  - Exact current official smart-contract-integration API, matching installed/upstream source, and the new-program directory layout still need verification before implementation.
- Exact next step:
  - Retrieve and pin the official integration example/API; inspect installed dependency and toolchain versions; then scaffold a separate program with a new, non-secret program identity and isolated client/state paths.

### 2026-09-26 — Official custody architecture pinned

- Files inspected:
  - Current official `smart-contract-integration.md` (344 lines; page modified 2026-09-16).
  - Official `magicblock-engine-examples` commit `e8393c60a82f73259a39abe807c6273a83659d0a`, especially `binary-prediction` program, CPI helpers, client, manifests, and tests.
  - Current `ephemeral-spl-token` main commit `0d2428150f9ee9867ec5c3a388834b914eee2c2d`, including the framework-agnostic `ephemeral-spl-api` instruction enum and eATA/global-vault derivations.
  - Installed JavaScript/Rust SDK sources and local toolchain versions.
- Evidence:
  - The official model creates an eATA at `[custody PDA, mint]` under `SPLxh1...`, deposits into it through the global vault, and delegates that eATA with `DelegateEphemeralAta`.
  - On the ER, the official example passes the custody PDA's canonical ATA address to the app instruction; PER materializes the delegated eATA balance there as an SPL Token account. The program then calls the standard Token Program with `CpiContext::new_with_signer` using the custody PDA seeds.
  - This is distinct from the prior wallet-owned canonical-ATA mapping: the underlying eATA owner/token authority here is the application PDA, and setup uses the direct eSPL custody lifecycle.
  - Current upstream `ephemeral-spl-api` provides authoritative instruction discriminators and eATA/global-vault seeds; the experiment will pin its Git revision instead of copying guessed bytes where feasible.
  - Local versions: Anchor CLI 1.0.2, Solana CLI 3.1.10, Rust 1.98.0, Node 24.20.0; the proven workspace uses Anchor crates 1.0.2 and `ephemeral-rollups-sdk` 0.16.2.
- Commands run:
  - Read-only downloads of the official Markdown page and pinned upstream API files.
  - `git show` against the checked-in sparse reference repository; targeted `rg` over installed SDK/Cargo sources; local tool version checks.
- Changes made:
  - Updated this status file only. No program or client implementation exists yet.
- Tests/simulations:
  - None; this milestone established source/API provenance.
- Current blocker:
  - The separate workspace, new program identity, exact state layouts, and local test harness still need implementation.
- Exact next step:
  - Scaffold `pda-custody/` as an independent Anchor workspace, generate a new ignored program keypair/public program ID without printing secret material, and implement the minimal custody/intent/receipt state machine plus deterministic validation tests.

### 2026-09-26 — Isolated program scaffold and first compile

- Files inspected:
  - Official eSPL permission creation/delegation processors, permission update CPI source, installed SDK permission flags, and official `binary-prediction` PDA-signed transfer helper.
- Evidence:
  - A private direct eATA permission initially makes the eATA owner PDA its authority; the application can use that PDA's signer seeds to update the permission with company/accountant/approver/recipient members before delegation.
  - The official ER execution source uses the custody PDA's canonical ATA as the SPL-compatible view while retaining the separately derived/delegated eATA as custody state.
  - New isolated program ID: `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`. Its keypair is ignored under `pda-custody/target/` and was never printed.
- Commands run:
  - Generated the new program keypair silently and printed only its public key.
  - `cargo fmt`; `cargo check -p pda-custody-private-payment`.
  - Cargo downloaded only the pinned official eSPL API and wheels dependencies after sandbox approval.
- Changes made:
  - Added independent `pda-custody/` Anchor/Cargo/npm workspace and manifests.
  - Added program constants, state accounts, errors, deterministic validation, official eSPL CPI builders, and the first complete instruction surface.
  - Implemented vault/eATA initialization and delegation, private permission setup, sparse intent/receipt shells, state delegation, two distinct stored approvals, recipient revision, domain-separated intent hash, and one-instruction PDA-signed execute/update flow.
- Tests/simulations:
  - First Rust compile passes. Only the known Anchor macro `unexpected cfg solana` warnings remain.
  - No network simulation, deployment, or transaction submission occurred.
- Current blocker:
  - Focused Rust negative tests, JavaScript model/client tests, full Anchor BPF build, and client transaction construction are not yet complete. The eSPL setup path also needs line-by-line review for devnet-idempotence and private permission lifecycle before any deployment request.
- Exact next step:
  - Add deterministic Rust tests for approval, binding, replay, and status failures; add JavaScript derivation/state-machine tests; then run both suites and fix any issues before building the deployable artifact.

### 2026-09-26 — Rust validation suite green

- Files inspected:
  - `validation.rs`, program state layouts, execution constraints, and the generated test fixture.
- Evidence:
  - The validator accepts the intended two-approval execution and rejects one approval, a duplicate approver, an unknown approver, wrong recipient, wrong destination eATA, wrong amount, wrong mint, stale recipient revision, mismatched/reused payment ID, already-executed intent, already-paid receipt, a company-wallet authority substitution, and an altered intent hash.
  - The custody token account owner is required to be the vault PDA, so the company signer is not a valid SPL Token authority for direct withdrawal.
- Commands run:
  - `cargo test -p pda-custody-private-payment`.
- Changes made:
  - Added the deterministic Rust validation tests alongside the pure validation logic.
- Tests/simulations:
  - 15 Rust tests passed; 0 failed. No RPC simulation or chain write occurred.
- Current blocker:
  - Transaction-level rollback cases require the JavaScript atomic ledger harness, and the address constants plus deployable Anchor artifact still need independent verification.
- Exact next step:
  - Add and run JavaScript tests for all required failures, especially failed-token-CPI and failed-post-CPI state-update rollback; verify every pinned address constant; then run the full Anchor build.

### 2026-09-26 — Address defect fixed and JavaScript rollback suite green

- Files inspected:
  - Rust public-key constants, current official eSPL/USDC/TEE values, JS PDA/hash model, npm lockfile, and all 13 required negative-test cases.
- Evidence:
  - The first public-key test exposed that the manually copied TEE byte array encoded `PqnBa...`, not the pinned devnet TEE `MTEWGu...`. The array was corrected from the public base58 value and now round-trips exactly.
  - The direct eATA and canonical PER SPL-view token account derive to different addresses; both are independently bound into the intent hash.
  - The atomic JS model copies transaction state and publishes it only on success. A token-CPI failure leaves balances/intent/receipt unchanged, and a forced failure after the modeled CPI also discards the balance movement and state mutations.
  - `npm install` reported 11 audit findings in transitive dependencies (3 low, 3 moderate, 5 high). No automatic or forced dependency mutation was performed.
- Commands run:
  - `cargo fmt --all`; `cargo test -p pda-custody-private-payment` (before and after the constant correction).
  - `npm install --ignore-scripts`; `npm test`; direct Node test execution for per-case output.
- Changes made:
  - Corrected the devnet TEE public-key byte array and added exact public-key round-trip tests.
  - Added `src/model.mjs` and `tests/model.test.mjs` with deterministic derivation, hashing, approval, execution, replay, bypass, and rollback coverage.
  - Added the isolated npm lockfile/dependency tree.
- Tests/simulations:
  - Rust: 16 passed, 0 failed.
  - JavaScript: 19 passed, 0 failed, including every requested negative condition and both atomic rollback conditions.
  - No RPC simulation, deployment, program upgrade, or transaction submission occurred.
- Current blocker:
  - The Anchor account/CPI review and full deployable build are still pending; the client must also construct the exact base setup and PER simulation requests without exposing or submitting secrets.
- Exact next step:
  - Complete line-by-line account-order and permission-lifecycle review against current official eSPL source, fix any discrepancy, then run `anchor build` and implement the simulation-only client against the generated IDL.

### 2026-09-26 — SBF stack issue fixed; Anchor build green

- Files inspected:
  - Current upstream eSPL processors for initialize-eATA, initialize-global-vault, PDA-authorized deposit, create-eATA-permission, and delegate-eATA.
  - SDK PER permission creation/update implementation and the MagicBlock skill's delegated-PDA permission lifecycle.
  - Generated Anchor account validation and build diagnostics.
- Evidence:
  - Every hand-built eSPL CPI meta and discriminator matches the pinned upstream processor account order.
  - The first `anchor build` compiled but reported unsafe generated stack frames: 5632 bytes for `InitializeVault::try_accounts` and 4416 bytes for `ExecutePrivatePayment::try_accounts`, above Solana's 4096-byte limit.
  - Setup was split into smaller instructions and large execution accounts were boxed. The second full build emitted no stack-overflow diagnostic.
  - The generated IDL, source `declare_id!`, Anchor keypair public key, and `Anchor.toml` all resolve to the isolated program ID `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`.
- Commands run:
  - `anchor build` (initial diagnostic and post-fix verification).
  - `cargo fmt --all`; `cargo check`; `cargo test`; `npm test`; `anchor keys list`; artifact/IDL inspection and SHA-256.
- Changes made:
  - Preserved `lib.rs.before-stack-split`, `state.rs.before-stack-split`, and `validation.rs.before-stack-split` before the material refactor.
  - Split setup into vault/eATA funding, custody-eATA permission configuration, global-vault eATA delegation, and custody-eATA delegation. This does not change the required atomic payment boundary.
  - Added `custody_access_configured` to on-chain state and execution validation.
  - Boxed the six deserialized accounts in the atomic execution context.
- Tests/simulations:
  - Rust: 16 passed; JavaScript: 19 passed after refactor.
  - Anchor SBF build passed with a 507 KiB `.so`; SHA-256 `1e9fb775ee02ca9c0fbc72887e5e1e9360930c20c213fb97277c36f4697b2c45`.
  - No RPC simulation, deployment, upgrade, or transaction submission occurred.
- Current blocker:
  - A PER simulation is impossible until this new isolated program is deployed with user approval. Before requesting that approval, the simulation-only client and deterministic instruction/account-meta tests must be completed and read-only devnet assumptions verified.
- Exact next step:
  - Implement a fail-closed devnet client that derives and validates every setup/PER account, builds the generated-IDL instructions, and permits simulation only; add meta/IDL tests and perform read-only devnet genesis/program-account checks.

### 2026-09-26 — Permission lifecycle and simulation-only client verified

- Files inspected:
  - Direct Permission Program `UpdatePermissionCpi` source, ER-local `CreateEphemeralPermissionCpi` source, generated IDL, client instruction metas, and official eATA owner/permission lifecycle.
  - Isolated `.lab/pda-custody-private-payment.json` metadata and public-key integrity through the client loader; secret arrays were neither printed nor logged.
- Evidence:
  - The base-chain direct eATA permission must be updated through the Permission Program by the vault PDA signer; the earlier ER-local update helper was the wrong lifecycle stage and was replaced.
  - Approvers need `AUTHORITY_FLAG` only on the delegated `PaymentIntent`, because each approval is a write. Vault, receipt, and custody eATA grant write authority only to the company; accounting viewers retain transaction-view flags.
  - Recipient eATA setup grants company and recipient authority/view before delegation, while both approvers receive view-only access.
  - The generated client has no transaction-submission API. Its only network execution operation is authenticated simulation, with before/after persistent-account fingerprints that fail if simulation changes state.
- Commands run:
  - Targeted source/IDL/meta inspection; `npm test`; `node scripts/pda-custody-private-payment.mjs plan`; `node scripts/pda-custody-private-payment.mjs check`.
- Changes made:
  - Added `src/client.mjs`, the fail-closed command wrapper, client tests, and isolated state initialization.
  - Corrected direct-eATA permission update and intent approver authority flags.
  - Added recipient eATA permission/update/delegation construction and exact instruction-meta tests.
- Tests/simulations:
  - Client/model JavaScript suite reached 24 passing tests.
  - Read-only devnet check verified genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, TEE identity `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, Circle devnet USDC mint with six decimals, and that the isolated program is not deployed.
  - No chain write or transaction submission occurred.
- Current blocker:
  - A real compiled-program atomic rollback proof was still needed locally; PER simulation remains unavailable until deployment approval.
- Exact next step:
  - Load the compiled artifact and deterministic fixture accounts into a temporary local validator, simulate the one-instruction execute path, and verify both pre-CPI and post-CPI failure rollback.

### 2026-09-26 — Compiled local-SVM atomicity proof completed

- Files inspected:
  - Generated account layouts and IDL field names, compiled program logs, simulated returned accounts, and persistent validator account snapshots.
- Evidence:
  - The first local fixture failed with `WrongCustodyEata`; decoding the fixture proved the Anchor 1.0 Borsh coder expects snake_case field names. CamelCase fixture keys had silently encoded default public keys. The harness was corrected; production code was not implicated.
  - Successful simulation invoked the SPL Token Program at CPI depth 2, moved exactly 10,000 base units (source `1000000 -> 990000`, destination `2000000 -> 2010000`), set `PaymentIntent.status = EXECUTED`, and set `PaymentReceipt.status = PAID` in the same top-level program instruction.
  - An insufficient-source fixture failed in the token CPI and left both balances, intent, and receipt unchanged.
  - A feature-gated local-only rollback probe transferred first, mutated the receipt, then returned `InvalidArgument`; the SVM rolled the source, destination, and receipt back to their exact persistent pre-state. The test-only instruction is absent from the normal IDL/artifact.
  - Simulations never changed persistent validator state and submitted zero transactions.
- Commands run:
  - `node tests/local-svm.integration.mjs` against a temporary `solana-test-validator` and preloaded deterministic accounts.
  - `anchor build -- --features test-failure-injection`; preserved the test artifact/IDL; then `anchor build` without the feature and verified the production IDL excludes the probe.
- Changes made:
  - Added `tests/local-svm.integration.mjs` and fixed its Anchor fixture encoding to snake_case.
  - Added the compile-time-only `test-failure-injection` feature and rollback probe.
  - Preserved `lib.rs.before-rollback-injection`, `Cargo.toml.before-rollback-injection`, and `local-svm.integration.mjs.before-rollback-injection` before the material test changes.
- Tests/simulations:
  - Local compiled-program success simulation: `err: null`; PDA-signed token CPI observed; intent EXECUTED; receipt PAID.
  - Failed token CPI: custom Token Program error; balances and program state unchanged.
  - Forced failure after successful token CPI: `InvalidArgument`; balances and receipt unchanged after rollback.
- Current blocker:
  - Local runtime proof is complete. The isolated program remains undeployed, so an actual MagicBlock PER simulation cannot yet execute.
- Exact next step:
  - Run the final full suite and read-only devnet check, freeze the normal artifact hash, inspect the repository diff/backups, and stop for explicit deployment approval.

### 2026-09-26 — Final pre-deployment verification

- Files inspected:
  - Normal and feature-gated artifacts/IDLs, all Rust and JavaScript test output, final instruction plan, and current devnet identity/genesis/program presence.
- Evidence:
  - Normal artifact SHA-256: `62625984161b1ee7017941387574d52a410d20953e46027ac95e3a63509b2f10` (521,576 bytes).
  - Feature-gated rollback-test artifact SHA-256: `155ccdeb370206b923f9b2812dbde89077fdad1ff5d9e071ccc7f1faee74b6c2`; it is a test artifact only and is not the deployment candidate.
  - The normal generated IDL contains no `test_fail_after_cpi` instruction.
  - The execution plan contains exactly one top-level execution instruction with eight account metas. The setup and two independent approval instructions are separate lifecycle transactions; the payment CPI plus EXECUTED/PAID state changes share the required atomic execution boundary.
  - Read-only devnet check again reports `programDeployed: false` and `blockchainWrites: 0`.
- Commands run:
  - `anchor build`; `cargo test --workspace`; `cargo fmt --check`; `npm test`; `node scripts/pda-custody-private-payment.mjs plan`; `node tests/local-svm.integration.mjs`; `node scripts/pda-custody-private-payment.mjs check`; artifact/IDL SHA-256 and absence checks.
- Changes made:
  - Finalized the normal production candidate and local rollback-test artifacts.
  - Added `pda-custody/README.md` documenting the trust boundary, PDA seeds, atomic instruction, safe local commands, and separate deployment/submission approval gates.
  - No existing wallet-owned experiment files or transaction histories were modified.
- Tests/simulations:
  - Rust: 18 passed, 0 failed (only the known Anchor macro `unexpected cfg solana` warnings).
  - JavaScript: 24 passed, 0 failed.
  - Anchor normal build: passed with no SBF stack overflow diagnostic.
  - Local compiled-program SVM suite: all success and rollback assertions passed.
  - Devnet/PER: read-only checks passed; no PER execution simulation was attempted because the program is not deployed.
- Current blocker:
  - Explicit user approval is required before deploying the new isolated program. PER simulation, private permission/read isolation on the real PER, and the later separately approved 0.01 devnet USDC transaction cannot be demonstrated before that deployment.
- Exact next step:
  - After explicit deployment approval, first re-verify devnet genesis and deploy only `pda-custody/target/deploy/pda_custody_private_payment.so` under isolated program ID `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`; then reconcile the deployment signature and stop again before any setup/payment transaction submission.

### 2026-09-26 — Final security/provenance audit blocked deployment

- Files inspected:
  - Normal production IDL and ELF, Rust state/permission/execution code, eSPL CPI helper, isolated public identity-role names, program keypair public key, Git tracking/ignore rules, and configured Git remote.
- Evidence:
  - The normal IDL has 14 instructions and no failure-injection instruction; the normal ELF likewise contains no failure-injection symbol.
  - `initialize_vault` and `execute_private_payment` are the two token-moving instruction paths. Only execution directly invokes SPL Token with the vault as authority, but initialization makes the vault sign the eSPL deposit CPI chain.
  - Program keypair, IDL, and `declare_id!` all resolve to `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`.
  - Normal artifact SHA-256 remains `62625984161b1ee7017941387574d52a410d20953e46027ac95e3a63509b2f10` (521,576 bytes).
  - `.lab`, `target`, keypairs, node modules, compiled `.so` files, and secret environment files are ignored and untracked.
  - Deployment-blocking permission mismatch: there is no dedicated accountant identity. `PaymentReceipt.accountant` is set to `approver_one`, who can approve payments. `accounting_members` also grants the recipient view flags on the vault and on every receipt created for that vault.
- Commands run:
  - Production IDL inventory with `jq`; targeted source/ELF searches; `solana address` on the ignored keypair; `sha256sum`; `git ls-files`; `git check-ignore`; safe identity-role-name inspection; sanitized remote inspection.
- Changes made:
  - Added `pda-custody/SECURITY_AUDIT.md` with the ten requested findings and instruction inventory.
  - Added a deployment-blocked warning to `pda-custody/README.md`.
  - No program source, IDL, artifact, `.lab` state, secret, or on-chain state changed.
- Tests/simulations:
  - Read-only provenance checks only. No deployment, transaction simulation, or blockchain write occurred.
- Current blocker:
  - The user's deployment approval was conditional on every check passing and bound to the existing artifact hash. Checks 1, 2, 3, and the literal form of 5 fail, so that authorization is not operative and deployment is prohibited.
- Exact next step:
  - Commit and push the audited source/documentation branch as requested, without merging or deploying. Then obtain authorization to implement a separate accountant and per-receipt recipient visibility; rebuild/retest and request new deployment approval for the resulting new artifact hash.

### 2026-09-26 — Audited branch committed and pushed; no deployment

- Files inspected:
  - Staged path list, staged diff whitespace, binary-file inventory, secret-pattern scan, branch name, origin repository, and remote branch heads.
- Evidence:
  - Only the 22 intended experiment source, test, manifest, and documentation files were committed. `.lab`, `target`, keypairs, build artifacts, node modules, local backup files, `.agents`, and `skills-lock.json` were excluded.
  - Source/documentation commit: `67450a9` (`feat: add PDA custody private payment experiment`).
  - HTTPS push lacked an interactive GitHub username and made no remote change. Read-only SSH access to the same repository succeeded, and the branch was then pushed through SSH.
  - Remote `main` remained at the pre-experiment commit; no merge or pull request was performed.
- Commands run:
  - Explicit `git add` path list; `git diff --cached --check`; staged path/binary/secret scans; `git commit`; HTTPS `git push` attempt; read-only SSH `git ls-remote`; SSH `git push` of only `experiment/pda-custody-private-payment`.
- Changes made:
  - Added this documentation-only handoff entry after the initial source commit/push.
- Tests/simulations:
  - No additional runtime test was necessary because the post-test changes were documentation only. No blockchain query beyond prior read-only checks and no blockchain write occurred.
- Current blocker:
  - Deployment remains prohibited because the conditional security checks did not all pass. No deployment signature or slot exists.
- Exact next step:
  - Commit and push this final documentation-only entry, then stop and request explicit authorization to remediate the accountant/visibility design. Any rebuilt artifact will require a new hash-bound deployment approval.

### 2026-09-26 — Autonomous remediation authorization and baseline

- Files inspected:
  - MagicBlock skill plus current security, Ephemeral SPL Token, delegation, and debugging references.
  - Local branch/HEAD, remote experiment/main refs, worktree status, current program keypair public key, and prior artifact hash.
- Evidence:
  - Local and remote experiment branch both start at the required `b9ed75cba3d185f9b21465c19749567ba453f887`; remote `main` remains `6aea403fe7126ede6d6ab4a2661ef9b123f80b18`.
  - Only the previously documented skill-installation files and local backup files are untracked; no tracked change predated this remediation.
  - Isolated keypair still resolves to `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`; prior artifact hash remains `62625984161b1ee7017941387574d52a410d20953e46027ac95e3a63509b2f10` before remediation.
  - The first combined read-only devnet client check returned a transient `fetch failed`; no chain write was attempted and this is not being treated as a network or identity result.
- Commands run:
  - Local Git status/log/ref checks; read-only SSH `git ls-remote`; `sha256sum`; `solana address`; simulation-client `check` attempt.
- Changes made:
  - Updated this status log only.
- Tests/simulations:
  - No program test or blockchain simulation yet in this remediation phase.
- Current blocker:
  - The independent-accountant, recipient-specific receipt access, and repeated-payment model still require source/client/test changes before any deployment can be considered.
- Exact next step:
  - Back up current experiment source, redesign the vault and permission member builders for one independent accountant plus per-payment recipient isolation, extend the client/state to two recipients/payments, and update deterministic tests.

### 2026-09-26 — Core accountant and least-privilege redesign compiles

- Files inspected:
  - Existing Rust state layouts, permission member builders, approval context, receipt write path, eSPL permission/update source, JavaScript state schema, plan builder, and model/client tests.
- Evidence:
  - `CompanyVault` now stores an independent accountant.
  - Permission sets are split: vault = company authority + accountant view; custody eATA = company authority only; intent = company plus both approvers with authority; receipt = company authority + accountant view + only the selected recipient view.
  - `approve_payment` no longer receives or exposes `CompanyVault`; immutable approver keys are copied into each intent during configuration and approval operates only on that private intent.
  - Vault permission creation is a one-time idempotent instruction; each intent/receipt pair has its own idempotent permission-creation instruction.
  - Receipt accounting now copies `vault.accountant`, and recipient rotation rejects company/accountant/approver identities.
- Commands run:
  - Backed up current Rust/JS source and tests as `*.before-accountant-remediation`.
  - `cargo fmt --all`; `cargo check -p pda-custody-private-payment`; `cargo test -p pda-custody-private-payment`.
- Changes made:
  - Updated `state.rs`, `lib.rs`, `model.mjs`, and the first model assertions.
  - Began version-2 isolated client state with accountant, recipient A, recipient B, two random payment IDs, revisions 1/2, and recipient self-funded eATA onboarding.
- Tests/simulations:
  - Rust: 18 passed, 0 failed; only the known Anchor macro `unexpected cfg solana` warnings remain.
- Current blocker:
  - The generated IDL and local-SVM fixtures still describe the previous state schema; two-payment JS/client tests and live transaction orchestration are not yet complete.
- Exact next step:
  - Finish client/test migration, rebuild the IDL, update local-SVM account fixtures for the new layouts, then exercise both recipient permission plans and repeated-payment behavior locally.

### 2026-09-26 — Corrected local validation passes; deployment-cost gate under review

- Files inspected:
  - Corrected Rust program/state, JavaScript model/client, two-payment plans, compiled local-SVM fixture, production IDL, normal production ELF, program keypair, and repository tracking/ignore state.
- Evidence:
  - Independent accountant and per-receipt isolation are implemented. Receipt A and receipt B have distinct PDAs and distinct recipient members while sharing the same custody vault/eATA.
  - Rust permission tests prove: vault = company authority + accountant view-only; custody = company authority only; intent = company plus exactly two approvers; each receipt = company authority + accountant view-only + its selected recipient view-only.
  - Recipient self-onboarding uses the selected recipient as payer/signer for its eATA permission/delegation path and does not grant that recipient access to the company vault or custody eATA.
  - Compiled local-SVM execution proves a single `execute_private_payment` instruction performs a depth-2 PDA-signed token CPI and atomically moves 10,000 base units while transitioning intent to EXECUTED and receipt to PAID.
  - Insufficient-funds token CPI and a feature-only forced post-CPI failure both leave token balances, intent, and receipt unchanged.
  - Normal production IDL contains 15 instructions and no failure-injection instruction. The normal ELF contains no failure-injection symbol. Program ID is consistent across keypair/source/IDL/Anchor configuration.
  - Current normal artifact SHA-256 is `875af74661009e792c872398ffee91aa1a7d78b226424e691b450e24f778f151`; size is 532,880 bytes.
- Commands run:
  - `cargo fmt --all`; Rust check/tests; JavaScript tests; feature-gated Anchor build; local-SVM integration tests; normal Anchor rebuild; IDL/ELF/program-ID/hygiene inspections; two-recipient plan generation; artifact hash/size inspection; `solana program deploy --help`; deployment rent query.
- Changes made:
  - Updated isolated Rust program/state, client/model, and all three local test suites. Migrated only the isolated ignored `.lab` state to schema version 2 without printing secret material.
- Tests/simulations:
  - Rust: 18 passed, 0 failed.
  - JavaScript: 26 passed, 0 failed.
  - Compiled local-SVM: success, failed-token-CPI rollback, and forced post-CPI rollback all passed.
  - Normal Anchor production build passed without an SBF stack-frame diagnostic.
- Current blocker:
  - The fixed MagicBlock devnet endpoint did not return the rent sysvar to `solana rent`. At 532,880 bytes the standard rent estimate may exceed the authorized 3.5 devnet-SOL total-spend ceiling, so deployment is not yet safe.
- Exact next step:
  - Produce a normal size-optimized SBF artifact, rerun production provenance checks, and obtain an exact read-only rent estimate from the required MagicBlock devnet endpoint before any blockchain write.

### 2026-09-26 — Size gate cleared and durable live workflow implemented

- Files inspected:
  - Current official MagicBlock Smart Contract Integration guide; pinned SDK delegation/auth/permission source; Solana deploy CLI; corrected normal IDL/ELF; public deployer address/balance; isolated state headers and public keys only.
- Evidence:
  - The official guide still documents an eATA derived under the Ephemeral SPL Token program for a program-owned PDA, eATA delegation, and an in-rollup `CpiContext::new_with_signer` SPL Token transfer.
  - Size optimization reduced the normal artifact from 532,880 to 460,760 bytes. Corrected SHA-256 is `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`.
  - The required MagicBlock devnet RPC returned the exact expected genesis and 2,341,539,640 lamports of rent for the 460,805-byte ProgramData allocation, leaving room under the 3.5 SOL authorization for minimal setup.
  - Program keypair/source/IDL/Anchor IDs all remain `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`; the normal IDL has 15 instructions and the normal ELF has no failure-injection symbol.
  - The pre-deployment audit now passes the independent-accountant, approval isolation, recipient isolation, repeated-payment, instruction inventory, custody outflow, artifact, and Git-hygiene controls.
- Commands run:
  - `anchor build -- --optimize-size` (ELF succeeded, combined IDL phase rejected the SBF-only flag); reproducible split build with `anchor build --no-idl -- --optimize-size` and explicit `anchor idl build`; hash/size/IDL/ELF/ID checks; fixed-RPC genesis/rent JSON-RPC; JavaScript syntax and unit tests.
- Changes made:
  - Rewrote `pda-custody/SECURITY_AUDIT.md` and `pda-custody/README.md` for the corrected design and artifact.
  - Exported safe state/connection helpers from `src/client.mjs`.
  - Added `scripts/live-pda-custody.mjs`, a bounded devnet-only runner with durable signed-transaction records, reconciliation, funding caps, two-payment setup/execution, negative simulations, exact permission decoding, and authenticated/public access-control probes.
  - Added the live runner to `npm run check`.
- Tests/simulations:
  - JavaScript syntax check: passed.
  - JavaScript/model/client tests: 26 passed, 0 failed.
  - No transaction was submitted. A read-only token-account query was inconclusive because the fixed RPC temporarily timed out/DNS failed; this was not treated as proof of missing funds or service failure.
- Current blocker:
  - None in the implementation. The required endpoint is temporarily intermittent, so all final read-only pre-deployment checks must succeed in one coherent gate before deployment.
- Exact next step:
  - Rerun the complete local suite and production scans, commit/push the corrected pre-deployment source, verify the remote branch/main, then perform the final fixed-endpoint deployment gate and deploy exactly once only if every identity/hash/balance/absence/cost check passes.

### 2026-09-26 — Final corrected pre-deployment suite passes

- Files inspected:
  - Corrected Rust/JavaScript source and tests, regenerated feature-only rollback artifact, regenerated normal size-optimized artifact/IDL, production instruction inventory, ELF strings, program identity declarations, and Git tracking/ignore rules.
- Evidence:
  - Rust: 18 passed, 0 failed. JavaScript: 26 passed, 0 failed.
  - Compiled local-SVM success transferred exactly 10,000 base units with a depth-2 token CPI and wrote EXECUTED/PAID.
  - Compiled local-SVM insufficient-funds and forced post-CPI failures left persistent balances and state unchanged.
  - The first local-SVM rerun could not bind its loopback faucet under the filesystem/network sandbox. The exact local-only command was rerun with the approved loopback permission and passed; this was not a blockchain action.
  - The production rebuild followed the feature build and excludes the test instruction. Final normal artifact remains 460,760 bytes with SHA-256 `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`.
  - The production IDL has exactly 15 expected instructions. Source/IDL/Anchor/keypair program IDs match. No admin/recovery/withdraw/fallback/failure-injection symbol exists in the normal artifact.
  - `.lab`, `target`, keypairs, `.so`, node modules, and secret environment files remain ignored and untracked. Local backup files remain preserved and untracked.
- Commands run:
  - `cargo fmt --all`; `cargo test --workspace`; feature Anchor build and preservation of its ignored test outputs; normal size-optimized Anchor/IDL rebuild; `npm run check`; `npm test`; compiled `node tests/local-svm.integration.mjs`; IDL/ELF/hash/size/program-ID/Git hygiene scans; `git diff --check`.
- Changes made:
  - Finalized the live runner's delegation-validator checks, negative-simulation persistence controls, exact recipient-eATA permission verification, receipt field validation, one-top-level-instruction assertion, and repeated authenticated/public account probes.
- Tests/simulations:
  - All required local security, rollback, build, syntax, and model tests pass.
  - No devnet transaction has been submitted in this remediation phase.
- Current blocker:
  - None locally. Deployment remains gated on a fresh coherent read-only check of the fixed MagicBlock devnet endpoint and deployer resources.
- Exact next step:
  - Stage only the corrected experiment source/tests/public documentation, scan the staged content, commit as `fix: separate accounting and per-receipt access`, push only the experiment branch, and verify remote `main` remains unchanged before the deployment gate.

### 2026-09-26 — Pre-deployment commit pushed; loader invocation reconciled as no-write

- Files inspected:
  - Staged source/test/documentation set; local and remote branch heads; final artifact/keypair/IDL/source IDs; fixed-RPC genesis, TEE, mint decimals, program/buffer balances, deployer balance, and rent estimates.
- Evidence:
  - Corrected source commit `0e3383d65e4f789e3c3ce62ccadfbce20c4beb43` was pushed only to `experiment/pda-custody-private-payment`. Remote `main` remained `6aea403fe7126ede6d6ab4a2661ef9b123f80b18`.
  - Final gate confirmed the expected genesis, TEE identity, six-decimal Circle devnet USDC mint, absent program, exact program ID/hash/size, deployer `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`, 5,160,560,297 lamports, and expected upgrade authority equal to that deployer.
  - Exact rent: 2,341,539,640 lamports for ProgramData, 833,120 for the program account, and 2,341,499,000 temporary buffer rent. Net deployment rent plus bounded setup remains below 3.5 SOL; peak buffer-plus-program allocation fits the deployer balance.
  - Dedicated ignored 0600 deployment-buffer keypair public key is `HMUJssvAgtjonKX1oHe7gXDuV88ftUDWLaurogZkfa1F`.
  - The first guarded command stopped on a read-only timeout before invoking the loader. A later loader invocation returned an account-read transport error and no signature.
  - Reconciliation at the same current devnet slot found program balance 0, buffer balance 0, and deployer balance unchanged exactly at 5,160,560,297 lamports. Therefore no buffer creation, upload, deployment, fee, or other blockchain write landed.
- Commands run:
  - Explicit staging/scans/commit; SSH push and remote-head verification; live read-only inspect; fixed-RPC balance/rent/absence checks; dedicated buffer generation; guarded RPC deploy command; post-error program/buffer/deployer reconciliation; MagicBlock status API and account-method health probes.
- Changes made:
  - Wrote an ignored, 0600 public-safe deployment preflight record and this status entry. No tracked source changed after the committed artifact build.
- Tests/simulations:
  - No payment/setup simulation or submission occurred. No deployment transaction signature exists because the loader failed before any chain write.
- Current blocker:
  - The fixed base RPC's `getAccountInfo` and `getMultipleAccounts` methods currently time out even for the USDC mint, while genesis and balance methods respond. The Solana loader requires those account reads and cannot safely start until they recover.
- Exact next step:
  - Continue read-only monitoring. Once `getAccountInfo` succeeds, reverify genesis plus zero program/buffer balances, then make one reconciled loader invocation using the same exact artifact and known buffer; do not use another RPC endpoint.

### 2026-09-26 — Official Solana devnet endpoint override applied

- Files inspected:
  - Branch/HEAD and tracked diff, preserved backup files, MagicBlock delegation/eSPL skill references, live runner endpoint guards, production IDL, program source/configuration, artifact/keypair, and ignore rules.
- Evidence:
  - HEAD is the requested `78d70134a963777cc51e4aed5c9260f10dd60be3`; the tracked tree was clean before this milestone.
  - Artifact SHA-256 is `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`, size is 460,760 bytes, and the keypair public key is `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo`.
  - The production IDL lists 15 instructions and no failure-injection instruction. `.lab`, `target`, keypairs, `.so`, and node modules remain ignored.
  - Current MagicBlock guidance preserves the base/PER endpoint split and permits Solana devnet as the base endpoint; the PER remains `https://devnet-tee.magicblock.app`.
- Commands run:
  - Git status/HEAD/diff checks; artifact hash/size; program-keypair public-key derivation; IDL/source/config/ELF hygiene searches; skill reference inspection; `node --check`; `npm test`.
- Changes made:
  - Changed only the live runner's required base endpoint to `https://api.devnet.solana.com` and expanded its transaction guard to reject references to either excluded legacy program ID. Commit `78d7013` is the exact tracked pre-edit backup.
- Tests/simulations:
  - JavaScript tests: 26 passed, 0 failed. Syntax check produced no JavaScript error. No RPC transaction or blockchain write was attempted.
- Current blocker:
  - None locally. The fresh official-devnet read-only deployment gate has not yet been run.
- Exact next step:
  - Run the complete read-only official-devnet gate (genesis, program/buffer absence, deployer identity/balance, mint/decimals, rent/cost, TEE identity, artifact/IDL/source consistency); deploy once only if every result matches.

### 2026-09-26 — Official-devnet deployment gate passes

- Files inspected:
  - Live runner/client endpoint constants, artifact/keypair, source/IDL/Anchor IDs, normal IDL instruction inventory, normal ELF strings, public evidence, and ignored known deployment buffer.
- Evidence:
  - Official Solana devnet genesis is exactly `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; PER identity is exactly `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.
  - Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` exists with 6 decimals.
  - Isolated target program and known buffer each have zero lamports; `program show` resolved the target as not found. No uploaded program or buffer landed in the earlier attempt.
  - Deployer is exactly `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b` with 5,160,560,297 lamports. ProgramData rent is 2,341,539,640 lamports; deployment plus bounded minimal setup remains below the 3.5 SOL spend cap.
  - Artifact remains SHA-256 `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`, 460,760 bytes. Program IDs match; the 15-instruction production IDL and normal ELF contain no failure-injection entry/symbol.
- Commands run:
  - Official-devnet `genesis-hash`, deployer/program/buffer balance checks, `program show`, rent query, mint `getTokenSupply`; PER `getIdentity`; local keypair/address, hash/size, IDL inventory, ELF, Git-diff and ignore scans.
- Changes made:
  - Set the shared client and live runner base default/guard to the newly authorized official Solana devnet endpoint. Updated the public live-evidence resumption boundary. Both excluded legacy program IDs remain transaction-blocked.
- Tests/simulations:
  - No blockchain transaction was built or submitted during this gate. The first batched official-RPC read received HTTP 429; paced individual reads then returned all required facts and were not treated as writes.
- Current blocker:
  - None. Deployment has not yet been invoked.
- Exact next step:
  - Run syntax/unit/hygiene checks, commit and push only the endpoint transition on the experiment branch, recheck genesis/hash/key/balance immediately before the loader, then deploy exactly once with the known buffer and reconcile before setup.

### 2026-09-27 — Manual devnet deployment independently reconciled

- Files inspected:
  - Approved local production artifact/keypair and the deployed program/program-data accounts through the trusted devnet RPC; current experiment branch remains isolated from `main`.
- Evidence:
  - Deployment signature `5TdXaPeBaHKCVMHY471Ykw88Jy3A38cU3T2q88Qy8AJqWE1UHXjdNMB3ahCemRAKhCkrVQRKxVXcaBJz9yeGCbR5` is finalized with `Status: Ok` at slot 504520046.
  - Program `AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo` is owned by the upgradeable loader and resolves to ProgramData `8L3bqttWFggYQLT2vEh242BaGJE2PXhiTmtBJBywYqbF` with upgrade authority `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`.
  - The known deployment buffer was consumed to zero by the successful deployment transaction.
  - A finalized program dump is exactly 460,760 bytes and byte-for-byte identical to the approved artifact; both SHA-256 values are `86ec1ac50ce2601eb4c265b0b3f19c9f6b5da1298adc2564f56082cd2454d37e`.
- Commands run:
  - Devnet genesis verification through the trusted environment-provided RPC; finalized signature confirmation; `solana program show`; `solana program dump`; SHA-256, size, and `cmp` verification. The RPC URL/API key was not written to any repository file.
  - Security note: `solana confirm --verbose` echoed the configured RPC URL into transient tool output. It was not persisted or committed, but the embedded Alchemy credential should be rotated before resumption.
- Changes made:
  - Added only this public-safe reconciliation record. No program deployment, upgrade, close, or other blockchain write was performed by this reconciliation step.
- Tests/simulations:
  - Read-only deployed-byte comparison passed. Live setup/payment tests have not started.
- Current blocker:
  - None. The live runner must be adapted to consume the trusted RPC environment variable without recording it, and the local suites must pass before setup.
- Exact next step:
  - Review README/security/live scripts/current branch; update the base-RPC selector without persisting its value; rerun Rust and JavaScript tests; create a fresh isolated fixture; then simulate and submit the minimal devnet setup one reconciled transaction at a time.

### 2026-09-27 — Post-deployment local baseline passes

- Files inspected:
  - Current README, security audit, status history, live runner, shared client/state lifecycle, branch/HEAD, and one-payment versus two-payment audit paths.
- Evidence:
  - Branch is `experiment/pda-custody-private-payment` at `7441553246a871d659b8f223995845a919e3a1f7`; only this status file was tracked-modified before the client adaptation.
  - The program security design remains two-approver/PDA-custody/one-instruction atomic. The existing live audit assumes both payments exist, while the current authorization permits one payment only.
- Commands run:
  - `cargo test --workspace`; `npm run check`; `npm test`; targeted source/documentation inspection and Git status checks.
- Changes made:
  - Added only this milestone entry. No blockchain write occurred.
- Tests/simulations:
  - Rust: 18 passed, 0 failed. JavaScript: 26 passed, 0 failed. Syntax checks passed. No live transaction or simulation was submitted during this milestone.
- Current blocker:
  - Client-only endpoint/state-path and single-payment audit adaptation is required before generating the new fixture.
- Exact next step:
  - Add safe environment-based base-RPC selection, an isolated `.lab` fixture path, and an A-only visibility/permission audit; rerun tests before any funding/setup transaction.

### 2026-09-27 — Single-payment live client safely adapted

- Files inspected:
  - Shared RPC/state-path selection, transaction preparation/simulation/submission/reconciliation, funding limits, setup/payment dispatch, permission decoding, authenticated/raw access probes, and live audit expectations.
- Evidence:
  - The runner verifies devnet genesis and the six-decimal mint before every submitted base/PER action; PER identity is additionally pinned for PER actions.
  - Every transaction is serialized and recorded before submission, simulated with signature verification, sent once with `maxRetries: 0`, and reconciled by its exact signature.
  - Latest authorization is enforced client-side: only payment A can be set up/executed; total live outflow is capped at 10,000 base units; recipient B remains an unfunded unrelated authenticated visibility control.
- Commands run:
  - `npm run check`; `npm test`; `git diff --check`; targeted live-runner/client review.
- Changes made:
  - Base RPC now prefers `SOLANA_DEVNET_RPC_URL` without logging/persisting it. Optional fixture selection is constrained to the repository `.lab` directory.
  - Live commands for payment B were removed; SOL funding covers only company, two approvers, and recipient A.
  - The access audit now checks the single real receipt against company/accountant/recipient-A positive controls and approver/recipient-B/outsider/unauthenticated denial controls, plus the base-layer sparse-shell check and exact permission member flags.
- Tests/simulations:
  - JavaScript: 26 passed, 0 failed; all syntax checks and whitespace validation passed. No blockchain write occurred.
- Current blocker:
  - None. A fresh fixture has not yet been generated.
- Exact next step:
  - Confirm the new ignored fixture path is absent, initialize it with mode 0600, run read-only inspect/derivation checks through the trusted devnet RPC and PER, then begin minimal funding only after those checks pass.

### 2026-09-27 — Fresh live fixture and read-only gate pass

- Files inspected:
  - Newly generated ignored fixture header/public keys only, filesystem mode/ignore rule, derived payment-A addresses, deployed program availability, mint decimals, genesis, and PER identity.
- Evidence:
  - Fresh fixture `.lab/pda-custody-live-20260927.json` was created without overwriting any prior `.lab` history, has mode 0600, is ignored, and contained zero transaction records at inspection.
  - Company, independent accountant, two approvers, recipient A, unrelated recipient B, and outsider are seven distinct new identities. Payment A is exactly 10,000 base units with new vault/intent/receipt PDAs.
  - Read-only inspect returned the exact devnet genesis, pinned TEE validator, Circle devnet mint with 6 decimals, and `programDeployed: true`.
  - An invalid non-base58 legacy-address literal caused the first inspect process to stop during module initialization; it was removed while the actual legacy deployed program guard remains. No RPC request or transaction occurred in that failed process.
- Commands run:
  - Fresh-state initialization; mode/ignore checks; `npm run check`; `npm test`; live `inspect` through the trusted devnet RPC plus fixed PER.
- Changes made:
  - Created the ignored secret fixture and corrected only the invalid client-side legacy address literal. No fixture secret or RPC credential was added to Git; the separate transient verbose-output exposure is recorded above.
- Tests/simulations:
  - JavaScript: 26 passed, 0 failed after the correction. Live inspect was read-only and reported zero blockchain writes.
- Current blocker:
  - None. Fixture identities are not funded and no experiment account exists yet.
- Exact next step:
  - Run the bounded funding command; simulate before each submission, reconcile its saved signature, and stop on any ambiguous outcome before vault initialization.

### 2026-09-27 — Minimal SOL funding finalized; Circle USDC faucet required

- Files inspected:
  - Fresh fixture's public transaction record, finalized base balances, deployer SPL-token account inventory, Circle's official faucet documentation, and the live evidence file.
- Evidence:
  - Minimal SOL funding signature `T5DsyRsMDrnpyaEG1CfJV9qZttdZhViaB1W7k55zYQ11GuemDVuw26u8KH4WQs53XGZSfH2VTvkyi2zRMoJpMh2` is finalized success.
  - Finalized balances: company 250,000,000 lamports; each approver 5,000,000; recipient A 35,000,000; deployer 2,520,882,537.
  - The deployer has no token account for Circle devnet USDC; its two token accounts hold unrelated mints. The runner failed before constructing/submitting the USDC funding transaction.
  - Circle's official faucet supports Solana devnet and dispenses test USDC, but the request is protected by reCAPTCHA.
- Commands run:
  - Live `fund`; live `reconcile`; finalized balance queries; read-only `spl-token accounts`; official Circle documentation lookup.
- Changes made:
  - Rewrote `pda-custody/LIVE_PER_EVIDENCE.md` with deployment reconciliation, fresh public fixture addresses, finalized SOL funding, current balances, and the precise funding blocker. The RPC endpoint/key and all fixture secrets remain absent.
- Tests/simulations:
  - The SOL transaction was saved before submission, simulated successfully, sent once, and reconciled finalized. No USDC transaction, vault initialization, delegation, approval, or payment was submitted.
- Current blocker:
  - A human must rotate the transiently exposed Alchemy credential and complete Circle's reCAPTCHA-protected Solana-devnet faucet request to deployer `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`. CAPTCHA bypass/automation is not allowed.
- Exact next step:
  - After the rotated RPC environment is installed and faucet funding arrives, reverify devnet genesis plus the exact Circle mint/ATA and balance, rerun `fund` to transfer only 20,000 base units to the isolated company, reconcile that signature, then continue simulation-first vault setup/delegation/PER execution.

### 2026-09-27 — Circle USDC funding finalized and reconciled

- Files inspected:
  - Rotated-RPC presence only, devnet genesis, deployer/company Circle-USDC balances, saved fixture transaction records, current branch/HEAD, and tracked cleanliness.
- Evidence:
  - Both trusted RPC environment variables are set; their values were not emitted. Base RPC genesis is exactly `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
  - Before funding, deployer held 20 Circle devnet USDC. Transaction `569treCJgDmWXt8DAaxs4dWcnJgBs2h1iqn73cdfAFmnJba9yJmQwWMiiwN8GXvR6gRR86QnRKGotpzcEWtHE3hB` finalized successfully after simulation.
  - Isolated company now holds exactly 0.02 Circle devnet USDC; deployer holds 19.98. The experiment funding cap was not exceeded.
  - Both saved funding signatures reconcile as finalized success; no ambiguous transaction remains.
- Commands run:
  - Presence-only environment checks; trusted-RPC genesis and `spl-token balance`; live `fund`; live `reconcile`; current branch/HEAD/status checks.
- Changes made:
  - Persisted the signed funding transaction and reconciliation in the ignored fixture; added this public-safe status milestone. No credential value or key material was recorded.
- Tests/simulations:
  - The Circle-USDC funding transaction simulated successfully before its single submission. Finalized balances match the intended 20,000-base-unit transfer exactly.
- Current blocker:
  - None. Vault/state/eATA accounts are not initialized yet.
- Exact next step:
  - Run `setup-a`; allow its simulation-first, one-at-a-time base initialization/delegation and PER permission/configuration steps, stopping immediately on any failed or ambiguous saved signature.

### 2026-09-27 — Base setup and delegation finalized; PER phase not entered

- Files inspected:
  - Saved public transaction metadata/outcomes, base setup/delegation control flow, PER authentication/propagation boundary, and current fixture state.
- Evidence:
  - Eight setup actions are finalized successes: initialize vault/deposit, configure custody access, delegate custody eATA, recipient self-onboarding/delegation, initialize intent/receipt shells, and delegate vault/intent/receipt.
  - Signatures: `5M2BKzFeGaAcSDi5joNdkMwZkGhSnniaHvRnT1xHfn6wQ8ySqGDpcWj8D4RT5HzGrJzDx3Gagk7MvH6ZbiPyfT9Z`, `5vtKFwZXD5eT8nyGW4neQXawqxDiTpGoTNVQeEyU7GSXkV7gTxjfvbcPWSBbut56p8achamTE9QS7DJAfioH4jH5`, `4HDi6nPBmDn972FDYErsbQw2BRfFJSxC351Y5MTdiT5DTdqytHn7MoNZcdNSaQNDT6LzB4tYHtQKc2txzS8NQh2k`, `4tvW3HkES3gWZpeE57J7dFFV8kUXWmvNeEA5sw21ArEmqnrb53Ag9wLpUaWrASCjgpHcuZD78JbZfsATLHWDW85x`, `3WyseMBCCdrAN9yYBPASDxsd7QWNWBb85EPqFafCKWwzqGXgAHRKdSjofa4WWYLno4u6MooxeH3n2ARGQkajs3R7`, `5UByT5EcBAX6xat7oUiurchQCmVQsmrqZAWsAmo29CDhbKqic26X7d8BcR8nEKg3Uf4tVqZTfd1Sigh3MAG5rsC2`, `5TmN7XdgkR81mrGs3r8KdwqmK6CHV2YSrmB3nyULNVSVJHMyCRV5BLn5ozQspv4ML3XQp8n7Ksm1d6Ni6DoAkZge`, and `3ANXgF3h4xpyiRBtqKuWe9byJ5bXDLbrSNgKHubGMqnQ1kGGSU3uWEA35EKhkMi6h7KnprjzNkW2ndvvfKYoy9Qo` plus the already recorded funding signatures.
  - Rerunning setup after reconciliation performed no duplicate base write. It exited before creating any PER permission/configuration transaction record and emitted no error, so there is no ambiguous PER signature.
- Commands run:
  - Live `setup-a`; live `reconcile`; public transaction-metadata inspection; setup/propagation source review.
- Changes made:
  - Added this public-safe status milestone. No program upgrade/close/undelegation occurred.
- Tests/simulations:
  - Every submitted base transaction was simulated before submission and reconciles finalized success. PER permission setup remains untested live.
- Current blocker:
  - The live runner exits silently at or before PER authentication/delegation propagation, without creating a transaction record.
- Exact next step:
  - Add non-sensitive phase markers around PER authentication, delegation-record checks, and account propagation; rerun the idempotent setup to identify the exact failing await before any PER write.

### 2026-09-27 — Missing recipient token view isolated and repaired client-side

- Files inspected:
  - Base/authenticated-PER/unauthenticated-PER owner/data visibility for vault, custody/recipient eATAs and token views, intent, and receipt; all five delegation records; pinned SDK ephemeral-destination builder; official Smart Contract Integration guide.
- Evidence:
  - Vault, custody eATA, recipient eATA, intent, and receipt are delegated to the pinned TEE. Their base owners are the Delegation Program and their authenticated-PER owners are the expected original programs.
  - Custody eATA/token view are hidden from unauthenticated PER reads. Recipient eATA is likewise hidden, but recipient canonical token view is absent on both base and PER.
  - The pinned SDK's ephemeral-destination flow creates the ordinary recipient ATA before `initEphemeralAtaIx`, eATA permission creation, and eATA delegation. Our self-onboarding omitted exactly that ATA creation.
- Commands run:
  - Bounded phase-marked `setup-a`; read-only cross-layer account/delegation diagnostic; installed SDK source search; current official guide review.
- Changes made:
  - Added a recipient-signed, idempotent associated-token-account instruction group and made live setup create/validate that token view before eATA onboarding. Added an exact client test for the ATA program/address. No deployed Rust program change is required.
- Tests/simulations:
  - No transaction was submitted during diagnosis. The failed wait ended before building any PER transaction.
- Current blocker:
  - The client repair must pass syntax/unit tests; then the missing ATA must be simulated/submitted once and PER materialization rechecked.
- Exact next step:
  - Run JavaScript tests; resume idempotent `setup-a` so it submits only the new recipient-ATA transaction, reconciles it, verifies PER propagation, and then creates the ER-local permissions/configuration.

### 2026-09-27 — Recipient token-view repair validated; saved history reconciled

- Files inspected:
  - Current experiment branch/diff, live runner transaction guard and reconciliation path, ignored fixture transaction labels, recipient-token-view repair, unit test, and public evidence/status files.
- Evidence:
  - Both trusted RPC environment variables are present. Their values are not recorded. The base endpoint returned the exact required devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; the default signer is the expected deployer `4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b`; its Circle devnet USDC balance is 19.98.
  - Every saved funding/setup signature reconciles as finalized success. The fixture has no recipient-token-view, PER-configuration, approval, or payment signature, so there is no unknown transaction to retry.
  - The repair uses the Associated Token Program's idempotent instruction, is signed by recipient A, and targets the exact canonical Circle-USDC token-view address already bound into the payment.
- Commands run:
  - Presence-only environment checks; guarded devnet genesis, signer, and Circle-USDC balance queries; live `reconcile`; `npm run check`; `npm test`; targeted diff/source review.
- Changes made:
  - Preserved pre-edit backups of this status and the live evidence file. No blockchain write occurred during this milestone.
- Tests/simulations:
  - JavaScript syntax checks passed. JavaScript tests: 26 passed, 0 failed. Reconciliation was read-only and found ten finalized-success transactions, zero failures, and zero unknown outcomes.
- Current blocker:
  - None. Recipient A's canonical token-view account remains absent and is the next deliberately authorized base-layer write.
- Exact next step:
  - Run idempotent `setup-a`; allow only the missing recipient token-view initialization followed by PER propagation checks and the three permission/payment-configuration transactions, each simulated, saved before submission, submitted once, and reconciled.

### 2026-09-27 — Recipient token view and private payment configuration finalized

- Files inspected:
  - Live setup control flow, exact repaired ATA instruction group, authenticated PER propagation checks, and saved transaction outcomes.
- Evidence:
  - Recipient A's canonical Circle-USDC token view was initialized once on base with signature `4qaJmxdd4NzFLq5vqfymuePeA6JQAF5Asay4XgCJWJm62WRgKLsasY24FWfyf6JzxmNRsUzsJkw8zkwzuUHTg4KD`.
  - Authenticated PER then returned the vault, custody token view, recipient token view, intent, and receipt after their pinned-validator delegation checks passed.
  - Vault private access finalized with `4k5KFg612q2BrRrtpqWVe5ALB5E9k7MHm7Ks8aaDeF25Z1nhRx6B7nB3Je1Qk6Zgy1GK2c5Utbh8qefV7iXNgA2V`; payment-A intent/receipt permissions finalized with `4A5nQnthUqwWTpE2M26HA4ER3CHSoywLhPEKZpQCQ3sbhqTcy6rduspheNScJwXoojy4MQ9TXsWbWoeZkfUskAzZ`; exact payment binding finalized with `65X77KyYEJj8G4kLu9PaLqFUzBPA4jioHrispRsrr9bWPoFh1thniEoo2QgE1c7WXq9upGt5nMR4HRVb7ZwKuu46`.
- Commands run:
  - Live `setup-a` through the environment-provided Solana devnet RPC and fixed PER endpoint.
- Changes made:
  - Added four signed transaction records to the ignored fixture and this public-safe milestone. No deployed program or prior experiment was modified.
- Tests/simulations:
  - Each of the four transactions passed network/mint/TEE guards and simulation before its single submission. The runner observed finalized success for each.
- Current blocker:
  - None, pending independent read-only reconciliation of the four new signatures.
- Exact next step:
  - Reconcile all saved signatures; decode the configured state/permissions without exposing credentials; then run the approval and payment workflow only if every new result remains successful.

### 2026-09-27 — Mixed PER permission layouts decoded from pinned source

- Files inspected:
  - `ephemeral-rollups-sdk` 0.16.2 `EphemeralPermission`, `Permission`, `Member`, and flag definitions; all five live permission accounts; audit decoder and expected member lists.
- Evidence:
  - The read-only pre-payment access audit stopped before any write because the legacy decoder handled only the compact ephemeral layout. Program-created permissions use compact `[header][Member...]`; eSPL-created permissions use Borsh `Option<Vec<Member>>` plus zero allocation padding.
  - Live permission reads confirmed exact private sets. Program and eSPL default members have flags `0` and therefore no authority/log/balance/message access. Company has `15`; accountant and recipient receipt viewers have `14` (view only); approvers appear only on the intent with `15`.
- Commands run:
  - Read-only live `audit`; pinned Cargo-registry source inspection; authenticated public-key/flag-only permission diagnostics; `npm run check`; `npm test`; `git diff --check`.
- Changes made:
  - Added a bounded decoder for both official layouts, included zero-flag default members in exact-set assertions, and added a unit test covering both encodings. Pre-edit source/test/runner backups were preserved.
- Tests/simulations:
  - First new unit run exposed a missing `PublicKey` import; after the one-line correction, JavaScript tests pass 27/27, syntax checks pass, and whitespace checks pass. The failed audit and diagnostic were read-only; no approval or payment transaction was constructed.
- Current blocker:
  - None. The corrected read-only access matrix must pass before approval one is submitted.
- Exact next step:
  - Rerun `audit`; if every authorized positive control and unauthorized matched control passes, record the exact permission matrix and proceed to payment A's simulation-first approval workflow.

### 2026-09-27 — Pre-payment privacy matrix passes; transient fetch failure reconciled

- Files inspected:
  - Saved access-control observation, exact permission membership/flags, saved transaction ledger, current PER status/identity, and current private balances/intent/receipt state.
- Evidence:
  - Corrected `audit` passed: all required authorized reads returned and decoded; matched unauthorized, outsider, unrelated-recipient, and unauthenticated PER reads returned no account. The public base RPC exposes only the delegated sparse receipt shell, not private paid data.
  - The first `pay-a` process returned `fetch failed` before creating any new transaction record. MagicBlock's live devnet TEE ER status was operational and `getIdentity` returned the pinned validator.
  - Independent authenticated reconciliation found custody `20,000`, destination `0`, approval count `0`, intent unexecuted/status `0`, receipt INITIALIZED/status `0`, amount `0`. No approval or payment landed and no signature is unknown.
- Commands run:
  - Corrected live `audit`; public-safe matrix extraction; first live `pay-a`; saved-ledger inspection; MagicBlock status API and TEE identity probes; authenticated state/balance reconciliation.
- Changes made:
  - Persisted the successful read-only audit observation in the ignored fixture and added this milestone. No blockchain state changed during the failed payment attempt.
- Tests/simulations:
  - Privacy matrix positive/negative controls passed. The payment workflow stopped before its first transaction and therefore performed no approval/payment simulation or submission.
- Current blocker:
  - None. The failure is reconciled as pre-transaction and current PER health/identity are correct.
- Exact next step:
  - Retry `pay-a` once from the verified zero-approval state; stop on any saved ambiguous signature or failed simulation.

### 2026-09-27 — Approval one finalized; recipient negative-test harness repaired

- Files inspected:
  - Payment-A transaction record/state, approver-negative-test loop, signer-role recording, and `deriveContext` keypair reconstruction.
- Evidence:
  - Approval one finalized exactly once with signature `5yAJWmMzsV42cfbRrJQtfC1PfidgNrTPD2DwQ6Ac93eVB6FEtCRnWLiRDDhP5QYAsQr7HzY4wfTEFtfp4xpdhdyc`.
  - Duplicate-approver and accountant-cannot-approve simulations failed as intended. The process then stopped locally because recipient A's reconstructed `Keypair` was compared by object identity rather than public key; approval two and payment execution were never prepared.
  - Full reconciliation reports approval one and all prior signatures finalized success, with no unknown outcome.
- Commands run:
  - Second live `pay-a`; keypair reconstruction/source inspection; `npm run check`; `npm test`; `git diff --check`; live `reconcile`.
- Changes made:
  - Added a tested public-key-based identity-role helper and used it for signer recording and negative-test authentication. Pre-edit backups were preserved.
- Tests/simulations:
  - JavaScript tests pass 28/28; syntax and whitespace checks pass. Two expected-failure live simulations ran without persistent state change.
- Current blocker:
  - None. Payment A is deliberately paused at exactly one finalized approval.
- Exact next step:
  - Resume `pay-a`; it must reuse approval one, complete all required negative simulations, submit approval two once, run binding/bypass simulations and the successful non-persistent execution simulation, then submit at most one 10,000-base-unit execution.

### 2026-09-27 — Valid CPI isolated to missing custody-PDA permission authority

- Files inspected:
  - Saved valid/negative simulation observations, current eATA permissions, official Smart Contract Integration guide, pinned eSPL `CreateEphemeralAtaPermission`/reset processors, base/PER permission-update behavior, and client setup plan.
- Evidence:
  - Approval two finalized once with signature `HBLnf1gavgZPVeKfGt2QKcb8jD7oUeVyhyYaejMkrsNvgg9Lip4geWpVCFnSWTVRR8Rc6QtC8f35uDAbfioac9b`; all 16 live signatures reconcile finalized success.
  - Duplicate/unknown-role approval, one-approval execution, wrong payment ID/recipient/destination/amount/mint/revision/hash, and direct company-wallet custody-transfer simulations all failed while preserving state.
  - The otherwise-valid execution simulation returned PER HTTP 403 before SVM logs and no payment transaction record was created.
  - Official documentation requires the custody PDA to sign the token CPI. Pinned eSPL source creates an eATA permission with its owner as `AUTHORITY`; our company-only update removed that custody-PDA entry. A PER-local standard-permission update reaches the Permission Program but is rejected afterward as `InvalidWritableAccount`; the identical update simulates successfully on base with 2,481 CU and unchanged persistent state.
- Commands run:
  - Resumed live `pay-a`; live `reconcile`; official documentation/source review; three compound permission-isolation simulations; isolated PER permission-update simulation; isolated base permission-update simulation; `npm run check`; `npm test`; `git diff --check`.
- Changes made:
  - Added a base-layer, company-authorized permission repair that preserves company flags `15` and restores only `AUTHORITY` flag `1` to the custody owner PDA. The runner detects the exact missing member before submitting; audit expectations and unit tests were updated. Pre-edit backups were preserved.
- Tests/simulations:
  - JavaScript tests pass 29/29; syntax and whitespace checks pass. All diagnosis transactions were simulation-only and persistent fingerprints remained unchanged. No token transfer or receipt mutation occurred.
- Current blocker:
  - The tested base permission repair is not yet submitted. The valid execution remains blocked by the old permission snapshot.
- Exact next step:
  - Run idempotent `setup-a` so only `setup.repair-custody-pda-authority` is simulated/submitted once; reconcile it, confirm the exact permission set propagated to PER, then rerun only the valid execution simulation before any payment submission.

### 2026-09-27 — Source authority repaired; destination authority isolated

- Files inspected:
  - Repaired base/PER custody permission, valid execution simulation result, destination permission members, base update behavior, and client permission-plan/audit assertions.
- Evidence:
  - Custody permission repair `2Buc1NDoC4awDX6TiAuLAPp7zwTtDLDG9pTafuDVYMd8cpLutNnnAsxYKQoNqPepo4mrAyz5AR6VkqBamHDz1oGS` finalized and reconciled. Base and PER both show company flags `15` and custody PDA flags `1`.
  - The unchanged valid execution still returns HTTP 403, proving source authority alone is insufficient and no payment was submitted.
  - A base-layer simulation that preserves company/recipient flags `15` and adds the custody PDA with authority-only flag `1` to recipient A's eATA permission succeeds with 2,592 CU and no persistent change.
- Commands run:
  - Live `setup-a`; live `reconcile`; authenticated base/PER permission comparison; standalone valid execution simulation; destination-permission base simulation; `npm run check`; `npm test`; `git diff --check`.
- Changes made:
  - Added a guarded per-recipient permission repair group and setup step; updated exact permission expectations for the post-delegation base update and added a unit test. Pre-edit backups were preserved.
- Tests/simulations:
  - JavaScript tests pass 30/30; syntax and whitespace checks pass. No token movement occurred; source remains 20,000 and destination remains 0.
- Current blocker:
  - The simulated destination permission repair is not yet submitted; valid CPI remains 403 under the old destination permission.
- Exact next step:
  - Run idempotent `setup-a` so only payment A's recipient-PDA authority repair is submitted once; reconcile/verify both layers, then rerun the valid execution simulation.

### 2026-09-27 — Final account-by-account PER diagnosis time-boxed

- Files inspected:
  - The authoritative ignored fixture `.lab/pda-custody-live-20260927.json`, all saved public transaction outcomes, the live runner's simulation options, the five associated permission accounts, and the required vault/eATA/token-view/intent/receipt accounts.
- Evidence:
  - Destination authority repair `iyJBDBgDWYG7LLKXc6drTeKT4gyVgWhJU5gTxo1UNRQg8JJsqMffs7RrjTU8Y8mdUYX2m7zcVJvJzockQGyKyFC` is finalized success. All 18 saved writes are finalized successes; there is no unknown transaction and no `payment.A.execute` record.
  - A first diagnostic accidentally used the older default fixture because `PDA_CUSTODY_STATE_PATH` was absent. Its addresses did not match the reconciled experiment and its read-only result was discarded. No transaction was prepared or submitted. The live runner now refuses to start unless the authoritative fixture is explicitly selected.
  - With the authoritative fixture, the authenticated company received every required account from PER: CompanyVault `GhjDy7sMFCfzt4EnrXNHv39y8yDCaeEXo7VfuTd7yE1M`, source eATA `DF8HFeS1wqKefrQMv2mxkZHLJTYhAo3vzdRDq2Yc62wk`, source token view `CRSEsAaPyxFjP865Nj5jtNBQcKzcJ2dyRqFkiXebA4P8`, PaymentIntent `3Ks7Jv86EazhKuk8T2h4ZCkuCKmnPtCkUCtj2LcWgmBw`, PaymentReceipt `2Ut3YhoBgkNRnWgGynz8NqrzL58t5Up6LbWEJuLbgWqW`, destination eATA `AbwrpUUoT31AngPnx8aEkEfgKQkG5QgzwB4p3wMCtb2a`, and destination token view `dnSo4DZTMn9eCANBubYDcampZbspaA6Pt97iBUgBLvt`. Every request reached PER and none was filtered.
  - Program-created ER-only permissions were returned on PER with the intended members. The two base-backed eATA permissions were returned on both base and PER with identical state: source has Delegation Program `0`, company `15`, vault PDA `1`; destination has Delegation Program `0`, company `15`, recipient A `15`, vault PDA `1`.
  - Therefore no individual inaccessible account or stale base/PER permission state exists, and no further access broadening is justified.
  - The exact valid `execute_private_payment` simulation, with no returned-account snapshot request, still receives `403 Forbidden: {"error":"Access denied"}` before SVM execution. It has no program logs, no Token Program CPI, and no transaction signature, so it does not satisfy the required simulation criterion.
- Commands run:
  - Explicit-fixture read-only `probe-access`; explicit-fixture `simulate-execute-a`; JavaScript syntax and whitespace checks only. No full local suite was rerun.
- Changes made:
  - Removed the unnecessary four-account `simulateTransaction.accounts` response request while retaining independent before/after fingerprints; added a safe account/permission probe; made failed audits persist their matched probe observations; and required the live runner to explicitly select the authoritative live fixture. Public-safe evidence/status documentation was updated. No permission or blockchain state changed.
- Tests/simulations:
  - The individual authenticated account probes and base/PER permission comparisons passed. The valid payment simulation failed at PER ingress with HTTP 403 and did not invoke `AzM25...`, invoke SPL Token by CPI, or return `err: null`.
- Current blocker:
  - PER rejects the combined valid transaction even though every individual transaction account and permission is company-readable. The inaccessible account requested by the time-box cannot be identified because none of the probed accounts is inaccessible. The remaining uncertainty is an undocumented transaction-level PER ingress rule or service-side combination check, not a proven application permission mismatch.
- Exact next step:
  - Stop without submitting payment or changing permissions. Escalate the public-safe probe table and 403 reproduction to MagicBlock; resume only when the PER supplies an actionable denied-account/reason or the same exact simulation begins reaching SVM.
