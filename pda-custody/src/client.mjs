import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  DELEGATION_PROGRAM_ID,
  DEVNET_TEE_VALIDATOR,
  DEVNET_USDC_MINT,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  deriveEata,
  derivePaymentAccounts,
  paymentIntentHash,
  randomPaymentId,
} from "./model.mjs";

export const BASE_RPC =
  process.env.SOLANA_DEVNET_RPC || "https://rpc.magicblock.app/devnet";
export const PER_RPC = "https://devnet-tee.magicblock.app";
export const DEVNET_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const PAYMENT_AMOUNT = 10_000n;
export const WALLET_REVISION = 1n;

const EXPERIMENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REPOSITORY_ROOT = path.resolve(EXPERIMENT_ROOT, "..");
export const IDL_PATH = path.join(
  EXPERIMENT_ROOT,
  "target/idl/pda_custody_private_payment.json",
);
export const STATE_PATH = path.join(
  REPOSITORY_ROOT,
  ".lab/pda-custody-private-payment.json",
);

const IDENTITY_NAMES = [
  "company",
  "approverOne",
  "approverTwo",
  "recipient",
  "outsider",
];

function connection(endpoint) {
  return new Connection(endpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: async (url, options) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function readIdl() {
  if (!fs.existsSync(IDL_PATH)) {
    throw new Error("Missing generated IDL. Run `anchor build` first.");
  }
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  if ((idl.address || idl.metadata?.address) !== PROGRAM_ID.toBase58()) {
    throw new Error("Generated IDL does not match the isolated program ID.");
  }
  return idl;
}

function keypairsFromState(state) {
  const identities = {};
  for (const name of IDENTITY_NAMES) {
    const encoded = state.keys?.[name];
    if (!Array.isArray(encoded)) {
      throw new Error(`Isolated state lacks ${name}.`);
    }
    const keypair = Keypair.fromSecretKey(Uint8Array.from(encoded));
    if (state.publicKeys?.[name] !== keypair.publicKey.toBase58()) {
      throw new Error(`Public-key integrity check failed for ${name}.`);
    }
    identities[name] = keypair;
  }
  return identities;
}

export function loadLocalState({ required = true } = {}) {
  if (!fs.existsSync(STATE_PATH)) {
    if (!required) return null;
    throw new Error("Missing isolated PDA-custody state; run `init-local`.");
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (
    state.version !== 1 ||
    state.cluster !== "devnet" ||
    state.programId !== PROGRAM_ID.toBase58()
  ) {
    throw new Error("Unexpected isolated PDA-custody state header.");
  }
  keypairsFromState(state);
  return state;
}

function writeStateExclusively(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true, mode: 0o700 });
  const temporary = `${STATE_PATH}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, STATE_PATH);
  fs.chmodSync(STATE_PATH, 0o600);
}

export function initializeLocalState() {
  if (fs.existsSync(STATE_PATH)) {
    throw new Error("Refusing to overwrite existing isolated PDA-custody state.");
  }
  const identities = Object.fromEntries(
    IDENTITY_NAMES.map((name) => [name, Keypair.generate()]),
  );
  const paymentId = randomPaymentId();
  const state = {
    version: 1,
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    publicKeys: Object.fromEntries(
      IDENTITY_NAMES.map((name) => [
        name,
        identities[name].publicKey.toBase58(),
      ]),
    ),
    keys: Object.fromEntries(
      IDENTITY_NAMES.map((name) => [
        name,
        Array.from(identities[name].secretKey),
      ]),
    ),
    payment: {
      paymentIdHex: paymentId.toString("hex"),
      amountBaseUnits: PAYMENT_AMOUNT.toString(),
      walletRevision: WALLET_REVISION.toString(),
    },
    transactions: {},
    observations: {},
  };
  writeStateExclusively(state);
  return {
    statePath: path.relative(REPOSITORY_ROOT, STATE_PATH),
    programId: state.programId,
    publicKeys: state.publicKeys,
    secretsPrinted: false,
  };
}

export function deriveContext(state) {
  const identities = keypairsFromState(state);
  const paymentId = Buffer.from(state.payment.paymentIdHex, "hex");
  const amount = BigInt(state.payment.amountBaseUnits);
  const walletRevision = BigInt(state.payment.walletRevision);
  if (amount !== PAYMENT_AMOUNT || walletRevision !== WALLET_REVISION) {
    throw new Error("Isolated payment does not match the fixed experiment plan.");
  }
  const accounts = derivePaymentAccounts({
    company: identities.company.publicKey,
    recipient: identities.recipient.publicKey,
    paymentId,
  });
  const intentHash = paymentIntentHash({
    vault: accounts.vault,
    paymentId,
    recipient: identities.recipient.publicKey,
    sourceEata: accounts.sourceEata,
    destinationEata: accounts.destinationEata,
    sourceTokenAccount: accounts.sourceTokenAccount,
    destinationTokenAccount: accounts.destinationTokenAccount,
    amount,
    walletRevision,
  });
  return { identities, paymentId, amount, walletRevision, accounts, intentHash };
}

function providerFor(rpc, signer, idl = readIdl()) {
  const provider = new anchor.AnchorProvider(
    rpc,
    new anchor.Wallet(signer),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  return { provider, program: new anchor.Program(idl, provider) };
}

function delegationAccounts(prefix, delegated) {
  return {
    [`${prefix}Buffer`]: delegated.buffer,
    [`${prefix}Record`]: delegated.record,
    [`${prefix}Metadata`]: delegated.metadata,
  };
}

export async function buildInstructionPlan(state, rpc = connection(BASE_RPC)) {
  const context = deriveContext(state);
  const { identities, paymentId, amount, walletRevision, accounts, intentHash } =
    context;
  const { program } = providerFor(rpc, identities.company);
  const common = {
    ownerProgram: PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    validator: DEVNET_TEE_VALIDATOR,
    systemProgram: SystemProgram.programId,
  };
  const companyTokenAccount = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    identities.company.publicKey,
  );

  const initializeVault = await program.methods
    .initializeVault(
      identities.approverOne.publicKey,
      identities.approverTwo.publicKey,
      identities.recipient.publicKey,
      new anchor.BN(amount.toString()),
    )
    .accountsStrict({
      company: identities.company.publicKey,
      mint: DEVNET_USDC_MINT,
      vault: accounts.vault,
      companyTokenAccount,
      custodyTokenAccount: accounts.sourceTokenAccount,
      custodyEata: accounts.sourceEata,
      globalVault: accounts.globalVault,
      globalVaultEata: accounts.globalVaultEata,
      globalVaultTokenAccount: accounts.globalVaultTokenAccount,
      ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const configureCustodyEataAccess = await program.methods
    .configureCustodyEataAccess()
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      custodyEata: accounts.sourceEata,
      custodyEataPermission: accounts.custodyEataPermission,
      ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      permissionProgram: PERMISSION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const delegateGlobalVaultEata = await program.methods
    .delegateGlobalVaultEata()
    .accountsStrict({
      company: identities.company.publicKey,
      globalVault: accounts.globalVault,
      globalVaultEata: accounts.globalVaultEata,
      globalVaultEataBuffer: accounts.globalVaultEataDelegation.buffer,
      globalVaultEataRecord: accounts.globalVaultEataDelegation.record,
      globalVaultEataMetadata: accounts.globalVaultEataDelegation.metadata,
      ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      validator: DEVNET_TEE_VALIDATOR,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const delegateCustodyEata = await program.methods
    .delegateCustodyEata()
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      custodyEata: accounts.sourceEata,
      custodyEataBuffer: accounts.custodyEataDelegation.buffer,
      custodyEataRecord: accounts.custodyEataDelegation.record,
      custodyEataMetadata: accounts.custodyEataDelegation.metadata,
      ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      validator: DEVNET_TEE_VALIDATOR,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const viewFlags =
    mb.TX_LOGS_FLAG | mb.TX_BALANCES_FLAG | mb.TX_MESSAGE_FLAG;
  const authorityViewFlags = mb.AUTHORITY_FLAG | viewFlags;
  const recipientEataPermissionUpdate = mb.createUpdatePermissionInstruction(
    {
      authority: [identities.recipient.publicKey, true],
      permissionedAccount: [accounts.destinationEata, false],
    },
    {
      members: [
        { pubkey: identities.company.publicKey, flags: authorityViewFlags },
        { pubkey: identities.approverOne.publicKey, flags: viewFlags },
        { pubkey: identities.approverTwo.publicKey, flags: viewFlags },
        { pubkey: identities.recipient.publicKey, flags: authorityViewFlags },
      ],
    },
  );
  const recipientEataSetup = [
    mb.initEphemeralAtaIx(
      accounts.destinationEata,
      identities.recipient.publicKey,
      DEVNET_USDC_MINT,
      identities.company.publicKey,
    ),
    mb.createEataPermissionIx(
      accounts.destinationEata,
      identities.company.publicKey,
    ),
    recipientEataPermissionUpdate,
    mb.delegateEphemeralAtaIx(
      identities.company.publicKey,
      accounts.destinationEata,
      DEVNET_TEE_VALIDATOR,
    ),
  ];

  const initializePaymentShells = await program.methods
    .initializePaymentShells([...paymentId])
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
      receipt: accounts.receipt,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const delegateVault = await program.methods
    .delegateVault()
    .accountsStrict({
      company: identities.company.publicKey,
      bufferVault: accounts.vaultDelegation.buffer,
      delegationRecordVault: accounts.vaultDelegation.record,
      delegationMetadataVault: accounts.vaultDelegation.metadata,
      vault: accounts.vault,
      ...common,
    })
    .instruction();
  const delegateIntent = await program.methods
    .delegateIntent([...paymentId])
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      bufferIntent: accounts.intentDelegation.buffer,
      delegationRecordIntent: accounts.intentDelegation.record,
      delegationMetadataIntent: accounts.intentDelegation.metadata,
      intent: accounts.intent,
      ...common,
    })
    .instruction();
  const delegateReceipt = await program.methods
    .delegateReceipt([...paymentId])
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      bufferReceipt: accounts.receiptDelegation.buffer,
      delegationRecordReceipt: accounts.receiptDelegation.record,
      delegationMetadataReceipt: accounts.receiptDelegation.metadata,
      receipt: accounts.receipt,
      ...common,
    })
    .instruction();

  const configurePrivateAccess = await program.methods
    .configurePrivateAccess([...paymentId])
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
      receipt: accounts.receipt,
      vaultPermission: accounts.vaultPermission,
      intentPermission: accounts.intentPermission,
      receiptPermission: accounts.receiptPermission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  const configurePayment = await program.methods
    .configurePayment(
      [...paymentId],
      new anchor.BN(amount.toString()),
      new anchor.BN(walletRevision.toString()),
      [...intentHash],
    )
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
      receipt: accounts.receipt,
    })
    .instruction();
  const approveOne = await program.methods
    .approvePayment([...paymentId])
    .accountsStrict({
      approver: identities.approverOne.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
    })
    .instruction();
  const approveTwo = await program.methods
    .approvePayment([...paymentId])
    .accountsStrict({
      approver: identities.approverTwo.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
    })
    .instruction();
  const execute = await program.methods
    .executePrivatePayment(
      [...paymentId],
      identities.recipient.publicKey,
      new anchor.BN(amount.toString()),
      new anchor.BN(walletRevision.toString()),
      [...intentHash],
    )
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      intent: accounts.intent,
      receipt: accounts.receipt,
      mint: DEVNET_USDC_MINT,
      sourceTokenAccount: accounts.sourceTokenAccount,
      destinationTokenAccount: accounts.destinationTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return {
    context,
    groups: [
      { name: "base.initializeVault", signers: ["company"], instructions: [initializeVault] },
      { name: "base.configureCustodyEataAccess", signers: ["company"], instructions: [configureCustodyEataAccess] },
      { name: "base.delegateGlobalVaultEata", signers: ["company"], instructions: [delegateGlobalVaultEata] },
      { name: "base.delegateCustodyEata", signers: ["company"], instructions: [delegateCustodyEata] },
      { name: "base.setupRecipientEata", signers: ["company", "recipient"], instructions: recipientEataSetup },
      { name: "base.initializePaymentShells", signers: ["company"], instructions: [initializePaymentShells] },
      { name: "base.delegateVault", signers: ["company"], instructions: [delegateVault] },
      { name: "base.delegateIntent", signers: ["company"], instructions: [delegateIntent] },
      { name: "base.delegateReceipt", signers: ["company"], instructions: [delegateReceipt] },
      { name: "per.configurePrivateAccess", signers: ["company"], instructions: [configurePrivateAccess] },
      { name: "per.configurePayment", signers: ["company"], instructions: [configurePayment] },
      { name: "per.approveOne", signers: ["approverOne"], instructions: [approveOne] },
      { name: "per.approveTwo", signers: ["approverTwo"], instructions: [approveTwo] },
      { name: "per.executeSimulationOnly", signers: ["company"], instructions: [execute] },
    ],
  };
}

function publicDerivationSummary(state) {
  const { identities, accounts, paymentId, amount, walletRevision, intentHash } =
    deriveContext(state);
  return {
    programId: PROGRAM_ID.toBase58(),
    company: identities.company.publicKey.toBase58(),
    approverOne: identities.approverOne.publicKey.toBase58(),
    approverTwo: identities.approverTwo.publicKey.toBase58(),
    recipient: identities.recipient.publicKey.toBase58(),
    vault: accounts.vault.toBase58(),
    custodyEata: accounts.sourceEata.toBase58(),
    custodyPerTokenView: accounts.sourceTokenAccount.toBase58(),
    recipientEata: accounts.destinationEata.toBase58(),
    recipientPerTokenView: accounts.destinationTokenAccount.toBase58(),
    intent: accounts.intent.toBase58(),
    receipt: accounts.receipt.toBase58(),
    paymentIdHex: paymentId.toString("hex"),
    amountBaseUnits: amount.toString(),
    walletRevision: walletRevision.toString(),
    intentHashHex: intentHash.toString("hex"),
  };
}

export async function readOnlyCheck() {
  const base = connection(BASE_RPC);
  const identityController = new AbortController();
  const identityTimeout = setTimeout(() => identityController.abort(), 20_000);
  let identityResponse;
  try {
    identityResponse = await fetch(PER_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getIdentity",
      }),
      signal: identityController.signal,
    });
  } finally {
    clearTimeout(identityTimeout);
  }
  const identityBody = await identityResponse.json();
  if (!identityResponse.ok || identityBody.error) {
    throw new Error("MagicBlock getIdentity read failed.");
  }
  const genesis = await base.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error("Refusing a non-devnet Solana RPC.");
  }
  const [tokenSupply, programBalance] = await Promise.all([
    base.getTokenSupply(DEVNET_USDC_MINT, "confirmed"),
    base.getBalance(PROGRAM_ID, "confirmed"),
  ]);
  if (identityBody.result?.identity !== DEVNET_TEE_VALIDATOR.toBase58()) {
    throw new Error("Unexpected MagicBlock devnet TEE identity.");
  }
  if (tokenSupply.value.decimals !== 6) {
    throw new Error("Circle devnet USDC mint does not have six decimals.");
  }
  let programDeployed = false;
  if (programBalance > 0) {
    const programInfo = await base.getAccountInfo(PROGRAM_ID, "confirmed");
    programDeployed = Boolean(programInfo?.executable);
  }
  return {
    cluster: "devnet",
    genesis,
    teeValidator: identityBody.result.identity,
    mint: DEVNET_USDC_MINT.toBase58(),
    mintDecimals: tokenSupply.value.decimals,
    isolatedProgram: PROGRAM_ID.toBase58(),
    programDeployed,
    blockchainWrites: 0,
  };
}

function accountFingerprint(info) {
  if (!info) return null;
  return {
    owner: info.owner.toBase58(),
    lamports: info.lamports,
    executable: info.executable,
    dataSha256: createHash("sha256").update(info.data).digest("hex"),
  };
}

async function authenticatedPer(identity) {
  const auth = await mb.getAuthToken(
    PER_RPC,
    identity.publicKey,
    async (message) => nacl.sign.detached(message, identity.secretKey),
  );
  return connection(`${PER_RPC}?token=${encodeURIComponent(auth.token)}`);
}

export async function simulateExecuteOnly(state) {
  const baseCheck = await readOnlyCheck();
  if (!baseCheck.programDeployed) {
    throw new Error(
      "Isolated program is not deployed; PER execution simulation cannot run before deployment approval.",
    );
  }
  const { identities, accounts } = deriveContext(state);
  const per = await authenticatedPer(identities.company);
  const plan = await buildInstructionPlan(state, per);
  const executeGroup = plan.groups.find(
    (group) => group.name === "per.executeSimulationOnly",
  );
  const watched = [
    accounts.sourceTokenAccount,
    accounts.destinationTokenAccount,
    accounts.intent,
    accounts.receipt,
  ];
  const before = await per.getMultipleAccountsInfo(watched, "confirmed");
  if (before.some((info) => !info)) {
    throw new Error("PER payment accounts are not fully initialized.");
  }
  const latest = await per.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: identities.company.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: executeGroup.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([identities.company]);
  const simulation = await per.simulateTransaction(transaction, {
    sigVerify: true,
    commitment: "confirmed",
  });
  const after = await per.getMultipleAccountsInfo(watched, "confirmed");
  const beforeFingerprints = before.map(accountFingerprint);
  const afterFingerprints = after.map(accountFingerprint);
  const persistentStateUnchanged =
    JSON.stringify(beforeFingerprints) === JSON.stringify(afterFingerprints);
  if (!persistentStateUnchanged) {
    throw new Error("Simulation changed persistent PER state.");
  }
  return {
    transactionSubmitted: false,
    simulationError: simulation.value.err,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    persistentStateUnchanged,
    recentLogs: simulation.value.logs?.slice(-40) ?? [],
  };
}

export async function runCommand(command) {
  if (command === "init-local") return initializeLocalState();
  if (command === "check") return readOnlyCheck();
  const state = loadLocalState();
  if (command === "derive") return publicDerivationSummary(state);
  if (command === "plan") {
    const plan = await buildInstructionPlan(state);
    return {
      ...publicDerivationSummary(state),
      groups: plan.groups.map((group) => ({
        name: group.name,
        signers: group.signers,
        instructions: group.instructions.length,
        accountMetas: group.instructions.reduce(
          (sum, instruction) => sum + instruction.keys.length,
          0,
        ),
      })),
      transactionsSubmitted: 0,
    };
  }
  if (command === "simulate-execute") return simulateExecuteOnly(state);
  throw new Error(
    "Usage: init-local | check | derive | plan | simulate-execute",
  );
}

export function cleanError(error) {
  return String(error?.message || error)
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/g, "[endpoint]")
    .slice(0, 800);
}
