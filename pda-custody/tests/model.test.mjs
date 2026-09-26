import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";
import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";

import {
  DEVNET_USDC_MINT,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  INTENT_APPROVED,
  INTENT_EXECUTED,
  INTENT_PENDING,
  PROGRAM_ID,
  RECEIPT_INITIALIZED,
  RECEIPT_PAID,
  derivePaymentAccounts,
  directTokenTransfer,
  executeAtomic,
  paymentIntentHash,
  randomPaymentId,
  recordApproval,
} from "../src/model.mjs";

const key = () => Keypair.generate().publicKey;

function fixture() {
  const company = key();
  const accountant = key();
  const approverOne = key();
  const approverTwo = key();
  const recipient = key();
  const paymentId = Buffer.alloc(32, 42);
  const accounts = derivePaymentAccounts({ company, recipient, paymentId });
  const amount = 10_000n;
  const walletRevision = 1n;
  const intentHash = paymentIntentHash({
    vault: accounts.vault,
    paymentId,
    recipient,
    sourceEata: accounts.sourceEata,
    destinationEata: accounts.destinationEata,
    sourceTokenAccount: accounts.sourceTokenAccount,
    destinationTokenAccount: accounts.destinationTokenAccount,
    amount,
    walletRevision,
  });
  const paymentIdHex = paymentId.toString("hex");
  const intentHashHex = intentHash.toString("hex");
  const state = {
    vault: {
      address: accounts.vault.toBase58(),
      company: company.toBase58(),
      accountant: accountant.toBase58(),
      approverOne: approverOne.toBase58(),
      approverTwo: approverTwo.toBase58(),
      recipient: recipient.toBase58(),
      mint: DEVNET_USDC_MINT.toBase58(),
      custodyEata: accounts.sourceEata.toBase58(),
      custodyTokenAccount: accounts.sourceTokenAccount.toBase58(),
      recipientWalletRevision: walletRevision,
      custodyAccessConfigured: true,
      accessConfigured: true,
    },
    intent: {
      address: accounts.intent.toBase58(),
      paymentId: paymentIdHex,
      approverOne: approverOne.toBase58(),
      approverTwo: approverTwo.toBase58(),
      recipient: recipient.toBase58(),
      sourceEata: accounts.sourceEata.toBase58(),
      destinationEata: accounts.destinationEata.toBase58(),
      sourceTokenAccount: accounts.sourceTokenAccount.toBase58(),
      destinationTokenAccount: accounts.destinationTokenAccount.toBase58(),
      amount,
      walletRevision,
      intentHash: intentHashHex,
      approvalMask: 3,
      approvalCount: 2,
      status: INTENT_APPROVED,
      executed: false,
      executedAt: 0n,
      accessConfigured: true,
    },
    receipt: {
      address: accounts.receipt.toBase58(),
      paymentId: paymentIdHex,
      status: RECEIPT_INITIALIZED,
      accessConfigured: true,
    },
    tokens: {
      source: {
        address: accounts.sourceTokenAccount.toBase58(),
        owner: accounts.vault.toBase58(),
        mint: DEVNET_USDC_MINT.toBase58(),
        balance: 1_000_000n,
      },
      destination: {
        address: accounts.destinationTokenAccount.toBase58(),
        owner: recipient.toBase58(),
        mint: DEVNET_USDC_MINT.toBase58(),
        balance: 2_000_000n,
      },
    },
  };
  const args = {
    vault: accounts.vault.toBase58(),
    mint: DEVNET_USDC_MINT.toBase58(),
    recipient: recipient.toBase58(),
    expectedSourceEata: accounts.sourceEata.toBase58(),
    expectedDestinationEata: accounts.destinationEata.toBase58(),
    sourceTokenAccount: accounts.sourceTokenAccount.toBase58(),
    destinationTokenAccount: accounts.destinationTokenAccount.toBase58(),
    paymentId: paymentIdHex,
    amount,
    walletRevision,
    intentHash: intentHashHex,
    computedIntentHash: intentHashHex,
  };
  return {
    state,
    args,
    accounts,
    company,
    accountant,
    approverOne,
    approverTwo,
    recipient,
  };
}

function rejects(code, callback) {
  assert.throws(callback, (error) => error?.code === code);
}

