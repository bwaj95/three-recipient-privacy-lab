// Read-only and simulation-only diagnostics for the private receipt PER 403.
// This file intentionally contains no sendRawTransaction/sendTransaction call.

import fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

const BASE_RPC =
  process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com";
const PER_RPC = "https://devnet-tee.magicblock.app";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PROGRAM_ID = new PublicKey(
  "FnKajG15Hu4tTENtENAHCau4krTWJUyXUGgdVuLpbTzq",
);
const VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PERMISSION_PROGRAM_ID =
  mb.PERMISSION_PROGRAM_ID ||
  new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const EPHEMERAL_VAULT_ID = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);
const MAGIC_PROGRAM_ID =
  mb.MAGIC_PROGRAM_ID ||
  new PublicKey("Magic11111111111111111111111111111111111111");
const RECEIPT_SEED = Buffer.from("private_receipt");
const STATE_PATH = ".lab/private-receipt-usdc.json";
const WALLETS_PATH = ".lab/privacy-demo.json";
const IDL_PATH = "private-receipt/target/idl/private_counter.json";
const AMOUNT = 10_000n;

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function cleanError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/\S+/g, "[endpoint]")
    .replace(/token=[^\s&]+/gi, "token=[redacted]")
    .slice(0, 1000);
}

const walletState = readJson(WALLETS_PATH);
const state = readJson(STATE_PATH);
const idl = readJson(IDL_PATH);
const company = Keypair.fromSecretKey(
  Uint8Array.from(walletState.keys.company),
);
const carol = Keypair.fromSecretKey(Uint8Array.from(walletState.keys.Carol));
const accountant = Keypair.fromSecretKey(
  Uint8Array.from(walletState.keys.outsider),
);

if (
  company.publicKey.toBase58() !==
    "CE5CcmqDSU1mZtmpT6NiDv7fZDg2edUgerT44RA3F896" ||
  carol.publicKey.toBase58() !== "HqBr2UFAdaPhvtcS8NhvdbPLEJy75vaiQ48h1jFdu9mj"
) {
  throw new Error("Wallet public keys do not match the devnet fixture.");
}

const plan = state.plans.happy;
const receipt = PublicKey.findProgramAddressSync(
  [
    RECEIPT_SEED,
    company.publicKey.toBuffer(),
    Buffer.from(plan.receiptIdHex, "hex"),
  ],
  PROGRAM_ID,
)[0];
const permission =
  typeof mb.permissionPdaFromAccount === "function"
    ? mb.permissionPdaFromAccount(receipt)
    : PublicKey.findProgramAddressSync(
        [Buffer.from("permission:"), receipt.toBuffer()],
        PERMISSION_PROGRAM_ID,
      )[0];
const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, company.publicKey);
const destinationAta = getAssociatedTokenAddressSync(
  USDC_MINT,
  carol.publicKey,
);

const realFetch = globalThis.fetch;
async function timedFetch(url, options = {}) {
  return realFetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(25_000),
  });
}
globalThis.fetch = timedFetch;

function connection(endpoint) {
  return new Connection(endpoint, {
    commitment: "confirmed",
    fetch: timedFetch,
    disableRetryOnRateLimit: true,
  });
}

const base = connection(BASE_RPC);

async function authenticatedPer() {
  const auth = await mb.getAuthToken(
    PER_RPC,
    company.publicKey,
    async (message) => nacl.sign.detached(message, company.secretKey),
  );
  return connection(`${PER_RPC}?token=${encodeURIComponent(auth.token)}`);
}

