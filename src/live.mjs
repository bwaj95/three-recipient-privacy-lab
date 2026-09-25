// Diagnostic integration probe. This does NOT deploy an approval/vault program.
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import {
  RECIPIENTS, assertDevnet, b58encode, approve, requireApprovals, commitment,
  startAttempt, reconcilePayment, decodeEataBytes, classifyRead
} from './core.mjs';
import { readJson, writeJson, withLock, delay } from './io.mjs';

const command = process.argv[2];
if (!['inspect', 'setup', 'pay', 'reconcile', 'observe', 'withdraw'].includes(command))
  throw new Error('Use inspect, setup, pay, reconcile, observe, or withdraw');
const RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const PER = 'https://devnet-tee.magicblock.app';
const TEE_VALIDATOR = 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo';
const STATE_FILE = '.lab/state.json';
const originFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => originFetch(input, {
  ...init, signal: init.signal || AbortSignal.timeout(12000),
});

let web3, spl, sdk;
try {
  [web3, spl, sdk] = await Promise.all([
    import('@solana/web3.js'), import('@solana/spl-token'),
    import('@magicblock-labs/ephemeral-rollups-sdk'),
  ]);
} catch {
  console.error('Install dependencies with npm install first. No transaction was sent.');
  process.exit(1);
}
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = web3;
for (const name of ['getAuthToken', 'deriveEphemeralAta', 'deriveVault', 'delegateSpl', 'transferSpl', 'undelegateIx', 'withdrawSpl']) {
  if (typeof sdk[name] !== 'function') throw new Error(`Installed SDK lacks ${name}; verify the pinned package before continuing`);
}
const validator = new PublicKey(TEE_VALIDATOR);
const base = new Connection(RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true });
const observer = new Connection(PER, { commitment: 'confirmed', disableRetryOnRateLimit: true });
const authConnections = new Map();
let state;
const persist = () => writeJson(STATE_FILE, state);
const safeError = e => String(e.message || e).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 350);

function createState() {
  const chainKeys = {};
  for (const name of ['company', 'Alice', 'Bob', 'Carol', 'outsider', 'mint'])
    chainKeys[name] = [...Keypair.generate().secretKey];
  const approvalKeys = {};
  for (const name of ['finance', 'manager']) {
    const k = generateKeyPairSync('ed25519');
    approvalKeys[name] = {
      publicKey: k.publicKey.export({ format: 'pem', type: 'spki' }),
      privateKey: k.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    };
  }
  return {
    network: 'devnet', createdAt: new Date().toISOString(), chainKeys, approvalKeys,
    operations: {}, payments: [], setupComplete: false, observations: []
  };
}
const wallet = name => Keypair.fromSecretKey(Uint8Array.from(state.chainKeys[name]));
const pub = name => wallet(name).publicKey;
const mint = () => pub('mint');
const ata = name => spl.getAssociatedTokenAddressSync(mint(), pub(name));
const eata = name => sdk.deriveEphemeralAta(pub(name), mint())[0];

async function ownerConnection(name) {
  if (authConnections.has(name)) return authConnections.get(name);
  const kp = wallet(name);
  const privateKey = createPrivateKey({
    type: 'pkcs8', format: 'der', key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey).subarray(0, 32),
    ])
  });
  const { token } = await sdk.getAuthToken(PER, kp.publicKey,
    async message => new Uint8Array(sign(null, Buffer.from(message), privateKey)));
  // Tokens exist only in memory and are never written into the report.
  const connection = new Connection(`${PER}?token=${encodeURIComponent(token)}`,
    { commitment: 'confirmed', disableRetryOnRateLimit: true });
  authConnections.set(name, connection);
  return connection;
}

