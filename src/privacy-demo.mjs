// privacy-demo.mjs
// Run from the existing three-recipient-privacy-lab folder.
//
// Commands:
//   node privacy-demo.mjs check
//   node privacy-demo.mjs prepare
//   node privacy-demo.mjs send Alice
//   node privacy-demo.mjs read Alice
//   node privacy-demo.mjs exit Alice
//
// Recipients: Alice, Bob, Carol.
// Readers: Alice, Bob, Carol, outsider, public, unauth.

import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import * as mb from '@magicblock-labs/ephemeral-rollups-sdk';

const RPC =
  process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';

const PER = 'https://devnet-tee.magicblock.app';

const GENESIS =
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const VALIDATOR = new PublicKey(
  'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo',
);

const AMOUNTS = {
  Alice: 1_110_000n,
  Bob: 2_220_000n,
  Carol: 3_330_000n,
};

const NAMES = Object.keys(AMOUNTS);
const FILE = '.lab/privacy-demo.json';

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const clean = error =>
  String(error.message || error)
    .replace(/https?:\/\/\S+/g, '[endpoint]')
    .slice(0, 400);

const read = file =>
  fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : undefined;

const showAmount = value =>
  `${BigInt(value) / 1_000_000n}.${(
    BigInt(value) % 1_000_000n
  )
    .toString()
    .padStart(6, '0')}`;

let state = read(FILE);
let nextRequest = 0;

// Space out requests and retry rate-limit responses.
const originalFetch = globalThis.fetch;

async function pacedFetch(url, options = {}) {
  let method = 'authentication';

  if (typeof options.body === 'string') {
    try {
      method = JSON.parse(options.body).method || 'authentication';
    } catch {
      method = 'HTTP';
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 1600;

    const response = await originalFetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15000),
    });

    const body = await response
      .clone()
      .json()
      .catch(() => null);

    if (response.status !== 429 && body?.error?.code !== 429) {
      return response;
    }

    if (attempt === 2) {
      throw new Error(
        `${method}: RPC still rate-limited. Pause; use a devnet RPC via SOLANA_DEVNET_RPC if needed.`,
      );
    }

    const seconds = Math.min(
      30,
      Math.max(
        10 * (attempt + 1),
        Number(response.headers.get('retry-after')) || 0,
      ),
    );

    console.log(
      `${method}: rate-limited; waiting ${seconds}s before retrying the same request.`,
    );

    await response.arrayBuffer();
    await sleep(seconds * 1000);
  }
}

globalThis.fetch = pacedFetch;

const connection = url =>
  new Connection(url, {
    commitment: 'confirmed',
    fetch: pacedFetch,
    disableRetryOnRateLimit: true,
  });

const base = connection(RPC);

// Reuse the company wallet from the previous experiment.
const company = () =>
  Keypair.fromSecretKey(
    Uint8Array.from(
      state?.keys.company ||
        read('.lab/state.json')?.chainKeys?.company ||
        [],
    ),
  );

const key = name =>
  name === 'company'
    ? company()
    : Keypair.fromSecretKey(
        Uint8Array.from(state.keys[name]),
      );

const mint = () => key('mint').publicKey;

const ata = name =>
  spl.getAssociatedTokenAddressSync(
    mint(),
    key(name).publicKey,
  );

const eata = name =>
  mb.deriveEphemeralAta(
    key(name).publicKey,
    mint(),
  )[0];

function save() {
  fs.mkdirSync('.lab', {
    recursive: true,
    mode: 0o700,
  });

  fs.writeFileSync(
    `${FILE}.tmp`,
    JSON.stringify(state, null, 2),
    { mode: 0o600 },
  );

  fs.renameSync(`${FILE}.tmp`, FILE);
}

// Authenticate as a particular wallet.
const sessions = new Map();

async function asOwner(name) {
  if (!sessions.has(name)) {
    const wallet = key(name);

    const privateKey = createPrivateKey({
      format: 'der',
      type: 'pkcs8',
      key: Buffer.concat([
        Buffer.from(
          '302e020100300506032b657004220420',
          'hex',
        ),
        Buffer.from(wallet.secretKey).subarray(0, 32),
      ]),
    });

    const { token } = await mb.getAuthToken(
      PER,
      wallet.publicKey,
      async bytes =>
        new Uint8Array(sign(null, bytes, privateKey)),
    );

    sessions.set(
      name,
      connection(
        `${PER}?token=${encodeURIComponent(token)}`,
      ),
    );
  }

  return sessions.get(name);
}

