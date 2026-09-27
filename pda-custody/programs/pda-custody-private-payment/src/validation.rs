use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::{
    APPROVAL_THRESHOLD, DEVNET_USDC_MINT, INTENT_APPROVED, INTENT_EXECUTED, INTENT_HASH_DOMAIN,
    INTENT_PENDING, RECEIPT_INITIALIZED, RECEIPT_PAID,
};
use crate::error::CustodyError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ValidationFailure {
    InvalidAmount,
    WrongCustodyPda,
    WrongMint,
    WrongCustodyEata,
    WrongSourceTokenAccount,
    WrongSourceAuthority,
    WrongRecipient,
    WrongDestinationEata,
    WrongDestinationTokenAccount,
    WrongAmount,
    StaleWalletRevision,
    WrongPaymentId,
    WrongIntentHash,
    UnknownApprover,
    DuplicateApprover,
    IntentNotPending,
    IntentNotApproved,
    IntentAlreadyExecuted,
    ReceiptAlreadyPaid,
    ReceiptNotInitialized,
    AccessNotConfigured,
}

impl From<ValidationFailure> for anchor_lang::error::Error {
    fn from(value: ValidationFailure) -> Self {
        match value {
            ValidationFailure::InvalidAmount => error!(CustodyError::InvalidAmount),
            ValidationFailure::WrongCustodyPda => error!(CustodyError::WrongCustodyPda),
            ValidationFailure::WrongMint => error!(CustodyError::WrongMint),
            ValidationFailure::WrongCustodyEata => error!(CustodyError::WrongCustodyEata),
            ValidationFailure::WrongSourceTokenAccount => {
                error!(CustodyError::WrongSourceTokenAccount)
            }
            ValidationFailure::WrongSourceAuthority => error!(CustodyError::WrongSourceAuthority),
            ValidationFailure::WrongRecipient => error!(CustodyError::WrongRecipient),
            ValidationFailure::WrongDestinationEata => {
                error!(CustodyError::WrongDestinationEata)
            }
            ValidationFailure::WrongDestinationTokenAccount => {
                error!(CustodyError::WrongDestinationTokenAccount)
            }
            ValidationFailure::WrongAmount => error!(CustodyError::WrongAmount),
            ValidationFailure::StaleWalletRevision => error!(CustodyError::StaleWalletRevision),
            ValidationFailure::WrongPaymentId => error!(CustodyError::WrongPaymentId),
            ValidationFailure::WrongIntentHash => error!(CustodyError::WrongIntentHash),
            ValidationFailure::UnknownApprover => error!(CustodyError::UnknownApprover),
            ValidationFailure::DuplicateApprover => error!(CustodyError::DuplicateApprover),
            ValidationFailure::IntentNotPending => error!(CustodyError::IntentNotPending),
            ValidationFailure::IntentNotApproved => error!(CustodyError::IntentNotApproved),
            ValidationFailure::IntentAlreadyExecuted => {
                error!(CustodyError::IntentAlreadyExecuted)
            }
            ValidationFailure::ReceiptAlreadyPaid => error!(CustodyError::ReceiptAlreadyPaid),
            ValidationFailure::ReceiptNotInitialized => {
                error!(CustodyError::ReceiptNotInitialized)
            }
            ValidationFailure::AccessNotConfigured => error!(CustodyError::AccessNotConfigured),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ApprovalResult {
    pub mask: u8,
    pub count: u8,
    pub status: u8,
}

pub fn record_approval(
    current_mask: u8,
    current_count: u8,
    current_status: u8,
    executed: bool,
    signer: Pubkey,
    approver_one: Pubkey,
    approver_two: Pubkey,
) -> std::result::Result<ApprovalResult, ValidationFailure> {
    if executed || current_status == INTENT_EXECUTED {
        return Err(ValidationFailure::IntentAlreadyExecuted);
    }
    if current_status != INTENT_PENDING && current_status != INTENT_APPROVED {
        return Err(ValidationFailure::IntentNotPending);
    }

    let bit = if signer == approver_one {
        1
    } else if signer == approver_two {
        2
    } else {
        return Err(ValidationFailure::UnknownApprover);
    };

    if current_mask & bit != 0 {
        return Err(ValidationFailure::DuplicateApprover);
    }

    let mask = current_mask | bit;
    let count = current_count
        .checked_add(1)
        .ok_or(ValidationFailure::IntentNotPending)?;
    let status = if count == APPROVAL_THRESHOLD && mask == 3 {
        INTENT_APPROVED
    } else {
        INTENT_PENDING
    };

    Ok(ApprovalResult {
        mask,
        count,
        status,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn payment_intent_hash(
    program_id: &Pubkey,
    vault: &Pubkey,
    payment_id: &[u8; 32],
    mint: &Pubkey,
    recipient: &Pubkey,
    source_eata: &Pubkey,
    destination_eata: &Pubkey,
    source_token_account: &Pubkey,
    destination_token_account: &Pubkey,
    amount: u64,
    wallet_revision: u64,
) -> [u8; 32] {
    hashv(&[
        INTENT_HASH_DOMAIN,
        program_id.as_ref(),
        vault.as_ref(),
        payment_id.as_ref(),
        mint.as_ref(),
        recipient.as_ref(),
        source_eata.as_ref(),
        destination_eata.as_ref(),
        source_token_account.as_ref(),
        destination_token_account.as_ref(),
        &amount.to_le_bytes(),
        &wallet_revision.to_le_bytes(),
    ])
    .to_bytes()
}

#[derive(Clone, Copy, Debug)]
pub struct ExecutionFacts {
    pub vault_key: Pubkey,
    pub expected_vault_key: Pubkey,
    pub vault_mint: Pubkey,
    pub mint_key: Pubkey,
    pub vault_recipient: Pubkey,
    pub intent_recipient: Pubkey,
    pub recipient_arg: Pubkey,
    pub vault_wallet_revision: u64,
    pub intent_wallet_revision: u64,
    pub wallet_revision_arg: u64,
    pub vault_custody_eata: Pubkey,
    pub intent_source_eata: Pubkey,
    pub expected_source_eata: Pubkey,
    pub intent_destination_eata: Pubkey,
    pub expected_destination_eata: Pubkey,
    pub vault_source_token_account: Pubkey,
    pub intent_source_token_account: Pubkey,
    pub source_token_account_key: Pubkey,
    pub expected_source_token_account: Pubkey,
    pub source_token_owner: Pubkey,
    pub source_token_mint: Pubkey,
    pub intent_destination_token_account: Pubkey,
    pub destination_token_account_key: Pubkey,
    pub expected_destination_token_account: Pubkey,
    pub destination_token_owner: Pubkey,
    pub destination_token_mint: Pubkey,
    pub payment_id_arg: [u8; 32],
    pub intent_payment_id: [u8; 32],
    pub receipt_payment_id: [u8; 32],
    pub amount_arg: u64,
    pub intent_amount: u64,
    pub intent_hash_arg: [u8; 32],
    pub stored_intent_hash: [u8; 32],
    pub computed_intent_hash: [u8; 32],
    pub approval_mask: u8,
    pub approval_count: u8,
    pub intent_status: u8,
    pub intent_executed: bool,
    pub receipt_status: u8,
    pub custody_access_configured: bool,
    pub vault_access_configured: bool,
    pub intent_access_configured: bool,
    pub receipt_access_configured: bool,
}

pub fn validate_execution(facts: &ExecutionFacts) -> std::result::Result<(), ValidationFailure> {
    if facts.amount_arg == 0 {
        return Err(ValidationFailure::InvalidAmount);
    }
    if facts.vault_key != facts.expected_vault_key {
        return Err(ValidationFailure::WrongCustodyPda);
    }
    if facts.vault_mint != DEVNET_USDC_MINT
        || facts.mint_key != DEVNET_USDC_MINT
        || facts.source_token_mint != DEVNET_USDC_MINT
        || facts.destination_token_mint != DEVNET_USDC_MINT
    {
        return Err(ValidationFailure::WrongMint);
    }
    if facts.vault_custody_eata != facts.expected_source_eata
        || facts.intent_source_eata != facts.expected_source_eata
    {
        return Err(ValidationFailure::WrongCustodyEata);
    }
    if facts.vault_source_token_account != facts.expected_source_token_account
        || facts.intent_source_token_account != facts.expected_source_token_account
        || facts.source_token_account_key != facts.expected_source_token_account
    {
        return Err(ValidationFailure::WrongSourceTokenAccount);
    }
    if facts.source_token_owner != facts.vault_key {
        return Err(ValidationFailure::WrongSourceAuthority);
    }
    if facts.vault_recipient != facts.recipient_arg
        || facts.intent_recipient != facts.recipient_arg
        || facts.destination_token_owner != facts.recipient_arg
    {
        return Err(ValidationFailure::WrongRecipient);
    }
    if facts.intent_destination_eata != facts.expected_destination_eata {
        return Err(ValidationFailure::WrongDestinationEata);
    }
    if facts.intent_destination_token_account != facts.expected_destination_token_account
        || facts.destination_token_account_key != facts.expected_destination_token_account
    {
        return Err(ValidationFailure::WrongDestinationTokenAccount);
    }
    if facts.intent_amount != facts.amount_arg {
        return Err(ValidationFailure::WrongAmount);
    }
    if facts.vault_wallet_revision != facts.wallet_revision_arg
        || facts.intent_wallet_revision != facts.wallet_revision_arg
    {
        return Err(ValidationFailure::StaleWalletRevision);
    }
    if facts.intent_payment_id != facts.payment_id_arg
        || facts.receipt_payment_id != facts.payment_id_arg
    {
        return Err(ValidationFailure::WrongPaymentId);
    }
    if facts.stored_intent_hash != facts.intent_hash_arg
        || facts.computed_intent_hash != facts.intent_hash_arg
    {
        return Err(ValidationFailure::WrongIntentHash);
    }
    if facts.intent_executed || facts.intent_status == INTENT_EXECUTED {
        return Err(ValidationFailure::IntentAlreadyExecuted);
    }
    if facts.intent_status != INTENT_APPROVED
        || facts.approval_mask != 3
        || facts.approval_count != APPROVAL_THRESHOLD
    {
        return Err(ValidationFailure::IntentNotApproved);
    }
    if facts.receipt_status == RECEIPT_PAID {
        return Err(ValidationFailure::ReceiptAlreadyPaid);
    }
    if facts.receipt_status != RECEIPT_INITIALIZED {
        return Err(ValidationFailure::ReceiptNotInitialized);
    }
    if !facts.custody_access_configured
        || !facts.vault_access_configured
        || !facts.intent_access_configured
        || !facts.receipt_access_configured
    {
        return Err(ValidationFailure::AccessNotConfigured);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        derive_eata, COMPANY_VAULT_SEED, PAYMENT_INTENT_SEED, PAYMENT_RECEIPT_SEED,
    };
    use std::str::FromStr;

    struct Fixture {
        company: Pubkey,
        approver_one: Pubkey,
        approver_two: Pubkey,
        payment_id: [u8; 32],
        facts: ExecutionFacts,
    }

    fn fixture() -> Fixture {
        let company = Pubkey::new_unique();
        let approver_one = Pubkey::new_unique();
        let approver_two = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let payment_id = [42; 32];
        let vault =
            Pubkey::find_program_address(&[COMPANY_VAULT_SEED, company.as_ref()], &crate::ID).0;
        let source_eata = derive_eata(&vault, &DEVNET_USDC_MINT);
        let destination_eata = derive_eata(&recipient, &DEVNET_USDC_MINT);
        let source_token_account =
            anchor_spl::associated_token::get_associated_token_address(&vault, &DEVNET_USDC_MINT);
        let destination_token_account = anchor_spl::associated_token::get_associated_token_address(
            &recipient,
            &DEVNET_USDC_MINT,
        );
        let amount = 10_000;
        let revision = 1;
        let intent_hash = payment_intent_hash(
            &crate::ID,
            &vault,
            &payment_id,
            &DEVNET_USDC_MINT,
            &recipient,
            &source_eata,
            &destination_eata,
            &source_token_account,
            &destination_token_account,
            amount,
            revision,
        );

        Fixture {
            company,
            approver_one,
            approver_two,
            payment_id,
            facts: ExecutionFacts {
                vault_key: vault,
                expected_vault_key: vault,
                vault_mint: DEVNET_USDC_MINT,
                mint_key: DEVNET_USDC_MINT,
                vault_recipient: recipient,
                intent_recipient: recipient,
                recipient_arg: recipient,
                vault_wallet_revision: revision,
                intent_wallet_revision: revision,
                wallet_revision_arg: revision,
                vault_custody_eata: source_eata,
                intent_source_eata: source_eata,
                expected_source_eata: source_eata,
                intent_destination_eata: destination_eata,
                expected_destination_eata: destination_eata,
                vault_source_token_account: source_token_account,
                intent_source_token_account: source_token_account,
                source_token_account_key: source_token_account,
                expected_source_token_account: source_token_account,
                source_token_owner: vault,
                source_token_mint: DEVNET_USDC_MINT,
                intent_destination_token_account: destination_token_account,
                destination_token_account_key: destination_token_account,
                expected_destination_token_account: destination_token_account,
                destination_token_owner: recipient,
                destination_token_mint: DEVNET_USDC_MINT,
                payment_id_arg: payment_id,
                intent_payment_id: payment_id,
                receipt_payment_id: payment_id,
                amount_arg: amount,
                intent_amount: amount,
                intent_hash_arg: intent_hash,
                stored_intent_hash: intent_hash,
                computed_intent_hash: intent_hash,
                approval_mask: 3,
                approval_count: APPROVAL_THRESHOLD,
                intent_status: INTENT_APPROVED,
                intent_executed: false,
                receipt_status: RECEIPT_INITIALIZED,
                custody_access_configured: true,
                vault_access_configured: true,
                intent_access_configured: true,
                receipt_access_configured: true,
            },
        }
    }

    #[test]
    fn valid_execution_is_accepted() {
        assert_eq!(validate_execution(&fixture().facts), Ok(()));
    }

    #[test]
    fn one_approval_is_not_enough() {
        let fixture = fixture();
        let first = record_approval(
            0,
            0,
            INTENT_PENDING,
            false,
            fixture.approver_one,
            fixture.approver_one,
            fixture.approver_two,
        )
        .unwrap();
        assert_eq!(first.status, INTENT_PENDING);
        assert_eq!(first.count, 1);

        let mut facts = fixture.facts;
        facts.approval_mask = first.mask;
        facts.approval_count = first.count;
        facts.intent_status = first.status;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::IntentNotApproved)
        );
    }

    #[test]
    fn duplicate_approver_is_rejected() {
        let fixture = fixture();
        assert_eq!(
            record_approval(
                1,
                1,
                INTENT_PENDING,
                false,
                fixture.approver_one,
                fixture.approver_one,
                fixture.approver_two,
            ),
            Err(ValidationFailure::DuplicateApprover)
        );
    }

    #[test]
    fn unknown_approver_is_rejected() {
        let fixture = fixture();
        assert_eq!(
            record_approval(
                0,
                0,
                INTENT_PENDING,
                false,
                Pubkey::new_unique(),
                fixture.approver_one,
                fixture.approver_two,
            ),
            Err(ValidationFailure::UnknownApprover)
        );
    }

    #[test]
    fn two_distinct_approvals_reach_approved() {
        let fixture = fixture();
        let first = record_approval(
            0,
            0,
            INTENT_PENDING,
            false,
            fixture.approver_one,
            fixture.approver_one,
            fixture.approver_two,
        )
        .unwrap();
        let second = record_approval(
            first.mask,
            first.count,
            first.status,
            false,
            fixture.approver_two,
            fixture.approver_one,
            fixture.approver_two,
        )
        .unwrap();
        assert_eq!(second.mask, 3);
        assert_eq!(second.count, 2);
        assert_eq!(second.status, INTENT_APPROVED);
    }

    #[test]
    fn wrong_recipient_is_rejected() {
        let mut facts = fixture().facts;
        facts.recipient_arg = Pubkey::new_unique();
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongRecipient)
        );
    }

    #[test]
    fn wrong_destination_eata_is_rejected() {
        let mut facts = fixture().facts;
        facts.intent_destination_eata = Pubkey::new_unique();
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongDestinationEata)
        );
    }