async function signatureStatus(connection, signature) {
  return (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
}

async function sendDurably(name, connection, instructions, signers, payment) {
  let operation = state.operations[name];
  if (!operation) {
    const latest = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest }).add(...instructions);
    tx.sign(...signers);
    operation = {
      signature: b58encode(tx.signature), bytes: tx.serialize().toString('base64'),
      message: tx.serializeMessage().toString('base64'), ...latest,
      createdAt: new Date().toISOString(), stage: 'prepared',
    };
    state.operations[name] = operation;
    if (payment) {
      Object.assign(payment, startAttempt(payment, {
        ...operation, paymentCommitment: commitment(payment),
      }));
    }
    persist(); // Write and fsync the signed bytes before broadcast.
  }
  const before = await signatureStatus(connection, operation.signature);
  if (before?.err != null) throw new Error(`Recorded transaction failed on chain: ${JSON.stringify(before.err)}`);
  if (before && ['confirmed', 'finalized'].includes(before.confirmationStatus)) return operation.signature;
  if (await connection.getBlockHeight('confirmed') > operation.lastValidBlockHeight) {
    throw new Error(`Recorded transaction expired with unresolved outcome. Reconcile ${name}; no replacement sent.`);
  }
  operation.stage = 'submitting'; persist();
  try {
    const returned = await connection.sendRawTransaction(Buffer.from(operation.bytes, 'base64'),
      { skipPreflight: false, maxRetries: 0 });
    if (returned !== operation.signature) throw new Error('RPC returned an unexpected signature');
    operation.stage = 'submitted'; persist();
    for (let n = 0; n < 15; n++) {
      const current = await signatureStatus(connection, operation.signature);
      if (current?.err != null) throw new Error(`Chain transaction error: ${JSON.stringify(current.err)}`);
      if (current && ['confirmed', 'finalized'].includes(current.confirmationStatus)) {
        operation.stage = 'confirmed'; persist(); return operation.signature;
      }
      await delay(1000);
    }
    throw new Error('Confirmation is still unknown; reconcile before any replacement');
  } catch (e) { operation.lastError = safeError(e); persist(); throw e; }
}

async function privateBalance(name, connection) {
  return (await connection.getTokenAccountBalance(ata(name), 'confirmed')).value.amount;
}

async function awaitBalance(name, amount) {
  const connection = await ownerConnection(name);
  let last;
  for (let i = 0; i < 15; i++) {
    try { if (await privateBalance(name, connection) === amount) return; }
    catch (e) { last = e; }
    await delay(1000);
  }
  throw new Error(`PER balance for ${name} not ready${last ? `: ${safeError(last)}` : ''}`);
}

