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
  deriveContext,
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
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  RECEIPT_PAID,
  derivePermission,
} from "../src/model.mjs";

const REQUIRED_BASE_RPC = "https://rpc.magicblock.app/devnet";
const EXCLUDED_PROGRAM = new PublicKey(
  "FnKajG15Hu4tTENtENAHCau4krTWJUyXUGgdVuLpbTzq",
);
const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);
const MAX_PAYMENT = 10_000n;
const MAX_TOTAL_PAYMENT = 20_000n;
const MAX_USDC_FUNDING = 50_000n;
const MAX_SOL_FUNDING = 500_000_000;
const TARGET_LAMPORTS = {
  company: 250_000_000,
  approverOne: 5_000_000,
  approverTwo: 5_000_000,
  recipientA: 35_000_000,
  recipientB: 35_000_000,
};
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

if (BASE_RPC !== REQUIRED_BASE_RPC || PER_RPC !== "https://devnet-tee.magicblock.app") {
  throw new Error("Refusing endpoints outside the fixed MagicBlock devnet boundary.");
}

const command = process.argv[2] || "inspect";
if (![
  "inspect",
  "fund",
  "setup-a",
  "pay-a",
  "setup-b",
  "pay-b",
  "audit",
  "reconcile",
  "all",
].includes(command)) {
  throw new Error(
    "Usage: inspect | fund | setup-a | pay-a | setup-b | pay-b | audit | reconcile | all",
  );
}

