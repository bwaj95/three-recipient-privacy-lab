// Devnet USDC repeat of the three-recipient MagicBlock PER experiment.
// Put this file at src/usdc-privacy.mjs in three-recipient-privacy-lab.
// Reuses the wallets in .lab/privacy-demo.json; it never imports the TEST mint.
// Commands: check | prepare | pay | read public|unauth|company|Alice|Bob|Carol|outsider
//           exit Alice | withdraw Alice
import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import * as mb from '@magicblock-labs/ephemeral-rollups-sdk';

const RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const PER = 'https://devnet-tee.magicblock.app';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const VALIDATOR = new PublicKey('MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo');
const MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const ESPL = new PublicKey('SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2');
const AMOUNTS = { Alice: 1_110_000n, Bob: 2_220_000n, Carol: 3_330_000n };
const NAMES = Object.keys(AMOUNTS);
const STATE = '.lab/usdc-privacy.json';
const OLD = '.lab/privacy-demo.json';
const EXPECTED = {
  company: 'CE5CcmqDSU1mZtmpT6NiDv7fZDg2edUgerT44RA3F896',
  Alice: 'AA9Wo4TJFcrmzYxCkRWceSxoX7XoT4z8QW6hCjiS7QVi',
  Bob: '7hmvR9FfBeJtDGPKvyvXhTttxpiQsqqh66QWqAGwJobR',
  Carol: 'HqBr2UFAdaPhvtcS8NhvdbPLEJy75vaiQ48h1jFdu9mj',
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = e => String(e?.message || e).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 350);
const read = path => fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
const original = read(OLD);
if (!original?.keys) throw new Error(`Missing ${OLD}. Run this inside the existing lab folder.`);
const wallets = {};
for (const name of ['company', ...NAMES, 'outsider']) {
  if (!original.keys[name]) throw new Error(`${OLD} lacks ${name}'s test wallet.`);
  wallets[name] = Keypair.fromSecretKey(Uint8Array.from(original.keys[name]));
  if (EXPECTED[name] && wallets[name].publicKey.toBase58() !== EXPECTED[name])
    throw new Error(`${name}'s wallet differs from the reviewed TEST experiment.`);
}
let state = read(STATE) || { version: 1, receipts: {}, views: {} };
if (state.version !== 1) throw new Error('Unexpected USDC experiment state version.');
const wallet = name => wallets[name];
const ata = name => spl.getAssociatedTokenAddressSync(MINT, wallet(name).publicKey);
const eata = name => mb.deriveEphemeralAta(wallet(name).publicKey, MINT)[0];
const amount = value => `${BigInt(value) / 1_000_000n}.${(BigInt(value) % 1_000_000n).toString().padStart(6, '0')}`;
function publicEataAmount(name, info) {
  const bytes = info?.data;
  if (!info?.owner.equals(ESPL) || ![72, 80].includes(bytes.length)
    || !bytes.subarray(0, 32).equals(wallet(name).publicKey.toBuffer())
    || !bytes.subarray(32, 64).equals(MINT.toBuffer())) return null;
  return bytes.readBigUInt64LE(64);
}

