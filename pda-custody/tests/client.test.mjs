import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import * as mb from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair } from "@solana/web3.js";

import {
  buildInstructionPlan,
  decodePrivatePermission,
  identityRoleForSigner,
} from "../src/client.mjs";
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

test("permission decoder supports ephemeral and standard PER layouts", () => {
  const permissioned = Keypair.generate().publicKey;
  const defaultMember = Keypair.generate().publicKey;
  const viewer = Keypair.generate().publicKey;
  const expectedMembers = [
    { flags: 0, pubkey: defaultMember.toBase58() },
    { flags: 14, pubkey: viewer.toBase58() },
  ];
  const writeMember = (buffer, offset, member) => {
    buffer[offset] = member.flags;
    member.pubkey.toBuffer().copy(buffer, offset + 1);
  };

  const ephemeral = Buffer.alloc(35 + expectedMembers.length * 33);
  permissioned.toBuffer().copy(ephemeral, 2);
  ephemeral[34] = 1;
  writeMember(ephemeral, 35, { flags: 0, pubkey: defaultMember });
  writeMember(ephemeral, 68, { flags: 14, pubkey: viewer });
  assert.deepEqual(decodePrivatePermission(ephemeral), {
    permissionedAccount: permissioned.toBase58(),
    isPrivate: true,
    layout: "ephemeral",
    members: expectedMembers,
  });

  const standard = Buffer.alloc(567);
  permissioned.toBuffer().copy(standard, 2);
  standard[34] = 1;
  standard.writeUInt32LE(expectedMembers.length, 35);
  writeMember(standard, 39, { flags: 0, pubkey: defaultMember });
  writeMember(standard, 72, { flags: 14, pubkey: viewer });
  assert.deepEqual(decodePrivatePermission(standard), {
    permissionedAccount: permissioned.toBase58(),
    isPrivate: true,
    layout: "standard",
    members: expectedMembers,
  });
});

test("identity roles match reconstructed signers by public key", () => {
  const original = Keypair.generate();
  const reconstructed = Keypair.fromSecretKey(original.secretKey);
  assert.notEqual(original, reconstructed);
  assert.equal(
    identityRoleForSigner({ recipientA: original }, reconstructed),
    "recipientA",
  );
  assert.equal(
    identityRoleForSigner({ recipientA: original }, Keypair.generate()),
    null,
  );
});

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
  const tokenView = group(plan, "base.initializeRecipientTokenView");
  assert.deepEqual(tokenView.signers, ["recipientA"]);
  assert.equal(tokenView.instructions.length, 1);
  assert.equal(
    tokenView.instructions[0].programId.toBase58(),
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );
  assert.equal(
    tokenView.instructions[0].keys[1].pubkey.toBase58(),
    plan.context.accounts.destinationTokenAccount.toBase58(),
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

test("custody repair restores only PDA authority after company visibility", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const repair = group(plan, "base.repairCustodyPdaAuthority");
  assert.deepEqual(repair.signers, ["company"]);
  assert.equal(repair.instructions.length, 1);
  assert.equal(
    repair.instructions[0].programId.toBase58(),
    PERMISSION_PROGRAM_ID.toBase58(),
  );
  const members = mb.deserializeMembersArgs(repair.instructions[0].data, 8).members;
  assert.equal(members.length, 2);
  assert.equal(
    members[0].pubkey.toBase58(),
    plan.context.identities.company.publicKey.toBase58(),
  );
  assert.equal(members[0].flags, 15);
  assert.equal(
    members[1].pubkey.toBase58(),
    plan.context.accounts.vault.toBase58(),
  );
  assert.equal(members[1].flags, mb.AUTHORITY_FLAG);
});

test("recipient repair preserves viewers and grants only PDA authority", async () => {
  const plan = await buildInstructionPlan(
    stateFixture(),
    new Connection("http://127.0.0.1:8899", "confirmed"),
  );
  const repair = group(plan, "base.repairRecipientPdaAuthority");
  assert.deepEqual(repair.signers, ["company"]);
  assert.equal(repair.instructions.length, 1);
  assert.equal(
    repair.instructions[0].programId.toBase58(),
    PERMISSION_PROGRAM_ID.toBase58(),
  );
  const members = mb.deserializeMembersArgs(repair.instructions[0].data, 8).members;
  assert.deepEqual(
    members.map((member) => [member.pubkey.toBase58(), member.flags]),
    [
      [plan.context.identities.company.publicKey.toBase58(), 15],
      [plan.context.recipient.publicKey.toBase58(), 15],
      [plan.context.accounts.vault.toBase58(), mb.AUTHORITY_FLAG],
    ],
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
