use anchor_lang::prelude::*;

#[error_code]
pub enum CustodyError {
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("configured identities must be nonzero and distinct")]
    InvalidIdentitySet,
    #[msg("mint must be Circle devnet USDC")]
    WrongMint,
    #[msg("custody PDA does not match the configured vault")]
    WrongCustodyPda,
    #[msg("custody eATA does not match [vault, mint]")]
    WrongCustodyEata,
    #[msg("source token account is not the custody PDA's canonical SPL view")]
    WrongSourceTokenAccount,
    #[msg("source token account is not owned by the custody PDA")]
    WrongSourceAuthority,
    #[msg("recipient does not match the approved intent")]
    WrongRecipient,
    #[msg("destination eATA does not match [recipient, mint]")]
    WrongDestinationEata,
    #[msg("destination token account is not the recipient's canonical SPL view")]
    WrongDestinationTokenAccount,
    #[msg("amount does not match the approved intent")]
    WrongAmount,
    #[msg("recipient wallet revision is stale")]
    StaleWalletRevision,
    #[msg("payment ID does not match the intent and receipt")]
    WrongPaymentId,
    #[msg("intent hash does not match the approved payment")]
    WrongIntentHash,
    #[msg("approver is not authorized")]
    UnknownApprover,
    #[msg("approver has already approved this payment")]
    DuplicateApprover,
    #[msg("payment intent is not pending approval")]
    IntentNotPending,
    #[msg("payment intent has not reached the two-approval threshold")]
    IntentNotApproved,
    #[msg("payment intent has already executed")]
    IntentAlreadyExecuted,
    #[msg("payment receipt is already paid")]
    ReceiptAlreadyPaid,
    #[msg("payment receipt is not initialized")]
    ReceiptNotInitialized,
    #[msg("payment shells are already configured")]
    PaymentAlreadyConfigured,
    #[msg("private access is not configured")]
    AccessNotConfigured,
    #[msg("private access was already configured")]
    AccessAlreadyConfigured,
    #[msg("recipient wallet revision overflow")]
    RevisionOverflow,
    #[msg("invalid external Ephemeral SPL Token account")]
    InvalidEphemeralSplAccount,
}
