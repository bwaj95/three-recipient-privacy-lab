use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Token, Transfer as TokenTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::CreateEphemeralPermissionCpi,
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
};
use solana_instruction::Instruction;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

declare_id!("FnKajG15Hu4tTENtENAHCau4krTWJUyXUGgdVuLpbTzq");

pub const RECEIPT_SEED: &[u8] = b"private_receipt";

pub const STATUS_INITIALIZED: u8 = 0;
pub const STATUS_PAID: u8 = 1;

fn verify_adjacent_transfer(
    transfer_ix: &Instruction,
    expected_source_ata: Pubkey,
    expected_destination_ata: Pubkey,
    authority: Pubkey,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        transfer_ix.program_id,
        token::ID,
        ReceiptError::InvalidAdjacentTransferProgram
    );
    require!(
        transfer_ix.accounts.len() == 3,
        ReceiptError::InvalidAdjacentTransferAccounts
    );

    let source_meta = &transfer_ix.accounts[0];
    let destination_meta = &transfer_ix.accounts[1];
    let authority_meta = &transfer_ix.accounts[2];

    require!(
        source_meta.pubkey == expected_source_ata
            && source_meta.is_writable
            && !source_meta.is_signer
            && destination_meta.pubkey == expected_destination_ata
            && destination_meta.is_writable
            && !destination_meta.is_signer
            && authority_meta.pubkey == authority
            && authority_meta.is_signer
            && !authority_meta.is_writable,
        ReceiptError::InvalidAdjacentTransferAccounts
    );

    require!(
        transfer_ix.data.len() == 9 && transfer_ix.data[0] == 3,
        ReceiptError::InvalidAdjacentTransferData
    );

    let transferred_amount = u64::from_le_bytes(
        transfer_ix.data[1..9]
            .try_into()
            .map_err(|_| ReceiptError::InvalidAdjacentTransferData)?,
    );
    require!(
        transferred_amount == amount,
        ReceiptError::WrongAdjacentTransferAmount
    );

    Ok(())
}

/// Circle's official Solana devnet USDC mint:
/// 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
pub const DEVNET_USDC_MINT: Pubkey = Pubkey::new_from_array([
    59, 68, 44, 179, 145, 33, 87, 241, 58, 147, 61, 1, 52, 40, 45, 3, 43, 95, 254, 205, 1, 162,
    219, 241, 183, 121, 6, 8, 223, 0, 46, 167,
]);

/// MagicBlock Ephemeral SPL Token program:
/// SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2
pub const EPHEMERAL_SPL_TOKEN_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 128, 200, 234, 115, 202, 172, 225, 29, 240, 193, 184, 192, 229, 47, 173, 17, 234, 44, 108,
    0, 194, 128, 125, 224, 239, 6, 229, 135, 199, 95, 71,
]);

#[ephemeral]
#[program]
pub mod private_counter {
    use super::*;

