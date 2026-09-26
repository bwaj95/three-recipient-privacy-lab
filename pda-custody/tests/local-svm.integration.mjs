import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as anchor from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { buildInstructionPlan, deriveContext, IDL_PATH } from "../src/client.mjs";
import {
  DEVNET_USDC_MINT,
  INTENT_APPROVED,
  INTENT_EXECUTED,
  PROGRAM_ID,
  RECEIPT_INITIALIZED,
  RECEIPT_PAID,
} from "../src/model.mjs";

const RPC_PORT = 18999;
const FAUCET_PORT = 19002;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const TEST_PROGRAM_SO = path.resolve(
  path.dirname(IDL_PATH),
  "../deploy/pda_custody_private_payment.test-failure-injection.so",
);
const TEST_IDL_PATH = path.resolve(
  path.dirname(IDL_PATH),
  "pda_custody_private_payment.test-failure-injection.json",
);
const names = [
  "company",
  "approverOne",
  "approverTwo",
  "recipient",
  "outsider",
];

function fixture(sourceBalance, fill) {
  const identities = Object.fromEntries(
    names.map((name) => [name, Keypair.generate()]),
  );
  return {
    version: 1,
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    publicKeys: Object.fromEntries(
      names.map((name) => [name, identities[name].publicKey.toBase58()]),
    ),
    keys: Object.fromEntries(
      names.map((name) => [name, Array.from(identities[name].secretKey)]),
    ),
    payment: {
      paymentIdHex: Buffer.alloc(32, fill).toString("hex"),
      amountBaseUnits: "10000",
      walletRevision: "1",
    },
    sourceBalance,
  };
}

function accountDump(pubkey, owner, data, lamports = 10_000_000) {
  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports,
      data: [data.toString("base64"), "base64"],
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
}

function writeDump(directory, dump) {
  fs.writeFileSync(
    path.join(directory, `${dump.pubkey}.json`),
    `${JSON.stringify(dump)}\n`,
    { mode: 0o600 },
  );
}

function tokenAccountData(mint, owner, amount) {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return data;
}

async function addFixtureAccounts(directory, coder, state) {
  const context = deriveContext(state);
  const { identities, accounts, paymentId, intentHash, amount, walletRevision } =
    context;
  const vaultEncoded = await coder.accounts.encode("CompanyVault", {
    company: identities.company.publicKey,
    approver_one: identities.approverOne.publicKey,
    approver_two: identities.approverTwo.publicKey,
    recipient: identities.recipient.publicKey,
    mint: DEVNET_USDC_MINT,
    custody_eata: accounts.sourceEata,
    custody_token_account: accounts.sourceTokenAccount,
    recipient_wallet_revision: new anchor.BN(walletRevision.toString()),
    approval_threshold: 2,
    custody_access_configured: true,
    access_configured: true,
    bump: accounts.vaultBump,
  });
  const intentEncoded = await coder.accounts.encode("PaymentIntent", {
    vault: accounts.vault,
    payment_id: [...paymentId],
    mint: DEVNET_USDC_MINT,
    recipient: identities.recipient.publicKey,
    source_eata: accounts.sourceEata,
    destination_eata: accounts.destinationEata,
    source_token_account: accounts.sourceTokenAccount,
    destination_token_account: accounts.destinationTokenAccount,
    amount: new anchor.BN(amount.toString()),
    wallet_revision: new anchor.BN(walletRevision.toString()),
    intent_hash: [...intentHash],
    approval_mask: 3,
    approval_count: 2,
    status: INTENT_APPROVED,
    executed: false,
    executed_at: new anchor.BN(0),
    access_configured: true,
    bump: accounts.intentBump,
  });
  const receiptEncoded = await coder.accounts.encode("PaymentReceipt", {
    vault: accounts.vault,
    payment_id: [...paymentId],
    company: PublicKey.default,
    accountant: PublicKey.default,
    recipient: PublicKey.default,
    source_eata: PublicKey.default,
    destination_eata: PublicKey.default,
    mint: PublicKey.default,
    amount: new anchor.BN(0),
    wallet_revision: new anchor.BN(0),
    intent_hash: [...Buffer.alloc(32)],
    paid_at: new anchor.BN(0),
    status: RECEIPT_INITIALIZED,
    access_configured: true,
    bump: accounts.receiptBump,
  });
  const paddedIntent = Buffer.alloc(327);
  intentEncoded.copy(paddedIntent);

  writeDump(
    directory,
    accountDump(
      identities.company.publicKey,
      SystemProgram.programId,
      Buffer.alloc(0),
      10_000_000_000,
    ),
  );
  writeDump(directory, accountDump(accounts.vault, PROGRAM_ID, vaultEncoded));
  writeDump(directory, accountDump(accounts.intent, PROGRAM_ID, paddedIntent));
  writeDump(directory, accountDump(accounts.receipt, PROGRAM_ID, receiptEncoded));
  writeDump(
    directory,
    accountDump(
      accounts.sourceTokenAccount,
      TOKEN_PROGRAM_ID,
      tokenAccountData(DEVNET_USDC_MINT, accounts.vault, state.sourceBalance),
    ),
  );
  writeDump(
    directory,
    accountDump(
      accounts.destinationTokenAccount,
      TOKEN_PROGRAM_ID,
      tokenAccountData(
        DEVNET_USDC_MINT,
        identities.recipient.publicKey,
        2_000_000n,
      ),
    ),
  );
  return context;
}

