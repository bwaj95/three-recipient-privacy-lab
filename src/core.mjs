import { createHash, sign, verify } from 'node:crypto';

export const RECIPIENTS = [
  { name: 'Alice', amount: '1110000' },
  { name: 'Bob', amount: '2220000' },
  { name: 'Carol', amount: '3330000' },
];
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// Application model only. A wallet owner can bypass this model on chain.
export function paymentMessage(p) {
  for (const key of ['id', 'vault', 'mint', 'recipient', 'amount', 'salt']) {
    if (typeof p[key] !== 'string' || !p[key]) throw new Error(`Invalid ${key}`);
  }
  if (!/^[1-9][0-9]*$/.test(p.amount) || BigInt(p.amount) > 0xffffffffffffffffn)
    throw new Error('Amount must be a positive u64 in base units');
  if (!/^[0-9a-f]{64}$/.test(p.salt)) throw new Error('Use a random 32-byte salt');
  if (!Number.isSafeInteger(p.revision) || p.revision < 0) throw new Error('Invalid revision');
  return Buffer.from(JSON.stringify([
    'turbin3-private-payroll-lab/v1', 'devnet', p.id, p.revision,
    p.vault, p.mint, p.recipient, p.amount, 'private', p.salt,
  ]));
}

export function commitment(p) {
  return createHash('sha256').update(paymentMessage(p)).digest('hex');
}

export function approve(p, signerId, privateKey) {
  return { signerId, signature: sign(null, paymentMessage(p), privateKey).toString('base64') };
}

export function requireApprovals(p, approvals, authorized, threshold = 2) {
  const keys = Object.values(authorized);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > keys.length)
    throw new Error('Invalid approval threshold');
  const unique = new Set();
  const uniqueKeys = new Set();
  for (const a of approvals) {
    const key = authorized[a.signerId];
    if (!key) throw new Error('Unauthorized approver');
    if (unique.has(a.signerId) || uniqueKeys.has(key)) throw new Error('Duplicate approver');
    if (!verify(null, paymentMessage(p), key, Buffer.from(a.signature, 'base64')))
      throw new Error('Approval does not match current payment');
    unique.add(a.signerId);
    uniqueKeys.add(key);
  }
  if (unique.size < threshold) throw new Error('More approvals required');
  return true;
}

export function changeRecipient(p, recipient) {
  if (p.attempt || p.status === 'paid') throw new Error('Resolve the existing payment first');
  return { ...p, recipient, revision: p.revision + 1, approvals: [], status: 'draft' };
}

// Persist the signed transaction before submitting it. A crash between persistence
// and submission must remain recoverable by inspecting/re-sending these SAME bytes.
export function startAttempt(p, signedAttempt) {
  if (p.status !== 'approved' || p.attempt) throw new Error('Payment cannot be resubmitted');
  if (!signedAttempt.signature || !signedAttempt.bytes || !signedAttempt.blockhash)
    throw new Error('Persist a complete signed attempt');
  if (signedAttempt.paymentCommitment !== commitment(p)) throw new Error('Attempt binding mismatch');
  return { ...p, status: 'processing', attempt: signedAttempt };
}

// Status of submission alone never proves delivery. Exact balance deltas are a
// controlled-fixture check, not a production reconciliation design.
export function reconcilePayment(p, observation) {
  if (!p.attempt) throw new Error('Missing payment attempt');
  if (p.status === 'paid') return p;
  const { tx, delta, transactionMatches, baseCommitFinalized } = observation;
  if (tx?.err != null) return { ...p, status: 'failed', failure: 'chain-error' };
  const confirmed = tx && ['confirmed', 'finalized'].includes(tx.confirmationStatus);
  if (confirmed && transactionMatches && delta === p.amount) {
    if (!baseCommitFinalized) return { ...p, status: 'credited_in_per' };
    return { ...p, status: 'paid' };
  }
  return { ...p, status: 'processing' };
}

export function pendingReserve(payments) {
  return payments.filter(p => !['paid', 'failed', 'cancelled'].includes(p.status))
    .reduce((sum, p) => sum + BigInt(p.amount), 0n);
}

export function assertDevnet(genesis) {
  if (genesis !== DEVNET_GENESIS) throw new Error('Refusing a non-devnet Solana connection');
}

// Exact source layout: owner[32], mint[32], little-endian u64 amount[8].
// A readable account can hold stale state. Record its slot and delegation status.
export function decodeEataBytes(data, expectedOwner, expectedMint) {
  if (data.length !== 72) return { classification: 'unrecognized-layout', length: data.length };
  if (!data.subarray(0, 32).equals(expectedOwner) || !data.subarray(32, 64).equals(expectedMint))
    return { classification: 'unexpected-owner-or-mint' };
  return { classification: 'readable-balance', amount: data.readBigUInt64LE(64).toString() };
}

export function classifyRead({ error, account, decoded }) {
  if (error) return { classification: 'request-error', detail: error };
  if (!account) return { classification: 'absent-or-filtered' };
  return decoded;
}

export function b58encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const b of bytes) value = value * 256n + BigInt(b);
  let out = '';
  while (value > 0n) { out = alphabet[Number(value % 58n)] + out; value /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
