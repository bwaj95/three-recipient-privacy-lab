use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_spl_api::instruction::ESplInstruction;
use ephemeral_spl_api::instructions::{
    CreateEphemeralAtaPermissionArgs, DelegateArgs, DepositArgs,
};
use solana_address::Address;
use wheels::layout::Encodable;

use crate::constants::EPHEMERAL_SPL_TOKEN_PROGRAM_ID;
use crate::error::CustodyError;

fn encoded<T: Encodable>(value: &T) -> Result<Vec<u8>> {
    value
        .encode()
        .map_err(|_| error!(CustodyError::InvalidEphemeralSplAccount))
}

pub fn initialize_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    owner: AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(owner.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: ESplInstruction::InitializeEphemeralAta.to_vec(),
    };

    invoke(
        &instruction,
        &[
            ephemeral_ata.to_account_info(),
            payer.to_account_info(),
            owner,
            mint.to_account_info(),
            system_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn initialize_global_vault<'info>(
    program: &UncheckedAccount<'info>,
    global_vault: &UncheckedAccount<'info>,
    mint: &Account<'info, Mint>,
    payer: &Signer<'info>,
    global_vault_eata: &UncheckedAccount<'info>,
    global_vault_token_account: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
    associated_token_program: &Program<'info, AssociatedToken>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(global_vault.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new(global_vault_eata.key(), false),
            AccountMeta::new(global_vault_token_account.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new_readonly(associated_token_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: ESplInstruction::InitializeGlobalVault.to_vec(),
    };

    invoke(
        &instruction,
        &[
            global_vault.to_account_info(),
            payer.to_account_info(),
            mint.to_account_info(),
            global_vault_eata.to_account_info(),
            global_vault_token_account.to_account_info(),
            token_program.to_account_info(),
            associated_token_program.to_account_info(),
            system_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn deposit_spl_tokens<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    global_vault: &UncheckedAccount<'info>,
    mint: &Account<'info, Mint>,
    source_token_account: &Account<'info, TokenAccount>,
    global_vault_token_account: &UncheckedAccount<'info>,
    owner: AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    owner_seeds: &[&[u8]],
) -> Result<()> {
    let args = DepositArgs { amount };
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new_readonly(global_vault.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new(source_token_account.key(), false),
            AccountMeta::new(global_vault_token_account.key(), false),
            AccountMeta::new_readonly(owner.key(), true),
            AccountMeta::new_readonly(token_program.key(), false),
        ],
        data: ESplInstruction::DepositSplTokens.with_data(&encoded(&args)?),
    };

    invoke_signed(
        &instruction,
        &[
            ephemeral_ata.to_account_info(),
            global_vault.to_account_info(),
            mint.to_account_info(),
            source_token_account.to_account_info(),
            global_vault_token_account.to_account_info(),
            owner,
            token_program.to_account_info(),
            program.to_account_info(),
        ],
        &[owner_seeds],
    )?;
    Ok(())
}

pub fn create_eata_permission<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    permission: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    permission_program: &UncheckedAccount<'info>,
) -> Result<()> {
    let args = CreateEphemeralAtaPermissionArgs { flag_byte: 0 };
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new(permission.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(permission_program.key(), false),
        ],
        data: ESplInstruction::CreateEphemeralAtaPermission.with_data(&encoded(&args)?),
    };

    invoke(
        &instruction,
        &[
            ephemeral_ata.to_account_info(),
            permission.to_account_info(),
            payer.to_account_info(),
            system_program.to_account_info(),
            permission_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn delegate_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    buffer: &UncheckedAccount<'info>,
    record: &UncheckedAccount<'info>,
    metadata: &UncheckedAccount<'info>,
    delegation_program: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    validator: Pubkey,
) -> Result<()> {
    let args = DelegateArgs {
        validator: Some(Address::new_from_array(validator.to_bytes())),
    };
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer.key(), true),
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new_readonly(EPHEMERAL_SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new(buffer.key(), false),
            AccountMeta::new(record.key(), false),
            AccountMeta::new(metadata.key(), false),
            AccountMeta::new_readonly(delegation_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: ESplInstruction::DelegateEphemeralAta.with_data(&encoded(&args)?),
    };

    invoke(
        &instruction,
        &[
            payer.to_account_info(),
            ephemeral_ata.to_account_info(),
            program.to_account_info(),
            buffer.to_account_info(),
            record.to_account_info(),
            metadata.to_account_info(),
            delegation_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )?;
    Ok(())
}