async function setup() {
  if (state.setupComplete) { console.log('Setup already complete.'); return; }
  const company = wallet('company');
  if (await base.getBalance(company.publicKey) < 150_000_000) {
    console.log(`Test fee wallet: ${company.publicKey.toBase58()}`);
    try {
      const signature = await base.requestAirdrop(company.publicKey, 1_000_000_000);
      console.log(`Devnet faucet request: ${signature}`);
      for (let n = 0; n < 15 && await base.getBalance(company.publicKey) < 150_000_000; n++) await delay(1000);
    } catch (e) {
      throw new Error(`Devnet faucet unavailable. Fund the printed TEST address with devnet SOL and rerun setup. ${safeError(e)}`);
    }
    if (await base.getBalance(company.publicKey) < 150_000_000)
      throw new Error('Faucet funding is not confirmed; rerun setup after it arrives');
  }
  const mintKey = wallet('mint');
  if (!await base.getAccountInfo(mintKey.publicKey)) {
    const rent = await base.getMinimumBalanceForRentExemption(spl.MINT_SIZE);
    await sendDurably('setup-mint', base, [
      SystemProgram.createAccount({
        fromPubkey: company.publicKey, newAccountPubkey: mintKey.publicKey,
        lamports: rent, space: spl.MINT_SIZE, programId: spl.TOKEN_PROGRAM_ID
      }),
      spl.createInitializeMint2Instruction(mintKey.publicKey, 6, company.publicKey, null),
    ], [company, mintKey]);
  }
  for (const name of ['company', ...RECIPIENTS.map(x => x.name)]) {
    const instructions = [spl.createAssociatedTokenAccountIdempotentInstruction(company.publicKey, ata(name), pub(name), mint())];
    if (name !== 'company' && !state.operations[`fund-${name}`]) {
      instructions.push(SystemProgram.transfer({ fromPubkey: company.publicKey, toPubkey: pub(name), lamports: 20_000_000 }));
    }
    await sendDurably(`fund-${name}`, base, instructions, [company]);
  }
  await sendDurably('mint-fixture-tokens', base, [
    spl.createMintToInstruction(mint(), ata('company'), company.publicKey, 10_000_000n),
  ], [company]);
  for (const name of ['company', ...RECIPIENTS.map(x => x.name)]) {
    const amount = name === 'company' ? 10_000_000n : 0n;
    const existing = !!await base.getAccountInfo(eata(name));
    const vault = sdk.deriveVault(mint())[0];
    const instructions = await sdk.delegateSpl(pub(name), mint(), amount, {
      payer: company.publicKey, validator, idempotent: false, private: true,
      initIfMissing: !existing, initVaultIfMissing: !await base.getAccountInfo(vault),
    });
    await sendDurably(`delegate-${name}`, base, instructions,
      name === 'company' ? [company] : [company, wallet(name)]);
    await awaitBalance(name, amount.toString());
  }
  state.payments = RECIPIENTS.map(row => {
    const p = {
      id: `fixture-${row.name}`, name: row.name, revision: 0,
      vault: pub('company').toBase58(), mint: mint().toBase58(), recipient: pub(row.name).toBase58(),
      amount: row.amount, salt: randomBytes(32).toString('hex'), status: 'approved', baseline: '0'
    };
    p.approvals = Object.entries(state.approvalKeys).map(([id, keys]) => approve(p, id, keys.privateKey));
    return p;
  });
  state.setupComplete = true; persist();
  console.log('Setup complete: fresh six-decimal TEST token; company 10.00, recipients 0.00.');
  console.log('The fixture uses a wallet treasury. PDA/multisig enforcement is NOT established.');
  await observe('before-payments');
}

