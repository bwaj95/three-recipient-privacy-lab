use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{
            CreateEphemeralPermissionCpi, UpdatePermissionCpi, UpdatePermissionCpiAccounts,
            UpdatePermissionInstructionArgs,
        },
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, MembersArgs, AUTHORITY_FLAG,
            PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
};

mod constants;
mod error;
mod espl;
mod state;
mod validation;

use constants::*;
use error::CustodyError;
use state::{CompanyVault, PaymentIntent, PaymentReceipt};
use validation::{payment_intent_hash, record_approval, validate_execution, ExecutionFacts};

declare_id!("AzM25i2W2ifd3MjvFV66vgtJCeqCNmmocsUPNtGg1WDo");

fn view_flags() -> u8 {
    TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG
}

fn vault_members(vault: &CompanyVault) -> Vec<Member> {
    let view_flags = view_flags();
    vec![
        Member {
            flags: AUTHORITY_FLAG | view_flags,
            pubkey: vault.company,
        },
        Member {
            flags: view_flags,
            pubkey: vault.accountant,
        },
    ]
}

fn custody_members(vault: &CompanyVault) -> Vec<Member> {
    vec![Member {
        flags: AUTHORITY_FLAG | view_flags(),
        pubkey: vault.company,
    }]
}

fn intent_members(vault: &CompanyVault) -> Vec<Member> {
    let view_flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
    vec![
        Member {
            flags: AUTHORITY_FLAG | view_flags,
            pubkey: vault.company,
        },
        Member {
            flags: AUTHORITY_FLAG | view_flags,
            pubkey: vault.approver_one,
        },
        Member {
            flags: AUTHORITY_FLAG | view_flags,
            pubkey: vault.approver_two,
        },
    ]
}

fn receipt_members(vault: &CompanyVault) -> Vec<Member> {
    let view_flags = view_flags();
    vec![
        Member {
            flags: AUTHORITY_FLAG | view_flags,
            pubkey: vault.company,
        },
        Member {
            flags: view_flags,
            pubkey: vault.accountant,
        },
        Member {
            flags: view_flags,
            pubkey: vault.recipient,
        },
    ]
}