async function waitForValidator(connection, process, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`local validator exited early: ${output().slice(-1000)}`);
    }
    try {
      await connection.getVersion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`local validator did not start: ${output().slice(-1000)}`);
}

async function waitForSignature(connection, signature) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await connection.getSignatureStatuses([signature]);
    const status = response.value[0];
    if (status?.err) {
      throw new Error(`local airdrop failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`local airdrop did not confirm: ${signature}`);
}

async function simulateFixture(connection, coder, state) {
  const plan = await buildInstructionPlan(state, connection);
  const execute = plan.groups.find(
    (group) => group.name === "per.executeSimulationOnly",
  );
  const { identities, accounts } = plan.context;
  const watched = [
    accounts.sourceTokenAccount,
    accounts.destinationTokenAccount,
    accounts.intent,
    accounts.receipt,
  ];
  const persistentBefore = await connection.getMultipleAccountsInfo(watched);
  assert.ok(persistentBefore.every(Boolean));
  const vaultInfo = await connection.getAccountInfo(accounts.vault);
  assert.ok(vaultInfo);
  const decodedVault = coder.accounts.decode("CompanyVault", vaultInfo.data);
  const decodedIntent = coder.accounts.decode("PaymentIntent", persistentBefore[2].data);
  assert.equal(
    decodedVault.custody_eata.toBase58(),
    accounts.sourceEata.toBase58(),
  );
  assert.equal(
    decodedIntent.source_eata.toBase58(),
    accounts.sourceEata.toBase58(),
  );
  const latest = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: identities.company.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: execute.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([identities.company]);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: true,
    commitment: "confirmed",
    innerInstructions: true,
    accounts: {
      encoding: "base64",
      addresses: watched.map((address) => address.toBase58()),
    },
  });
  const persistentAfter = await connection.getMultipleAccountsInfo(watched);
  assert.deepEqual(
    persistentAfter.map((info) => info.data),
    persistentBefore.map((info) => info.data),
  );
  const hasSimulatedAccounts = simulation.value.accounts?.every(Boolean) ?? false;
  if (simulation.value.err === null && !hasSimulatedAccounts) {
    throw new Error(
      `simulation did not return watched accounts: ${JSON.stringify({
        err: simulation.value.err,
        logs: simulation.value.logs?.slice(-20),
        accountPresence: simulation.value.accounts?.map(Boolean),
      })}`,
    );
  }
  const post = hasSimulatedAccounts
    ? simulation.value.accounts.map((account) =>
        Buffer.from(account.data[0], "base64"),
      )
    : persistentAfter.map((account) => account.data);
  return {
    simulation,
    hasSimulatedAccounts,
    postSource: AccountLayout.decode(post[0]),
    postDestination: AccountLayout.decode(post[1]),
    postIntent: coder.accounts.decode("PaymentIntent", post[2]),
    postReceipt: coder.accounts.decode("PaymentReceipt", post[3]),
  };
}

async function simulatePostCpiFailure(connection, coder, testIdl, state) {
  const { identities, accounts, paymentId, amount } = deriveContext(state);
  const watched = [
    accounts.sourceTokenAccount,
    accounts.destinationTokenAccount,
    accounts.receipt,
  ];
  const persistentBefore = await connection.getMultipleAccountsInfo(watched);
  assert.ok(persistentBefore.every(Boolean));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(identities.company),
    { commitment: "confirmed" },
  );
  const program = new anchor.Program(testIdl, provider);
  const instruction = await program.methods
    .testFailAfterCpi([...paymentId], new anchor.BN(amount.toString()))
    .accountsStrict({
      company: identities.company.publicKey,
      vault: accounts.vault,
      receipt: accounts.receipt,
      sourceTokenAccount: accounts.sourceTokenAccount,
      destinationTokenAccount: accounts.destinationTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const latest = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: identities.company.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [instruction],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([identities.company]);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: true,
    commitment: "confirmed",
    innerInstructions: true,
    accounts: {
      encoding: "base64",
      addresses: watched.map((address) => address.toBase58()),
    },
  });
  const persistentAfter = await connection.getMultipleAccountsInfo(watched);
  assert.deepEqual(
    persistentAfter.map((info) => info.data),
    persistentBefore.map((info) => info.data),
  );
  assert.notEqual(simulation.value.err, null);
  assert.ok(
    simulation.value.logs?.some(
      (line) =>
        line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke`) &&
        line.includes("[2]"),
    ),
  );
  return {
    simulation,
    source: AccountLayout.decode(persistentAfter[0].data),
    destination: AccountLayout.decode(persistentAfter[1].data),
    receipt: coder.accounts.decode("PaymentReceipt", persistentAfter[2].data),
  };
}