const balance = async (name, rpc) =>
  (await rpc.getTokenAccountBalance(ata(name)))
    .value.amount;

const status = async (rpc, signature) =>
  (
    await rpc.getSignatureStatuses(
      [signature],
      { searchTransactionHistory: true },
    )
  ).value[0];

function base58(bytes) {
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  let n = BigInt(
    `0x${Buffer.from(bytes).toString('hex')}`,
  );

  let result = '';

  while (n) {
    result = alphabet[Number(n % 58n)] + result;
    n /= 58n;
  }

  for (const byte of bytes) {
    if (byte) break;
    result = '1' + result;
  }

  return result;
}

// Retain signed transactions so a retry reuses the same transaction.
async function sendOnce(
  label,
  rpc,
  instructions,
  signers,
) {
  console.log(label);

  let receipt = state.receipts[label];

  if (receipt?.confirmed) {
    return receipt.signature;
  }

  if (!receipt) {
    const latest = await rpc.getLatestBlockhash();

    const tx = new Transaction({
      feePayer: signers[0].publicKey,
      ...latest,
    }).add(...instructions);

    tx.sign(...signers);

    receipt = state.receipts[label] = {
      signature: base58(tx.signature),
      bytes: tx.serialize().toString('base64'),
      ...latest,
    };

    save();
  }

  let current = await status(rpc, receipt.signature);

  if (current?.err) {
    throw new Error(
      `${label}: transaction failed: ${JSON.stringify(current.err)}`,
    );
  }

  if (
    !['confirmed', 'finalized'].includes(
      current?.confirmationStatus,
    )
  ) {
    if (
      (await rpc.getBlockHeight()) >
      receipt.lastValidBlockHeight
    ) {
      throw new Error(
        `${label}: saved transaction expired; outcome needs review. Signature: ${receipt.signature}`,
      );
    }

    await rpc.sendRawTransaction(
      Buffer.from(receipt.bytes, 'base64'),
      {
        skipPreflight: false,
        maxRetries: 0,
      },
    );

    for (let n = 0; n < 8; n++) {
      await sleep(3000);

      current = await status(
        rpc,
        receipt.signature,
      );

      if (current?.err) {
        throw new Error(
          `${label}: transaction failed: ${JSON.stringify(current.err)}`,
        );
      }

      if (
        ['confirmed', 'finalized'].includes(
          current?.confirmationStatus,
        )
      ) {
        break;
      }
    }
  }

  if (
    !['confirmed', 'finalized'].includes(
      current?.confirmationStatus,
    )
  ) {
    throw new Error(
      `${label}: confirmation unknown. Keep the state file and rerun this same command. Signature: ${receipt.signature}`,
    );
  }

  receipt.confirmed = true;
  save();

  console.log(`  Confirmed: ${receipt.signature}`);

  return receipt.signature;
}

// STEP 1: Read-only connectivity and funding check.
async function check() {
  console.log(
    `Existing test wallet: ${company().publicKey.toBase58()}`,
  );

  console.log('Checking Solana devnet...');

  if ((await base.getGenesisHash()) !== GENESIS) {
    throw new Error(
      'The Solana endpoint is not the expected devnet.',
    );
  }

  console.log(
    `Devnet SOL: ${
      (await base.getBalance(company().publicKey)) /
      1e9
    }`,
  );

  console.log('Checking MagicBlock validator...');

  const response = await pacedFetch(PER, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getIdentity',
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `PER identity request failed: ${
        data.error?.message || response.status
      }`,
    );
  }

  if (
    data.result?.identity !==
    VALIDATOR.toBase58()
  ) {
    throw new Error(
      'PER validator identity differs from the reviewed endpoint.',
    );
  }

  console.log(
    'Check complete. No blockchain writes were made by this command.',
  );
}