    /// Creates an empty receipt PDA on the Solana base layer.
    ///
    /// Only the company authority and random receipt ID are public at this
    /// point. Recipient, amount, mint, eATAs and accounting data remain empty.
    ///
    /// The company also prefunds this PDA with enough ephemeral rent for a
    /// three-member permission account:
    ///
    /// 1. company
    /// 2. accountant
    /// 3. recipient
    pub fn initialize_receipt(ctx: Context<InitializeReceipt>, receipt_id: [u8; 32]) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.receipt.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(3) as u32),
        )?;

        let receipt = &mut ctx.accounts.receipt;

        receipt.authority = ctx.accounts.authority.key();
        receipt.receipt_id = receipt_id;

        // Sensitive fields are deliberately empty on the public base layer.
        receipt.accountant = Pubkey::default();
        receipt.recipient = Pubkey::default();
        receipt.source_eata = Pubkey::default();
        receipt.destination_eata = Pubkey::default();
        receipt.mint = Pubkey::default();
        receipt.amount = 0;
        receipt.wallet_revision = 0;
        receipt.intent_hash = [0; 32];
        receipt.settled_at = 0;
        receipt.status = STATUS_INITIALIZED;

        Ok(())
    }

    /// Delegates the receipt PDA to MagicBlock's TEE validator.
    ///
    /// After delegation, the receipt's writable state is maintained inside
    /// the PER. Permission setup happens in `configure_access`.
    pub fn delegate_receipt(
        ctx: Context<DelegateReceiptPrivately>,
        receipt_id: [u8; 32],
    ) -> Result<()> {
        if ctx.accounts.receipt.owner != &ephemeral_rollups_sdk::id() {
            let validator = ctx.accounts.validator.as_ref();

            ctx.accounts.delegate_receipt(
                &ctx.accounts.authority,
                &[
                    RECEIPT_SEED,
                    ctx.accounts.authority.key().as_ref(),
                    receipt_id.as_ref(),
                ],
                DelegateConfig {
                    validator: validator.map(|value| value.key()),
                    ..Default::default()
                },
            )?;
        }

        Ok(())
    }

    /// Creates a private EphemeralPermission for the receipt.
    ///
    /// The permission is created directly as private. Only these wallets are
    /// included as readers:
    ///
    /// - company authority
    /// - accountant
    /// - recipient
    ///
    /// The accountant and recipient are first written only inside the PER.
    pub fn configure_access(
        ctx: Context<ConfigureAccess>,
        accountant: Pubkey,
        recipient: Pubkey,
    ) -> Result<()> {
        let authority = ctx.accounts.receipt.authority;

        require!(
            accountant != Pubkey::default(),
            ReceiptError::InvalidAccountant
        );
        require!(
            recipient != Pubkey::default(),
            ReceiptError::InvalidRecipient
        );
        require!(
            accountant != authority && recipient != authority && accountant != recipient,
            ReceiptError::DuplicateViewer
        );

        // Idempotent recovery: if the permission transaction previously
        // succeeded but the client lost its RPC response, accept the same
        // configuration but reject a conflicting configuration.
        if ctx.accounts.permission.lamports() > 0 {
            require_keys_eq!(
                ctx.accounts.receipt.accountant,
                accountant,
                ReceiptError::AccessAlreadyConfigured
            );
            require_keys_eq!(
                ctx.accounts.receipt.recipient,
                recipient,
                ReceiptError::AccessAlreadyConfigured
            );

            return Ok(());
        }

        let receipt_id = ctx.accounts.receipt.receipt_id;
        let bump = [ctx.bumps.receipt];

        let signer_seeds = [RECEIPT_SEED, authority.as_ref(), receipt_id.as_ref(), &bump];

        let view_flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;

        let members = vec![
            Member {
                flags: view_flags,
                pubkey: authority,
            },
            Member {
                flags: view_flags,
                pubkey: accountant,
            },
            Member {
                flags: view_flags,
                pubkey: recipient,
            },
        ];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.receipt.to_account_info(),
            permissioned_account: ctx.accounts.receipt.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&signer_seeds])?;

        let receipt = &mut ctx.accounts.receipt;
        receipt.accountant = accountant;
        receipt.recipient = recipient;

        Ok(())
    }

    /// Atomically transfers private USDC and writes the payment receipt.
    ///
    /// If the token CPI fails, the receipt remains INITIALIZED.
    /// If receipt serialization fails, the token transfer is rolled back.
    pub fn settle_private_payment(
        ctx: Context<SettlePrivatePayment>,
        recipient: Pubkey,
        amount: u64,
        wallet_revision: u64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, ReceiptError::InvalidAmount);
        require!(intent_hash != [0; 32], ReceiptError::InvalidIntentHash);
        require!(
            ctx.accounts.receipt.status == STATUS_INITIALIZED,
            ReceiptError::AlreadySettled
        );
        require_keys_eq!(
            ctx.accounts.receipt.recipient,
            recipient,
            ReceiptError::WrongRecipient
        );

        let authority = ctx.accounts.authority.key();

        // transferSpl supplies ordinary ATA addresses. Inside the PER,
        // MagicBlock maps their data to private ephemeral balances.
        let expected_source_ata = anchor_spl::associated_token::get_associated_token_address(
            &authority,
            &DEVNET_USDC_MINT,
        );

        let expected_destination_ata = anchor_spl::associated_token::get_associated_token_address(
            &recipient,
            &DEVNET_USDC_MINT,
        );

        let (expected_source_eata, _) = Pubkey::find_program_address(
            &[authority.as_ref(), DEVNET_USDC_MINT.as_ref()],
            &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        );

        let (expected_destination_eata, _) = Pubkey::find_program_address(
            &[recipient.as_ref(), DEVNET_USDC_MINT.as_ref()],
            &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        );

        require_keys_eq!(
            ctx.accounts.source_ata.key(),
            expected_source_ata,
            ReceiptError::WrongSourceEata
        );
        require_keys_eq!(
            ctx.accounts.destination_ata.key(),
            expected_destination_ata,
            ReceiptError::WrongDestinationEata
        );

        // On the PER, delegated eATAs expose an SPL-token-compatible
        // representation. The standard Token Program validates:
        //
        // - source authority
        // - source balance
        // - source/destination mint equality
        // - writable token-account state
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TokenTransfer {
                    from: ctx.accounts.source_ata.to_account_info(),
                    to: ctx.accounts.destination_ata.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // These writes occur only after the CPI succeeds. They are still part
        // of the same SVM transaction and therefore share atomic rollback.
        let receipt = &mut ctx.accounts.receipt;

        receipt.source_eata = expected_source_eata;
        receipt.destination_eata = expected_destination_eata;
        receipt.mint = DEVNET_USDC_MINT;
        receipt.amount = amount;
        receipt.wallet_revision = wallet_revision;
        receipt.intent_hash = intent_hash;
        receipt.settled_at = Clock::get()?.unix_timestamp;
        receipt.status = STATUS_PAID;

        Ok(())
    }

    /// Records a private payment performed by the immediately preceding
    /// top-level SPL Token instruction.
    ///
    /// The PER only maps private balances onto ordinary ATA addresses for a
    /// supported top-level Token Program transfer. Passing those ATA accounts
    /// through this custom program is rejected at PER ingress, so the token
    /// movement and receipt update are kept as two instructions in the same
    /// atomic SVM transaction.
    pub fn record_private_payment(
        ctx: Context<RecordPrivatePayment>,
        recipient: Pubkey,
        amount: u64,
        wallet_revision: u64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, ReceiptError::InvalidAmount);
        require!(intent_hash != [0; 32], ReceiptError::InvalidIntentHash);
        require!(
            ctx.accounts.receipt.status == STATUS_INITIALIZED,
            ReceiptError::AlreadySettled
        );
        require_keys_eq!(
            ctx.accounts.receipt.recipient,
            recipient,
            ReceiptError::WrongRecipient
        );

        let authority = ctx.accounts.authority.key();
        let expected_source_ata = anchor_spl::associated_token::get_associated_token_address(
            &authority,
            &DEVNET_USDC_MINT,
        );
        let expected_destination_ata = anchor_spl::associated_token::get_associated_token_address(
            &recipient,
            &DEVNET_USDC_MINT,
        );

        let instructions_info = ctx.accounts.instructions.to_account_info();
        let current_index = load_current_index_checked(&instructions_info)?;
        require!(current_index > 0, ReceiptError::MissingAdjacentTransfer);

        let transfer_ix =
            load_instruction_at_checked(usize::from(current_index - 1), &instructions_info)?;

        verify_adjacent_transfer(
            &transfer_ix,
            expected_source_ata,
            expected_destination_ata,
            authority,
            amount,
        )?;

        let (expected_source_eata, _) = Pubkey::find_program_address(
            &[authority.as_ref(), DEVNET_USDC_MINT.as_ref()],
            &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        );
        let (expected_destination_eata, _) = Pubkey::find_program_address(
            &[recipient.as_ref(), DEVNET_USDC_MINT.as_ref()],
            &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        );

        let receipt = &mut ctx.accounts.receipt;
        receipt.source_eata = expected_source_eata;
        receipt.destination_eata = expected_destination_eata;
        receipt.mint = DEVNET_USDC_MINT;
        receipt.amount = amount;
        receipt.wallet_revision = wallet_revision;
        receipt.intent_hash = intent_hash;
        receipt.settled_at = Clock::get()?.unix_timestamp;
        receipt.status = STATUS_PAID;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(receipt_id: [u8; 32])]