function save() {
  fs.mkdirSync('.lab', { recursive: true, mode: 0o700 });
  const temp = `${STATE}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, STATE);
}

// Pace HTTP calls to avoid devnet's public RPC limits. Never retry a chain write
// by creating a fresh transaction; the signed bytes are saved below instead.
const realFetch = globalThis.fetch;
let nextRequest = 0;
async function pacedFetch(url, options = {}) {
  for (let n = 0; n < 3; n++) {
    await sleep(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 1200;
    const response = await realFetch(url, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
    const data = await response.clone().json().catch(() => null);
    if (response.status !== 429 && data?.error?.code !== 429) return response;
    if (n === 2) throw new Error('RPC is rate limited. Retry this SAME command later.');
    await response.arrayBuffer();
    await sleep(10_000 * (n + 1));
  }
}
globalThis.fetch = pacedFetch;
const connection = url => new Connection(url, { commitment: 'confirmed', fetch: pacedFetch, disableRetryOnRateLimit: true });
const base = connection(RPC);
const owners = new Map();
async function asOwner(name) {
  if (!owners.has(name)) {
    const kp = wallet(name);
    const pk = createPrivateKey({ type: 'pkcs8', format: 'der', key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey).subarray(0, 32),
    ]) });
    const { token } = await mb.getAuthToken(PER, kp.publicKey,
      async bytes => new Uint8Array(sign(null, bytes, pk)));
    owners.set(name, connection(`${PER}?token=${encodeURIComponent(token)}`));
  }
  return owners.get(name);
}
const balance = async (name, rpc) => (await rpc.getTokenAccountBalance(ata(name))).value.amount;
const status = async (rpc, signature) => (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n, result = '';
  for (const b of bytes) n = n * 256n + BigInt(b);
  while (n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; }
  for (const b of bytes) { if (b) break; result = '1' + result; }
  return result;
}

// Persist exact signed bytes before submission. Unknown or expired outcomes
// stop the experiment; rerunning never creates a fresh payment.
async function sendOnce(label, rpc, instructions, signers) {
  let receipt = state.receipts[label];
  if (receipt?.confirmed) return receipt.signature;
  if (!receipt) {
    const latest = await rpc.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest }).add(...instructions);
    tx.sign(...signers);
    receipt = state.receipts[label] = {
      signature: base58(tx.signature), bytes: tx.serialize().toString('base64'), ...latest,
    };
    save();
  }
  let current = await status(rpc, receipt.signature);
  if (current?.err) throw new Error(`${label}: recorded transaction failed: ${JSON.stringify(current.err)}`);
  if (!['confirmed', 'finalized'].includes(current?.confirmationStatus)) {
    if (await rpc.getBlockHeight() > receipt.lastValidBlockHeight)
      throw new Error(`${label}: saved transaction expired; outcome unresolved. Do not start a new transfer. ${receipt.signature}`);
    await rpc.sendRawTransaction(Buffer.from(receipt.bytes, 'base64'), { skipPreflight: false, maxRetries: 0 });
    for (let n = 0; n < 8; n++) {
      await sleep(3000);
      current = await status(rpc, receipt.signature);
      if (current?.err) throw new Error(`${label}: transaction failed: ${JSON.stringify(current.err)}`);
      if (['confirmed', 'finalized'].includes(current?.confirmationStatus)) break;
    }
  }
  if (!['confirmed', 'finalized'].includes(current?.confirmationStatus))
    throw new Error(`${label}: confirmation unknown. Keep ${STATE}; rerun this SAME command. ${receipt.signature}`);
  receipt.confirmed = true; save();
  console.log(`  Confirmed ${label}: ${receipt.signature}`);
  return receipt.signature;
}

async function check() {
  if (await base.getGenesisHash() !== GENESIS) throw new Error('Refusing a non-devnet Solana RPC.');
  const response = await pacedFetch(PER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIdentity' }) });
  const reply = await response.json();
  if (!response.ok || reply.error || reply.result?.identity !== VALIDATOR.toBase58())
    throw new Error('Unexpected MagicBlock devnet validator identity.');
  const mint = await spl.getMint(base, MINT);
  if (mint.decimals !== 6) throw new Error('USDC mint has unexpected decimals.');
  const payer = wallet('company').publicKey;
  const existingAta = await base.getAccountInfo(ata('company'));
  console.log(`Company wallet: ${payer}`);
  console.log(`Circle devnet USDC mint: ${MINT}`);
  console.log(`Devnet SOL: ${(await base.getBalance(payer)) / 1e9}`);
  console.log(`Company public USDC: ${existingAta ? amount(await balance('company', base)) : 'ATA not created'}`);
  console.log('Check is read-only. Circle faucet: https://faucet.circle.com/ (USDC, Solana Devnet).');
}

async function prepare() {
  if (state.ready) { console.log('USDC private balances already prepared; run pay.'); return; }
  const payer = wallet('company');
  if (await base.getBalance(payer.publicKey) < 100_000_000)
    throw new Error('Company needs at least 0.1 devnet SOL for setup and transaction fees.');
  for (const name of ['company', ...NAMES]) {
    if (!state.receipts[`Prepare USDC: ${name}`] && await base.getAccountInfo(eata(name)))
      throw new Error(`${name} already has a USDC eATA outside this experiment. Stop; do not overwrite it.`);
  }
  const createAtas = ['company', ...NAMES].map(name =>
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(name), wallet(name).publicKey, MINT));
  const rentSponsor = mb.deriveRentPda()[0];
  const shortfall = Math.max(0, 50_000_000 - await base.getBalance(rentSponsor));
  if (shortfall) createAtas.push(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: rentSponsor, lamports: shortfall,
  }));
  await sendOnce('Create USDC ATAs', base, createAtas, [payer]);
  const publicUSDC = await balance('company', base);
  if (!state.receipts['Prepare USDC: company'] && BigInt(publicUSDC) < 10_000_000n)
    throw new Error(`Company has ${amount(publicUSDC)} devnet USDC. Use Circle faucet for ${payer.publicKey}; then rerun prepare. No deposit was sent.`);
  for (const name of ['company', ...NAMES]) {
    const credit = name === 'company' ? 10_000_000n : 0n;
    if (!state.receipts[`Prepare USDC: ${name}`]) {
      const ixs = await mb.delegateSpl(wallet(name).publicKey, MINT, credit, {
        payer: payer.publicKey, validator: VALIDATOR, idempotent: false, private: true,
        initIfMissing: true, initVaultIfMissing: name === 'company',
      });
      await sendOnce(`Prepare USDC: ${name}`, base, ixs,
        name === 'company' ? [payer] : [payer, wallet(name)]);
    } else {
      await sendOnce(`Prepare USDC: ${name}`, base, [], [payer]);
    }
    let found;
    for (let n = 0; n < 10; n++) {
      try { found = await balance(name, await asOwner(name)); if (found === credit.toString()) break; }
      catch { /* PER propagation may lag; an error is never privacy evidence. */ }
      await sleep(2000);
    }
    if (found !== credit.toString()) throw new Error(`${name} private USDC credit is not verified; rerun prepare later.`);
    console.log(`${name} private USDC: ${amount(found)}`);
  }
  state.ready = true; save();
  console.log('Prepared 10 USDC for company, 0 for recipients. The public funding deposit is visible.');
}

async function pay() {
  if (!state.ready) throw new Error('Run prepare first.');
  const owner = await asOwner('company');
  for (const name of NAMES) {
    const label = `Private USDC to ${name}`;
    const ixs = state.receipts[label] ? [] : await mb.transferSpl(wallet('company').publicKey,
      wallet(name).publicKey, MINT, AMOUNTS[name], {
        visibility: 'private', fromBalance: 'ephemeral', toBalance: 'ephemeral', validator: VALIDATOR,
      });
    await sendOnce(label, owner, ixs, [wallet('company')]);
    const received = await balance(name, await asOwner(name));
    if (received !== AMOUNTS[name].toString())
      throw new Error(`${name}: expected ${amount(AMOUNTS[name])}, observed ${amount(received)}; do not send another payment.`);
    console.log(`${name} received ${amount(received)} private USDC.`);
  }
  const remaining = await balance('company', owner);
  if (remaining !== '3340000') throw new Error(`Expected company private balance 3.34, observed ${amount(remaining)}.`);
  console.log('Company private USDC: 3.340000. Next: read public, read unauth, read Alice/Bob/Carol.');
}

async function readView(viewer) {
  const rpc = viewer === 'public' ? base : viewer === 'unauth' ? connection(PER) : await asOwner(viewer);
  const rows = [];
  for (const name of NAMES) {
    const row = { recipient: name, SPL_balance_view: '?', eATA: '?', PER_receipt: 'not sent', errors: [] };
    // PER can remap a query for the ordinary ATA to the viewer's private balance.
    try { row.SPL_balance_view = amount(await balance(name, rpc)); }
    catch (e) { row.SPL_balance_view = 'unavailable'; row.errors.push(`ATA ${clean(e)}`); }
    try {
      const info = await rpc.getAccountInfo(eata(name));
      row.eataProgram = info?.owner.toBase58();
      // Current eATA layout is 80 bytes; old snapshots may be 72.
      // A base account still owned by the delegation program may be stale.
      const value = publicEataAmount(name, info);
      row.eATA = value === null ? info ? 'delegated/other layout' : 'absent or filtered' : amount(value);
    } catch (e) { row.eATA = 'request error'; row.errors.push(`eATA ${clean(e)}`); }
    const receipt = state.receipts[`Private USDC to ${name}`];
    if (receipt) {
      try {
        const tx = await rpc.getTransaction(receipt.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        const instructions = tx?.transaction?.message?.instructions ?? tx?.transaction?.message?.compiledInstructions;
        row.PER_receipt = tx ? `${instructions?.length || 0} instruction(s) returned` : 'absent or filtered';
      } catch (e) { row.PER_receipt = 'request error'; row.errors.push(`receipt ${clean(e)}`); }
    }
    rows.push(row);
  }
  console.log(`View as ${viewer}:`);
  console.table(rows.map(({ recipient, SPL_balance_view, eATA, PER_receipt }) => ({ recipient, SPL_balance_view, eATA, PER_receipt })));
  for (const row of rows) for (const error of row.errors) console.log(`${row.recipient}: ${error}`);
  state.views[viewer] ||= [];
  state.views[viewer].push({ at: new Date().toISOString(), rows }); save();
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/usdc-privacy.json', JSON.stringify({ mint: MINT.toBase58(),
    depositSignature: state.receipts['Prepare USDC: company']?.signature,
    paymentSignatures: Object.fromEntries(NAMES.map(name => [name, state.receipts[`Private USDC to ${name}`]?.signature])),
    withdrawalSignature: state.receipts['Withdraw USDC Alice']?.signature,
    views: state.views,
    limitations: 'Public setup links wallets; public funding amount is visible. Missing/error/empty PER data is inconclusive. Public eATA can be stale while delegated. Do not assert complete payroll privacy.'
  }, null, 2));
  console.log('Saved reports/usdc-privacy.json. Empty data/errors do not prove privacy.');
}

async function committedAlice() {
  const info = await base.getAccountInfo(eata('Alice'), 'finalized');
  return publicEataAmount('Alice', info) === AMOUNTS.Alice;
}

async function exitAlice() {
  if (!state.receipts['Private USDC to Alice']?.confirmed)
    throw new Error('First pay Alice and verify the private credit.');
  if (state.receipts['Withdraw USDC Alice']?.confirmed) {
    console.log('Alice has already withdrawn USDC. Run read public.');
    return;
  }
  if (!await committedAlice()) {
    const owner = wallet('Alice');
    await sendOnce('Undelegate USDC Alice', await asOwner('Alice'),
      [mb.undelegateIx(owner.publicKey, MINT)], [owner]);
    let committed = false;
    for (let n = 0; n < 12; n++) {
      if (await committedAlice()) { committed = true; break; }
      await sleep(3000);
    }
    if (!committed) throw new Error('Commit not visible on finalized Solana yet; rerun exit Alice later. No second undelegation will be sent.');
  }
  state.aliceCommitted = true; save();
  console.log('Alice eATA committed with 1.110000 USDC. Observe public state before withdrawing:');
  await readView('public');
  console.log('Next: withdraw Alice. This step will publicly reveal the destination and amount.');
}

async function withdrawAlice() {
  if (!state.aliceCommitted || (!state.receipts['Withdraw USDC Alice'] && !await committedAlice()))
    throw new Error('Run exit Alice and verify the finalized 1.11 USDC eATA before withdrawal.');
  if (state.alicePublicBefore === undefined) {
    state.alicePublicBefore = await balance('Alice', base); save();
  }
  const owner = wallet('Alice');
  const ixs = state.receipts['Withdraw USDC Alice'] ? [] : await mb.withdrawSpl(owner.publicKey, MINT,
    AMOUNTS.Alice, { idempotent: false });
  const signature = await sendOnce('Withdraw USDC Alice', base, ixs, [owner]);
  const result = await status(base, signature);
  const current = await balance('Alice', base);
  if (result?.err || BigInt(current) - BigInt(state.alicePublicBefore) !== AMOUNTS.Alice)
    throw new Error(`Public credit not verified. Signature ${signature}; check the same command later.`);
  const parsed = await base.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const instructions = [ ...(parsed?.transaction.message.instructions || []),
    ...(parsed?.meta?.innerInstructions || []).flatMap(entry => entry.instructions) ];
  const visible = instructions.filter(ix => ix.parsed?.type === 'transferChecked'
    && ix.parsed.info?.destination === ata('Alice').toBase58()
    && ix.parsed.info?.mint === MINT.toBase58())
    .map(ix => ({ destination: ix.parsed.info.destination, amount: ix.parsed.info.tokenAmount?.uiAmountString }));
  console.log(`Alice's ordinary public ATA: ${amount(current)} USDC. Withdrawal: ${signature}`);
  console.log('Public transferChecked instruction(s):', visible.length ? visible : 'not returned by RPC; public ATA credit still observed');
  await readView('public');
}