test("pinned IDs and derivations use the isolated program and direct eSPL PDA", () => {
  const { accounts } = fixture();
  assert.equal(PROGRAM_ID.toBase58(), "AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo");
  assert.equal(
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID.toBase58(),
    "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
  );
  assert.notEqual(accounts.sourceEata.toBase58(), accounts.sourceTokenAccount.toBase58());
  assert.equal(
    accounts.custodyEataPermission.toBase58(),
    mb.permissionPdaFromAccount(accounts.sourceEata).toBase58(),
  );
  assert.equal(
    accounts.custodyEataDelegation.buffer.toBase58(),
    mb
      .delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        accounts.sourceEata,
        EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      )
      .toBase58(),
  );
  assert.equal(
    accounts.intentDelegation.record.toBase58(),
    mb.delegationRecordPdaFromDelegatedAccount(accounts.intent).toBase58(),
  );
  assert.equal(
    accounts.receiptDelegation.metadata.toBase58(),
    mb.delegationMetadataPdaFromDelegatedAccount(accounts.receipt).toBase58(),
  );
});

test("a valid payment atomically transfers and writes EXECUTED/PAID", () => {
  const { state, args } = fixture();
  const result = executeAtomic(state, args);
  assert.equal(result.tokens.source.balance, 990_000n);
  assert.equal(result.tokens.destination.balance, 2_010_000n);
  assert.equal(result.intent.status, INTENT_EXECUTED);
  assert.equal(result.intent.executed, true);
  assert.equal(result.receipt.status, RECEIPT_PAID);
  assert.equal(result.receipt.amount, 10_000n);
  assert.equal(result.receipt.accountant, state.vault.accountant);
  assert.equal(result.receipt.intentHash, args.intentHash);
  assert.equal(state.tokens.source.balance, 1_000_000n);
  assert.equal(state.intent.status, INTENT_APPROVED);
  assert.equal(state.receipt.status, RECEIPT_INITIALIZED);
});

test("one approval fails", () => {
  const { state, args } = fixture();
  state.intent.approvalMask = 1;
  state.intent.approvalCount = 1;
  state.intent.status = INTENT_PENDING;
  rejects("IntentNotApproved", () => executeAtomic(state, args));
});

test("duplicate approver fails", () => {
  const { state, approverOne } = fixture();
  state.intent.approvalMask = 1;
  state.intent.approvalCount = 1;
  state.intent.status = INTENT_PENDING;
  rejects("DuplicateApprover", () =>
    recordApproval(state.intent, approverOne.toBase58()),
  );
});

test("unknown approver fails", () => {
  const { state } = fixture();
  state.intent.approvalMask = 0;
  state.intent.approvalCount = 0;
  state.intent.status = INTENT_PENDING;
  rejects("UnknownApprover", () =>
    recordApproval(state.intent, key().toBase58()),
  );
});

test("independent accountant and recipient cannot approve", () => {
  const { state, accountant, recipient } = fixture();
  state.intent.approvalMask = 0;
  state.intent.approvalCount = 0;
  state.intent.status = INTENT_PENDING;
  assert.notEqual(state.vault.accountant, state.intent.approverOne);
  assert.notEqual(state.vault.accountant, state.intent.approverTwo);
  rejects("UnknownApprover", () =>
    recordApproval(state.intent, accountant.toBase58()),
  );
  rejects("UnknownApprover", () =>
    recordApproval(state.intent, recipient.toBase58()),
  );
});

test("two independent approvers are required", () => {
  const { state, approverOne, approverTwo } = fixture();
  state.intent.approvalMask = 0;
  state.intent.approvalCount = 0;
  state.intent.status = INTENT_PENDING;
  recordApproval(state.intent, approverOne.toBase58());
  assert.equal(state.intent.status, INTENT_PENDING);
  recordApproval(state.intent, approverTwo.toBase58());
  assert.equal(state.intent.status, INTENT_APPROVED);
  assert.equal(state.intent.approvalMask, 3);
});

test("wrong recipient fails", () => {
  const { state, args } = fixture();
  args.recipient = key().toBase58();
  rejects("WrongRecipient", () => executeAtomic(state, args));
});

test("wrong destination eATA fails", () => {
  const { state, args } = fixture();
  args.expectedDestinationEata = key().toBase58();
  rejects("WrongDestinationEata", () => executeAtomic(state, args));
});