pub struct InitializeReceipt<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + core::mem::size_of::<PrivateReceipt>(),
        seeds = [
            RECEIPT_SEED,
            authority.key().as_ref(),
            receipt_id.as_ref(),
        ],
        bump
    )]
    pub receipt: Account<'info, PrivateReceipt>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(receipt_id: [u8; 32])]
pub struct DelegateReceiptPrivately<'info> {
    pub authority: Signer<'info>,

    /// CHECK: PDA seeds are checked here. Its original program ownership is
    /// checked by the delegation CPI.
    #[account(
        mut,
        del,
        seeds = [
            RECEIPT_SEED,
            authority.key().as_ref(),
            receipt_id.as_ref(),
        ],
        bump
    )]
    pub receipt: UncheckedAccount<'info>,

    /// CHECK: Checked by the delegation program.
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct ConfigureAccess<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            RECEIPT_SEED,
            receipt.authority.as_ref(),
            receipt.receipt_id.as_ref(),
        ],
        has_one = authority,
        bump
    )]
    pub receipt: Account<'info, PrivateReceipt>,

    /// CHECK: Derived and validated against the Permission Program.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, receipt.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: Fixed Permission Program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    /// CHECK: Fixed ephemeral permission-rent vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: Fixed Magic Program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettlePrivatePayment<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            RECEIPT_SEED,
            receipt.authority.as_ref(),
            receipt.receipt_id.as_ref(),
        ],
        has_one = authority,
        bump
    )]
    pub receipt: Account<'info, PrivateReceipt>,

    /// CHECK: Address is derived and checked in the handler. The Token Program
    /// validates its SPL-token-compatible state during the CPI.
    #[account(mut)]
    pub source_ata: UncheckedAccount<'info>,

    /// CHECK: Address is derived and checked in the handler. The Token Program
    /// validates its SPL-token-compatible state during the CPI.
    #[account(mut)]
    pub destination_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecordPrivatePayment<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            RECEIPT_SEED,
            receipt.authority.as_ref(),
            receipt.receipt_id.as_ref(),
        ],
        has_one = authority,
        bump
    )]
    pub receipt: Account<'info, PrivateReceipt>,

    /// CHECK: Fixed Instructions sysvar, read through checked sysvar helpers.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[account]
