import { createHash, randomBytes } from "node:crypto";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo",
);
export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
export const EPHEMERAL_SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
);
export const DEVNET_TEE_VALIDATOR = new PublicKey(
  "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const EPHEMERAL_VAULT_ID = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);

export const COMPANY_VAULT_SEED = Buffer.from("company_vault");
export const PAYMENT_INTENT_SEED = Buffer.from("payment_intent");
export const PAYMENT_RECEIPT_SEED = Buffer.from("payment_receipt");
export const PERMISSION_SEED = Buffer.from("permission:");
export const INTENT_HASH_DOMAIN = Buffer.from(
  "pda-custody-private-payment-v1",
);

export const INTENT_PENDING = 0;
export const INTENT_APPROVED = 1;
export const INTENT_EXECUTED = 2;
export const RECEIPT_INITIALIZED = 0;
export const RECEIPT_PAID = 1;
export const APPROVAL_THRESHOLD = 2;

export class ModelError extends Error {
  constructor(code) {
    super(code);
    this.name = "ModelError";
    this.code = code;
  }
}

function fail(code) {
  throw new ModelError(code);
}

function asPublicKey(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function u64Le(value) {
  const number = BigInt(value);
  if (number < 0n || number > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("u64 out of range");
  }
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(number);
  return buffer;
}

export function randomPaymentId() {
  let paymentId;
  do {
    paymentId = randomBytes(32);
  } while (paymentId.equals(Buffer.alloc(32)));
  return paymentId;
}

export function normalizePaymentId(paymentId) {
  const bytes = Buffer.isBuffer(paymentId)
    ? Buffer.from(paymentId)
    : Buffer.from(paymentId, "hex");
  if (bytes.length !== 32 || bytes.equals(Buffer.alloc(32))) {
    fail("WrongPaymentId");
  }
  return bytes;
}

export function deriveEata(owner, mint = DEVNET_USDC_MINT) {
  return PublicKey.findProgramAddressSync(
    [asPublicKey(owner).toBuffer(), asPublicKey(mint).toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  )[0];
}

export function deriveGlobalVault(mint = DEVNET_USDC_MINT) {
  return PublicKey.findProgramAddressSync(
    [asPublicKey(mint).toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  )[0];
}

export function derivePermission(account) {
  return PublicKey.findProgramAddressSync(
    [PERMISSION_SEED, asPublicKey(account).toBuffer()],
    PERMISSION_PROGRAM_ID,
  )[0];
}

export function deriveDelegationAccounts(account, ownerProgram) {
  const delegatedAccount = asPublicKey(account);
  return {
    buffer: PublicKey.findProgramAddressSync(
      [Buffer.from("buffer"), delegatedAccount.toBuffer()],
      asPublicKey(ownerProgram),
    )[0],
    record: PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), delegatedAccount.toBuffer()],
      DELEGATION_PROGRAM_ID,
    )[0],
    metadata: PublicKey.findProgramAddressSync(
      [Buffer.from("delegation-metadata"), delegatedAccount.toBuffer()],
      DELEGATION_PROGRAM_ID,
    )[0],
  };
}

export function derivePaymentAccounts({ company, recipient, paymentId }) {
  const companyKey = asPublicKey(company);
  const recipientKey = asPublicKey(recipient);
  const paymentIdBytes = normalizePaymentId(paymentId);
  const [vault, vaultBump] = PublicKey.findProgramAddressSync(
    [COMPANY_VAULT_SEED, companyKey.toBuffer()],
    PROGRAM_ID,
  );
  const [intent, intentBump] = PublicKey.findProgramAddressSync(
    [PAYMENT_INTENT_SEED, vault.toBuffer(), paymentIdBytes],
    PROGRAM_ID,
  );
  const [receipt, receiptBump] = PublicKey.findProgramAddressSync(
    [PAYMENT_RECEIPT_SEED, vault.toBuffer(), paymentIdBytes],
    PROGRAM_ID,
  );
  const sourceEata = deriveEata(vault);
  const destinationEata = deriveEata(recipientKey);
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    vault,
    true,
  );
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    recipientKey,
  );
  const globalVault = deriveGlobalVault();
  const globalVaultEata = deriveEata(globalVault);
  const globalVaultTokenAccount = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    globalVault,
    true,
  );

  return {
    vault,
    vaultBump,
    intent,
    intentBump,
    receipt,
    receiptBump,
    sourceEata,
    destinationEata,
    sourceTokenAccount,
    destinationTokenAccount,
    globalVault,
    globalVaultEata,
    globalVaultTokenAccount,
    custodyEataPermission: derivePermission(sourceEata),
    vaultPermission: derivePermission(vault),
    intentPermission: derivePermission(intent),
    receiptPermission: derivePermission(receipt),
    custodyEataDelegation: deriveDelegationAccounts(
      sourceEata,
      EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    ),
    globalVaultEataDelegation: deriveDelegationAccounts(
      globalVaultEata,
      EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    ),
    vaultDelegation: deriveDelegationAccounts(vault, PROGRAM_ID),
    intentDelegation: deriveDelegationAccounts(intent, PROGRAM_ID),
    receiptDelegation: deriveDelegationAccounts(receipt, PROGRAM_ID),
  };
}

