// Resumes only missing BPF Upgradeable Loader buffer chunks on Solana devnet.
// This script cannot upgrade a program and contains no payment instructions.

import fs from "node:fs";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const RPC = "https://api.devnet.solana.com";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXPECTED_AUTHORITY = new PublicKey(
  "4k5kaSZ796EWM8hNfXuhcdVbZ2MNWonTbRmsshWDBX7b",
);
const BUFFER = new PublicKey("9Nb5P7ztMn8VVXfEVGtEiggFJ6uwYt9wgUSVH2DMKB4G");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const BINARY_PATH = "target/deploy/private_counter.so";
const KEYPAIR_PATH = "/home/bwaj/.config/solana/id.json";
const EXPECTED_SHA256 =
  "f677047d8f0cba5572bff51b34934ccf546d44f98f400258c32ee090bc7543d0";
const BUFFER_HEADER_LENGTH = 37;
const CHUNK_SIZE = 1012;

const connection = new Connection(RPC, {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
});
const binary = fs.readFileSync(BINARY_PATH);
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function cleanError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/\S+/g, "[endpoint]")
    .slice(0, 600);
}

function loaderWriteInstruction(offset, bytes) {
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0); // UpgradeableLoaderInstruction::Write
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  bytes.copy(data, 16);

  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: BUFFER, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function bufferBytes() {
  const info = await connection.getAccountInfo(BUFFER, "confirmed");
  if (!info || !info.owner.equals(LOADER)) {
    throw new Error(
      "Expected upgradeable-loader buffer account was not found.",
    );
  }
  if (info.data.length !== BUFFER_HEADER_LENGTH + binary.length) {
    throw new Error(
      `Unexpected buffer account length ${info.data.length}; expected ${BUFFER_HEADER_LENGTH + binary.length}.`,
    );
  }
  return info.data.subarray(BUFFER_HEADER_LENGTH);
}

function mismatchedOffsets(current) {
  const offsets = [];
  for (let offset = 0; offset < binary.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, binary.length);
    if (!current.subarray(offset, end).equals(binary.subarray(offset, end))) {
      offsets.push(offset);
    }
  }
  return offsets;
}

async function reconciledStatus(signature) {
  const result = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  return result.value[0];
}

async function writeChunk(offset, bytes) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const genesis = await connection.getGenesisHash();
    if (genesis !== DEVNET_GENESIS) {
      throw new Error(`Refusing write on genesis ${genesis}.`);
    }

    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(loaderWriteInstruction(offset, bytes));
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(authority);
    const signature = bs58.encode(tx.signature);

    try {
      await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
    } catch (error) {
      const status = await reconciledStatus(signature);
      if (status?.err) {
        throw new Error(
          `Chunk ${offset} failed as ${signature}: ${JSON.stringify(status.err)}`,
        );
      }
      if (status && !status.err) {
        return signature;
      }
      if (attempt === 6) {
        throw new Error(
          `Chunk ${offset} submission unresolved after reconciliation: ${cleanError(error)}`,
        );
      }
      continue;
    }

    for (let poll = 0; poll < 25; poll++) {
      const status = await reconciledStatus(signature);
      if (status?.err) {
        throw new Error(
          `Chunk ${offset} failed as ${signature}: ${JSON.stringify(status.err)}`,
        );
      }
      if (status && !status.err) {
        return signature;
      }
      if (
        (await connection.getBlockHeight("confirmed")) >
        latest.lastValidBlockHeight
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error(`Chunk ${offset} exhausted retry attempts.`);
}

async function main() {
  if (!authority.publicKey.equals(EXPECTED_AUTHORITY)) {
    throw new Error("Configured signer is not the expected upgrade authority.");
  }
  if (sha256(binary) !== EXPECTED_SHA256) {
    throw new Error("Local program binary hash changed.");
  }
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) {
    throw new Error("RPC is not Solana devnet.");
  }

  const before = await bufferBytes();
  const missing = mismatchedOffsets(before);
  console.log({
    mode: process.env.WRITE_BUFFER === "1" ? "write" : "dry-run",
    buffer: BUFFER.toBase58(),
    binarySha256: EXPECTED_SHA256,
    totalChunks: Math.ceil(binary.length / CHUNK_SIZE),
    mismatchedChunks: missing.length,
  });

  if (process.env.WRITE_BUFFER !== "1") {
    return;
  }

  for (let index = 0; index < missing.length; index++) {
    const offset = missing[index];
    const bytes = binary.subarray(
      offset,
      Math.min(offset + CHUNK_SIZE, binary.length),
    );
    const signature = await writeChunk(offset, bytes);
    if ((index + 1) % 10 === 0 || index + 1 === missing.length) {
      console.log({
        written: index + 1,
        total: missing.length,
        lastOffset: offset,
        lastSignature: signature,
      });
    }
  }

  const after = await bufferBytes();
  const remaining = mismatchedOffsets(after);
  console.log({
    remainingMismatchedChunks: remaining.length,
    bufferSha256: sha256(after),
    matchesExpected:
      remaining.length === 0 && sha256(after) === EXPECTED_SHA256,
  });
  if (remaining.length !== 0 || sha256(after) !== EXPECTED_SHA256) {
    throw new Error("Buffer verification failed after resumable upload.");
  }
}

main().catch((error) => {
  console.error(cleanError(error));
  process.exitCode = 1;
});