fn validate_identity_set(
    company: Pubkey,
    accountant: Pubkey,
    approver_one: Pubkey,
    approver_two: Pubkey,
    recipient: Pubkey,
) -> Result<()> {
    let values = [company, accountant, approver_one, approver_two, recipient];
    require!(
        values.iter().all(|key| *key != Pubkey::default()),
        CustodyError::InvalidIdentitySet
    );
    for left in 0..values.len() {
        for right in (left + 1)..values.len() {
            require!(
                values[left] != values[right],
                CustodyError::InvalidIdentitySet
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod permission_tests {
    use super::*;

    fn vault() -> CompanyVault {
        CompanyVault {
            company: Pubkey::new_unique(),
            accountant: Pubkey::new_unique(),
            approver_one: Pubkey::new_unique(),
            approver_two: Pubkey::new_unique(),
            recipient: Pubkey::new_unique(),
            mint: DEVNET_USDC_MINT,
            custody_eata: Pubkey::new_unique(),
            custody_token_account: Pubkey::new_unique(),
            recipient_wallet_revision: 1,
            approval_threshold: APPROVAL_THRESHOLD,
            custody_access_configured: true,
            access_configured: true,
            bump: 1,
        }
    }

    #[test]
    fn permission_sets_are_least_privilege() {
        let vault = vault();
        let vault_access = vault_members(&vault);
        let custody = custody_members(&vault);
        let intent = intent_members(&vault);
        let receipt = receipt_members(&vault);

        assert_eq!(vault_access.len(), 2);
        assert_eq!(vault_access[0].pubkey, vault.company);
        assert_ne!(vault_access[0].flags & AUTHORITY_FLAG, 0);
        assert_eq!(vault_access[1].pubkey, vault.accountant);
        assert_eq!(vault_access[1].flags & AUTHORITY_FLAG, 0);
        assert_eq!(custody.len(), 1);
        assert_eq!(custody[0].pubkey, vault.company);
        assert_ne!(intent[0].flags & AUTHORITY_FLAG, 0);
        assert_ne!(intent[1].flags & AUTHORITY_FLAG, 0);
        assert_ne!(intent[2].flags & AUTHORITY_FLAG, 0);
        assert_eq!(receipt.len(), 3);
        assert_eq!(receipt[0].pubkey, vault.company);
        assert_eq!(receipt[1].pubkey, vault.accountant);
        assert_eq!(receipt[1].flags & AUTHORITY_FLAG, 0);
        assert_eq!(receipt[2].pubkey, vault.recipient);
        assert_eq!(receipt[2].flags & AUTHORITY_FLAG, 0);
        assert!(!vault_access
            .iter()
            .any(|member| member.pubkey == vault.recipient));
        assert!(!custody
            .iter()
            .any(|member| member.pubkey == vault.recipient));
        assert!(!receipt
            .iter()
            .any(|member| member.pubkey == vault.approver_one));
    }
}

#[ephemeral]
#[program]
pub mod pda_custody_private_payment {
    use super::*;

    /// Creates the program-owned custody PDA, deposits Circle devnet USDC into
    /// its direct eATA, configures private eATA access, and delegates the eATA
    /// to the pinned devnet TEE validator.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        accountant: Pubkey,
        approver_one: Pubkey,
        approver_two: Pubkey,
        recipient: Pubkey,
        initial_amount: u64,
    ) -> Result<()> {
        require!(initial_amount > 0, CustodyError::InvalidAmount);
        validate_identity_set(
            ctx.accounts.company.key(),
            accountant,
            approver_one,
            approver_two,
            recipient,
        )?;

        let vault_key = ctx.accounts.vault.key();
        let vault_bump = ctx.bumps.vault;
        let vault = &mut ctx.accounts.vault;
        vault.company = ctx.accounts.company.key();
        vault.accountant = accountant;
        vault.approver_one = approver_one;
        vault.approver_two = approver_two;
        vault.recipient = recipient;
        vault.mint = DEVNET_USDC_MINT;
        vault.custody_eata = ctx.accounts.custody_eata.key();
        vault.custody_token_account = ctx.accounts.custody_token_account.key();
        vault.recipient_wallet_revision = 1;
        vault.approval_threshold = APPROVAL_THRESHOLD;
        vault.custody_access_configured = false;
        vault.access_configured = false;
        vault.bump = vault_bump;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.company.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(4) as u32),
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.company_token_account.to_account_info(),
                    to: ctx.accounts.custody_token_account.to_account_info(),
                    authority: ctx.accounts.company.to_account_info(),
                },
            ),
            initial_amount,
        )?;

        espl::initialize_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.custody_eata,
            ctx.accounts.vault.to_account_info(),
            &ctx.accounts.mint,
            &ctx.accounts.company,
            &ctx.accounts.system_program,
        )?;

        if ctx.accounts.global_vault.lamports() == 0 {
            espl::initialize_global_vault(
                &ctx.accounts.ephemeral_token_program,
                &ctx.accounts.global_vault,
                &ctx.accounts.mint,
                &ctx.accounts.company,
                &ctx.accounts.global_vault_eata,
                &ctx.accounts.global_vault_token_account,
                &ctx.accounts.token_program,
                &ctx.accounts.associated_token_program,
                &ctx.accounts.system_program,
            )?;
        }

        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.key(),
            associated_token::Create {
                payer: ctx.accounts.company.to_account_info(),
                associated_token: ctx.accounts.global_vault_token_account.to_account_info(),
                authority: ctx.accounts.global_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;

        let bump = [vault_bump];
        let vault_seeds = [COMPANY_VAULT_SEED, ctx.accounts.company.key.as_ref(), &bump];
        espl::deposit_spl_tokens(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.custody_eata,
            &ctx.accounts.global_vault,
            &ctx.accounts.mint,
            &ctx.accounts.custody_token_account,
            &ctx.accounts.global_vault_token_account,
            ctx.accounts.vault.to_account_info(),
            &ctx.accounts.token_program,
            initial_amount,
            &vault_seeds,
        )?;

        require_keys_eq!(
            vault_key,
            ctx.accounts.vault.key(),
            CustodyError::WrongCustodyPda
        );
        Ok(())
    }

    /// Makes the PDA-owned custody eATA private before it is delegated. The
    /// eATA initially grants AUTHORITY to the vault PDA; that PDA signs the
    /// update that installs the fixed company/approver/recipient member set.
    pub fn configure_custody_eata_access(ctx: Context<ConfigureCustodyEataAccess>) -> Result<()> {
        if ctx.accounts.vault.custody_access_configured {
            require!(
                ctx.accounts.custody_eata_permission.owner == &PERMISSION_PROGRAM_ID
                    && !ctx.accounts.custody_eata_permission.data_is_empty(),
                CustodyError::InvalidEphemeralSplAccount
            );
            return Ok(());
        }

        espl::create_eata_permission(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.custody_eata,
            &ctx.accounts.custody_eata_permission,
            &ctx.accounts.company,
            &ctx.accounts.system_program,
            &ctx.accounts.permission_program,
        )?;

        let bump = [ctx.accounts.vault.bump];
        let vault_seeds = [
            COMPANY_VAULT_SEED,
            ctx.accounts.vault.company.as_ref(),
            &bump,
        ];
        let permission_program = ctx.accounts.permission_program.to_account_info();
        let authority = ctx.accounts.vault.to_account_info();
        let permissioned_account = ctx.accounts.custody_eata.to_account_info();
        let permission = ctx.accounts.custody_eata_permission.to_account_info();
        UpdatePermissionCpi::new(
            &permission_program,
            UpdatePermissionCpiAccounts {
                authority: (&authority, true),
                permissioned_account: (&permissioned_account, false),
                permission: &permission,
            },
            UpdatePermissionInstructionArgs {
                args: MembersArgs {
                    members: Some(custody_members(&ctx.accounts.vault)),
                },
            },
        )
        .invoke_signed(&[&vault_seeds])?;

        ctx.accounts.vault.custody_access_configured = true;
        Ok(())
    }

    /// Idempotently delegates the shared per-mint global-vault eATA to the
    /// same pinned TEE as this isolated experiment.
    pub fn delegate_global_vault_eata(ctx: Context<DelegateGlobalVaultEata>) -> Result<()> {
        espl::delegate_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.company,
            &ctx.accounts.global_vault_eata,
            &ctx.accounts.global_vault_eata_buffer,
            &ctx.accounts.global_vault_eata_record,
            &ctx.accounts.global_vault_eata_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            ctx.accounts.validator.key(),
        )
    }

    /// Delegates only after the program has installed the private access list.
    pub fn delegate_custody_eata(ctx: Context<DelegateCustodyEata>) -> Result<()> {
        require!(
            ctx.accounts.vault.custody_access_configured,
            CustodyError::AccessNotConfigured
        );
        espl::delegate_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.company,
            &ctx.accounts.custody_eata,
            &ctx.accounts.custody_eata_buffer,
            &ctx.accounts.custody_eata_record,
            &ctx.accounts.custody_eata_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            ctx.accounts.validator.key(),
        )
    }

    /// Creates deliberately sparse public shells. Sensitive intent and receipt
    /// fields are populated only after both accounts are delegated to the PER.
    pub fn initialize_payment_shells(
        ctx: Context<InitializePaymentShells>,
        payment_id: [u8; 32],
    ) -> Result<()> {
        require!(payment_id != [0; 32], CustodyError::WrongPaymentId);

        ctx.accounts.intent.initialize_shell(
            ctx.accounts.vault.key(),
            payment_id,
            ctx.bumps.intent,
        );
        ctx.accounts.receipt.initialize_shell(
            ctx.accounts.vault.key(),
            payment_id,
            ctx.bumps.receipt,
        );

        let permission_rent =
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(4) as u32);
        for target in [
            ctx.accounts.intent.to_account_info(),
            ctx.accounts.receipt.to_account_info(),
        ] {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.company.to_account_info(),
                        to: target,
                    },
                ),
                permission_rent,
            )?;
        }
        Ok(())
    }

    pub fn delegate_vault(ctx: Context<DelegateVault>) -> Result<()> {
        if ctx.accounts.vault.owner != &ephemeral_rollups_sdk::id() {
            ctx.accounts.delegate_vault(
                &ctx.accounts.company,
                &[COMPANY_VAULT_SEED, ctx.accounts.company.key.as_ref()],
                DelegateConfig {
                    validator: Some(ctx.accounts.validator.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    pub fn delegate_intent(ctx: Context<DelegateIntent>, payment_id: [u8; 32]) -> Result<()> {
        if ctx.accounts.intent.owner != &ephemeral_rollups_sdk::id() {
            ctx.accounts.delegate_intent(
                &ctx.accounts.company,
                &[
                    PAYMENT_INTENT_SEED,
                    ctx.accounts.vault.key.as_ref(),
                    payment_id.as_ref(),
                ],
                DelegateConfig {
                    validator: Some(ctx.accounts.validator.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    pub fn delegate_receipt(ctx: Context<DelegateReceipt>, payment_id: [u8; 32]) -> Result<()> {
        if ctx.accounts.receipt.owner != &ephemeral_rollups_sdk::id() {
            ctx.accounts.delegate_receipt(
                &ctx.accounts.company,
                &[
                    PAYMENT_RECEIPT_SEED,
                    ctx.accounts.vault.key.as_ref(),
                    payment_id.as_ref(),
                ],
                DelegateConfig {
                    validator: Some(ctx.accounts.validator.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    /// Creates the vault permission exactly once. Only company can write;
    /// the independent accountant receives transaction-view flags.
    pub fn configure_vault_private_access(ctx: Context<ConfigureVaultPrivateAccess>) -> Result<()> {
        if ctx.accounts.vault.access_configured {
            require!(
                ctx.accounts.vault_permission.owner == &PERMISSION_PROGRAM_ID
                    && !ctx.accounts.vault_permission.data_is_empty(),
                CustodyError::AccessNotConfigured
            );
            return Ok(());
        }
        require!(
            ctx.accounts.vault_permission.lamports() == 0,
            CustodyError::AccessAlreadyConfigured
        );
        let company = ctx.accounts.vault.company;
        let vault_bump = [ctx.accounts.vault.bump];
        let vault_seeds = [COMPANY_VAULT_SEED, company.as_ref(), &vault_bump];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.vault.to_account_info(),
            permissioned_account: ctx.accounts.vault.to_account_info(),
            permission: ctx.accounts.vault_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vault_members(&ctx.accounts.vault),
            },
        }
        .invoke_signed(&[&vault_seeds])?;
        ctx.accounts.vault.access_configured = true;
        Ok(())
    }

    /// Creates each intent and receipt permission exactly once. The intent is
    /// writable only by company and the two approvers. The receipt is writable
    /// only by company and visible only to company, accountant, and this
    /// payment's selected recipient.
    pub fn configure_payment_private_access(
        ctx: Context<ConfigurePaymentPrivateAccess>,
        _payment_id: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.vault.access_configured,
            CustodyError::AccessNotConfigured
        );
        if ctx.accounts.intent.access_configured && ctx.accounts.receipt.access_configured {
            require!(
                ctx.accounts.intent_permission.owner == &PERMISSION_PROGRAM_ID
                    && !ctx.accounts.intent_permission.data_is_empty()
                    && ctx.accounts.receipt_permission.owner == &PERMISSION_PROGRAM_ID
                    && !ctx.accounts.receipt_permission.data_is_empty(),
                CustodyError::AccessNotConfigured
            );
            return Ok(());
        }
        require!(
            !ctx.accounts.intent.access_configured
                && !ctx.accounts.receipt.access_configured
                && ctx.accounts.intent_permission.lamports() == 0
                && ctx.accounts.receipt_permission.lamports() == 0,
            CustodyError::AccessAlreadyConfigured
        );

        let intent_bump = [ctx.accounts.intent.bump];
        let intent_seeds = [
            PAYMENT_INTENT_SEED,
            ctx.accounts.intent.vault.as_ref(),
            ctx.accounts.intent.payment_id.as_ref(),
            &intent_bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.intent.to_account_info(),
            permissioned_account: ctx.accounts.intent.to_account_info(),
            permission: ctx.accounts.intent_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: intent_members(&ctx.accounts.vault),
            },
        }
        .invoke_signed(&[&intent_seeds])?;

        let receipt_bump = [ctx.accounts.receipt.bump];
        let receipt_seeds = [
            PAYMENT_RECEIPT_SEED,
            ctx.accounts.receipt.vault.as_ref(),
            ctx.accounts.receipt.payment_id.as_ref(),
            &receipt_bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.receipt.to_account_info(),
            permissioned_account: ctx.accounts.receipt.to_account_info(),
            permission: ctx.accounts.receipt_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: receipt_members(&ctx.accounts.vault),
            },
        }
        .invoke_signed(&[&receipt_seeds])?;

        ctx.accounts.intent.access_configured = true;
        ctx.accounts.receipt.access_configured = true;
        Ok(())
    }

    /// Binds the delegated intent to the current recipient revision and exact
    /// payment. The supplied hash must equal the program's domain-separated
    /// recomputation; callers cannot approve a partially bound payload.
    pub fn configure_payment(
        ctx: Context<ConfigurePayment>,
        _payment_id: [u8; 32],
        amount: u64,
        wallet_revision: u64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, CustodyError::InvalidAmount);
        require!(
            ctx.accounts.vault.access_configured
                && ctx.accounts.intent.access_configured
                && ctx.accounts.receipt.access_configured,
            CustodyError::AccessNotConfigured
        );
        require!(
            ctx.accounts.intent.amount == 0
                && ctx.accounts.intent.intent_hash == [0; 32]
                && !ctx.accounts.intent.executed,
            CustodyError::PaymentAlreadyConfigured
        );
        require_eq!(
            wallet_revision,
            ctx.accounts.vault.recipient_wallet_revision,
            CustodyError::StaleWalletRevision
        );

        let recipient = ctx.accounts.vault.recipient;
        let source_eata = derive_eata(&ctx.accounts.vault.key(), &DEVNET_USDC_MINT);
        let destination_eata = derive_eata(&recipient, &DEVNET_USDC_MINT);
        let source_token_account = anchor_spl::associated_token::get_associated_token_address(
            &ctx.accounts.vault.key(),
            &DEVNET_USDC_MINT,
        );
        let destination_token_account = anchor_spl::associated_token::get_associated_token_address(
            &recipient,
            &DEVNET_USDC_MINT,
        );
        let computed_hash = payment_intent_hash(
            &crate::ID,
            &ctx.accounts.vault.key(),
            &ctx.accounts.intent.payment_id,
            &DEVNET_USDC_MINT,
            &recipient,
            &source_eata,
            &destination_eata,
            &source_token_account,
            &destination_token_account,
            amount,
            wallet_revision,
        );
        require!(computed_hash == intent_hash, CustodyError::WrongIntentHash);
        require_keys_eq!(
            ctx.accounts.vault.custody_eata,
            source_eata,
            CustodyError::WrongCustodyEata
        );
        require_keys_eq!(
            ctx.accounts.vault.custody_token_account,
            source_token_account,
            CustodyError::WrongSourceTokenAccount
        );

        let intent = &mut ctx.accounts.intent;
        intent.approver_one = ctx.accounts.vault.approver_one;
        intent.approver_two = ctx.accounts.vault.approver_two;
        intent.mint = DEVNET_USDC_MINT;
        intent.recipient = recipient;
        intent.source_eata = source_eata;
        intent.destination_eata = destination_eata;
        intent.source_token_account = source_token_account;
        intent.destination_token_account = destination_token_account;
        intent.amount = amount;
        intent.wallet_revision = wallet_revision;
        intent.intent_hash = intent_hash;
        intent.approval_mask = 0;
        intent.approval_count = 0;
        intent.status = INTENT_PENDING;
        Ok(())
    }

    pub fn approve_payment(ctx: Context<ApprovePayment>, _payment_id: [u8; 32]) -> Result<()> {
        let result = record_approval(
            ctx.accounts.intent.approval_mask,
            ctx.accounts.intent.approval_count,
            ctx.accounts.intent.status,
            ctx.accounts.intent.executed,
            ctx.accounts.approver.key(),
            ctx.accounts.intent.approver_one,
            ctx.accounts.intent.approver_two,
        )
        .map_err(anchor_lang::error::Error::from)?;
        ctx.accounts.intent.approval_mask = result.mask;
        ctx.accounts.intent.approval_count = result.count;
        ctx.accounts.intent.status = result.status;
        Ok(())
    }

    pub fn rotate_recipient(ctx: Context<RotateRecipient>, recipient: Pubkey) -> Result<()> {
        require!(
            recipient != Pubkey::default(),
            CustodyError::InvalidIdentitySet
        );
        require!(
            recipient != ctx.accounts.vault.company
                && recipient != ctx.accounts.vault.accountant
                && recipient != ctx.accounts.vault.approver_one
                && recipient != ctx.accounts.vault.approver_two,
            CustodyError::InvalidIdentitySet
        );
        ctx.accounts.vault.recipient = recipient;
        ctx.accounts.vault.recipient_wallet_revision = ctx
            .accounts
            .vault
            .recipient_wallet_revision
            .checked_add(1)
            .ok_or(CustodyError::RevisionOverflow)?;
        Ok(())
    }

    /// Performs the PDA-signed SPL Token CPI and both state transitions in one
    /// instruction. Any error, including after the CPI, rolls back the token
    /// movement, intent mutation, and receipt mutation together.
    pub fn execute_private_payment(
        ctx: Context<ExecutePrivatePayment>,
        payment_id: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        wallet_revision: u64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        let vault_key = ctx.accounts.vault.key();
        let expected_vault_key = Pubkey::find_program_address(
            &[COMPANY_VAULT_SEED, ctx.accounts.company.key.as_ref()],
            &crate::ID,
        )
        .0;
        let expected_source_eata = derive_eata(&vault_key, &DEVNET_USDC_MINT);
        let expected_destination_eata = derive_eata(&recipient, &DEVNET_USDC_MINT);
        let expected_source_token_account =
            anchor_spl::associated_token::get_associated_token_address(
                &vault_key,
                &DEVNET_USDC_MINT,
            );
        let expected_destination_token_account =
            anchor_spl::associated_token::get_associated_token_address(
                &recipient,
                &DEVNET_USDC_MINT,
            );
        let computed_intent_hash = payment_intent_hash(
            &crate::ID,
            &vault_key,
            &payment_id,
            &DEVNET_USDC_MINT,
            &recipient,
            &expected_source_eata,
            &expected_destination_eata,
            &expected_source_token_account,
            &expected_destination_token_account,
            amount,
            wallet_revision,
        );

        validate_execution(&ExecutionFacts {
            vault_key,
            expected_vault_key,
            vault_mint: ctx.accounts.vault.mint,
            mint_key: ctx.accounts.mint.key(),
            vault_recipient: ctx.accounts.vault.recipient,
            intent_recipient: ctx.accounts.intent.recipient,
            recipient_arg: recipient,
            vault_wallet_revision: ctx.accounts.vault.recipient_wallet_revision,
            intent_wallet_revision: ctx.accounts.intent.wallet_revision,
            wallet_revision_arg: wallet_revision,
            vault_custody_eata: ctx.accounts.vault.custody_eata,
            intent_source_eata: ctx.accounts.intent.source_eata,
            expected_source_eata,
            intent_destination_eata: ctx.accounts.intent.destination_eata,
            expected_destination_eata,
            vault_source_token_account: ctx.accounts.vault.custody_token_account,
            intent_source_token_account: ctx.accounts.intent.source_token_account,
            source_token_account_key: ctx.accounts.source_token_account.key(),
            expected_source_token_account,
            source_token_owner: ctx.accounts.source_token_account.owner,
            source_token_mint: ctx.accounts.source_token_account.mint,
            intent_destination_token_account: ctx.accounts.intent.destination_token_account,
            destination_token_account_key: ctx.accounts.destination_token_account.key(),
            expected_destination_token_account,
            destination_token_owner: ctx.accounts.destination_token_account.owner,
            destination_token_mint: ctx.accounts.destination_token_account.mint,
            payment_id_arg: payment_id,
            intent_payment_id: ctx.accounts.intent.payment_id,
            receipt_payment_id: ctx.accounts.receipt.payment_id,
            amount_arg: amount,
            intent_amount: ctx.accounts.intent.amount,
            intent_hash_arg: intent_hash,
            stored_intent_hash: ctx.accounts.intent.intent_hash,
            computed_intent_hash,
            approval_mask: ctx.accounts.intent.approval_mask,
            approval_count: ctx.accounts.intent.approval_count,
            intent_status: ctx.accounts.intent.status,
            intent_executed: ctx.accounts.intent.executed,
            receipt_status: ctx.accounts.receipt.status,
            custody_access_configured: ctx.accounts.vault.custody_access_configured,
            vault_access_configured: ctx.accounts.vault.access_configured,
            intent_access_configured: ctx.accounts.intent.access_configured,
            receipt_access_configured: ctx.accounts.receipt.access_configured,
        })
        .map_err(anchor_lang::error::Error::from)?;

        let bump = [ctx.accounts.vault.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            COMPANY_VAULT_SEED,
            ctx.accounts.vault.company.as_ref(),
            &bump,
        ]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    to: ctx.accounts.destination_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let intent = &mut ctx.accounts.intent;
        intent.status = INTENT_EXECUTED;
        intent.executed = true;
        intent.executed_at = now;

        let receipt = &mut ctx.accounts.receipt;
        receipt.company = ctx.accounts.vault.company;
        receipt.accountant = ctx.accounts.vault.accountant;
        receipt.recipient = recipient;
        receipt.source_eata = expected_source_eata;
        receipt.destination_eata = expected_destination_eata;
        receipt.mint = DEVNET_USDC_MINT;
        receipt.amount = amount;
        receipt.wallet_revision = wallet_revision;
        receipt.intent_hash = intent_hash;
        receipt.paid_at = now;
        receipt.status = RECEIPT_PAID;
        Ok(())
    }

    /// Local-SVM-only rollback probe. This is excluded from the production
    /// artifact unless the explicit test feature is enabled: transfer first,
    /// mutate program state, then return an error so the runtime must undo both.
    #[cfg(feature = "test-failure-injection")]
    pub fn test_fail_after_cpi(
        ctx: Context<TestFailAfterCpi>,
        _payment_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let bump = [ctx.accounts.vault.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            COMPANY_VAULT_SEED,
            ctx.accounts.vault.company.as_ref(),
            &bump,
        ]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    to: ctx.accounts.destination_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        ctx.accounts.receipt.status = RECEIPT_PAID;
        Err(ProgramError::InvalidArgument.into())
    }
}

#[derive(Accounts)]
#[instruction(accountant: Pubkey, approver_one: Pubkey, approver_two: Pubkey, recipient: Pubkey, initial_amount: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(address = DEVNET_USDC_MINT)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = company,
        space = CompanyVault::SPACE,
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, CompanyVault>>,
    #[account(
        mut,
        constraint = company_token_account.owner == company.key() @ CustodyError::WrongSourceAuthority,
        constraint = company_token_account.mint == DEVNET_USDC_MINT @ CustodyError::WrongMint
    )]
    pub company_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = company,
        associated_token::mint = mint,
        associated_token::authority = vault
    )]
    pub custody_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = derive_eata(&vault.key(), &mint.key()) @ CustodyError::WrongCustodyEata
    )]
    /// CHECK: Created by the fixed Ephemeral SPL Token program.
    pub custody_eata: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_global_vault(&mint.key()) @ CustodyError::InvalidEphemeralSplAccount
    )]
    /// CHECK: Created by the fixed Ephemeral SPL Token program.
    pub global_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_eata(&global_vault.key(), &mint.key()) @ CustodyError::InvalidEphemeralSplAccount
    )]
    /// CHECK: Global-vault eATA created by the fixed eSPL program.
    pub global_vault_eata: UncheckedAccount<'info>,
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address(&global_vault.key(), &mint.key()) @ CustodyError::InvalidEphemeralSplAccount
    )]
    /// CHECK: Validated/created idempotently by the Associated Token Program.
    pub global_vault_token_account: UncheckedAccount<'info>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: Fixed Ephemeral SPL Token program.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureCustodyEataAccess<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(
        mut,
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, CompanyVault>>,
    #[account(
        mut,
        address = derive_eata(&vault.key(), &DEVNET_USDC_MINT) @ CustodyError::WrongCustodyEata,
        constraint = custody_eata.owner == &EPHEMERAL_SPL_TOKEN_PROGRAM_ID @ CustodyError::InvalidEphemeralSplAccount
    )]
    /// CHECK: Direct eATA validated by deterministic address and current owner.
    pub custody_eata: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PERMISSION_SEED, custody_eata.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    /// CHECK: Fixed permission PDA for the custody eATA.
    pub custody_eata_permission: UncheckedAccount<'info>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: Fixed Ephemeral SPL Token program.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program.
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateGlobalVaultEata<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(address = derive_global_vault(&DEVNET_USDC_MINT) @ CustodyError::InvalidEphemeralSplAccount)]
    /// CHECK: Deterministic shared USDC global vault.
    pub global_vault: UncheckedAccount<'info>,
    #[account(mut, address = derive_eata(&global_vault.key(), &DEVNET_USDC_MINT) @ CustodyError::InvalidEphemeralSplAccount)]
    /// CHECK: Deterministic shared USDC global-vault eATA.
    pub global_vault_eata: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_buffer(&global_vault_eata.key(), &EPHEMERAL_SPL_TOKEN_PROGRAM_ID))]
    /// CHECK: Deterministic global-vault eATA delegation buffer.
    pub global_vault_eata_buffer: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_record(&global_vault_eata.key()))]
    /// CHECK: Deterministic global-vault eATA delegation record.
    pub global_vault_eata_record: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_metadata(&global_vault_eata.key()))]
    /// CHECK: Deterministic global-vault eATA delegation metadata.
    pub global_vault_eata_metadata: UncheckedAccount<'info>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: Fixed Ephemeral SPL Token program.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    #[account(address = ephemeral_rollups_sdk::id())]
    /// CHECK: Fixed delegation program.
    pub delegation_program: UncheckedAccount<'info>,
    #[account(address = DEVNET_TEE_VALIDATOR)]
    /// CHECK: Pinned devnet TEE validator.
    pub validator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateCustodyEata<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, CompanyVault>>,
    #[account(mut, address = derive_eata(&vault.key(), &DEVNET_USDC_MINT) @ CustodyError::WrongCustodyEata)]
    /// CHECK: Deterministic program-owned direct eATA.
    pub custody_eata: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_buffer(&custody_eata.key(), &EPHEMERAL_SPL_TOKEN_PROGRAM_ID))]
    /// CHECK: Deterministic eSPL delegation buffer.
    pub custody_eata_buffer: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_record(&custody_eata.key()))]
    /// CHECK: Deterministic delegation record.
    pub custody_eata_record: UncheckedAccount<'info>,
    #[account(mut, address = derive_delegation_metadata(&custody_eata.key()))]
    /// CHECK: Deterministic delegation metadata.
    pub custody_eata_metadata: UncheckedAccount<'info>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: Fixed Ephemeral SPL Token program.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    #[account(address = ephemeral_rollups_sdk::id())]
    /// CHECK: Fixed delegation program.
    pub delegation_program: UncheckedAccount<'info>,
    #[account(address = DEVNET_TEE_VALIDATOR)]
    /// CHECK: Pinned devnet TEE validator.
    pub validator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct InitializePaymentShells<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        bump
    )]
    /// CHECK: Address binds shells to this company's isolated vault even if the vault is delegated.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = company,
        space = PaymentIntent::SPACE,
        seeds = [PAYMENT_INTENT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        bump
    )]
    pub intent: Account<'info, PaymentIntent>,
    #[account(
        init,
        payer = company,
        space = PaymentReceipt::SPACE,
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        bump
    )]
    pub receipt: Account<'info, PaymentReceipt>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateVault<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(mut, del, seeds = [COMPANY_VAULT_SEED, company.key().as_ref()], bump)]
    /// CHECK: Validated by seeds and delegation CPI.
    pub vault: UncheckedAccount<'info>,
    #[account(address = DEVNET_TEE_VALIDATOR)]
    /// CHECK: Pinned devnet TEE validator.
    pub validator: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct DelegateIntent<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(seeds = [COMPANY_VAULT_SEED, company.key().as_ref()], bump)]
    /// CHECK: Address-only vault binding; vault may already be delegated.
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        del,
        seeds = [PAYMENT_INTENT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        bump
    )]
    /// CHECK: Validated by seeds and delegation CPI.
    pub intent: UncheckedAccount<'info>,
    #[account(address = DEVNET_TEE_VALIDATOR)]
    /// CHECK: Pinned devnet TEE validator.
    pub validator: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct DelegateReceipt<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(seeds = [COMPANY_VAULT_SEED, company.key().as_ref()], bump)]
    /// CHECK: Address-only vault binding; vault may already be delegated.
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        del,
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        bump
    )]
    /// CHECK: Validated by seeds and delegation CPI.
    pub receipt: UncheckedAccount<'info>,
    #[account(address = DEVNET_TEE_VALIDATOR)]
    /// CHECK: Pinned devnet TEE validator.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConfigureVaultPrivateAccess<'info> {
    pub company: Signer<'info>,
    #[account(
        mut,
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Account<'info, CompanyVault>,
    #[account(mut, seeds = [PERMISSION_SEED, vault.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    /// CHECK: Permission PDA for vault.
    pub vault_permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program.
    pub permission_program: UncheckedAccount<'info>,
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    /// CHECK: Fixed permission rent vault.
    pub ephemeral_vault: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program.
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct ConfigurePaymentPrivateAccess<'info> {
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Account<'info, CompanyVault>,
    #[account(
        mut,
        seeds = [PAYMENT_INTENT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = intent.bump
    )]
    pub intent: Account<'info, PaymentIntent>,
    #[account(
        mut,
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = receipt.bump
    )]
    pub receipt: Account<'info, PaymentReceipt>,
    #[account(mut, seeds = [PERMISSION_SEED, intent.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    /// CHECK: Permission PDA for intent.
    pub intent_permission: UncheckedAccount<'info>,
    #[account(mut, seeds = [PERMISSION_SEED, receipt.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    /// CHECK: Permission PDA for receipt.
    pub receipt_permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program.
    pub permission_program: UncheckedAccount<'info>,
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    /// CHECK: Fixed permission rent vault.
    pub ephemeral_vault: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program.
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct ConfigurePayment<'info> {
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Account<'info, CompanyVault>,
    #[account(
        mut,
        seeds = [PAYMENT_INTENT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = intent.bump
    )]
    pub intent: Account<'info, PaymentIntent>,
    #[account(
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = receipt.bump
    )]
    pub receipt: Account<'info, PaymentReceipt>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct ApprovePayment<'info> {
    pub approver: Signer<'info>,
    #[account(
        mut,
        seeds = [PAYMENT_INTENT_SEED, intent.vault.as_ref(), payment_id.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, PaymentIntent>,
}

#[derive(Accounts)]
pub struct RotateRecipient<'info> {
    pub company: Signer<'info>,
    #[account(
        mut,
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Account<'info, CompanyVault>,
}

#[derive(Accounts)]
#[instruction(
    payment_id: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    wallet_revision: u64,
    intent_hash: [u8; 32]
)]
pub struct ExecutePrivatePayment<'info> {
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, CompanyVault>>,
    #[account(
        mut,
        seeds = [PAYMENT_INTENT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = intent.bump
    )]
    pub intent: Box<Account<'info, PaymentIntent>>,
    #[account(
        mut,
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = receipt.bump
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    #[account(address = DEVNET_USDC_MINT)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub source_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub destination_token_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[cfg(feature = "test-failure-injection")]
#[derive(Accounts)]
#[instruction(payment_id: [u8; 32], amount: u64)]
pub struct TestFailAfterCpi<'info> {
    pub company: Signer<'info>,
    #[account(
        seeds = [COMPANY_VAULT_SEED, company.key().as_ref()],
        has_one = company,
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, CompanyVault>>,
    #[account(
        mut,
        seeds = [PAYMENT_RECEIPT_SEED, vault.key().as_ref(), payment_id.as_ref()],
        has_one = vault,
        bump = receipt.bump
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    #[account(mut)]
    pub source_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub destination_token_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