const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "pda-custody-local-svm-"),
);
const ledger = path.join(temporary, "ledger");
const accountsDirectory = path.join(temporary, "accounts");
fs.mkdirSync(accountsDirectory, { mode: 0o700 });
let validator;

try {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const testIdl = JSON.parse(fs.readFileSync(TEST_IDL_PATH, "utf8"));
  const coder = new anchor.BorshCoder(idl);
  const success = fixture(1_000_000n, 71);
  const insufficient = fixture(5_000n, 72);
  await addFixtureAccounts(accountsDirectory, coder, success);
  await addFixtureAccounts(accountsDirectory, coder, insufficient);

  const mint = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 5_005_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mint,
  );
  writeDump(accountsDirectory, accountDump(DEVNET_USDC_MINT, TOKEN_PROGRAM_ID, mint));

  let validatorOutput = "";
  validator = spawn(
    "solana-test-validator",
    [
      "--ledger",
      ledger,
      "--rpc-port",
      String(RPC_PORT),
      "--faucet-port",
      String(FAUCET_PORT),
      "--bpf-program",
      PROGRAM_ID.toBase58(),
      TEST_PROGRAM_SO,
      "--account-dir",
      accountsDirectory,
      "--quiet",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [validator.stdout, validator.stderr]) {
    stream.on("data", (chunk) => {
      validatorOutput = `${validatorOutput}${chunk}`.slice(-10_000);
    });
  }

  const connection = new Connection(RPC, "confirmed");
  await waitForValidator(connection, validator, () => validatorOutput);
  for (const state of [success, insufficient]) {
    const { identities } = deriveContext(state);
    const signature = await connection.requestAirdrop(
      identities.company.publicKey,
      1_000_000_000,
    );
    await waitForSignature(connection, signature);
  }

  const successful = await simulateFixture(connection, coder, success);
  assert.equal(successful.simulation.value.err, null);
  assert.equal(successful.postSource.amount, 990_000n);
  assert.equal(successful.postDestination.amount, 2_010_000n);
  assert.equal(successful.postIntent.status, INTENT_EXECUTED);
  assert.equal(successful.postIntent.executed, true);
  assert.equal(successful.postReceipt.status, RECEIPT_PAID);
  assert.equal(successful.postReceipt.amount.toString(), "10000");
  assert.ok(
    successful.simulation.value.logs?.some(
      (line) =>
        line.includes(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke`) &&
        line.includes("[2]"),
    ),
  );

  const failed = await simulateFixture(connection, coder, insufficient);
  assert.notEqual(failed.simulation.value.err, null);
  assert.equal(failed.postSource.amount, 5_000n);
  assert.equal(failed.postDestination.amount, 2_000_000n);
  assert.equal(failed.postIntent.status, INTENT_APPROVED);
  assert.equal(failed.postIntent.executed, false);
  assert.equal(failed.postReceipt.status, RECEIPT_INITIALIZED);

  const postCpiFailure = await simulatePostCpiFailure(
    connection,
    coder,
    testIdl,
    success,
  );
  assert.equal(postCpiFailure.source.amount, 1_000_000n);
  assert.equal(postCpiFailure.destination.amount, 2_000_000n);
  assert.equal(postCpiFailure.receipt.status, RECEIPT_INITIALIZED);

  console.log(
    JSON.stringify(
      {
        localSimulationOnly: true,
        success: {
          err: successful.simulation.value.err,
          sourceAfter: successful.postSource.amount.toString(),
          destinationAfter: successful.postDestination.amount.toString(),
          intentStatusAfter: successful.postIntent.status,
          receiptStatusAfter: successful.postReceipt.status,
          tokenCpiObserved: true,
        },
        failedTokenCpi: {
          err: failed.simulation.value.err,
          sourceAfter: failed.postSource.amount.toString(),
          destinationAfter: failed.postDestination.amount.toString(),
          intentStatusAfter: failed.postIntent.status,
          receiptStatusAfter: failed.postReceipt.status,
        },
        failedAfterTokenCpi: {
          err: postCpiFailure.simulation.value.err,
          tokenCpiObservedBeforeFailure: true,
          sourcePersistentAfter: postCpiFailure.source.amount.toString(),
          destinationPersistentAfter: postCpiFailure.destination.amount.toString(),
          receiptStatusPersistentAfter: postCpiFailure.receipt.status,
        },
        persistentStateUnchanged: true,
        transactionsSubmitted: 0,
      },
      null,
      2,
    ),
  );
} finally {
  if (validator && validator.exitCode === null) {
    validator.kill("SIGINT");
    await new Promise((resolve) => {
      validator.once("exit", resolve);
      setTimeout(resolve, 2_000);
    });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
