import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair } from "@solana/web3.js";

import { buildInstructionPlan } from "../src/client.mjs";
import {
  DEVNET_USDC_MINT,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
} from "../src/model.mjs";

const names = [
  "company",
  "accountant",
  "approverOne",
  "approverTwo",
  "recipientA",
  "recipientB",
  "outsider",
];

function stateFixture() {
  const identities = Object.fromEntries(
    names.map((name) => [name, Keypair.generate()]),
  );
  return {
    version: 2,
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    publicKeys: Object.fromEntries(
      names.map((name) => [name, identities[name].publicKey.toBase58()]),
    ),
    keys: Object.fromEntries(
      names.map((name) => [name, Array.from(identities[name].secretKey)]),
    ),
    payments: {
      A: {
        recipientRole: "recipientA",
        paymentIdHex: Buffer.alloc(32, 55).toString("hex"),
        amountBaseUnits: "10000",
        walletRevision: "1",
      },
      B: {
        recipientRole: "recipientB",
        paymentIdHex: Buffer.alloc(32, 56).toString("hex"),
        amountBaseUnits: "10000",
        walletRevision: "2",
      },
    },
  };
}

function group(plan, name) {
  const result = plan.groups.find((candidate) => candidate.name === name);
  assert.ok(result, `missing group ${name}`);
  return result;
}

test("client builds the exact single-instruction atomic execution boundary", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const execution = group(plan, "per.executeSimulationOnly");
  assert.equal(execution.instructions.length, 1);
  assert.deepEqual(execution.signers, ["company"]);
  const instruction = execution.instructions[0];
  assert.equal(instruction.programId.toBase58(), PROGRAM_ID.toBase58());
  assert.equal(instruction.keys.length, 8);
  assert.equal(instruction.keys[0].isSigner, true);
  assert.equal(
    instruction.keys[1].pubkey.toBase58(),
    plan.context.accounts.vault.toBase58(),
  );
  assert.equal(instruction.keys[1].isSigner, false);
  assert.equal(
    instruction.keys[4].pubkey.toBase58(),
    DEVNET_USDC_MINT.toBase58(),
  );
  assert.equal(
    instruction.keys[5].pubkey.toBase58(),
    plan.context.accounts.sourceTokenAccount.toBase58(),
  );
  assert.equal(
    instruction.keys[6].pubkey.toBase58(),
    plan.context.accounts.destinationTokenAccount.toBase58(),
  );
});

test("recipient self-onboarding installs only company and recipient authorities", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const setup = group(plan, "base.setupRecipientEata");
  assert.deepEqual(setup.signers, ["recipientA"]);
  assert.equal(setup.instructions.length, 4);
  assert.equal(
    setup.instructions[0].programId.toBase58(),
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID.toBase58(),
  );
  assert.equal(setup.instructions[0].data[0], 0);
  assert.equal(setup.instructions[1].data[0], 6);
  assert.equal(
    setup.instructions[2].programId.toBase58(),
    PERMISSION_PROGRAM_ID.toBase58(),
  );
  assert.deepEqual([...setup.instructions[2].data.subarray(0, 8)], [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(setup.instructions[3].data[0], 4);

  const members = mb.deserializeMembersArgs(setup.instructions[2].data, 8).members;
  assert.equal(members.length, 2);
  assert.notEqual(members[0].flags & mb.AUTHORITY_FLAG, 0);
  assert.notEqual(members[1].flags & mb.AUTHORITY_FLAG, 0);
  assert.equal(
    setup.instructions[0].keys[1].pubkey.toBase58(),
    plan.context.recipient.publicKey.toBase58(),
  );
});

test("approval instructions require the two distinct configured signer metas", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const first = group(plan, "per.approveOne");
  const second = group(plan, "per.approveTwo");
  assert.deepEqual(first.signers, ["approverOne"]);
  assert.deepEqual(second.signers, ["approverTwo"]);
  assert.equal(first.instructions[0].keys[0].isSigner, true);
  assert.equal(second.instructions[0].keys[0].isSigner, true);
  assert.notEqual(
    first.instructions[0].keys[0].pubkey.toBase58(),
    second.instructions[0].keys[0].pubkey.toBase58(),
  );
  assert.equal(first.instructions[0].keys.length, 2);
  assert.equal(second.instructions[0].keys.length, 2);
  assert.ok(
    first.instructions[0].keys.every(
      (meta) =>
        meta.pubkey.toBase58() !== plan.context.identities.accountant.publicKey.toBase58(),
    ),
  );
});

test("two payments share custody but isolate recipients, intents, and receipts", async () => {
  const state = stateFixture();
  const rpc = new Connection("http://127.0.0.1:8899", "confirmed");
  const planA = await buildInstructionPlan(state, rpc, "A");
  const planB = await buildInstructionPlan(state, rpc, "B");
  assert.equal(
    planA.context.accounts.vault.toBase58(),
    planB.context.accounts.vault.toBase58(),
  );
  assert.equal(
    planA.context.accounts.sourceEata.toBase58(),
    planB.context.accounts.sourceEata.toBase58(),
  );
  assert.notEqual(
    planA.context.accounts.destinationEata.toBase58(),
    planB.context.accounts.destinationEata.toBase58(),
  );
  assert.notEqual(
    planA.context.accounts.intent.toBase58(),
    planB.context.accounts.intent.toBase58(),
  );
  assert.notEqual(
    planA.context.accounts.receipt.toBase58(),
    planB.context.accounts.receipt.toBase58(),
  );
  assert.equal(group(planA, "per.rotateRecipient").instructions.length, 0);
  assert.equal(group(planB, "per.rotateRecipient").instructions.length, 1);
  assert.equal(
    planA.context.identities.accountant.publicKey.equals(
      planA.context.identities.approverOne.publicKey,
    ),
    false,
  );
});

test("simulation client contains no transaction submission path", () => {
  const source = [
    fs.readFileSync(new URL("../src/client.mjs", import.meta.url), "utf8"),
    fs.readFileSync(
      new URL("../scripts/pda-custody-private-payment.mjs", import.meta.url),
      "utf8",
    ),
  ].join("\n");
  assert.doesNotMatch(source, /sendRawTransaction|sendTransaction|\.rpc\s*\(/);
});
