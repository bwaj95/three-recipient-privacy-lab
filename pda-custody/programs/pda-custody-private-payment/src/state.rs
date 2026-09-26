use anchor_lang::prelude::*;

use crate::constants::{INTENT_PENDING, RECEIPT_INITIALIZED};

#[account]
pub struct CompanyVault {
    pub company: Pubkey,
    pub approver_one: Pubkey,
    pub approver_two: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub custody_eata: Pubkey,
    pub custody_token_account: Pubkey,
    pub recipient_wallet_revision: u64,
    pub approval_threshold: u8,
    pub custody_access_configured: bool,
    pub access_configured: bool,
    pub bump: u8,
}

impl CompanyVault {
    pub const SPACE: usize = 8 + (7 * 32) + 8 + 4;
}

#[account]
pub struct PaymentIntent {
    pub vault: Pubkey,
    pub payment_id: [u8; 32],
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub source_eata: Pubkey,
    pub destination_eata: Pubkey,
    pub source_token_account: Pubkey,
    pub destination_token_account: Pubkey,
    pub amount: u64,
    pub wallet_revision: u64,
    pub intent_hash: [u8; 32],
    pub approval_mask: u8,
    pub approval_count: u8,
    pub status: u8,
    pub executed: bool,
    pub executed_at: i64,
    pub access_configured: bool,
    pub bump: u8,
}

impl PaymentIntent {
    pub const SPACE: usize = 8 + (8 * 32) + 16 + 32 + 5 + 8 + 2;

    pub fn initialize_shell(&mut self, vault: Pubkey, payment_id: [u8; 32], bump: u8) {
        self.vault = vault;
        self.payment_id = payment_id;
        self.mint = Pubkey::default();
        self.recipient = Pubkey::default();
        self.source_eata = Pubkey::default();
        self.destination_eata = Pubkey::default();
        self.source_token_account = Pubkey::default();
        self.destination_token_account = Pubkey::default();
        self.amount = 0;
        self.wallet_revision = 0;
        self.intent_hash = [0; 32];
        self.approval_mask = 0;
        self.approval_count = 0;
        self.status = INTENT_PENDING;
        self.executed = false;
        self.executed_at = 0;
        self.access_configured = false;
        self.bump = bump;
    }
}

#[account]
pub struct PaymentReceipt {
    pub vault: Pubkey,
    pub payment_id: [u8; 32],
    pub company: Pubkey,
    pub accountant: Pubkey,
    pub recipient: Pubkey,
    pub source_eata: Pubkey,
    pub destination_eata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub wallet_revision: u64,
    pub intent_hash: [u8; 32],
    pub paid_at: i64,
    pub status: u8,
    pub access_configured: bool,
    pub bump: u8,
}

impl PaymentReceipt {
    pub const SPACE: usize = 8 + (9 * 32) + 24 + 3;

    pub fn initialize_shell(&mut self, vault: Pubkey, payment_id: [u8; 32], bump: u8) {
        self.vault = vault;
        self.payment_id = payment_id;
        self.company = Pubkey::default();
        self.accountant = Pubkey::default();
        self.recipient = Pubkey::default();
        self.source_eata = Pubkey::default();
        self.destination_eata = Pubkey::default();
        self.mint = Pubkey::default();
        self.amount = 0;
        self.wallet_revision = 0;
        self.intent_hash = [0; 32];
        self.paid_at = 0;
        self.status = RECEIPT_INITIALIZED;
        self.access_configured = false;
        self.bump = bump;
    }
}
