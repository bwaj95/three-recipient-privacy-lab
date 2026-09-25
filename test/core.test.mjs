import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  approve, requireApprovals, commitment, changeRecipient, startAttempt,
  reconcilePayment, pendingReserve, assertDevnet, DEVNET_GENESIS,
  decodeEataBytes, classifyRead, b58encode,
} from '../src/core.mjs';

function fixture() {
  const a = generateKeyPairSync('ed25519');
  const b = generateKeyPairSync('ed25519');
  const key = x => x.publicKey.export({ type: 'spki', format: 'pem' });
  const p = { id: 'alice-september', vault: 'test-company', mint: 'test-mint', recipient: 'alice-wallet-1', amount: '1110000', salt: 'ab'.repeat(32), revision: 0, status: 'approved' };
  const approvals = [approve(p, 'finance', a.privateKey), approve(p, 'manager', b.privateKey)];
  const authorized = { finance: key(a), manager: key(b) };
  return { p, approvals, authorized, a, b };
}
function attempted(p) {
  return startAttempt(p, { signature: 'fixture-signature-not-on-chain', bytes: 'fixture', blockhash: 'fixture-blockhash', paymentCommitment: commitment(p) });
}

test('two different authorized signatures approve the exact payment', () => {
  const { p, approvals, authorized } = fixture();
  assert.equal(requireApprovals(p, approvals, authorized), true);
});
test('one signature and duplicate signatures cannot meet the threshold', () => {
  const { p, approvals, authorized } = fixture();
  assert.throws(() => requireApprovals(p, approvals.slice(0, 1), authorized), /More approvals/);
  assert.throws(() => requireApprovals(p, [approvals[0], approvals[0]], authorized), /Duplicate/);
});
test('unknown signer cannot authorize a payout', () => {
  const { p, approvals, authorized } = fixture();
  assert.throws(() => requireApprovals(p, [{ ...approvals[0], signerId: 'attacker' }, approvals[1]], authorized), /Unauthorized/);
});
test('recipient, amount, mint, vault, revision, and ID changes invalidate approval', () => {
  const { p, approvals, authorized } = fixture();
  for (const [key, value] of Object.entries({ recipient: 'wallet-2', amount: '9999999', mint: 'wrong-token', vault: 'another-vault', revision: 1, id: 'replay-id' })) {
    assert.throws(() => requireApprovals({ ...p, [key]: value }, approvals, authorized), /does not match/);
  }
});
test('wallet rotation removes approvals and increments revision', () => {
  const { p, approvals } = fixture();
  const next = changeRecipient({ ...p, approvals }, 'new-wallet');
  assert.deepEqual(next.approvals, []);
  assert.equal(next.status, 'draft');
  assert.equal(next.revision, 1);
});
test('unknown delivery blocks rotation and any second payment attempt', () => {
  const p = attempted(fixture().p);
  assert.throws(() => startAttempt(p, p.attempt), /cannot be resubmitted/);
  assert.throws(() => changeRecipient(p, 'new-wallet'), /Resolve/);
});
test('timeout or absent status retains processing and reserved funds', () => {
  const p = attempted(fixture().p);
  const after = reconcilePayment(p, { tx: null, delta: '0' });
  assert.equal(after.status, 'processing');
  assert.equal(pendingReserve([after]), 1110000n);
});
test('transaction confirmation without recipient evidence never marks paid', () => {
  const p = attempted(fixture().p);
  const tx = { err: null, confirmationStatus: 'finalized' };
  assert.equal(reconcilePayment(p, { tx, delta: '0', transactionMatches: true, baseCommitFinalized: true }).status, 'processing');
  assert.equal(reconcilePayment(p, { tx, delta: p.amount, transactionMatches: false, baseCommitFinalized: true }).status, 'processing');
});
test('PER credit remains distinct from verified base-chain settlement', () => {
  const p = attempted(fixture().p);
  const observation = { tx: { err: null, confirmationStatus: 'confirmed' }, delta: p.amount, transactionMatches: true };
  const credited = reconcilePayment(p, observation);
  assert.equal(credited.status, 'credited_in_per');
  assert.equal(pendingReserve([credited]), 1110000n);
  assert.equal(reconcilePayment(credited, { ...observation, baseCommitFinalized: true }).status, 'paid');
});
test('one recipient failure does not undo the other recipients', () => {
  const base = fixture().p;
  const ps = [base, { ...base, id: 'bob', amount: '2220000' }, { ...base, id: 'carol', amount: '3330000' }].map(attempted);
  const outcomes = ps.map((p, i) => reconcilePayment(p, {
    tx: { err: i === 1 ? { InstructionError: [0, 'Custom'] } : null, confirmationStatus: 'finalized' },
    delta: i === 1 ? '0' : p.amount, transactionMatches: true, baseCommitFinalized: true,
  }));
  assert.deepEqual(outcomes.map(p => p.status), ['paid', 'failed', 'paid']);
});
test('invalid amounts are rejected before signing', () => {
  const { p } = fixture();
  for (const amount of ['0', '-1', '1.11', '01', '18446744073709551616'])
    assert.throws(() => commitment({ ...p, amount }), /positive u64/);
});
test('different salts avoid deterministic salary commitments', () => {
  const { p } = fixture();
  assert.notEqual(commitment(p), commitment({ ...p, salt: 'cd'.repeat(32) }));
});
test('network guard rejects mainnet and arbitrary genesis values', () => {
  assertDevnet(DEVNET_GENESIS);
  assert.throws(() => assertDevnet('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), /non-devnet/);
  assert.throws(() => assertDevnet(undefined), /non-devnet/);
});
test('public readable eATA bytes reveal the amount in a synthetic fixture', () => {
  const owner = Buffer.alloc(32, 1), mint = Buffer.alloc(32, 2);
  const bytes = Buffer.concat([owner, mint, Buffer.alloc(8)]);
  bytes.writeBigUInt64LE(1110000n, 64);
  assert.deepEqual(decodeEataBytes(bytes, owner, mint), { classification: 'readable-balance', amount: '1110000' });
  assert.equal(decodeEataBytes(bytes, mint, owner).classification, 'unexpected-owner-or-mint');
});
test('RPC failures and absent accounts are never counted as proof of privacy', () => {
  assert.equal(classifyRead({ error: 'timeout' }).classification, 'request-error');
  assert.equal(classifyRead({ account: null }).classification, 'absent-or-filtered');
});
test('base58 encoder preserves leading zeros and a known one-byte vector', () => {
  assert.equal(b58encode(Buffer.from([0, 0, 1])), '112');
  assert.equal(b58encode(Buffer.from([57])), 'z');
});