// STEP 2: Create test tokens and private balances.
async function prepare() {
  if (state?.ready) {
    console.log(
      'Test balances are already prepared.',
    );
    return;
  }

  if (!state) {
    state = {
      keys: {
        company: [...company().secretKey],
      },
      receipts: {},
      views: {},
    };

    for (const name of [
      'mint',
      ...NAMES,
      'outsider',
    ]) {
      state.keys[name] = [
        ...Keypair.generate().secretKey,
      ];
    }

    save();
  }

  const payer = company();

  if (
    (await base.getBalance(payer.publicKey)) <
    300_000_000
  ) {
    throw new Error(
      `Fund ${payer.publicKey.toBase58()} with devnet SOL; prepare requires at least 0.3 SOL.`,
    );
  }

  const rentSponsor = mb.deriveRentPda()[0];

  const rentShortfall = Math.max(
    0,
    50_000_000 -
      (await base.getBalance(rentSponsor)),
  );

  const instructions = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint(),
      lamports:
        await base.getMinimumBalanceForRentExemption(
          spl.MINT_SIZE,
        ),
      space: spl.MINT_SIZE,
      programId: spl.TOKEN_PROGRAM_ID,
    }),

    spl.createInitializeMint2Instruction(
      mint(),
      6,
      payer.publicKey,
      null,
    ),

    ...['company', ...NAMES].map(name =>
      spl.createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        ata(name),
        key(name).publicKey,
        mint(),
      ),
    ),

    spl.createMintToInstruction(
      mint(),
      ata('company'),
      payer.publicKey,
      10_000_000n,
    ),

    ...NAMES.map(name =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: key(name).publicKey,
        lamports: 20_000_000,
      }),
    ),
  ];

  if (rentShortfall) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: rentSponsor,
        lamports: rentShortfall,
      }),
    );
  }

  await sendOnce(
    'Create test token and accounts',
    base,
    instructions,
    [payer, key('mint')],
  );

  for (const name of ['company', ...NAMES]) {
    const amount =
      name === 'company' ? 10_000_000n : 0n;

    const ixs = await mb.delegateSpl(
      key(name).publicKey,
      mint(),
      amount,
      {
        payer: payer.publicKey,
        validator: VALIDATOR,
        idempotent: false,
        private: true,
        initIfMissing: true,
        initVaultIfMissing:
          name === 'company',
      },
    );

    await sendOnce(
      `Prepare private balance: ${name}`,
      base,
      ixs,
      name === 'company'
        ? [payer]
        : [payer, key(name)],
    );

    const rpc = await asOwner(name);

    let value;
    let lastError;

    for (let n = 0; n < 6; n++) {
      try {
        value = await balance(name, rpc);

        if (value === amount.toString()) {
          break;
        }
      } catch (error) {
        lastError = clean(error);
      }

      await sleep(3000);
    }

    if (value !== amount.toString()) {
      throw new Error(
        `${name}: own PER balance is not ready (${
          lastError || value
        }). Rerun prepare later.`,
      );
    }

    console.log(
      `  ${name} reads own balance: ${showAmount(value)} TEST`,
    );
  }

  state.ready = true;
  save();

  console.log(
    'Prepared: company 10 TEST; Alice/Bob/Carol 0. Next: send Alice.',
  );
}

// STEP 3: Send to one recipient and check their balance.
async function transfer(name) {
  const rpc = await asOwner('company');

  const ixs = await mb.transferSpl(
    company().publicKey,
    key(name).publicKey,
    mint(),
    AMOUNTS[name],
    {
      visibility: 'private',
      fromBalance: 'ephemeral',
      toBalance: 'ephemeral',
      validator: VALIDATOR,
    },
  );

  await sendOnce(
    `Send to ${name}`,
    rpc,
    ixs,
    [company()],
  );

  const received = await balance(
    name,
    await asOwner(name),
  );

  if (received !== AMOUNTS[name].toString()) {
    throw new Error(
      `${name}: expected ${AMOUNTS[name]}, observed ${received} base units. Credit not verified.`,
    );
  }

  console.log(
    `${name} received ${showAmount(received)} TEST in the PER.`,
  );

  console.log(
    `Company PER balance: ${showAmount(
      await balance('company', rpc),
    )} TEST`,
  );

  console.log(
    'Delivery checked. Privacy is assessed separately with read.',
  );
}

