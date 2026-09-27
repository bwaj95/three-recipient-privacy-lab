#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as anchor from "@coral-xyz/anchor";
import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  BASE_RPC,
  DEVNET_GENESIS,
  INITIAL_CUSTODY_AMOUNT,
  PER_RPC,
  buildInstructionPlan,
  connection,
  decodePrivatePermission,
  deriveContext,
  identityRoleForSigner,
  keypairsFromState,
  loadLocalState,
  readIdl,
  readOnlyCheck,
  saveLocalState,
} from "../src/client.mjs";
import {
  DELEGATION_PROGRAM_ID,
  DEVNET_TEE_VALIDATOR,
  DEVNET_USDC_MINT,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  INTENT_APPROVED,
  INTENT_EXECUTED,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  RECEIPT_INITIALIZED,
  RECEIPT_PAID,
  derivePermission,
} from "../src/model.mjs";

const EXCLUDED_PROGRAMS = [
  new PublicKey("FnKajG15Hu4tTENtENAHCau4krTWJUyXUGgdVuLpbTzq"),
];
const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);
const MAX_PAYMENT = 10_000n;
const MAX_TOTAL_PAYMENT = 10_000n;
const MAX_USDC_FUNDING = 50_000n;
const MAX_SOL_FUNDING = 500_000_000;
const TARGET_LAMPORTS = {
  company: 250_000_000,
  approverOne: 5_000_000,
  approverTwo: 5_000_000,
  recipientA: 35_000_000,
};
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

if (
  !process.env.SOLANA_DEVNET_RPC_URL ||
  !process.env.PDA_CUSTODY_STATE_PATH ||
  path.basename(process.env.PDA_CUSTODY_STATE_PATH) !==
    "pda-custody-live-20260927.json" ||
  BASE_RPC !== process.env.SOLANA_DEVNET_RPC_URL ||
  PER_RPC !== "https://devnet-tee.magicblock.app"
) {
  throw new Error(
    "Refusing endpoints or fixture outside the fixed live devnet experiment boundary.",
  );
}

const command = process.argv[2] || "inspect";
if (![
  "inspect",
  "fund",
  "setup-a",
  "pay-a",
  "submit-payment-once",
  "audit",
  "probe-access",
  "reconcile",
  "all",
].includes(command)) {
  throw new Error(
    "Usage: inspect | fund | setup-a | pay-a | submit-payment-once | audit | probe-access | reconcile | all",
  );
}

const state = loadLocalState();
const identities = keypairsFromState(state);
const idl = readIdl();
const coder = new anchor.BorshCoder(idl);
const base = connection(BASE_RPC);
const perConnections = new Map();
const authUrls = new Map();

function cleanError(error) {
  return String(error?.message || error)
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/g, "[endpoint]")
    .slice(0, 1_200);
}

function save() {
  saveLocalState(state);
}

function publicKey(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function field(value, snake, camel) {
  return value[snake] ?? value[camel];
}

function accountFingerprint(info) {
  if (!info) return null;
  return {
    owner: info.owner.toBase58(),
    lamports: info.lamports,
    executable: info.executable,
    dataLength: info.data.length,
    dataSha256: createHash("sha256").update(info.data).digest("hex"),
  };
}

async function perIdentity() {
  const response = await fetch(PER_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`PER identity query failed with HTTP ${response.status}.`);
  }
  return body.result?.identity;
}

async function verifyNetwork(endpointKind) {
  const [genesis, supply] = await Promise.all([
    base.getGenesisHash(),
    base.getTokenSupply(DEVNET_USDC_MINT, "confirmed"),
  ]);
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(`Refusing unexpected genesis ${genesis}.`);
  }
  if (supply.value.decimals !== 6) {
    throw new Error("Refusing a devnet USDC mint with unexpected decimals.");
  }
  if (endpointKind === "per") {
    const identity = await perIdentity();
    if (identity !== DEVNET_TEE_VALIDATOR.toBase58()) {
      throw new Error(`Refusing unexpected PER identity ${identity}.`);
    }
  }
}

async function authenticatedPer(role = "company") {
  if (!identities[role]) throw new Error(`Unknown identity role ${role}.`);
  if (!perConnections.has(role)) {
    const signer = identities[role];
    const auth = await mb.getAuthToken(
      PER_RPC,
      signer.publicKey,
      async (message) => nacl.sign.detached(message, signer.secretKey),
    );
    const url = `${PER_RPC}?token=${encodeURIComponent(auth.token)}`;
    authUrls.set(role, url);
    perConnections.set(role, connection(url));
  }
  return perConnections.get(role);
}

function programFor(rpc, signer) {
  const provider = new anchor.AnchorProvider(
    rpc,
    new anchor.Wallet(signer),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  return new anchor.Program(idl, provider);
}

function loadDeployer() {
  const keypairPath = process.env.SOLANA_KEYPAIR || path.join(
    os.homedir(),
    ".config/solana/id.json",
  );
  const encoded = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(encoded));
}

function validateInstructions(instructions) {
  if (!instructions.length) throw new Error("Refusing an empty transaction.");
  for (const instruction of instructions) {
    if (EXCLUDED_PROGRAMS.some((program) => instruction.programId.equals(program))) {
      throw new Error("Refusing any instruction to the excluded program.");
    }
    if (
      instruction.keys.some((meta) =>
        EXCLUDED_PROGRAMS.some((program) => meta.pubkey.equals(program)),
      )
    ) {
      throw new Error("Refusing any account reference to the excluded program.");
    }
  }
}

async function statusFor(rpc, signature) {
  const response = await rpc.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  return response.value[0];
}

async function pollStatus(rpc, signature, finalized = false) {
  let observed = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    observed = await statusFor(rpc, signature);
    if (observed?.err) return observed;
    if (
      observed &&
      (!finalized || observed.confirmationStatus === "finalized")
    ) {
      return observed;
    }
    await sleep(2_500);
  }
  return observed;
}

async function prepareTransaction(rpc, instructions, signers) {
  validateInstructions(instructions);
  const latest = await rpc.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign(signers);
  const bytes = Buffer.from(transaction.serialize());
  return {
    transaction,
    record: {
      signature: bs58.encode(transaction.signatures[0]),
      bytes: bytes.toString("base64"),
      messageSha256: createHash("sha256")
        .update(transaction.message.serialize())
        .digest("hex"),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
  };
}

async function sendOnce(
  label,
  endpointKind,
  rpc,
  instructions,
  signers,
  semanticAction,
  { finalized = false } = {},
) {
  await verifyNetwork(endpointKind);
  let record = state.transactions[label];
  if (record?.outcome === "success") {
    return record.signature;
  }
  if (record?.outcome === "failure") {
    throw new Error(`${label} previously finalized as failure.`);
  }
  if (["unknown", "expired-unseen", "simulation-failure"].includes(record?.outcome)) {
    throw new Error(`${label} is ${record.outcome}; reconcile it before any retry.`);
  }

  let transaction;
  if (!record) {
    const prepared = await prepareTransaction(rpc, instructions, signers);
    transaction = prepared.transaction;
    record = state.transactions[label] = {
      ...prepared.record,
      endpoint: endpointKind,
      semanticAction,
      signerRoles: signers.map((signer) =>
        identityRoleForSigner(identities, signer) ||
        (signer.publicKey.equals(loadDeployer().publicKey) ? "deployer" : "unknown"),
      ),
      preparedAt: new Date().toISOString(),
      outcome: "prepared",
    };
    save();
  } else {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(record.bytes, "base64"),
    );
  }

  let current = await statusFor(rpc, record.signature);
  if (!current) {
    const blockHeight = await rpc.getBlockHeight("confirmed");
    if (blockHeight > record.lastValidBlockHeight) {
      record.outcome = "expired-unseen";
      record.reconciledAt = new Date().toISOString();
      save();
      throw new Error(
        `${label} expired with no status; refusing to construct a replacement automatically.`,
      );
    }

    const simulation = await rpc.simulateTransaction(transaction, {
      sigVerify: true,
      commitment: "confirmed",
    });
    record.preflight = {
      err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      logsTail: simulation.value.logs?.slice(-20) ?? [],
    };
    save();
    if (simulation.value.err) {
      record.outcome = "simulation-failure";
      save();
      throw new Error(`${label} simulation failed; transaction was not submitted.`);
    }

    try {
      const returned = await rpc.sendRawTransaction(
        Buffer.from(record.bytes, "base64"),
        { skipPreflight: false, maxRetries: 0 },
      );
      if (returned !== record.signature) {
        throw new Error(`${label} RPC returned a different signature.`);
      }
      record.submittedAt = new Date().toISOString();
      save();
    } catch (error) {
      current = await statusFor(rpc, record.signature);
      if (!current) {
        record.submitError = cleanError(error);
        record.outcome = "unknown";
        save();
        throw new Error(`${label} submission outcome is unknown; reconcile before continuing.`);
      }
    }
    current ||= await pollStatus(rpc, record.signature, finalized);
  }

  if (!current) {
    record.outcome = "unknown";
    record.reconciledAt = new Date().toISOString();
    save();
    throw new Error(`${label} remains unknown; reconcile before continuing.`);
  }
  record.confirmationStatus = current.confirmationStatus;
  record.slot = current.slot;
  record.reconciledAt = new Date().toISOString();
  if (current.err) {
    record.outcome = "failure";
    record.error = current.err;
    save();
    throw new Error(`${label} failed: ${JSON.stringify(current.err)}`);
  }
  if (finalized && current.confirmationStatus !== "finalized") {
    record.outcome = "confirmed-awaiting-finality";
    save();
    throw new Error(`${label} confirmed but did not reach finality in the polling window.`);
  }
  record.outcome = "success";
  save();
  console.log(`${label}: ${record.signature} (${current.confirmationStatus})`);
  return record.signature;
}