export function paymentIntentHash({
  vault,
  paymentId,
  mint = DEVNET_USDC_MINT,
  recipient,
  sourceEata,
  destinationEata,
  sourceTokenAccount,
  destinationTokenAccount,
  amount,
  walletRevision,
}) {
  return createHash("sha256")
    .update(INTENT_HASH_DOMAIN)
    .update(PROGRAM_ID.toBuffer())
    .update(asPublicKey(vault).toBuffer())
    .update(normalizePaymentId(paymentId))
    .update(asPublicKey(mint).toBuffer())
    .update(asPublicKey(recipient).toBuffer())
    .update(asPublicKey(sourceEata).toBuffer())
    .update(asPublicKey(destinationEata).toBuffer())
    .update(asPublicKey(sourceTokenAccount).toBuffer())
    .update(asPublicKey(destinationTokenAccount).toBuffer())
    .update(u64Le(amount))
    .update(u64Le(walletRevision))
    .digest();
}

export function recordApproval(intent, signer) {
  if (intent.executed || intent.status === INTENT_EXECUTED) {
    fail("IntentAlreadyExecuted");
  }
  if (![INTENT_PENDING, INTENT_APPROVED].includes(intent.status)) {
    fail("IntentNotPending");
  }

  let bit;
  if (signer === intent.approverOne) bit = 1;
  else if (signer === intent.approverTwo) bit = 2;
  else fail("UnknownApprover");

  if ((intent.approvalMask & bit) !== 0) fail("DuplicateApprover");
  intent.approvalMask |= bit;
  intent.approvalCount += 1;
  intent.status =
    intent.approvalMask === 3 && intent.approvalCount === APPROVAL_THRESHOLD
      ? INTENT_APPROVED
      : INTENT_PENDING;
}