test("wrong amount fails", () => {
  const { state, args } = fixture();
  args.amount = 10_001n;
  rejects("WrongAmount", () => executeAtomic(state, args));
});

test("wrong mint fails", () => {
  const { state, args } = fixture();
  args.mint = key().toBase58();
  rejects("WrongMint", () => executeAtomic(state, args));
});

test("stale recipient wallet revision fails", () => {
  const { state, args } = fixture();
  state.vault.recipientWalletRevision += 1n;
  rejects("StaleWalletRevision", () => executeAtomic(state, args));
});

test("reusing a payment ID resolves to the same PDA and cannot execute twice", () => {
  const { state, args, company, recipient, accounts } = fixture();
  const replayAccounts = derivePaymentAccounts({
    company,
    recipient,
    paymentId: Buffer.from(args.paymentId, "hex"),
  });
  assert.equal(replayAccounts.intent.toBase58(), accounts.intent.toBase58());
  assert.equal(replayAccounts.receipt.toBase58(), accounts.receipt.toBase58());
  const paid = executeAtomic(state, args);
  rejects("IntentAlreadyExecuted", () => executeAtomic(paid, args));
});

test("an already-paid receipt fails", () => {
  const { state, args } = fixture();
  state.receipt.status = RECEIPT_PAID;
  rejects("ReceiptAlreadyPaid", () => executeAtomic(state, args));
});

test("company wallet cannot directly transfer PDA-owned custody", () => {
  const { state, company } = fixture();
  assert.notEqual(state.tokens.source.owner, company.toBase58());
  rejects("TokenOwnerMismatch", () =>
    directTokenTransfer(state, company.toBase58(), 10_000n),
  );
});

test("failed token CPI leaves balances, intent, and receipt unchanged", () => {
  const { state, args } = fixture();
  const before = structuredClone(state);
  rejects("TokenCpiFailed", () => executeAtomic(state, args, { tokenCpi: true }));
  assert.deepEqual(state, before);
});

test("failed state update after token CPI rolls back the token movement", () => {
  const { state, args } = fixture();
  const before = structuredClone(state);
  rejects("StateUpdateFailed", () =>
    executeAtomic(state, args, { afterTokenCpi: true }),
  );
  assert.deepEqual(state, before);
});

test("payment IDs are random, nonzero 32-byte values", () => {
  const left = randomPaymentId();
  const right = randomPaymentId();
  assert.equal(left.length, 32);
  assert.equal(right.length, 32);
  assert.notDeepEqual(left, Buffer.alloc(32));
  assert.notDeepEqual(left, right);
});

test("wrong payment ID and changed hash fail", () => {
  const wrongId = fixture();
  wrongId.args.paymentId = Buffer.alloc(32, 9).toString("hex");
  rejects("WrongPaymentId", () => executeAtomic(wrongId.state, wrongId.args));

  const wrongHash = fixture();
  wrongHash.args.intentHash = Buffer.alloc(32, 7).toString("hex");
  rejects("WrongIntentHash", () => executeAtomic(wrongHash.state, wrongHash.args));
});

test("invalid public key cannot be substituted for a derived account", () => {
  assert.throws(() => new PublicKey("not-a-key"));
});

test("intent hash matches the Rust known vector", () => {
  const company = new PublicKey(
    "CE5CcmqDSU1mZtmpT6NiDv7fZDg2edUgerT44RA3F896",
  );
  const recipient = new PublicKey(
    "HqBr2UFAdaPhvtcS8NhvdbPLEJy75vaiQ48h1jFdu9mj",
  );
  const paymentId = Buffer.alloc(32, 42);
  const accounts = derivePaymentAccounts({ company, recipient, paymentId });
  const hash = paymentIntentHash({
    vault: accounts.vault,
    paymentId,
    recipient,
    sourceEata: accounts.sourceEata,
    destinationEata: accounts.destinationEata,
    sourceTokenAccount: accounts.sourceTokenAccount,
    destinationTokenAccount: accounts.destinationTokenAccount,
    amount: 10_000n,
    walletRevision: 1n,
  });
  assert.equal(
    hash.toString("hex"),
    "6f210bfdbd86500a9a842c0740d31a4f437e836c0da1880552afad9cd6a96796",
  );
});