async function simulate(
  label,
  rpc,
  instructions,
  signers,
  { expectSuccess, watched = [], watchRpc = rpc },
) {
  const { transaction } = await prepareTransaction(rpc, instructions, signers);
  const before = watched.length
    ? await watchRpc.getMultipleAccountsInfo(watched, "confirmed")
    : [];
  let result;
  let transportError = null;
  try {
    const response = await rpc.simulateTransaction(transaction, {
      sigVerify: true,
      commitment: "confirmed",
      innerInstructions: true,
    });
    result = response.value;
  } catch (error) {
    transportError = cleanError(error);
  }
  const after = watched.length
    ? await watchRpc.getMultipleAccountsInfo(watched, "confirmed")
    : [];
  const persistentStateUnchanged = watched.length
    ? JSON.stringify(before.map(accountFingerprint)) ===
      JSON.stringify(after.map(accountFingerprint))
    : true;
  const failed = Boolean(transportError || result?.err);
  const observation = {
    endpoint: "PER simulation",
    expected: expectSuccess ? "success" : "failure",
    observed: failed ? "failure" : "success",
    err: result?.err ?? null,
    transportError,
    unitsConsumed: result?.unitsConsumed ?? null,
    tokenCpiObserved:
      result?.logs?.some(
        (line) =>
          line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke`) &&
          line.includes("[2]"),
      ) ?? false,
    persistentStateUnchanged,
    logsTail: result?.logs?.slice(-20) ?? [],
    recordedAt: new Date().toISOString(),
  };
  state.observations[label] = observation;
  save();
  if (!persistentStateUnchanged) {
    throw new Error(`${label} simulation changed persistent state.`);
  }
  if (expectSuccess === failed) {
    throw new Error(`${label} had the opposite result from the expected simulation.`);
  }
  console.log(`${label}: observed expected ${observation.observed}`);
  return { observation };
}

function planGroup(plan, name) {
  const group = plan.groups.find((candidate) => candidate.name === name);
  if (!group) throw new Error(`Missing instruction group ${name}.`);
  return group;
}

async function waitForAccount(rpc, address, label) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      const info = await rpc.getAccountInfo(address, "confirmed");
      if (info) return info;
    } catch {
      // The delegated account may need a few slots before it is readable.
    }
    await sleep(2_500);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function verifyDelegation(address, label) {
  const record = await mb.getDelegationRecord(base, address, "confirmed");
  if (
    record.status !== mb.DelegationStatus.Delegated ||
    !record.validator.equals(DEVNET_TEE_VALIDATOR)
  ) {
    throw new Error(`${label} is not delegated to the pinned devnet TEE.`);
  }
}

async function decodedAccount(rpc, accountName, address) {
  const info = await rpc.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return coder.accounts.decode(accountName, info.data);
}

async function fund() {
  await verifyNetwork("base");
  const deployer = loadDeployer();
  const transfers = [];
  let fundingLamports = 0;
  for (const [role, target] of Object.entries(TARGET_LAMPORTS)) {
    const current = await base.getBalance(identities[role].publicKey, "confirmed");
    if (current < target) {
      const lamports = target - current;
      fundingLamports += lamports;
      transfers.push(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: identities[role].publicKey,
          lamports,
        }),
      );
    }
  }
  if (fundingLamports > MAX_SOL_FUNDING) {
    throw new Error("Refusing SOL funding above the isolated experiment cap.");
  }
  const deployerBalance = await base.getBalance(deployer.publicKey, "confirmed");
  if (deployerBalance < fundingLamports + 100_000_000) {
    throw new Error("Deployer lacks enough devnet SOL for minimal isolated setup.");
  }
  if (transfers.length) {
    await sendOnce(
      "funding.minimal-sol",
      "base",
      base,
      transfers,
      [deployer],
      `Fund four isolated fee payers with ${fundingLamports} devnet lamports total`,
    );
  }

  const sourceAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    deployer.publicKey,
  );
  const companyAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    identities.company.publicKey,
  );
  let companyAmount = 0n;
  const companyInfo = await base.getAccountInfo(companyAta, "confirmed");
  if (companyInfo) {
    companyAmount = BigInt(
      (await base.getTokenAccountBalance(companyAta, "confirmed")).value.amount,
    );
  }
  if (companyAmount > MAX_USDC_FUNDING) {
    throw new Error("Isolated company already exceeds the authorized USDC funding cap.");
  }
  if (companyAmount < INITIAL_CUSTODY_AMOUNT) {
    const amount = INITIAL_CUSTODY_AMOUNT - companyAmount;
    const sourceBalance = BigInt(
      (await base.getTokenAccountBalance(sourceAta, "confirmed")).value.amount,
    );
    if (sourceBalance < amount) {
      throw new Error("Deployer lacks the required Circle devnet USDC funding.");
    }
    await sendOnce(
      "funding.circle-usdc",
      "base",
      base,
      [
        createAssociatedTokenAccountIdempotentInstruction(
          deployer.publicKey,
          companyAta,
          identities.company.publicKey,
          DEVNET_USDC_MINT,
        ),
        createTransferCheckedInstruction(
          sourceAta,
          DEVNET_USDC_MINT,
          companyAta,
          deployer.publicKey,
          amount,
          6,
        ),
      ],
      [deployer],
      `Fund isolated company with ${amount} Circle devnet USDC base units`,
    );
  }
  state.observations.funding = {
    solLamports: fundingLamports,
    companyUsdcBaseUnits: INITIAL_CUSTODY_AMOUNT.toString(),
    deployer: deployer.publicKey.toBase58(),
    recordedAt: new Date().toISOString(),
  };
  save();
}

async function setupPayment(label) {
  if (label !== "A") {
    throw new Error("This live runner is capped to the single authorized payment A.");
  }
  await verifyNetwork("base");
  const context = deriveContext(state, label);
  if (context.amount !== MAX_PAYMENT) {
    throw new Error("Refusing a payment above the fixed 0.01 USDC amount.");
  }
  const plan = await buildInstructionPlan(state, base, label);
  const { accounts } = context;

  if (label === "A") {
    if (!(await base.getAccountInfo(accounts.vault, "confirmed"))) {
      const group = planGroup(plan, "base.initializeVault");
      await sendOnce(
        "setup.initialize-vault",
        "base",
        base,
        group.instructions,
        [identities.company],
        "Create isolated PDA vault and deposit 0.02 Circle devnet USDC inward",
      );
    }
    let vault = await decodedAccount(base, "CompanyVault", accounts.vault);
    if (vault && !field(vault, "custody_access_configured", "custodyAccessConfigured")) {
      const group = planGroup(plan, "base.configureCustodyEataAccess");
      await sendOnce(
        "setup.configure-custody-access",
        "base",
        base,
        group.instructions,
        [identities.company],
        "Restrict the PDA-owned custody eATA to the company",
      );
      vault = await decodedAccount(base, "CompanyVault", accounts.vault);
    }
    if (!vault || !field(vault, "custody_access_configured", "custodyAccessConfigured")) {
      throw new Error("Custody access was not configured before delegation.");
    }

    const globalInfo = await base.getAccountInfo(accounts.globalVaultEata, "confirmed");
    if (globalInfo?.owner.equals(EPHEMERAL_SPL_TOKEN_PROGRAM_ID)) {
      const group = planGroup(plan, "base.delegateGlobalVaultEata");
      await sendOnce(
        "setup.delegate-global-vault-eata",
        "base",
        base,
        group.instructions,
        [identities.company],
        "Delegate the shared Circle devnet USDC global-vault eATA to the pinned TEE",
      );
    } else if (!globalInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
      throw new Error("Global-vault eATA has an unexpected owner.");
    }

    const custodyInfo = await base.getAccountInfo(accounts.sourceEata, "confirmed");
    if (custodyInfo?.owner.equals(EPHEMERAL_SPL_TOKEN_PROGRAM_ID)) {
      const group = planGroup(plan, "base.delegateCustodyEata");
      await sendOnce(
        "setup.delegate-custody-eata",
        "base",
        base,
        group.instructions,
        [identities.company],
        "Delegate the private PDA custody eATA to the pinned TEE",
      );
    } else if (!custodyInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
      throw new Error("Custody eATA has an unexpected owner.");
    }
  }

  const custodyPermissionInfo = await base.getAccountInfo(
    accounts.custodyEataPermission,
    "confirmed",
  );
  if (!custodyPermissionInfo?.owner.equals(PERMISSION_PROGRAM_ID)) {
    throw new Error("Custody eATA permission is unavailable on the base layer.");
  }
  const custodyPermission = decodePrivatePermission(custodyPermissionInfo.data);
  const custodyPdaHasAuthority = custodyPermission.members.some(
    (member) =>
      member.pubkey === accounts.vault.toBase58() &&
      (member.flags & mb.AUTHORITY_FLAG) !== 0,
  );
  if (!custodyPdaHasAuthority) {
    const group = planGroup(plan, "base.repairCustodyPdaAuthority");
    await sendOnce(
      "setup.repair-custody-pda-authority",
      "base",
      base,
      group.instructions,
      [identities.company],
      "Restore least-privilege AUTHORITY for the custody eATA owner PDA",
    );
  }

  const recipientTokenViewInfo = await base.getAccountInfo(
    accounts.destinationTokenAccount,
    "confirmed",
  );
  if (!recipientTokenViewInfo) {
    const group = planGroup(plan, "base.initializeRecipientTokenView");
    await sendOnce(
      `setup.${label}.initialize-recipient-token-view`,
      "base",
      base,
      group.instructions,
      [context.recipient],
      `${context.recipientRole} initializes only its canonical Circle-USDC token view`,
    );
  } else if (!recipientTokenViewInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`${context.recipientRole} token view has an unexpected owner.`);
  }

  const recipientInfo = await base.getAccountInfo(accounts.destinationEata, "confirmed");
  if (!recipientInfo) {
    const group = planGroup(plan, "base.setupRecipientEata");
    await sendOnce(
      `setup.${label}.recipient-self-onboard`,
      "base",
      base,
      group.instructions,
      [context.recipient],
      `${context.recipientRole} self-initializes, permissions, and delegates only its own eATA`,
    );
  } else if (!recipientInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(`${context.recipientRole} eATA exists with an unexpected owner.`);
  }

  const recipientPermissionAddress = derivePermission(accounts.destinationEata);
  const recipientPermissionInfo = await base.getAccountInfo(
    recipientPermissionAddress,
    "confirmed",
  );
  if (!recipientPermissionInfo?.owner.equals(PERMISSION_PROGRAM_ID)) {
    throw new Error(`${context.recipientRole} eATA permission is unavailable on base.`);
  }
  const recipientPermission = decodePrivatePermission(recipientPermissionInfo.data);
  const recipientPdaHasAuthority = recipientPermission.members.some(
    (member) =>
      member.pubkey === accounts.vault.toBase58() &&
      (member.flags & mb.AUTHORITY_FLAG) !== 0,
  );
  if (!recipientPdaHasAuthority) {
    const group = planGroup(plan, "base.repairRecipientPdaAuthority");
    await sendOnce(
      `setup.${label}.repair-recipient-pda-authority`,
      "base",
      base,
      group.instructions,
      [identities.company],
      `Grant least-privilege AUTHORITY to the custody PDA for recipient ${label}`,
    );
  }

  if (!(await base.getAccountInfo(accounts.intent, "confirmed"))) {
    const group = planGroup(plan, "base.initializePaymentShells");
    await sendOnce(
      `setup.${label}.initialize-shells`,
      "base",
      base,
      group.instructions,
      [identities.company],
      `Create sparse public intent and receipt shells for payment ${label}`,
    );
  }

  if (label === "A") {
    const vaultInfo = await base.getAccountInfo(accounts.vault, "confirmed");
    if (vaultInfo?.owner.equals(PROGRAM_ID)) {
      const group = planGroup(plan, "base.delegateVault");
      await sendOnce(
        "setup.delegate-vault",
        "base",
        base,
        group.instructions,
        [identities.company],
        "Delegate the isolated CompanyVault to the pinned TEE",
      );
    } else if (!vaultInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
      throw new Error("CompanyVault has an unexpected owner.");
    }
  }

  for (const [kind, address, groupName] of [
    ["intent", accounts.intent, "base.delegateIntent"],
    ["receipt", accounts.receipt, "base.delegateReceipt"],
  ]) {
    const info = await base.getAccountInfo(address, "confirmed");
    if (info?.owner.equals(PROGRAM_ID)) {
      const group = planGroup(plan, groupName);
      await sendOnce(
        `setup.${label}.delegate-${kind}`,
        "base",
        base,
        group.instructions,
        [identities.company],
        `Delegate payment ${label} ${kind} to the pinned TEE`,
      );
    } else if (!info?.owner.equals(DELEGATION_PROGRAM_ID)) {
      throw new Error(`Payment ${label} ${kind} has an unexpected owner.`);
    }
  }

  console.log(`setup.${label}: base state finalized; authenticating company on PER`);
  const per = await authenticatedPer("company");
  console.log(`setup.${label}: PER authentication succeeded; checking delegation propagation`);
  for (const [address, name] of [
    [accounts.vault, "vault"],
    [accounts.sourceTokenAccount, "custody token view"],
    [accounts.destinationTokenAccount, `${context.recipientRole} token view`],
    [accounts.intent, `payment ${label} intent`],
    [accounts.receipt, `payment ${label} receipt`],
  ]) {
    const delegationAddress = address.equals(accounts.sourceTokenAccount)
      ? accounts.sourceEata
      : address.equals(accounts.destinationTokenAccount)
        ? accounts.destinationEata
        : address;
    console.log(`setup.${label}: checking ${name}`);
    await verifyDelegation(delegationAddress, name);
    await waitForAccount(per, address, name);
  }
  console.log(`setup.${label}: delegated accounts are readable; building PER configuration`);
  const perPlan = await buildInstructionPlan(state, per, label);
  if (label === "A") {
    const group = planGroup(perPlan, "per.configureVaultPrivateAccess");
    await sendOnce(
      "setup.configure-vault-private-access",
      "per",
      per,
      group.instructions,
      [identities.company],
      "Create the one-time company-authority/accountant-view vault permission",
    );
  } else {
    const group = planGroup(perPlan, "per.rotateRecipient");
    await sendOnce(
      "setup.B.rotate-recipient",
      "per",
      per,
      group.instructions,
      [identities.company],
      "Select recipient B and advance the wallet revision without changing receipt A",
    );
  }
  {
    const group = planGroup(perPlan, "per.configurePaymentPrivateAccess");
    await sendOnce(
      `setup.${label}.configure-payment-private-access`,
      "per",
      per,
      group.instructions,
      [identities.company],
      `Create isolated intent and receipt permissions for payment ${label}`,
    );
  }
  {
    const group = planGroup(perPlan, "per.configurePayment");
    await sendOnce(
      `setup.${label}.configure-payment`,
      "per",
      per,
      group.instructions,
      [identities.company],
      `Bind payment ${label} to exact recipient, accounts, amount, revision, and hash`,
    );
  }
}

async function executeInstruction(label, overrides = {}) {
  const context = deriveContext(state, label);
  const per = await authenticatedPer("company");
  const program = programFor(per, identities.company);
  const paymentId = overrides.paymentId ?? context.paymentId;
  const recipient = overrides.recipient ?? context.recipient.publicKey;
  const amount = overrides.amount ?? context.amount;
  const walletRevision = overrides.walletRevision ?? context.walletRevision;
  const intentHash = overrides.intentHash ?? context.intentHash;
  const accounts = context.accounts;
  return program.methods
    .executePrivatePayment(
      [...paymentId],
      recipient,
      new anchor.BN(amount.toString()),
      new anchor.BN(walletRevision.toString()),
      [...intentHash],
    )
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
      receipt: accounts.receipt,
      mint: overrides.mint ?? DEVNET_USDC_MINT,
      sourceTokenAccount:
        overrides.sourceTokenAccount ?? accounts.sourceTokenAccount,
      destinationTokenAccount:
        overrides.destinationTokenAccount ?? accounts.destinationTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

async function approvalInstruction(label, signer) {
  const context = deriveContext(state, label);
  const per = await authenticatedPer("company");
  const program = programFor(per, signer);
  return program.methods
    .approvePayment([...context.paymentId])
    .accountsStrict({
      approver: signer.publicKey,
      intent: context.accounts.intent,
    })
    .instruction();
}

async function runNegativeSimulationsBeforeExecution(label, per) {
  const context = deriveContext(state, label);
  const watched = [
    context.accounts.sourceTokenAccount,
    context.accounts.destinationTokenAccount,
    context.accounts.intent,
    context.accounts.receipt,
  ];
  for (const [name, signer] of [
    ["duplicate-approver", identities.approverOne],
    ["accountant-cannot-approve", identities.accountant],
    ["recipient-cannot-approve", context.recipient],
    ["outsider-cannot-approve", identities.outsider],
  ]) {
    const signerRole = identityRoleForSigner(identities, signer);
    if (!signerRole) {
      throw new Error(`${name} signer does not match an isolated identity.`);
    }
    await simulate(
      `negative.${label}.${name}`,
      await authenticatedPer(signerRole),
      [await approvalInstruction(label, signer)],
      [signer],
      { expectSuccess: false, watched, watchRpc: per },
    );
  }
  await simulate(
    `negative.${label}.one-approval-cannot-execute`,
    per,
    [await executeInstruction(label)],
    [identities.company],
    { expectSuccess: false, watched },
  );
}

async function runBoundNegativeSimulations(label, per) {
  const context = deriveContext(state, label);
  const watched = [
    context.accounts.sourceTokenAccount,
    context.accounts.destinationTokenAccount,
    context.accounts.intent,
    context.accounts.receipt,
  ];
  const changedHash = Buffer.from(context.intentHash);
  changedHash[0] ^= 0xff;
  const otherPaymentId = deriveContext(state, label === "A" ? "B" : "A").paymentId;
  const cases = [
    ["wrong-payment-id", { paymentId: otherPaymentId }],
    ["wrong-recipient", { recipient: identities.outsider.publicKey }],
    ["wrong-destination", { destinationTokenAccount: context.accounts.sourceTokenAccount }],
    ["wrong-amount", { amount: context.amount + 1n }],
    ["wrong-mint", { mint: NATIVE_MINT }],
    ["stale-wallet-revision", { walletRevision: context.walletRevision - 1n }],
    ["changed-intent-hash", { intentHash: changedHash }],
  ];
  for (const [name, overrides] of cases) {
    await simulate(
      `negative.${label}.${name}`,
      per,
      [await executeInstruction(label, overrides)],
      [identities.company],
      { expectSuccess: false, watched },
    );
  }
  const directTransfer = createTransferInstruction(
    context.accounts.sourceTokenAccount,
    context.accounts.destinationTokenAccount,
    identities.company.publicKey,
    context.amount,
  );
  await simulate(
    `negative.${label}.company-direct-custody-transfer`,
    per,
    [directTransfer],
    [identities.company],
    { expectSuccess: false, watched },
  );
}

function receiptView(receipt) {
  return {
    vault: receipt.vault.toBase58(),
    paymentIdHex: Buffer.from(field(receipt, "payment_id", "paymentId")).toString("hex"),
    company: receipt.company.toBase58(),
    accountant: receipt.accountant.toBase58(),
    recipient: receipt.recipient.toBase58(),
    sourceEata: field(receipt, "source_eata", "sourceEata").toBase58(),
    destinationEata: field(receipt, "destination_eata", "destinationEata").toBase58(),
    mint: receipt.mint.toBase58(),
    amountBaseUnits: receipt.amount.toString(),
    walletRevision: field(receipt, "wallet_revision", "walletRevision").toString(),
    intentHashHex: Buffer.from(field(receipt, "intent_hash", "intentHash")).toString("hex"),
    paidAt: field(receipt, "paid_at", "paidAt").toString(),
    status: Number(receipt.status),
    statusName: Number(receipt.status) === RECEIPT_PAID ? "PAID" : "INITIALIZED",
  };
}

function assertPaidReceipt(receipt, context) {
  const view = receiptView(receipt);
  const expected = {
    vault: context.accounts.vault.toBase58(),
    paymentIdHex: context.paymentId.toString("hex"),
    company: identities.company.publicKey.toBase58(),
    accountant: identities.accountant.publicKey.toBase58(),
    recipient: context.recipient.publicKey.toBase58(),
    sourceEata: context.accounts.sourceEata.toBase58(),
    destinationEata: context.accounts.destinationEata.toBase58(),
    mint: DEVNET_USDC_MINT.toBase58(),
    amountBaseUnits: context.amount.toString(),
    walletRevision: context.walletRevision.toString(),
    intentHashHex: context.intentHash.toString("hex"),
    status: RECEIPT_PAID,
    statusName: "PAID",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (view[name] !== value) {
      throw new Error(`Paid receipt field ${name} did not match the approved intent.`);
    }
  }
  if (BigInt(view.paidAt) <= 0n) {
    throw new Error("Paid receipt lacks a valid timestamp.");
  }
  return view;
}

function safeSubmitError(error) {
  const message = cleanError(error)
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, "[redacted-serialized-transaction]")
    .replace(/[1-9A-HJ-NP-Za-km-z]{160,}/g, "[redacted-serialized-transaction]");
  return {
    name: String(error?.name || "Error").slice(0, 120),
    status: Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.response?.status)
        ? error.response.status
        : null,
    message,
  };
}

function assertPublicKeyField(actual, expected, label) {
  if (!actual || !publicKey(actual).equals(publicKey(expected))) {
    throw new Error(`${label} does not match the fixed approved payment.`);
  }
}

function assertBytesField(actual, expected, label) {
  if (!actual || !Buffer.from(actual).equals(Buffer.from(expected))) {
    throw new Error(`${label} does not match the fixed approved payment.`);
  }
}

async function readPaymentState(rpc, context) {
  const [source, destination, intent, receipt] = await Promise.all([
    rpc.getTokenAccountBalance(context.accounts.sourceTokenAccount),
    rpc.getTokenAccountBalance(context.accounts.destinationTokenAccount),
    decodedAccount(rpc, "PaymentIntent", context.accounts.intent),
    decodedAccount(rpc, "PaymentReceipt", context.accounts.receipt),
  ]);
  if (!intent || !receipt) {
    throw new Error("The approved intent or initialized receipt is unavailable on the PER.");
  }
  return {
    sourceBalance: BigInt(source.value.amount),
    destinationBalance: BigInt(destination.value.amount),
    intent,
    receipt,
  };
}

function paymentStateView(value) {
  return {
    sourceBalance: value.sourceBalance.toString(),
    destinationBalance: value.destinationBalance.toString(),
    intentStatus: Number(value.intent.status),
    intentStatusName:
      Number(value.intent.status) === INTENT_EXECUTED
        ? "EXECUTED"
        : Number(value.intent.status) === INTENT_APPROVED
          ? "APPROVED"
          : "PENDING",
    approvalMask: Number(field(value.intent, "approval_mask", "approvalMask")),
    approvalCount: Number(field(value.intent, "approval_count", "approvalCount")),
    intentExecuted: Boolean(value.intent.executed),
    receiptStatus: Number(value.receipt.status),
    receiptStatusName:
      Number(value.receipt.status) === RECEIPT_PAID ? "PAID" : "INITIALIZED",
    receiptAmount: value.receipt.amount.toString(),
  };
}

function assertReadyPaymentState(value, context) {
  if (
    value.sourceBalance !== 20_000n ||
    value.destinationBalance !== 0n
  ) {
    throw new Error("Private token balances differ from the authoritative pre-payment state.");
  }
  const intent = value.intent;
  if (
    Number(intent.status) !== INTENT_APPROVED ||
    Boolean(intent.executed) ||
    Number(field(intent, "approval_mask", "approvalMask")) !== 3 ||
    Number(field(intent, "approval_count", "approvalCount")) !== 2
  ) {
    throw new Error("PaymentIntent is not APPROVED by the two distinct fixed approvers.");
  }
  assertPublicKeyField(intent.vault, context.accounts.vault, "intent vault");
  assertBytesField(
    field(intent, "payment_id", "paymentId"),
    context.paymentId,
    "intent payment ID",
  );
  assertPublicKeyField(intent.mint, DEVNET_USDC_MINT, "intent mint");
  assertPublicKeyField(intent.recipient, context.recipient.publicKey, "intent recipient");
  assertPublicKeyField(
    field(intent, "source_eata", "sourceEata"),
    context.accounts.sourceEata,
    "intent source eATA",
  );
  assertPublicKeyField(
    field(intent, "destination_eata", "destinationEata"),
    context.accounts.destinationEata,
    "intent destination eATA",
  );
  assertPublicKeyField(
    field(intent, "source_token_account", "sourceTokenAccount"),
    context.accounts.sourceTokenAccount,
    "intent source token account",
  );
  assertPublicKeyField(
    field(intent, "destination_token_account", "destinationTokenAccount"),
    context.accounts.destinationTokenAccount,
    "intent destination token account",
  );
  if (
    BigInt(intent.amount.toString()) !== 10_000n ||
    BigInt(field(intent, "wallet_revision", "walletRevision").toString()) !==
      context.walletRevision
  ) {
    throw new Error("Intent amount or wallet revision differs from the fixed payment.");
  }
  assertBytesField(
    field(intent, "intent_hash", "intentHash"),
    context.intentHash,
    "intent hash",
  );

  const receipt = value.receipt;
  if (
    Number(receipt.status) !== RECEIPT_INITIALIZED ||
    BigInt(receipt.amount.toString()) !== 0n
  ) {
    throw new Error("PaymentReceipt is not INITIALIZED with amount zero.");
  }
  assertPublicKeyField(receipt.vault, context.accounts.vault, "receipt vault");
  assertBytesField(
    field(receipt, "payment_id", "paymentId"),
    context.paymentId,
    "receipt payment ID",
  );
}

function paymentStateIsUnchanged(before, after) {
  return JSON.stringify(paymentStateView(before)) === JSON.stringify(paymentStateView(after));
}

async function transactionEvidence(rpc, signature, status) {
  let transaction = null;
  let retrievalError = null;
  try {
    transaction = await rpc.getTransaction(signature, {
      commitment:
        status?.confirmationStatus === "finalized" ? "finalized" : "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (error) {
    retrievalError = safeSubmitError(error);
  }
  const logs = transaction?.meta?.logMessages ?? [];
  return {
    available: Boolean(transaction),
    retrievalError,
    slot: transaction?.slot ?? status?.slot ?? null,
    transactionError: transaction?.meta?.err ?? status?.err ?? null,
    topLevelInstructionCount:
      transaction?.transaction?.message?.compiledInstructions?.length ?? null,
    programInvoked: logs.some((line) =>
      line.includes(`Program ${PROGRAM_ID.toBase58()} invoke`),
    ),
    programSucceeded: logs.some((line) =>
      line.includes(`Program ${PROGRAM_ID.toBase58()} success`),
    ),
    tokenProgramInvoked: logs.some((line) =>
      line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke`),
    ),
    tokenProgramSucceeded: logs.some((line) =>
      line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} success`),
    ),
    logs,
  };
}

async function reconcileDirectPayment(
  rpc,
  record,
  before,
  context,
  submitError,
  returnedSignature,
) {
  const ingressRejected = Boolean(
    submitError && /(?:HTTP\s*)?403|forbidden/i.test(JSON.stringify(submitError)),
  );
  let signatureStatus = null;
  let currentBlockHeight = null;
  let reconciliationError = null;
  const maximumPolls = ingressRejected ? 3 : 100;

  for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
    try {
      signatureStatus = await statusFor(rpc, record.signature);
      currentBlockHeight = await rpc.getBlockHeight("confirmed");
      record.lastPolledAt = new Date().toISOString();
      record.currentBlockHeight = currentBlockHeight;
      record.confirmationStatus = signatureStatus?.confirmationStatus ?? null;
      record.slot = signatureStatus?.slot ?? null;
      record.error = signatureStatus?.err ?? null;
      save();
      if (
        signatureStatus?.err ||
        signatureStatus?.confirmationStatus === "finalized" ||
        (!signatureStatus && currentBlockHeight > record.lastValidBlockHeight)
      ) {
        break;
      }
      if (ingressRejected && !signatureStatus) {
        if (attempt === maximumPolls - 1) break;
      }
    } catch (error) {
      reconciliationError = safeSubmitError(error);
      record.reconciliationError = reconciliationError;
      save();
    }
    await sleep(2_500);
  }

  let after = null;
  let stateReadError = null;
  try {
    after = await readPaymentState(rpc, context);
  } catch (error) {
    stateReadError = safeSubmitError(error);
  }
  const evidence = await transactionEvidence(rpc, record.signature, signatureStatus);
  const beforeView = paymentStateView(before);
  const afterView = after ? paymentStateView(after) : null;
  const unchanged = after ? paymentStateIsUnchanged(before, after) : null;
  let paidReceipt = null;
  let atomicValidationError = null;
  let atomicStateValid = false;
  if (after) {
    try {
      paidReceipt = assertPaidReceipt(after.receipt, context);
      atomicStateValid =
        after.sourceBalance === 10_000n &&
        after.destinationBalance === 10_000n &&
        Number(after.intent.status) === INTENT_EXECUTED &&
        Boolean(after.intent.executed) &&
        Number(after.receipt.status) === RECEIPT_PAID;
      if (!atomicStateValid) {
        throw new Error("Post-state did not contain all four atomic transitions.");
      }
    } catch (error) {
      atomicValidationError = cleanError(error);
      atomicStateValid = false;
      paidReceipt = null;
    }
  }

  let outcome;
  if (signatureStatus?.err) {
    outcome = "PER_EXECUTION_ERROR";
  } else if (signatureStatus && atomicStateValid) {
    outcome =
      signatureStatus.confirmationStatus === "finalized"
        ? "FINALIZED_SUCCESS"
        : "CONFIRMED_SUCCESS";
  } else if (signatureStatus) {
    outcome = "SIGNATURE_SUCCESS_STATE_MISMATCH";
  } else if (ingressRejected && unchanged === true) {
    outcome = "PER_INGRESS_REJECTED";
  } else if (
    currentBlockHeight !== null &&
    currentBlockHeight > record.lastValidBlockHeight &&
    unchanged === true
  ) {
    outcome = "EXPIRED_NOT_LANDED";
  } else {
    outcome = "UNKNOWN";
  }

  Object.assign(record, {
    returnedSignature: returnedSignature ?? null,
    submitError,
    reconciliationError,
    stateReadError,
    currentBlockHeight,
    confirmationStatus: signatureStatus?.confirmationStatus ?? null,
    slot: signatureStatus?.slot ?? evidence.slot ?? null,
    error: signatureStatus?.err ?? null,
    outcome,
    reconciledAt: new Date().toISOString(),
    before: beforeView,
    after: afterView,
    persistentStateUnchanged: unchanged,
    atomicStateValid,
    atomicValidationError,
    transactionEvidence: evidence,
  });
  state.observations["payment.A.direct-submit-result"] = {
    signature: record.signature,
    outcome,
    confirmationStatus: record.confirmationStatus,
    slot: record.slot,
    blockhash: record.blockhash,
    lastValidBlockHeight: record.lastValidBlockHeight,
    currentBlockHeight,
    before: beforeView,
    after: afterView,
    paidReceipt,
    transactionEvidence: evidence,
    submitError,
    stateReadError,
    recordedAt: new Date().toISOString(),
  };
  if (atomicStateValid) {
    state.observations["payment.A.result"] = {
      signature: record.signature,
      slot: record.slot,
      finality: record.confirmationStatus,
      topLevelInstructionCount: evidence.topLevelInstructionCount,
      innerTokenCpiObserved: evidence.tokenProgramInvoked,
      transactionError: evidence.transactionError,
      sourceBefore: before.sourceBalance.toString(),
      sourceAfter: after.sourceBalance.toString(),
      destinationBefore: before.destinationBalance.toString(),
      destinationAfter: after.destinationBalance.toString(),
      receipt: paidReceipt,
      recordedAt: new Date().toISOString(),
    };
  }
  save();
  return state.observations["payment.A.direct-submit-result"];
}

async function submitPaymentOnce() {
  const label = "payment.A.execute";
  await verifyNetwork("per");
  if (state.transactions[label]) {
    throw new Error(
      `${label} already has a durable transaction record; refusing a replacement or second submission.`,
    );
  }

  await reconcile();
  const unresolved = Object.entries(state.transactions).filter(
    ([, record]) =>
      record.outcome !== "success" || record.confirmationStatus !== "finalized",
  );
  if (unresolved.length) {
    throw new Error(
      `Existing transaction reconciliation is not fully finalized-success: ${unresolved
        .map(([existingLabel]) => existingLabel)
        .join(", ")}`,
    );
  }
  if (state.observations["payment.A.result"]) {
    throw new Error("A successful payment result already exists; refusing another payment.");
  }

  const rpc = await authenticatedPer("company");
  const context = deriveContext(state, "A");
  if (context.amount !== 10_000n) {
    throw new Error("Derived payment amount differs from the authorized transaction.");
  }
  const before = await readPaymentState(rpc, context);
  assertReadyPaymentState(before, context);

  const plan = await buildInstructionPlan(state, rpc, "A");
  const execute = planGroup(plan, "per.executeSimulationOnly");
  if (
    execute.instructions.length !== 1 ||
    !execute.instructions[0].programId.equals(PROGRAM_ID)
  ) {
    throw new Error("The approved payment is not exactly one isolated program instruction.");
  }
  const prepared = await prepareTransaction(
    rpc,
    execute.instructions,
    [identities.company],
  );
  const record = (state.transactions[label] = {
    ...prepared.record,
    endpoint: "per",
    semanticLabel: label,
    semanticAction:
      "Atomically transfer 0.01 private devnet USDC and write payment A receipt",
    signerRoles: ["company"],
    preparedAt: new Date().toISOString(),
    submittedAt: null,
    submissionAttemptedAt: null,
    submissionAttempts: 0,
    outcome: "PREPARED",
    skipPreflight: true,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  });
  save();

  const attemptedAt = new Date().toISOString();
  record.submittedAt = attemptedAt;
  record.submissionAttemptedAt = attemptedAt;
  record.submissionAttempts = 1;
  record.outcome = "SUBMISSION_ATTEMPTED";
  save();

  let returnedSignature = null;
  let submitError = null;
  try {
    returnedSignature = await rpc.sendRawTransaction(
      Buffer.from(record.bytes, "base64"),
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      },
    );
    record.returnedSignature = returnedSignature;
    if (returnedSignature !== record.signature) {
      record.signatureMismatch = true;
    }
  } catch (error) {
    submitError = safeSubmitError(error);
    record.submitError = submitError;
  }
  record.submissionResponseAt = new Date().toISOString();
  save();

  const result = await reconcileDirectPayment(
    rpc,
    record,
    before,
    context,
    submitError,
    returnedSignature,
  );
  console.dir(
    {
      signature: result.signature,
      outcome: result.outcome,
      confirmationStatus: result.confirmationStatus,
      slot: result.slot,
      lastValidBlockHeight: result.lastValidBlockHeight,
      currentBlockHeight: result.currentBlockHeight,
      before: result.before,
      after: result.after,
      programInvoked: result.transactionEvidence.programInvoked,
      programSucceeded: result.transactionEvidence.programSucceeded,
      tokenProgramInvoked: result.transactionEvidence.tokenProgramInvoked,
      tokenProgramSucceeded: result.transactionEvidence.tokenProgramSucceeded,
      submitError: result.submitError,
      serializedTransactionPrinted: false,
      submissionAttempts: record.submissionAttempts,
    },
    { depth: null },
  );
}

async function pay(label) {
  if (label !== "A") {
    throw new Error("This live runner is capped to the single authorized payment A.");
  }
  const context = deriveContext(state, label);
  const per = await authenticatedPer("company");
  const plan = await buildInstructionPlan(state, per, label);
  const watched = [
    context.accounts.sourceTokenAccount,
    context.accounts.destinationTokenAccount,
    context.accounts.intent,
    context.accounts.receipt,
  ];

  const currentIntent = await decodedAccount(per, "PaymentIntent", context.accounts.intent);
  if (!currentIntent) throw new Error(`Payment ${label} intent is unavailable.`);
  if (!field(currentIntent, "approval_count", "approvalCount")) {
    const group = planGroup(plan, "per.approveOne");
    await sendOnce(
      `payment.${label}.approval-one`,
      "per",
      await authenticatedPer("approverOne"),
      group.instructions,
      [identities.approverOne],
      `Approver one approves payment ${label}`,
    );
  }

  const afterOne = await decodedAccount(per, "PaymentIntent", context.accounts.intent);
  if (Number(field(afterOne, "approval_count", "approvalCount")) === 1) {
    await runNegativeSimulationsBeforeExecution(label, per);
    const group = planGroup(plan, "per.approveTwo");
    await sendOnce(
      `payment.${label}.approval-two`,
      "per",
      await authenticatedPer("approverTwo"),
      group.instructions,
      [identities.approverTwo],
      `Approver two independently approves payment ${label}`,
    );
  }

  const approvedIntent = await decodedAccount(per, "PaymentIntent", context.accounts.intent);
  if (Number(field(approvedIntent, "approval_count", "approvalCount")) !== 2) {
    throw new Error(`Payment ${label} does not have exactly two approvals.`);
  }

  const receiptBefore = await decodedAccount(per, "PaymentReceipt", context.accounts.receipt);
  if (Number(receiptBefore.status) === RECEIPT_PAID) {
    return;
  }

  await runBoundNegativeSimulations(label, per);
  const beforeSource = BigInt(
    (await per.getTokenAccountBalance(context.accounts.sourceTokenAccount)).value.amount,
  );
  const beforeDestination = BigInt(
    (await per.getTokenAccountBalance(context.accounts.destinationTokenAccount)).value.amount,
  );
  const execute = planGroup(plan, "per.executeSimulationOnly");
  const validSimulation = await simulate(
    `payment.${label}.valid-execution-simulation`,
    per,
    execute.instructions,
    [identities.company],
    { expectSuccess: true, watched },
  );
  if (!validSimulation.observation.tokenCpiObserved) {
    throw new Error(`Payment ${label} simulation lacked the PDA-signed token CPI.`);
  }

  await sendOnce(
    `payment.${label}.execute`,
    "per",
    per,
    execute.instructions,
    [identities.company],
    `Atomically transfer 0.01 private devnet USDC and write payment ${label} receipt`,
    { finalized: true },
  );

  const [afterSourceResult, afterDestinationResult, intentAfter, receiptAfter] =
    await Promise.all([
      per.getTokenAccountBalance(context.accounts.sourceTokenAccount),
      per.getTokenAccountBalance(context.accounts.destinationTokenAccount),
      decodedAccount(per, "PaymentIntent", context.accounts.intent),
      decodedAccount(per, "PaymentReceipt", context.accounts.receipt),
    ]);
  const afterSource = BigInt(afterSourceResult.value.amount);
  const afterDestination = BigInt(afterDestinationResult.value.amount);
  if (
    beforeSource - afterSource !== MAX_PAYMENT ||
    afterDestination - beforeDestination !== MAX_PAYMENT ||
    Number(intentAfter.status) !== 2 ||
    !intentAfter.executed ||
    Number(receiptAfter.status) !== RECEIPT_PAID
  ) {
    throw new Error(`Payment ${label} post-state failed atomic reconciliation.`);
  }
  const paidReceipt = assertPaidReceipt(receiptAfter, context);
  const transactionRecord = state.transactions[`payment.${label}.execute`];
  const transaction = await per.getTransaction(transactionRecord.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction || transaction.meta?.err) {
    throw new Error(`Payment ${label} transaction record is unavailable or failed.`);
  }
  const innerTokenCpiObserved =
    transaction.meta.logMessages?.some(
      (line) =>
        line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke`) &&
        line.includes("[2]"),
    ) ?? false;
  if (!innerTokenCpiObserved) {
    throw new Error(`Payment ${label} finalized without an observable token CPI.`);
  }
  if (transaction.transaction.message.compiledInstructions.length !== 1) {
    throw new Error(`Payment ${label} did not use exactly one top-level instruction.`);
  }
  state.observations[`payment.${label}.result`] = {
    signature: transactionRecord.signature,
    slot: transaction.slot,
    finality: transactionRecord.confirmationStatus,
    topLevelInstructionCount:
      transaction.transaction.message.compiledInstructions.length,
    innerTokenCpiObserved,
    transactionError: transaction.meta.err,
    sourceBefore: beforeSource.toString(),
    sourceAfter: afterSource.toString(),
    destinationBefore: beforeDestination.toString(),
    destinationAfter: afterDestination.toString(),
    receipt: paidReceipt,
    recordedAt: new Date().toISOString(),
  };
  save();

  await simulate(
    `negative.${label}.replay-already-paid`,
    per,
    [await executeInstruction(label)],
    [identities.company],
    { expectSuccess: false, watched },
  );
}