// STEP 4: Read the same balances and transactions as a chosen observer.
async function visibility(viewer) {
  const rpc =
    viewer === 'public'
      ? base
      : viewer === 'unauth'
        ? connection(PER)
        : await asOwner(viewer);

  const rows = [];

  for (const name of NAMES) {
    const row = {
      recipient: name,
      SPL_balance: 'not read',
      eATA_balance: 'not read',
      payment_receipt: 'not sent',
      errors: [],
    };

    try {
      row.SPL_balance = showAmount(
        await balance(name, rpc),
      );
    } catch (error) {
      row.errors.push(`SPL: ${clean(error)}`);
    }

    try {
      const { context, value } =
        await rpc.getAccountInfoAndContext(
          eata(name),
        );

      row.slot = context.slot;
      row.accountProgram =
        value?.owner.toBase58();

      const bytes = value?.data;

      if (
        [72, 80].includes(bytes?.length) &&
        bytes
          .subarray(0, 32)
          .equals(key(name).publicKey.toBuffer()) &&
        bytes
          .subarray(32, 64)
          .equals(mint().toBuffer())
      ) {
        row.eATA_balance = showAmount(
          bytes.readBigUInt64LE(64),
        );
      } else {
        row.eATA_balance = value
          ? 'other layout'
          : 'absent or filtered';
      }
    } catch (error) {
      row.errors.push(`eATA: ${clean(error)}`);
    }

    const receipt =
      state.receipts[`Send to ${name}`];

    if (receipt) {
      try {
        const tx = await rpc.getTransaction(
          receipt.signature,
          {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          },
        );

        row.payment_receipt = tx
          ? 'READABLE'
          : 'absent or filtered';

        if (tx) {
          row.messageBase64 = Buffer.from(
            tx.transaction.message.serialize(),
          ).toString('base64');
        }
      } catch (error) {
        row.payment_receipt = 'request error';
        row.errors.push(
          `Transaction: ${clean(error)}`,
        );
      }
    }

    rows.push(row);
  }

  console.log(`View as ${viewer}:`);

  console.table(
    rows.map(
      ({
        recipient,
        SPL_balance,
        eATA_balance,
        payment_receipt,
      }) => ({
        recipient,
        SPL_balance,
        eATA_balance,
        payment_receipt,
      }),
    ),
  );

  for (const row of rows) {
    for (const error of row.errors) {
      console.log(
        `${row.recipient}: ${error}`,
      );
    }
  }

  const snapshot = {
    at: new Date().toISOString(),
    viewer,
    rows,
  };

  state.views[viewer] ||= [];
  state.views[viewer].push(snapshot);
  save();

  fs.mkdirSync('reports', {
    recursive: true,
  });

  fs.writeFileSync(
    'reports/privacy-demo.json',
    JSON.stringify(
      {
        mint: mint().toBase58(),
        views: state.views,
        scope:
          'Synthetic token experiment. Shared setup payer exposes wallet associations. Base eATA balances can be stale while delegated. Missing data/errors are inconclusive; use an owner read as positive control. No overall privacy PASS is asserted.',
      },
      null,
      2,
    ),
  );

  console.log(
    'Saved reports/privacy-demo.json. Errors and missing data do not prove privacy.',
  );
}

