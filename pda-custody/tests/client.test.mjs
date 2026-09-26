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
  "approverOne",
  "approverTwo",
  "recipient",
  "outsider",
];

function stateFixture() {
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
      paymentIdHex: Buffer.alloc(32, 55).toString("hex"),
      amountBaseUnits: "10000",
      walletRevision: "1",
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

test("recipient eATA setup installs explicit authorities before delegation", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const setup = group(plan, "base.setupRecipientEata");
  assert.deepEqual(setup.signers, ["company", "recipient"]);
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
  assert.equal(members.length, 4);
  assert.notEqual(members[0].flags & mb.AUTHORITY_FLAG, 0);
  assert.equal(members[1].flags & mb.AUTHORITY_FLAG, 0);
  assert.equal(members[2].flags & mb.AUTHORITY_FLAG, 0);
  assert.notEqual(members[3].flags & mb.AUTHORITY_FLAG, 0);
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