async function rawAccountProbe(endpoint, address, decoderName = null) {
  let response;
  let body;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address.toBase58(), { encoding: "base64", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    body = await response.json().catch(() => null);
  } catch (error) {
    return {
      httpStatus: null,
      rpcError: cleanError(error),
      returned: false,
      owner: null,
      dataLength: 0,
      decoded: false,
      value: null,
    };
  }
  const value = body?.result?.value ?? null;
  let decoded = null;
  if (value?.data?.[0] && decoderName) {
    try {
      decoded = coder.accounts.decode(
        decoderName,
        Buffer.from(value.data[0], "base64"),
      );
    } catch {
      decoded = null;
    }
  }
  return {
    httpStatus: response.status,
    rpcError: body?.error ?? null,
    returned: Boolean(value),
    owner: value?.owner ?? null,
    dataLength: value?.data?.[0]
      ? Buffer.from(value.data[0], "base64").length
      : 0,
    decoded: Boolean(decoded),
    value: decoded,
  };
}

async function reliableAccountProbe(endpoint, address, decoderName = null) {
  const first = await rawAccountProbe(endpoint, address, decoderName);
  if (first.httpStatus !== null) return { ...first, attempts: 1 };
  await sleep(1_500);
  const second = await rawAccountProbe(endpoint, address, decoderName);
  if (second.httpStatus === null) {
    throw new Error("Two account probes failed without an HTTP response; privacy is inconclusive.");
  }
  return { ...second, attempts: 2 };
}