// STEP 5: Withdraw to ordinary Solana accounts after reviewing privacy.
async function exitToSolana(name) {
  const ownerRpc = await asOwner(name);
  const owner = key(name);

  const sent =
    state.receipts[`Send to ${name}`];

  if (!sent?.confirmed) {
    throw new Error(
      'Complete the private transfer first.',
    );
  }

  const sig = await sendOnce(
    `Undelegate ${name}`,
    ownerRpc,
    [
      mb.undelegateIx(
        owner.publicKey,
        mint(),
      ),
    ],
    [owner],
  );

  async function signatureFromLogs(
    signature,
    prefix,
  ) {
    for (let n = 0; n < 8; n++) {
      const tx = await ownerRpc.getTransaction(
        signature,
        {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        },
      );

      if (tx?.meta?.err) {
        throw new Error(
          'Commit scheduling transaction failed.',
        );
      }

      const found = tx?.meta?.logMessages
        ?.find(line => line.includes(prefix))
        ?.split(prefix)[1]
        ?.trim();

      if (found) return found;

      await sleep(3000);
    }

    throw new Error(
      'Commit receipt not available yet; rerun this exit command.',
    );
  }

  const eTokenProgram = new PublicKey(
    'SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2'
  );
  const publicEataInfo = await base.getAccountInfo(eata(name));
  const alreadyCommittedAndUndelegated =
    publicEataInfo?.owner.equals(eTokenProgram);

  state.commits ||= {};

  if (!alreadyCommittedAndUndelegated && !state.commits[name]) {
    const scheduled = await signatureFromLogs(
      sig,
      'ScheduledCommitSent signature: ',
    );

    state.commits[name] =
      await signatureFromLogs(
        scheduled,
        'ScheduledCommitSent signature[0]: ',
      );

    save();
  }

  let finalized = alreadyCommittedAndUndelegated;

  for (let n = 0; !finalized && n < 12; n++) {
    const current = await status(
      base,
      state.commits[name],
    );

    if (current?.err) {
      throw new Error(
        'Base commitment failed.',
      );
    }

    if (
      current?.confirmationStatus ===
      'finalized'
    ) {
      finalized = true;
      break;
    }

    await sleep(3000);
  }

  if (!finalized) {
    throw new Error(
      'Commit not finalized yet; rerun the exit command.',
    );
  }

  console.log(
    'Committed back to Solana. Capture public visibility before withdrawal:',
  );

  await visibility('public');

  const ixs = await mb.withdrawSpl(
    owner.publicKey,
    mint(),
    AMOUNTS[name],
    { idempotent: false },
  );

  await sendOnce(
    `Withdraw ${name}`,
    base,
    ixs,
    [owner],
  );

  const publicBalance = await balance(
    name,
    base,
  );

  if (
    publicBalance !== AMOUNTS[name].toString()
  ) {
    throw new Error(
      `${name}: public withdrawal credit does not match the expected amount yet.`,
    );
  }

  console.log(
    `Public ${name} balance: ${showAmount(publicBalance)} TEST (confirmed withdrawal)`,
  );

  console.log(
    'This ordinary withdrawal exposes the destination and amount on Solana.',
  );
}

// Command entry point.
const [command, name] =
  process.argv.slice(2);

let lock;

try {
  if (
    ![
      'check',
      'prepare',
      'send',
      'read',
      'exit',
    ].includes(command)
  ) {
    throw new Error(
      'Use: check | prepare | send Alice|Bob|Carol | read Alice|Bob|Carol|outsider|public|unauth | exit Alice',
    );
  }

  if (
    ['send', 'exit'].includes(command) &&
    !NAMES.includes(name)
  ) {
    throw new Error(
      'Choose Alice, Bob, or Carol.',
    );
  }

  if (
    command === 'read' &&
    ![
      ...NAMES,
      'outsider',
      'public',
      'unauth',
    ].includes(name)
  ) {
    throw new Error(
      'Choose a reader: Alice, Bob, Carol, outsider, public, or unauth.',
    );
  }

  if (command !== 'check') {
    fs.mkdirSync('.lab', {
      recursive: true,
      mode: 0o700,
    });

    lock = fs.openSync(
      '.lab/privacy-demo.lock',
      'wx',
      0o600,
    );
  }

  await check();

  if (
    ['send', 'read', 'exit'].includes(
      command,
    ) &&
    !state?.ready
  ) {
    throw new Error('Run prepare first.');
  }

  if (command === 'prepare') {
    await prepare();
  }

  if (command === 'send') {
    await transfer(name);
  }

  if (command === 'read') {
    await visibility(name);
  }

  if (command === 'exit') {
    await exitToSolana(name);
  }
} catch (error) {
  console.error(clean(error));

  if (error.code === 'EEXIST') {
    console.error(
      'A demo runner or stale lock exists. Check for a running instance before removing the lock.',
    );
  }

  process.exitCode = 1;
} finally {
  if (lock !== undefined) {
    fs.closeSync(lock);
    fs.unlinkSync('.lab/privacy-demo.lock');
  }
}