pub struct PrivateReceipt {
    /// Company wallet that created the receipt and authorizes settlement.
    pub authority: Pubkey,

    /// Random application-generated ID. It contains no employee information.
    pub receipt_id: [u8; 32],

    /// Authorized accounting reader. Written only after delegation.
    pub accountant: Pubkey,

    /// Authorized recipient. Written only after delegation.
    pub recipient: Pubkey,

    /// Company private USDC eATA.
    pub source_eata: Pubkey,

    /// Recipient private USDC eATA.
    pub destination_eata: Pubkey,

    /// Must equal Circle's devnet USDC mint in this experiment.
    pub mint: Pubkey,

    /// USDC base units: 10_000 means 0.01 USDC.
    pub amount: u64,

    /// Binds settlement to the currently approved recipient wallet revision.
    pub wallet_revision: u64,

    /// Hash of the approved off-chain payment intent.
    pub intent_hash: [u8; 32],

    /// PER execution timestamp.
    pub settled_at: i64,

    /// 0 = INITIALIZED, 1 = PAID.
    pub status: u8,
}

#[error_code]
pub enum ReceiptError {
    #[msg("The accountant wallet is invalid")]
    InvalidAccountant,

    #[msg("The recipient wallet is invalid")]
    InvalidRecipient,

    #[msg("Company, accountant and recipient wallets must be distinct")]
    DuplicateViewer,

    #[msg("The receipt permission already has a different configuration")]
    AccessAlreadyConfigured,

    #[msg("Payment amount must be greater than zero")]
    InvalidAmount,

    #[msg("Payment intent hash cannot be all zeroes")]
    InvalidIntentHash,

    #[msg("This receipt has already been settled")]
    AlreadySettled,

    #[msg("The supplied recipient does not match the authorized receipt recipient")]
    WrongRecipient,

    #[msg("The supplied source is not the company's PER-mapped USDC ATA")]
    WrongSourceEata,

    #[msg("The supplied destination is not the recipient's PER-mapped USDC ATA")]
    WrongDestinationEata,

    #[msg("A matching SPL transfer must immediately precede the receipt update")]
    MissingAdjacentTransfer,

    #[msg("The adjacent payment instruction is not the SPL Token Program")]
    InvalidAdjacentTransferProgram,

    #[msg("The adjacent SPL transfer accounts do not match the approved payment")]
    InvalidAdjacentTransferAccounts,

    #[msg("The adjacent instruction is not an exact SPL Token transfer")]
    InvalidAdjacentTransferData,

    #[msg("The adjacent SPL transfer amount does not match the receipt amount")]
    WrongAdjacentTransferAmount,
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_instruction::AccountMeta;

    const TEST_AMOUNT: u64 = 10_000;

    fn valid_transfer() -> (Instruction, Pubkey, Pubkey, Pubkey) {
        let source = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let mut data = vec![3];
        data.extend_from_slice(&TEST_AMOUNT.to_le_bytes());

        (
            Instruction {
                program_id: token::ID,
                accounts: vec![
                    AccountMeta::new(source, false),
                    AccountMeta::new(destination, false),
                    AccountMeta::new_readonly(authority, true),
                ],
                data,
            },
            source,
            destination,
            authority,
        )
    }

    #[test]
    fn accepts_exact_adjacent_spl_transfer() {
        let (ix, source, destination, authority) = valid_transfer();
        verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT).unwrap();
    }

    #[test]
    fn rejects_wrong_program() {
        let (mut ix, source, destination, authority) = valid_transfer();
        ix.program_id = Pubkey::new_unique();
        assert!(
            verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT).is_err()
        );
    }

    #[test]
    fn rejects_wrong_accounts_or_flags() {
        let (mut ix, source, destination, authority) = valid_transfer();
        ix.accounts[1].is_writable = false;
        assert!(
            verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT).is_err()
        );

        let (mut ix, source, destination, authority) = valid_transfer();
        ix.accounts
            .push(AccountMeta::new_readonly(Pubkey::new_unique(), false));
        assert!(
            verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT).is_err()
        );
    }

    #[test]
    fn rejects_wrong_discriminator_or_amount() {
        let (mut ix, source, destination, authority) = valid_transfer();
        ix.data[0] = 12;
        assert!(
            verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT).is_err()
        );

        let (ix, source, destination, authority) = valid_transfer();
        assert!(
            verify_adjacent_transfer(&ix, source, destination, authority, TEST_AMOUNT + 1,)
                .is_err()
        );
    }
}