async function permissionProbe(endpoint, address) {
  const result = await reliableAccountProbe(endpoint, address);
  let permission = null;
  if (result.returned) {
    const rpc = connection(endpoint);
    const info = await rpc.getAccountInfo(address, "confirmed");
    if (info?.owner.equals(PERMISSION_PROGRAM_ID)) {
      const decoded = decodePrivatePermission(info.data);
      permission = {
        permissionedAccount: decoded.permissionedAccount,
        isPrivate: decoded.isPrivate,
        members: decoded.members,
      };
    }
  }
  return {
    returned: result.returned,
    owner: result.owner,
    httpStatus: result.httpStatus,
    permission,
  };
}

async function probeAccess() {
  await verifyNetwork("per");
  await authenticatedPer("company");
  const context = deriveContext(state, "A");
  const { accounts } = context;
  const endpoint = authUrls.get("company");
  const permissionAddresses = {
    vault: accounts.vaultPermission,
    sourceCustodyEata: accounts.custodyEataPermission,
    paymentIntent: accounts.intentPermission,
    paymentReceipt: accounts.receiptPermission,
    destinationRecipientEata: derivePermission(accounts.destinationEata),
  };
  const permissionComparisons = {};
  for (const [role, address] of Object.entries(permissionAddresses)) {
    const [baseResult, perResult] = await Promise.all([
      permissionProbe(BASE_RPC, address),
      permissionProbe(endpoint, address),
    ]);
    permissionComparisons[role] = {
      address: address.toBase58(),
      base: {
        returned: baseResult.returned,
        owner: baseResult.owner,
        permission: baseResult.permission,
      },
      per: {
        returned: perResult.returned,
        owner: perResult.owner,
        permission: perResult.permission,
        requestReachedPer: perResult.httpStatus !== null,
        filtered: perResult.httpStatus === 200 && !perResult.returned,
      },
    };
  }

  const required = [
    ["CompanyVault", accounts.vault, "vault"],
    ["source custody eATA", accounts.sourceEata, "sourceCustodyEata"],
    ["source custody PER token view", accounts.sourceTokenAccount, "sourceCustodyEata"],
    ["PaymentIntent", accounts.intent, "paymentIntent"],
    ["PaymentReceipt", accounts.receipt, "paymentReceipt"],
    ["destination recipient eATA", accounts.destinationEata, "destinationRecipientEata"],
    ["destination recipient PER token view", accounts.destinationTokenAccount, "destinationRecipientEata"],
  ];
  const accountsReport = [];
  for (const [role, address, permissionRole] of required) {
    const result = await reliableAccountProbe(endpoint, address);
    accountsReport.push({
      address: address.toBase58(),
      role,
      returned: result.returned,
      owner: result.owner,
      permission: permissionComparisons[permissionRole],
      requestReachedPer: result.httpStatus !== null,
      filtered: result.httpStatus === 200 && !result.returned,
    });
  }

  const firstInaccessible = accountsReport.find((entry) => !entry.returned) ?? null;
  const report = {
    accounts: accountsReport,
    associatedPermissions: Object.entries(permissionComparisons).map(
      ([role, comparison]) => ({ role, ...comparison }),
    ),
    firstInaccessible: firstInaccessible
      ? { address: firstInaccessible.address, role: firstInaccessible.role }
      : null,
  };
  state.observations.companyAccountProbe = {
    ...report,
    recordedAt: new Date().toISOString(),
  };
  save();
  console.dir(report, { depth: null });
}

