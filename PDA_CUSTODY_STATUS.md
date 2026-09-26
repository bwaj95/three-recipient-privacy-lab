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
