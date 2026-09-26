use anchor_lang::prelude::*;

pub const COMPANY_VAULT_SEED: &[u8] = b"company_vault";
pub const PAYMENT_INTENT_SEED: &[u8] = b"payment_intent";
pub const PAYMENT_RECEIPT_SEED: &[u8] = b"payment_receipt";
pub const INTENT_HASH_DOMAIN: &[u8] = b"pda-custody-private-payment-v1";

pub const APPROVAL_THRESHOLD: u8 = 2;
pub const INTENT_PENDING: u8 = 0;
pub const INTENT_APPROVED: u8 = 1;
pub const INTENT_EXECUTED: u8 = 2;
pub const RECEIPT_INITIALIZED: u8 = 0;
pub const RECEIPT_PAID: u8 = 1;

/// Circle's official Solana devnet USDC mint.
pub const DEVNET_USDC_MINT: Pubkey = Pubkey::new_from_array([
    59, 68, 44, 179, 145, 33, 87, 241, 58, 147, 61, 1, 52, 40, 45, 3, 43, 95, 254, 205, 1, 162,
    219, 241, 183, 121, 6, 8, 223, 0, 46, 167,
]);

/// MagicBlock Ephemeral SPL Token program.
pub const EPHEMERAL_SPL_TOKEN_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 128, 200, 234, 115, 202, 172, 225, 29, 240, 193, 184, 192, 229, 47, 173, 17, 234, 44, 108,
    0, 194, 128, 125, 224, 239, 6, 229, 135, 199, 95, 71,
]);

/// Devnet TEE validator used by the completed private-payment experiment.
pub const DEVNET_TEE_VALIDATOR: Pubkey = Pubkey::new_from_array([
    5, 61, 71, 26, 133, 158, 115, 46, 104, 11, 201, 88, 248, 65, 7, 43, 143, 63, 188, 25, 115, 155,
    230, 151, 196, 198, 129, 18, 111, 140, 31, 116,
]);

pub fn derive_eata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), mint.as_ref()],
        &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    )
    .0
}

pub fn derive_global_vault(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[mint.as_ref()], &EPHEMERAL_SPL_TOKEN_PROGRAM_ID).0
}

pub fn derive_delegation_buffer(delegated_account: &Pubkey, owner_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"buffer", delegated_account.as_ref()], owner_program).0
}

pub fn derive_delegation_record(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation", delegated_account.as_ref()],
        &ephemeral_rollups_sdk::id(),
    )
    .0
}

pub fn derive_delegation_metadata(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation-metadata", delegated_account.as_ref()],
        &ephemeral_rollups_sdk::id(),
    )
    .0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_public_keys_match_official_devnet_values() {
        assert_eq!(
            DEVNET_USDC_MINT.to_string(),
            "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        );
        assert_eq!(
            EPHEMERAL_SPL_TOKEN_PROGRAM_ID.to_string(),
            "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2"
        );
        assert_eq!(EPHEMERAL_SPL_TOKEN_PROGRAM_ID, ephemeral_spl_api::id());
        assert_eq!(
            DEVNET_TEE_VALIDATOR.to_string(),
            "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
        );
    }
}