async function audit() {
  await verifyNetwork("per");
  for (const role of Object.keys(identities)) {
    await authenticatedPer(role);
  }
  const a = deriveContext(state, "A");
  const resources = {
    vault: [a.accounts.vault, "CompanyVault"],
    intentA: [a.accounts.intent, "PaymentIntent"],
    receiptA: [a.accounts.receipt, "PaymentReceipt"],
    custody: [a.accounts.sourceTokenAccount, null],
    destinationA: [a.accounts.destinationTokenAccount, null],
  };
  const checks = [
    ["company", "vault"],
    ["accountant", "vault"],
    ["company", "intentA"],
    ["approverOne", "intentA"],
    ["approverTwo", "intentA"],
    ["approverOne", "vault"],
    ["approverTwo", "vault"],
    ["approverOne", "receiptA"],
    ["approverTwo", "receiptA"],
    ["accountant", "intentA"],
    ["recipientA", "vault"],
    ["recipientB", "vault"],
    ["recipientA", "receiptA"],
    ["recipientB", "receiptA"],
    ["accountant", "receiptA"],
    ["company", "receiptA"],
    ["outsider", "receiptA"],
    ["recipientA", "destinationA"],
    ["recipientB", "destinationA"],
    ["recipientA", "custody"],
    ["recipientB", "custody"],
    ["company", "custody"],
  ];
  const matrix = [];
  for (const [role, resourceName] of checks) {
    const [address, decoderName] = resources[resourceName];
    const result = await reliableAccountProbe(authUrls.get(role), address, decoderName);
    matrix.push({
      endpoint: "MagicBlock devnet PER",
      authenticatedIdentity: role,
      account: resourceName,
      address: address.toBase58(),
      httpStatus: result.httpStatus,
      rpcError: result.rpcError,
      returned: result.returned,
      owner: result.owner,
      dataLength: result.dataLength,
      decoded: result.decoded,
      decodedReceipt:
        decoderName === "PaymentReceipt" && result.value
          ? receiptView(result.value)
          : null,
      attempts: result.attempts,
    });
  }
  for (const resourceName of ["receiptA"]) {
    const [address, decoderName] = resources[resourceName];
    for (const [identity, endpoint] of [
      ["unauthenticated", PER_RPC],
      ["public-base-rpc", BASE_RPC],
    ]) {
      const result = await reliableAccountProbe(endpoint, address, decoderName);
      matrix.push({
        endpoint:
          identity === "unauthenticated"
            ? "MagicBlock devnet PER"
            : "MagicBlock/Solana devnet base RPC",
        authenticatedIdentity: identity,
        account: resourceName,
        address: address.toBase58(),
        httpStatus: result.httpStatus,
        rpcError: result.rpcError,
        returned: result.returned,
        owner: result.owner,
        dataLength: result.dataLength,
        decoded: result.decoded,
        decodedReceipt:
          decoderName === "PaymentReceipt" && result.value
            ? receiptView(result.value)
            : null,
        attempts: result.attempts,
      });
    }
  }

  const expectedAllowed = new Set([
    "company:vault",
    "accountant:vault",
    "company:intentA",
    "approverOne:intentA",
    "approverTwo:intentA",
    "recipientA:receiptA",
    "accountant:receiptA",
    "company:receiptA",
    "recipientA:destinationA",
    "company:custody",
  ]);
  state.observations.accessControl = {
    matrix,
    permissions: null,
    positiveControlsPassed: false,
    unauthorizedControlsPassed: false,
    incompleteReason: "Validating matched positive and negative controls",
    recordedAt: new Date().toISOString(),
  };
  save();
  for (const row of matrix) {
    const key = `${row.authenticatedIdentity}:${row.account}`;
    if (expectedAllowed.has(key) && !row.returned) {
      throw new Error(`Authorized positive control failed for ${key}.`);
    }
    if (
      !expectedAllowed.has(key) &&
      row.endpoint === "MagicBlock devnet PER" &&
      row.returned
    ) {
      throw new Error(`Unauthorized private account was returned for ${key}.`);
    }
    if (
      row.authenticatedIdentity === "public-base-rpc" &&
      row.decodedReceipt &&
      (row.decodedReceipt.status === RECEIPT_PAID ||
        row.decodedReceipt.amountBaseUnits !== "0")
    ) {
      throw new Error("Base-layer receipt shell exposed private paid accounting data.");
    }
  }

  const companyPer = await authenticatedPer("company");
  const permissionAddresses = {
    vault: a.accounts.vaultPermission,
    custodyEata: a.accounts.custodyEataPermission,
    intentA: a.accounts.intentPermission,
    receiptA: a.accounts.receiptPermission,
    recipientEataA: derivePermission(a.accounts.destinationEata),
  };
  const permissions = {};
  for (const [name, address] of Object.entries(permissionAddresses)) {
    const info = await companyPer.getAccountInfo(address, "confirmed");
    if (!info || !info.owner.equals(PERMISSION_PROGRAM_ID)) {
      throw new Error(`Missing permission ${name}.`);
    }
    permissions[name] = decodePrivatePermission(info.data);
  }
  const exactMembers = {
    vault: [
      [PROGRAM_ID.toBase58(), 0],
      [identities.company.publicKey.toBase58(), 15],
      [identities.accountant.publicKey.toBase58(), 14],
    ],
    custodyEata: [
      [DELEGATION_PROGRAM_ID.toBase58(), 0],
      [identities.company.publicKey.toBase58(), 15],
      [a.accounts.vault.toBase58(), 1],
    ],
    intentA: [
      [PROGRAM_ID.toBase58(), 0],
      [identities.company.publicKey.toBase58(), 15],
      [identities.approverOne.publicKey.toBase58(), 15],
      [identities.approverTwo.publicKey.toBase58(), 15],
    ],
    receiptA: [
      [PROGRAM_ID.toBase58(), 0],
      [identities.company.publicKey.toBase58(), 15],
      [identities.accountant.publicKey.toBase58(), 14],
      [identities.recipientA.publicKey.toBase58(), 14],
    ],
    recipientEataA: [
      [DELEGATION_PROGRAM_ID.toBase58(), 0],
      [identities.company.publicKey.toBase58(), 15],
      [identities.recipientA.publicKey.toBase58(), 15],
      [a.accounts.vault.toBase58(), 1],
    ],
  };
  const permissionedResources = {
    vault: a.accounts.vault,
    custodyEata: a.accounts.sourceEata,
    intentA: a.accounts.intent,
    receiptA: a.accounts.receipt,
    recipientEataA: a.accounts.destinationEata,
  };
  for (const [name, expected] of Object.entries(exactMembers)) {
    const observed = permissions[name].members.map((member) => [member.pubkey, member.flags]);
    if (
      !permissions[name].isPrivate ||
      permissions[name].permissionedAccount !== permissionedResources[name].toBase58() ||
      JSON.stringify(observed) !== JSON.stringify(expected)
    ) {
      throw new Error(`Permission ${name} does not match the exact private member set.`);
    }
  }
  state.observations.accessControl = {
    matrix,
    permissions,
    positiveControlsPassed: true,
    unauthorizedControlsPassed: true,
    incompleteReason: null,
    recordedAt: new Date().toISOString(),
  };
  save();
}