const state = loadLocalState();
const identities = keypairsFromState(state);
const idl = readIdl();
const coder = new anchor.BorshCoder(idl);
const base = connection(REQUIRED_BASE_RPC);
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
    if (instruction.programId.equals(EXCLUDED_PROGRAM)) {
      throw new Error("Refusing any instruction to the excluded program.");
    }
    if (instruction.keys.some((meta) => meta.pubkey.equals(EXCLUDED_PROGRAM))) {
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
        Object.entries(identities).find(([, value]) => value === signer)?.[0] ||
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
      ...(watched.length
        ? {
            accounts: {
              encoding: "base64",
              addresses: watched.map((address) => address.toBase58()),
            },
          }
        : {}),
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
  return { observation, simulatedAccounts: result?.accounts ?? null };
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
      `Fund five isolated fee payers with ${fundingLamports} devnet lamports total`,
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
  if (!['A', 'B'].includes(label)) throw new Error("Unknown payment label.");
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

  const per = await authenticatedPer("company");
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
    await verifyDelegation(delegationAddress, name);
    await waitForAccount(per, address, name);
  }
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
    await simulate(
      `negative.${label}.${name}`,
      await authenticatedPer(
        Object.entries(identities).find(([, value]) => value === signer)[0],
      ),
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

async function pay(label) {
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

function decodePermission(data) {
  if (data.length < 35 || (data.length - 35) % 33 !== 0) {
    throw new Error(`Unexpected permission data length ${data.length}.`);
  }
  const members = [];
  for (let offset = 35; offset < data.length; offset += 33) {
    members.push({
      flags: data[offset],
      pubkey: new PublicKey(data.subarray(offset + 1, offset + 33)).toBase58(),
    });
  }
  return {
    permissionedAccount: new PublicKey(data.subarray(2, 34)).toBase58(),
    isPrivate: data[34] === 1,
    members,
  };
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

async function audit() {
  await verifyNetwork("per");
  for (const role of Object.keys(identities)) {
    await authenticatedPer(role);
  }
  const a = deriveContext(state, "A");
  const b = deriveContext(state, "B");
  const resources = {
    vault: [a.accounts.vault, "CompanyVault"],
    intentA: [a.accounts.intent, "PaymentIntent"],
    intentB: [b.accounts.intent, "PaymentIntent"],
    receiptA: [a.accounts.receipt, "PaymentReceipt"],
    receiptB: [b.accounts.receipt, "PaymentReceipt"],
    custody: [a.accounts.sourceTokenAccount, null],
    destinationA: [a.accounts.destinationTokenAccount, null],
    destinationB: [b.accounts.destinationTokenAccount, null],
  };
  const checks = [
    ["company", "vault"],
    ["accountant", "vault"],
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
    ["recipientA", "receiptB"],
    ["recipientB", "receiptB"],
    ["recipientB", "receiptA"],
    ["accountant", "receiptA"],
    ["accountant", "receiptB"],
    ["company", "receiptA"],
    ["company", "receiptB"],
    ["outsider", "receiptA"],
    ["outsider", "receiptB"],
    ["recipientA", "destinationA"],
    ["recipientA", "destinationB"],
    ["recipientB", "destinationB"],
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
  for (const resourceName of ["receiptA", "receiptB"]) {
    const [address, decoderName] = resources[resourceName];
    for (const [identity, endpoint] of [
      ["unauthenticated", PER_RPC],
      ["public-base-rpc", REQUIRED_BASE_RPC],
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
    "approverOne:intentA",
    "approverTwo:intentA",
    "recipientA:receiptA",
    "recipientB:receiptB",
    "accountant:receiptA",
    "accountant:receiptB",
    "company:receiptA",
    "company:receiptB",
    "recipientA:destinationA",
    "recipientB:destinationB",
    "company:custody",
  ]);
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
  }

  const companyPer = await authenticatedPer("company");
  const permissionAddresses = {
    vault: a.accounts.vaultPermission,
    custodyEata: a.accounts.custodyEataPermission,
    intentA: a.accounts.intentPermission,
    receiptA: a.accounts.receiptPermission,
    intentB: b.accounts.intentPermission,
    receiptB: b.accounts.receiptPermission,
    recipientEataA: derivePermission(a.accounts.destinationEata),
    recipientEataB: derivePermission(b.accounts.destinationEata),
  };
  const permissions = {};
  for (const [name, address] of Object.entries(permissionAddresses)) {
    const info = await companyPer.getAccountInfo(address, "confirmed");
    if (!info || !info.owner.equals(PERMISSION_PROGRAM_ID)) {
      throw new Error(`Missing permission ${name}.`);
    }
    permissions[name] = decodePermission(info.data);
  }
  const exactMembers = {
    vault: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.accountant.publicKey.toBase58(), 14],
    ],
    custodyEata: [[identities.company.publicKey.toBase58(), 15]],
    intentA: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.approverOne.publicKey.toBase58(), 15],
      [identities.approverTwo.publicKey.toBase58(), 15],
    ],
    receiptA: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.accountant.publicKey.toBase58(), 14],
      [identities.recipientA.publicKey.toBase58(), 14],
    ],
    intentB: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.approverOne.publicKey.toBase58(), 15],
      [identities.approverTwo.publicKey.toBase58(), 15],
    ],
    receiptB: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.accountant.publicKey.toBase58(), 14],
      [identities.recipientB.publicKey.toBase58(), 14],
    ],
    recipientEataA: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.recipientA.publicKey.toBase58(), 15],
    ],
    recipientEataB: [
      [identities.company.publicKey.toBase58(), 15],
      [identities.recipientB.publicKey.toBase58(), 15],
    ],
  };
  const permissionedResources = {
    vault: a.accounts.vault,
    custodyEata: a.accounts.sourceEata,
    intentA: a.accounts.intent,
    receiptA: a.accounts.receipt,
    intentB: b.accounts.intent,
    receiptB: b.accounts.receipt,
    recipientEataA: a.accounts.destinationEata,
    recipientEataB: b.accounts.destinationEata,
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
  await setupPayment("B");
  await pay("B");
  await audit();
  await reconcile();
  const paidTotal = ["A", "B"].reduce((total, label) => {
    return state.observations[`payment.${label}.result`] ? total + MAX_PAYMENT : total;
  }, 0n);
  if (paidTotal > MAX_TOTAL_PAYMENT) {
    throw new Error("Total payment outflow exceeded the authorized cap.");
  }
}

try {
  if (command === "inspect") await inspect();
  if (command === "fund") await fund();
  if (command === "setup-a") await setupPayment("A");
  if (command === "pay-a") await pay("A");
  if (command === "setup-b") await setupPayment("B");
  if (command === "pay-b") await pay("B");
  if (command === "audit") await audit();
  if (command === "reconcile") await reconcile();
  if (command === "all") await all();
} catch (error) {
  console.error(cleanError(error));
  process.exitCode = 1;
}