const [command, name] = process.argv.slice(2);
let lock;
try {
  if (!['check', 'prepare', 'pay', 'read', 'exit', 'withdraw'].includes(command))
    throw new Error('Use: check | prepare | pay | read public|unauth|company|Alice|Bob|Carol|outsider | exit Alice | withdraw Alice');
  if (command === 'read' && !['public', 'unauth', 'company', ...NAMES, 'outsider'].includes(name))
    throw new Error('Choose: public, unauth, company, Alice, Bob, Carol, outsider.');
  if (['exit', 'withdraw'].includes(command) && name !== 'Alice') throw new Error('Only Alice exits in this USDC repeat.');
  if (command !== 'check') {
    fs.mkdirSync('.lab', { recursive: true, mode: 0o700 });
    lock = fs.openSync('.lab/usdc-privacy.lock', 'wx', 0o600);
  }
  await check();
  if (command === 'prepare') await prepare();
  if (command === 'pay') await pay();
  if (command === 'read') await readView(name);
  if (command === 'exit') await exitAlice();
  if (command === 'withdraw') await withdrawAlice();
} catch (e) {
  console.error(clean(e));
  if (e.code === 'EEXIST') console.error('A USDC demo run or stale lock exists. Check for a running process first.');
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync('.lab/usdc-privacy.lock'); }
}