function programFor(rpc) {
  const provider = new anchor.AnchorProvider(rpc, new anchor.Wallet(company), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new anchor.Program(idl, provider);
}

function flagNames(flags) {
  return [
    [1, "AUTHORITY"],
    [2, "TX_LOGS"],
    [4, "TX_BALANCES"],
    [8, "TX_MESSAGE"],
    [16, "ACCOUNT_SIGNATURES"],
  ]
    .filter(([bit]) => (flags & bit) !== 0)
    .map(([, name]) => name);
}

function decodeEphemeralPermission(data) {
  if (data.length < 35 || (data.length - 35) % 33 !== 0) {
    throw new Error(`Unexpected permission data length ${data.length}.`);
  }
  const members = [];
  for (let offset = 35; offset < data.length; offset += 33) {
    const flags = data[offset];
    members.push({
      pubkey: new PublicKey(data.subarray(offset + 1, offset + 33)).toBase58(),
      flags,
      flagNames: flagNames(flags),
    });
  }
  return {
    discriminator: data[0],
    bump: data[1],
    permissionedAccount: new PublicKey(data.subarray(2, 34)).toBase58(),
    isPrivate: data[34] === 1,
    members,
  };
}

function metaView(ix, labels = new Map()) {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((key, index) => ({
      index,
      label: labels.get(key.pubkey.toBase58()) || null,
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    dataLength: ix.data.length,
    dataHex: Buffer.from(ix.data).toString("hex"),
  };
}

async function simulate(rpc, label, instructions) {
  const tx = new Transaction().add(...instructions);
  const latest = await rpc.getLatestBlockhash("confirmed");
  tx.feePayer = company.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(company);
  try {
    const result = await rpc.simulateTransaction(tx, undefined, true);
    return {
      label,
      rpcAccepted: true,
      err: result.value.err,
      unitsConsumed: result.value.unitsConsumed ?? null,
      logs: result.value.logs?.slice(-12) ?? [],
    };
  } catch (error) {
    return {
      label,
      rpcAccepted: false,
      error: cleanError(error),
    };
  }
}

function invalidProgramIx(keys = []) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from("ffffffffffffffff", "hex"),
  });
}