async function reconcile() {
  for (const [label, record] of Object.entries(state.transactions)) {
    const rpc = record.endpoint === "per" ? await authenticatedPer("company") : base;
    const current = await statusFor(rpc, record.signature);
    if (!current) {
      record.outcome = (await rpc.getBlockHeight("confirmed")) > record.lastValidBlockHeight
        ? "expired-unseen"
        : "unknown";
    } else {
      record.slot = current.slot;
      record.confirmationStatus = current.confirmationStatus;
      record.error = current.err ?? null;
      record.outcome = current.err ? "failure" : "success";
    }
    record.reconciledAt = new Date().toISOString();
    console.log(`${label}: ${record.outcome}${record.confirmationStatus ? ` (${record.confirmationStatus})` : ""}`);
  }
  save();
}

async function inspect() {
  const check = await readOnlyCheck();
  const deployer = loadDeployer();
  const contexts = Object.fromEntries(
    ["A", "B"].map((label) => {
      const value = deriveContext(state, label);
      return [
        label,
        {
          recipient: value.recipient.publicKey.toBase58(),
          amountBaseUnits: value.amount.toString(),
          vault: value.accounts.vault.toBase58(),
          intent: value.accounts.intent.toBase58(),
          receipt: value.accounts.receipt.toBase58(),
        },
      ];
    }),
  );
  console.dir(
    {
      ...check,
      deployer: deployer.publicKey.toBase58(),
      identities: state.publicKeys,
      payments: contexts,
      recordedTransactions: Object.keys(state.transactions),
      secretsPrinted: false,
    },
    { depth: null },
  );
}

async function all() {
  await inspect();
  await fund();
  await setupPayment("A");
  await pay("A");
  await audit();
  await reconcile();
  const paidTotal = state.observations["payment.A.result"] ? MAX_PAYMENT : 0n;
  if (paidTotal > MAX_TOTAL_PAYMENT) {
    throw new Error("Total payment outflow exceeded the authorized cap.");
  }
}

try {
  if (command === "inspect") await inspect();
  if (command === "fund") await fund();
  if (command === "setup-a") await setupPayment("A");
  if (command === "pay-a") await pay("A");
  if (command === "submit-payment-once") await submitPaymentOnce();
  if (command === "audit") await audit();
  if (command === "probe-access") await probeAccess();
  if (command === "reconcile") await reconcile();
  if (command === "all") await all();
} catch (error) {
  console.error(cleanError(error));
  process.exitCode = 1;
}