export function validateExecution(state, args) {
  const { vault, intent, receipt, tokens } = state;
  const amount = BigInt(args.amount);
  if (amount <= 0n) fail("InvalidAmount");
  if (args.vault !== vault.address) fail("WrongCustodyPda");
  if (
    vault.mint !== DEVNET_USDC_MINT.toBase58() ||
    args.mint !== DEVNET_USDC_MINT.toBase58() ||
    tokens.source.mint !== DEVNET_USDC_MINT.toBase58() ||
    tokens.destination.mint !== DEVNET_USDC_MINT.toBase58()
  ) {
    fail("WrongMint");
  }
  if (
    vault.custodyEata !== args.expectedSourceEata ||
    intent.sourceEata !== args.expectedSourceEata
  ) {
    fail("WrongCustodyEata");
  }
  if (
    vault.custodyTokenAccount !== args.sourceTokenAccount ||
    intent.sourceTokenAccount !== args.sourceTokenAccount ||
    tokens.source.address !== args.sourceTokenAccount
  ) {
    fail("WrongSourceTokenAccount");
  }
  if (tokens.source.owner !== vault.address) fail("WrongSourceAuthority");
  if (
    vault.recipient !== args.recipient ||
    intent.recipient !== args.recipient ||
    tokens.destination.owner !== args.recipient
  ) {
    fail("WrongRecipient");
  }
  if (intent.destinationEata !== args.expectedDestinationEata) {
    fail("WrongDestinationEata");
  }
  if (
    intent.destinationTokenAccount !== args.destinationTokenAccount ||
    tokens.destination.address !== args.destinationTokenAccount
  ) {
    fail("WrongDestinationTokenAccount");
  }
  if (BigInt(intent.amount) !== amount) fail("WrongAmount");
  if (
    vault.recipientWalletRevision !== args.walletRevision ||
    intent.walletRevision !== args.walletRevision
  ) {
    fail("StaleWalletRevision");
  }
  if (
    intent.paymentId !== args.paymentId ||
    receipt.paymentId !== args.paymentId
  ) {
    fail("WrongPaymentId");
  }
  if (
    intent.intentHash !== args.intentHash ||
    args.computedIntentHash !== args.intentHash
  ) {
    fail("WrongIntentHash");
  }
  if (intent.executed || intent.status === INTENT_EXECUTED) {
    fail("IntentAlreadyExecuted");
  }
  if (
    intent.status !== INTENT_APPROVED ||
    intent.approvalMask !== 3 ||
    intent.approvalCount !== APPROVAL_THRESHOLD
  ) {
    fail("IntentNotApproved");
  }
  if (receipt.status === RECEIPT_PAID) fail("ReceiptAlreadyPaid");
  if (receipt.status !== RECEIPT_INITIALIZED) {
    fail("ReceiptNotInitialized");
  }
  if (
    !vault.custodyAccessConfigured ||
    !vault.accessConfigured ||
    !intent.accessConfigured ||
    !receipt.accessConfigured
  ) {
    fail("AccessNotConfigured");
  }
}

function cloneState(state) {
  return structuredClone(state);
}

export function executeAtomic(state, args, failure = {}) {
  const pending = cloneState(state);
  validateExecution(pending, args);

  if (failure.tokenCpi) fail("TokenCpiFailed");
  const amount = BigInt(args.amount);
  const sourceBalance = BigInt(pending.tokens.source.balance);
  if (sourceBalance < amount) fail("TokenCpiInsufficientFunds");
  pending.tokens.source.balance = sourceBalance - amount;
  pending.tokens.destination.balance =
    BigInt(pending.tokens.destination.balance) + amount;

  if (failure.afterTokenCpi) fail("StateUpdateFailed");

  pending.intent.status = INTENT_EXECUTED;
  pending.intent.executed = true;
  pending.intent.executedAt = 1_700_000_000n;
  Object.assign(pending.receipt, {
    company: pending.vault.company,
    accountant: pending.vault.accountant,
    recipient: args.recipient,
    sourceEata: args.expectedSourceEata,
    destinationEata: args.expectedDestinationEata,
    mint: DEVNET_USDC_MINT.toBase58(),
    amount,
    walletRevision: args.walletRevision,
    intentHash: args.intentHash,
    paidAt: 1_700_000_000n,
    status: RECEIPT_PAID,
  });
  return pending;
}

export function directTokenTransfer(state, actor, amount) {
  if (actor !== state.tokens.source.owner) fail("TokenOwnerMismatch");
  const value = BigInt(amount);
  if (BigInt(state.tokens.source.balance) < value) {
    fail("TokenCpiInsufficientFunds");
  }
}