    #[test]
    fn wrong_amount_is_rejected() {
        let mut facts = fixture().facts;
        facts.amount_arg += 1;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongAmount)
        );
    }

    #[test]
    fn wrong_mint_is_rejected() {
        let mut facts = fixture().facts;
        facts.mint_key = Pubkey::new_unique();
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongMint)
        );
    }

    #[test]
    fn stale_wallet_revision_is_rejected() {
        let mut facts = fixture().facts;
        facts.vault_wallet_revision += 1;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::StaleWalletRevision)
        );
    }

    #[test]
    fn payment_id_is_a_replay_protection_seed() {
        let fixture = fixture();
        let intent = Pubkey::find_program_address(
            &[
                PAYMENT_INTENT_SEED,
                fixture.facts.vault_key.as_ref(),
                fixture.payment_id.as_ref(),
            ],
            &crate::ID,
        )
        .0;
        let replay = Pubkey::find_program_address(
            &[
                PAYMENT_INTENT_SEED,
                fixture.facts.vault_key.as_ref(),
                fixture.payment_id.as_ref(),
            ],
            &crate::ID,
        )
        .0;
        let receipt = Pubkey::find_program_address(
            &[
                PAYMENT_RECEIPT_SEED,
                fixture.facts.vault_key.as_ref(),
                fixture.payment_id.as_ref(),
            ],
            &crate::ID,
        )
        .0;
        assert_eq!(intent, replay);
        assert_ne!(intent, receipt);

        let mut facts = fixture.facts;
        facts.payment_id_arg = [99; 32];
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongPaymentId)
        );
    }

    #[test]
    fn already_paid_receipt_is_rejected() {
        let mut facts = fixture().facts;
        facts.receipt_status = RECEIPT_PAID;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::ReceiptAlreadyPaid)
        );
    }

    #[test]
    fn already_executed_intent_is_rejected() {
        let mut facts = fixture().facts;
        facts.intent_executed = true;
        facts.intent_status = INTENT_EXECUTED;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::IntentAlreadyExecuted)
        );
    }

    #[test]
    fn company_wallet_is_not_the_token_authority() {
        let fixture = fixture();
        assert_ne!(fixture.company, fixture.facts.vault_key);
        let mut facts = fixture.facts;
        facts.source_token_owner = fixture.company;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongSourceAuthority)
        );
    }

    #[test]
    fn changed_intent_hash_is_rejected() {
        let mut facts = fixture().facts;
        facts.intent_hash_arg[0] ^= 1;
        assert_eq!(
            validate_execution(&facts),
            Err(ValidationFailure::WrongIntentHash)
        );
    }

    #[test]
    fn intent_hash_matches_the_javascript_client_vector() {
        let company = Pubkey::from_str("CE5CcmqDSU1mZtmpT6NiDv7fZDg2edUgerT44RA3F896").unwrap();
        let recipient = Pubkey::from_str("HqBr2UFAdaPhvtcS8NhvdbPLEJy75vaiQ48h1jFdu9mj").unwrap();
        let payment_id = [42; 32];
        let vault =
            Pubkey::find_program_address(&[COMPANY_VAULT_SEED, company.as_ref()], &crate::ID).0;
        assert_eq!(
            vault.to_string(),
            "2pCXcLvy5gqEqgtoES9u2cvYWKckQJK42s89BkTSrCfB"
        );
        let source_eata = derive_eata(&vault, &DEVNET_USDC_MINT);
        let destination_eata = derive_eata(&recipient, &DEVNET_USDC_MINT);
        assert_eq!(
            source_eata.to_string(),
            "45E3iTKo4eg2PETJgbYVix16ApnQ4ipdB8cj9yzM8gMb"
        );
        assert_eq!(
            destination_eata.to_string(),
            "7MvBPB9JJbSC6Dx1x2KVUPvVWbeYjK9aWM9QXt5pT7HP"
        );
        let source_token_account =
            anchor_spl::associated_token::get_associated_token_address(&vault, &DEVNET_USDC_MINT);
        let destination_token_account = anchor_spl::associated_token::get_associated_token_address(
            &recipient,
            &DEVNET_USDC_MINT,
        );
        assert_eq!(
            payment_intent_hash(
                &crate::ID,
                &vault,
                &payment_id,
                &DEVNET_USDC_MINT,
                &recipient,
                &source_eata,
                &destination_eata,
                &source_token_account,
                &destination_token_account,
                10_000,
                1,
            ),
            [
                0x6f, 0x21, 0x0b, 0xfd, 0xbd, 0x86, 0x50, 0x0a, 0x9a, 0x84, 0x2c, 0x07, 0x40, 0xd3,
                0x1a, 0x4f, 0x43, 0x7e, 0x83, 0x6c, 0x0d, 0xa1, 0x88, 0x05, 0x52, 0xaf, 0xad, 0x9c,
                0xd6, 0xa9, 0x67, 0x96,
            ]
        );
    }
}