async function reconcile() {
  const companyConnection = await ownerConnection('company');
  for (const p of state.payments) {
    if (!p.attempt || p.status === 'paid' || p.withdraw) continue;
    try {
      const tx = await signatureStatus(companyConnection, p.attempt.signature);
      if (tx?.err != null) {
        p.lastEvidence = { tx, checkedAt: new Date().toISOString() };
        Object.assign(p, reconcilePayment(p, p.lastEvidence));
        delete p.reconcileError; persist();
        console.log(`${p.name}: ${p.status}`); continue;
      }
      const receipt = await companyConnection.getTransaction(p.attempt.signature,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const actualMessage = receipt?.transaction.message.serialize();
      const transactionMatches = !!actualMessage && Buffer.from(actualMessage).toString('base64') === p.attempt.message;
      const owner = await ownerConnection(p.name);
      const balance = await privateBalance(p.name, owner);
      const delta = (BigInt(balance) - BigInt(p.baseline)).toString();
      p.lastEvidence = { tx, delta, transactionMatches, checkedAt: new Date().toISOString() };
      Object.assign(p, reconcilePayment(p, p.lastEvidence));
      delete p.reconcileError;
    } catch (e) { p.reconcileError = safeError(e); }
    persist();
    console.log(`${p.name}: ${p.status}${p.reconcileError ? ` (${p.reconcileError})` : ''}`);
  }
}

async function pay() {
  const companyConnection = await ownerConnection('company');
  const authorized = Object.fromEntries(Object.entries(state.approvalKeys).map(([k, v]) => [k, v.publicKey]));
  for (const p of state.payments) {
    try {
      requireApprovals(p, p.approvals, authorized);
      if (p.attempt) {
        if (p.status === 'processing') {
          const recorded = state.operations[`pay-${p.name}`];
          if (!recorded || recorded.signature !== p.attempt.signature ||
            p.attempt.paymentCommitment !== commitment(p)) throw new Error('Saved attempt binding mismatch');
          console.log(`${p.name}: checking or resending the SAME signed transaction`);
          await sendDurably(`pay-${p.name}`, companyConnection, [], [wallet('company')], p);
        } else console.log(`${p.name}: ${p.status}; no additional payment sent`);
        continue;
      }
      // No permission broadening, recipient co-signature, or public fallback on failure.
      const instructions = await sdk.transferSpl(pub('company'), pub(p.name), mint(), BigInt(p.amount), {
        visibility: 'private', fromBalance: 'ephemeral', toBalance: 'ephemeral', validator,
      });
      await sendDurably(`pay-${p.name}`, companyConnection, instructions, [wallet('company')], p);
    } catch (e) { p.sendError = safeError(e); persist(); console.log(`${p.name}: ${p.sendError}`); }
  }
  await reconcile();
  await observe('after-payments');
  if (state.payments.some(p => !['credited_in_per', 'paid'].includes(p.status))) process.exitCode = 1;
}

async function observe(stage = 'manual') {
  const matrix = [];
  const readers = [{ name: 'base-public', connection: base }, { name: 'PER-unauthenticated', connection: observer }];
  for (const name of ['company', ...RECIPIENTS.map(x => x.name), 'outsider']) {
    try { readers.push({ name: `PER-${name}`, connection: await ownerConnection(name) }); }
    catch (e) { matrix.push({ reader: `PER-${name}`, classification: 'auth-error', detail: safeError(e) }); }
  }
  for (const reader of readers) {
    for (const recipient of ['company', ...RECIPIENTS.map(x => x.name)]) {
      try {
        const response = await reader.connection.getAccountInfoAndContext(eata(recipient), 'confirmed');
        const account = response.value;
        matrix.push({
          reader: reader.name, subject: recipient, address: eata(recipient).toBase58(),
          slot: response.context.slot, accountProgram: account?.owner.toBase58(),
          ...classifyRead({ account, decoded: account ? decodeEataBytes(account.data, pub(recipient).toBuffer(), mint().toBuffer()) : undefined })
        });
      } catch (e) { matrix.push({ reader: reader.name, subject: recipient, classification: 'request-error', detail: safeError(e) }); }
      // Query the remapped SPL view too: denying one path is insufficient.
      try {
        const result = await reader.connection.getTokenAccountBalance(ata(recipient), 'confirmed');
        matrix.push({
          reader: reader.name, subject: recipient, route: 'SPL-balance', classification: 'readable-balance',
          amount: result.value.amount, slot: result.context.slot
        });
      } catch (e) { matrix.push({ reader: reader.name, subject: recipient, route: 'SPL-balance', classification: 'request-error', detail: safeError(e) }); }
    }
  }
  const transactionVisibility = [];
  for (const p of state.payments.filter(x => x.attempt)) {
    for (const reader of readers) {
      try {
        const receipt = await reader.connection.getTransaction(p.attempt.signature,
          { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        transactionVisibility.push({
          payment: p.name, reader: reader.name,
          outcome: receipt ? 'transaction-readable' : 'absent-or-filtered',
          slot: receipt?.slot, logs: receipt?.meta?.logMessages ?? null
        });
      } catch (e) { transactionVisibility.push({ payment: p.name, reader: reader.name, outcome: 'request-error', detail: safeError(e) }); }
    }
  }
  const observation = { stage, at: new Date().toISOString(), matrix, transactionVisibility };
  state.observations.push(observation); persist();
  writeJson('reports/live-observations.json', {
    network: 'devnet', mint: mint().toBase58(), realUSDC: false, programDeployed: false,
    onchainApprovalEnforcement: 'UNVERIFIED - wallet-treasury probe only',
    financeAuditAccess: 'UNVERIFIED - company can retain its own payment records; no delegated auditor configured',
    teeHardwareAttestation: 'NOT independently verified by this probe',
    fullPrivacyPass: false,
    limitation: 'Synthetic amounts and shared setup payer. Read failures do not prove confidentiality; source/base snapshots can be stale.',
    payments: state.payments.map(p => ({
      name: p.name, status: p.status, amount: p.amount,
      recipient: p.recipient, signature: p.attempt?.signature, evidence: p.lastEvidence,
      withdraw: p.withdraw, errors: [p.sendError, p.reconcileError, p.withdrawError].filter(Boolean)
    })),
    observations: state.observations,
  });
  console.log('Wrote reports/live-observations.json. This is evidence, not a full privacy PASS.');
}

async function withdraw() {
  for (const p of state.payments) {
    if (p.status === 'paid') continue;
    if (p.status !== 'credited_in_per') {
      console.log(`${p.name}: withdrawal skipped; recipient credit not verified`); continue;
    }
    try {
      const owner = wallet(p.name);
      const amount = p.amount;
      p.withdraw ??= { baseline: (await base.getTokenAccountBalance(ata(p.name))).value.amount };
      persist();
      if (!p.withdraw.commitSignature) {
        const connection = await ownerConnection(p.name);
        if (!p.withdraw.undelegateSignature) {
          p.withdraw.undelegateSignature = await sendDurably(`undelegate-${p.name}`, connection,
            [sdk.undelegateIx(owner.publicKey, mint())], [owner]);
          persist();
        }
        p.withdraw.commitSignature = await resolveCommit(p.withdraw.undelegateSignature, connection);
        persist();
      }
      const commitSignature = p.withdraw.commitSignature;
      let finalized = false;
      for (let n = 0; n < 40; n++) {
        const status = await signatureStatus(base, commitSignature);
        if (status?.err != null) throw new Error('Base commitment transaction failed');
        if (status?.confirmationStatus === 'finalized') { finalized = true; break; }
        await delay(1000);
      }
      if (!finalized) throw new Error('Base commitment not finalized yet; rerun withdraw later');
      // Capture this before unshielding: commit itself may reveal the balance.
      if (!p.withdraw.observedCommit) {
        await observe(`after-commit-${p.name}`);
        p.withdraw.observedCommit = true; persist();
      }
      const instructions = await sdk.withdrawSpl(owner.publicKey, mint(), BigInt(amount), { idempotent: false });
      const withdrawalSignature = await sendDurably(`withdraw-${p.name}`, base, instructions, [owner]);
      p.withdraw.signature = withdrawalSignature; persist();
      for (let n = 0; n < 40; n++) {
        const status = await signatureStatus(base, withdrawalSignature);
        const balance = (await base.getTokenAccountBalance(ata(p.name), 'confirmed')).value.amount;
        const exactCredit = BigInt(balance) - BigInt(p.withdraw.baseline) === BigInt(amount);
        if (status?.err != null) throw new Error('Withdrawal failed on base chain');
        if (status?.confirmationStatus === 'finalized' && exactCredit) {
          p.status = 'paid'; p.withdraw.publicAmount = amount; p.withdraw.finalized = true; persist(); break;
        }
        await delay(1000);
      }
      if (p.status !== 'paid') throw new Error('Withdrawal is not finalized with exact recipient credit yet; rerun withdraw');
      delete p.withdrawError; persist();
      console.log(`${p.name}: ${p.status}; public withdrawal visibility recorded`);
    } catch (e) { p.withdrawError = safeError(e); persist(); console.log(`${p.name}: ${p.withdrawError}`); }
  }
  await observe('after-withdrawals');
  if (state.payments.some(p => p.status !== 'paid')) process.exitCode = 1;
}

// Mirrors the SDK's two successful-transaction log lookups, using bounded HTTP
// polling instead of its WebSocket confirmation helper. Never schedules a write.
async function resolveCommit(undelegateSignature, connection) {
  async function successfulReceipt(signature) {
    for (let n = 0; n < 20; n++) {
      const receipt = await connection.getTransaction(signature,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (receipt?.meta?.err != null) throw new Error('Commit scheduling transaction failed');
      if (receipt?.meta) return receipt;
      await delay(1000);
    }
    throw new Error('Commit scheduling receipt not available yet; rerun withdraw');
  }
  function logSignature(receipt, prefix) {
    const line = receipt.meta.logMessages?.find(x => x.includes(prefix));
    const signature = line?.split(prefix)[1]?.trim();
    if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
      throw new Error(`Expected commitment signature log unavailable: ${prefix}`);
    return signature;
  }
  const scheduling = await successfulReceipt(undelegateSignature);
  const scheduledSignature = logSignature(scheduling, 'ScheduledCommitSent signature: ');
  const scheduled = await successfulReceipt(scheduledSignature);
  return logSignature(scheduled, 'ScheduledCommitSent signature[0]: ');
}

async function inspect() {
  const company = Keypair.generate(), token = Keypair.generate();
  const cases = [];
  for (const r of RECIPIENTS) {
    const recipient = Keypair.generate();
    const options = { fromBalance: 'ephemeral', toBalance: 'ephemeral', validator };
    const privateIxs = await sdk.transferSpl(company.publicKey, recipient.publicKey, token.publicKey, BigInt(r.amount), { ...options, visibility: 'private' });
    const publicIxs = await sdk.transferSpl(company.publicKey, recipient.publicKey, token.publicKey, BigInt(r.amount), { ...options, visibility: 'public' });
    const ix = privateIxs[0];
    cases.push({
      recipient: r.name, networkCalls: 0, transactionsSubmitted: 0,
      standardSplTransfer: ix.programId.equals(spl.TOKEN_PROGRAM_ID) && ix.data[0] === 3,
      amountReadableInInstruction: ix.data.length === 9 ? ix.data.readBigUInt64LE(1).toString() : null,
      sameInstructionAsPublicMode: privateIxs.length === publicIxs.length && privateIxs.every((x, i) =>
        x.programId.equals(publicIxs[i].programId) && x.data.equals(publicIxs[i].data) &&
        JSON.stringify(x.keys) === JSON.stringify(publicIxs[i].keys)),
    });
  }
  const pda = PublicKey.findProgramAddressSync([Buffer.from('company-vault')], Keypair.generate().publicKey)[0];
  let pdaResult;
  try {
    await sdk.transferSpl(pda, Keypair.generate().publicKey, token.publicKey, 1n,
      { visibility: 'private', fromBalance: 'ephemeral', toBalance: 'ephemeral', validator });
    pdaResult = 'helper accepted PDA; program authorization still untested';
  } catch (e) { pdaResult = `helper rejected PDA: ${e.name}; use a separately verified program/CPI path`; }
  writeJson('reports/sdk-inspection.json', {
    generatedAt: new Date().toISOString(), kind: 'unsigned SDK instructions, not network execution', cases, pdaResult,
    conclusion: 'The visibility option alone does not encrypt intra-PER transfer instruction bytes. Verify PER account permissions, transaction filtering, and commit/withdrawal exposure separately.',
  });
  for (const row of cases) console.log(`${row.recipient}: plaintext amount ${row.amountReadableInInstruction}; private/public instruction equal: ${row.sameInstructionAsPublicMode}`);
  console.log(pdaResult);
}

try {
  if (command === 'inspect') await inspect();
  else await withLock(async () => {
    state = readJson(STATE_FILE);
    if (!state && command !== 'setup') throw new Error('Run npm run setup first');
    if (!state) { state = createState(); persist(); }
    assertDevnet(await base.getGenesisHash());
    // const identity = (await observer.getIdentity()).identity;
    const identityResponse = await fetch(PER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getIdentity',
      }),
    });

    if (!identityResponse.ok) {
      throw new Error(`PER getIdentity HTTP ${identityResponse.status}`);
    }

    const identityPayload = await identityResponse.json();

    if (identityPayload?.error) {
      throw new Error(
        `PER getIdentity failed: ${identityPayload.error.message || 'RPC error'}`
      );
    }

    const identity = identityPayload?.result?.identity;
    if (identity !== TEE_VALIDATOR) throw new Error('PER identity differs from the reviewed devnet validator; stop and verify the endpoint');
    if (command !== 'setup' && !state.setupComplete) throw new Error('Setup is incomplete; rerun setup');
    if (command === 'setup') await setup();
    if (command === 'pay') await pay();
    if (command === 'reconcile') { await reconcile(); await observe('after-reconcile'); }
    if (command === 'observe') await observe();
    if (command === 'withdraw') await withdraw();
  });
} catch (e) { console.error(safeError(e)); process.exitCode = 1; }