async function main() {
  const per = await authenticatedPer();
  const [baseGenesis, perGenesis, perIdentity] = await Promise.all([
    base.getGenesisHash(),
    per.getGenesisHash(),
    per._rpcRequest("getIdentity", []),
  ]);
  const perIdentityKey = perIdentity.result?.identity;
  if (
    baseGenesis !== DEVNET_GENESIS ||
    perIdentityKey !== VALIDATOR.toBase58()
  ) {
    throw new Error(
      `Unexpected endpoint identity: base=${baseGenesis}, PER=${perIdentityKey}`,
    );
  }

  const permissionInfo = await per.getAccountInfo(permission, "confirmed");
  if (!permissionInfo) {
    throw new Error("Receipt EphemeralPermission was not returned to company.");
  }
  const decodedPermission = decodeEphemeralPermission(permissionInfo.data);
  if (decodedPermission.permissionedAccount !== receipt.toBase58()) {
    throw new Error("Permission account targets a different receipt.");
  }

  const old = state.transactions["happy: atomic USDC payment and receipt"];
  const [oldPerStatus, oldBaseStatus, perHeight, baseHeight] =
    await Promise.all([
      per.getSignatureStatuses([old.signature], {
        searchTransactionHistory: true,
      }),
      base.getSignatureStatuses([old.signature], {
        searchTransactionHistory: true,
      }),
      per.getBlockHeight("confirmed"),
      base.getBlockHeight("confirmed"),
    ]);

  const transferIxs = await mb.transferSpl(
    company.publicKey,
    carol.publicKey,
    USDC_MINT,
    AMOUNT,
    {
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "ephemeral",
      validator: VALIDATOR,
    },
  );
  if (transferIxs.length !== 1) {
    throw new Error(
      `Expected one transfer instruction; got ${transferIxs.length}.`,
    );
  }

  const program = programFor(per);
  const settleIx = await program.methods
    .settlePrivatePayment(
      carol.publicKey,
      new anchor.BN(plan.amount),
      new anchor.BN(plan.walletRevision),
      [...Buffer.from(plan.intentHashHex, "hex")],
    )
    .accountsPartial({
      authority: company.publicKey,
      receipt,
      sourceAta,
      destinationAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const configureNoopIx = await program.methods
    .configureAccess(accountant.publicKey, carol.publicKey)
    .accountsPartial({
      authority: company.publicKey,
      receipt,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();

  const recordIx = await program.methods
    .recordPrivatePayment(
      carol.publicKey,
      new anchor.BN(plan.amount),
      new anchor.BN(plan.walletRevision),
      [...Buffer.from(plan.intentHashHex, "hex")],
    )
    .accountsPartial({
      authority: company.publicKey,
      receipt,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();

  const labels = new Map([
    [company.publicKey.toBase58(), "company"],
    [carol.publicKey.toBase58(), "Carol"],
    [receipt.toBase58(), "receipt"],
    [permission.toBase58(), "receipt permission"],
    [sourceAta.toBase58(), "company ordinary ATA"],
    [destinationAta.toBase58(), "Carol ordinary ATA"],
    [TOKEN_PROGRAM_ID.toBase58(), "Token Program"],
  ]);

  console.dir(
    {
      safety: {
        baseGenesis,
        perGenesis,
        perIdentity: perIdentityKey,
        devnetVerified: true,
        transactionSubmissionCodePresent: false,
      },
      addresses: {
        receipt: receipt.toBase58(),
        permission: permission.toBase58(),
      },
      permissionAccount: {
        owner: permissionInfo.owner.toBase58(),
        dataLength: permissionInfo.data.length,
        ...decodedPermission,
      },
      unresolvedTransaction: {
        signature: old.signature,
        lastValidBlockHeight: old.lastValidBlockHeight,
        perStatus: oldPerStatus.value[0],
        baseStatus: oldBaseStatus.value[0],
        currentPerBlockHeight: perHeight,
        currentBaseBlockHeight: baseHeight,
        expiredOnBoth:
          perHeight > old.lastValidBlockHeight &&
          baseHeight > old.lastValidBlockHeight,
      },
      accountMetas: {
        supportedTransferSpl: metaView(transferIxs[0], labels),
        customSettlement: metaView(settleIx, labels),
        configureAccessNoop: metaView(configureNoopIx, labels),
        proposedReceiptOnlyUpdate: metaView(recordIx, labels),
      },
    },
    { depth: null },
  );

  const signerMeta = {
    pubkey: company.publicKey,
    isSigner: true,
    isWritable: true,
  };
  const receiptMeta = {
    pubkey: receipt,
    isSigner: false,
    isWritable: true,
  };
  const sourceMeta = {
    pubkey: sourceAta,
    isSigner: false,
    isWritable: true,
  };

  const cases = [
    ["custom program, no accounts", [invalidProgramIx()]],
    ["custom program, signer only", [invalidProgramIx([signerMeta])]],
    [
      "receipt-only writable custom invocation",
      [invalidProgramIx([signerMeta, receiptMeta])],
    ],
    [
      "receipt plus company ATA custom invocation",
      [invalidProgramIx([signerMeta, receiptMeta, sourceMeta])],
    ],
    ["supported top-level transfer", transferIxs],
    ["configure receipt no-op only", [configureNoopIx]],
    ["proposed receipt-only update", [recordIx]],
    [
      "supported transfer plus custom program no accounts",
      [...transferIxs, invalidProgramIx()],
    ],
    [
      "supported transfer plus receipt configure no-op",
      [...transferIxs, configureNoopIx],
    ],
    [
      "supported transfer plus proposed receipt-only update",
      [...transferIxs, recordIx],
    ],
    ["deployed custom settlement", [settleIx]],
  ];

  const results = [];
  for (const [label, instructions] of cases) {
    results.push(await simulate(per, label, instructions));
  }
  console.dir({ simulationOnly: true, results }, { depth: null });
}

main().catch((error) => {
  console.error(cleanError(error));
  process.exitCode = 1;
});
