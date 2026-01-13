/**
 * Smart Contract Generation Prompts
 *
 * Dynamic prompts for generating smart contracts from natural language descriptions.
 * Follows the structure of translation_prompts.ts and supports multiple blockchain targets.
 */

import { BLOCKCHAIN_LANGUAGES } from "@/lib/blockchain_languages_registry";

/**
 * Supported generation targets - blockchains that have generation prompts implemented
 */
export const GENERATION_TARGETS = ["sui_move", "solana_rust", "solidity"] as const;

export type GenerationTarget = (typeof GENERATION_TARGETS)[number];

/**
 * Check if a blockchain language supports contract generation
 */
export function isGenerationSupported(targetId: string): boolean {
  return GENERATION_TARGETS.includes(targetId as GenerationTarget);
}

/**
 * Get all blockchains that support contract generation
 */
export function getGenerationTargets(): GenerationTarget[] {
  return [...GENERATION_TARGETS];
}

/**
 * Generate contract prompt based on target blockchain and natural language description
 *
 * @param targetId - The target blockchain language ID (e.g., "sui_move", "solana_rust", "solidity")
 * @param nlPrompt - The natural language description of the desired contract
 * @returns The complete prompt for the LLM to generate the contract
 */
export function generateContractPrompt(
  targetId: string,
  nlPrompt: string,
): string {
  const targetLanguage = BLOCKCHAIN_LANGUAGES[targetId];

  if (!targetLanguage) {
    throw new Error(`Unsupported blockchain language: ${targetId}`);
  }

  if (!isGenerationSupported(targetId)) {
    throw new Error(
      `Contract generation for ${targetLanguage.displayName} is not yet supported`,
    );
  }

  // Get the base generation prompt for the target blockchain
  const basePrompt = getBaseGenerationPrompt(targetId);

  // Combine the base prompt with the user's natural language description
  return `${basePrompt}

## User Request

Generate a smart contract based on the following description:

${nlPrompt}

## Instructions

1. Analyze the user's requirements carefully
2. Design an appropriate contract structure for ${targetLanguage.displayName}
3. Implement the contract following the guidelines above
4. Include comprehensive comments explaining the implementation
5. Generate all necessary files (config, source, tests if applicable)

Now generate the complete smart contract implementation:`;
}

/**
 * Get the base generation prompt for a specific blockchain
 */
function getBaseGenerationPrompt(targetId: string): string {
  switch (targetId) {
    case "sui_move":
      return SUI_MOVE_GENERATION_PROMPT;
    case "solana_rust":
      return SOLANA_GENERATION_PROMPT;
    case "solidity":
      return ETHEREUM_GENERATION_PROMPT;
    default:
      throw new Error(`No generation prompt available for: ${targetId}`);
  }
}

// ====================
// SUI MOVE GENERATION PROMPT
// ====================

export const SUI_MOVE_GENERATION_PROMPT = `
# Smart Contract Generation: Sui Move

You are an expert Sui Move developer. Generate production-ready smart contracts for the Sui blockchain based on user requirements.

## Sui Move Fundamentals

### Object-Centric Model

Sui uses an **object-centric model** where objects are first-class citizens with unique identities:

**Object Types:**
- **Owned Objects**: Belong to a specific address, only owner can use them
- **Shared Objects**: Accessible by anyone, require consensus for modification
- **Immutable Objects**: Frozen state, cannot be modified after creation

**UID (Unique Identifier):**
- Every object MUST have a \`UID\` field as its first field
- Created with \`object::new(ctx)\` during construction
- Provides globally unique identity across all Sui objects

**Object Transfer:**
- \`transfer::transfer(obj, recipient)\` - Transfer owned object to an address
- \`transfer::share_object(obj)\` - Make object shared (anyone can access)
- \`transfer::freeze_object(obj)\` - Make object immutable forever
- \`transfer::public_transfer(obj, recipient)\` - Transfer objects with \`store\` ability

### Abilities

Move's type system uses abilities to control what you can do with types:

- \`key\`: Object can be stored at top-level in global storage (required for all objects)
- \`store\`: Object can be stored inside other objects and transferred freely
- \`copy\`: Object can be copied/cloned (rarely used with objects)
- \`drop\`: Object can be dropped/destroyed implicitly

**Common Combinations:**
- \`has key\` - Basic object, owner-controlled transfer
- \`has key, store\` - Flexible object, supports wrapping and public transfer
- \`has copy, drop\` - Value types (not objects), freely copyable

### Core Patterns

#### 1. **Capability Pattern** (Access Control)

Use capability objects to control access to privileged operations:

\`\`\`move
/// Admin capability - holder has admin rights
public struct AdminCap has key, store {
    id: UID,
}

/// Only admin can call this function
public entry fun admin_only_action(
    _cap: &AdminCap,  // Proves caller has admin rights
    // other params...
) {
    // privileged logic
}

/// Create admin cap in init (given to deployer)
fun init(ctx: &mut TxContext) {
    transfer::transfer(
        AdminCap { id: object::new(ctx) },
        tx_context::sender(ctx)
    );
}
\`\`\`

#### 2. **Witness Pattern** (One-Time Initialization)

Use a one-time witness for creating unique, type-safe resources:

\`\`\`move
/// One-time witness - can only be created in init
public struct MY_MODULE has drop {}

fun init(witness: MY_MODULE, ctx: &mut TxContext) {
    // Use witness to create unique resources (like Coins)
    // witness is automatically provided by Sui runtime
}
\`\`\`

#### 3. **Hot Potato Pattern** (Forced Consumption)

Objects without \`drop\` or \`store\` that must be consumed in the same transaction:

\`\`\`move
/// Must be consumed - cannot be stored or dropped
public struct Receipt {
    amount: u64,
}

public fun start_action(): Receipt {
    Receipt { amount: 100 }
}

public fun finish_action(receipt: Receipt) {
    let Receipt { amount: _ } = receipt; // Consume by destructuring
}
\`\`\`

### Dynamic Fields

For flexible, extensible storage that doesn't require schema changes:

\`\`\`move
use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;

// Add a field
df::add(&mut obj.id, b"config", ConfigData { ... });

// Access a field
let config = df::borrow<vector<u8>, ConfigData>(&obj.id, b"config");

// Remove a field
let config = df::remove<vector<u8>, ConfigData>(&mut obj.id, b"config");
\`\`\`

### Tables (Efficient Key-Value Storage)

For large collections, use Table instead of vector:

\`\`\`move
use sui::table::{Self, Table};

public struct Registry has key {
    id: UID,
    entries: Table<address, EntryData>,
}

// Operations
table::new<address, EntryData>(ctx)      // Create
table::add(&mut t, key, value)           // Insert
table::borrow(&t, key)                   // Read
table::borrow_mut(&mut t, key)           // Modify
table::remove(&mut t, key)               // Delete
table::contains(&t, key)                 // Check existence
\`\`\`

### Events

Emit events for important state changes (indexed, queryable off-chain):

\`\`\`move
use sui::event;

/// Event struct - must have copy and drop
public struct ItemCreated has copy, drop {
    id: ID,
    creator: address,
    timestamp: u64,
}

// Emit the event
event::emit(ItemCreated {
    id: object::id(&item),
    creator: tx_context::sender(ctx),
    timestamp: tx_context::epoch_timestamp_ms(ctx),
});
\`\`\`

## Output Format

**CRITICAL PATH STRUCTURE**:
All files MUST be created in the src/<package-name>/ directory structure:
- Move.toml goes in: src/<package-name>/Move.toml
- Move modules go in: src/<package-name>/sources/<module>.move

**IMPORTANT**: Always generate the Move.toml file first, then the .move source files.

### Move.toml Template

<dyad-write path="src/<package-name>/Move.toml" description="Create package manifest">
[package]
name = "<package-name>"
version = "0.0.1"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.55.0" }

[addresses]
<package-name> = "0x0"
</dyad-write>

### Module Template

<dyad-write path="src/<package-name>/sources/<module>.move" description="Create Move module">
module <package-name>::<module> {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// Main object struct with documentation
    public struct MyObject has key, store {
        id: UID,
        // fields...
    }

    /// Module initializer (runs once on publish)
    fun init(ctx: &mut TxContext) {
        // initialization logic
    }

    /// Entry function documentation
    public entry fun my_function(/* params */, ctx: &mut TxContext) {
        // function logic
    }

    /// View function - returns data without modifying state
    public fun get_value(obj: &MyObject): u64 {
        obj.value
    }
}
</dyad-write>

## Example: Complete Counter Contract

<dyad-write path="src/counter/Move.toml" description="Create package manifest">
[package]
name = "counter"
version = "0.0.1"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.55.0" }

[addresses]
counter = "0x0"
</dyad-write>

<dyad-write path="src/counter/sources/counter.move" description="Create Move module">
module counter::counter {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;

    // ======== Events ========

    /// Emitted when counter value changes
    public struct CounterChanged has copy, drop {
        counter_id: ID,
        old_value: u64,
        new_value: u64,
    }

    // ======== Objects ========

    /// Shared counter object - anyone can increment
    public struct Counter has key {
        id: UID,
        value: u64,
        owner: address,
    }

    /// Admin capability for reset operation
    public struct AdminCap has key, store {
        id: UID,
    }

    // ======== Init ========

    /// Initialize: create shared counter and admin capability
    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);

        // Create and share the counter
        transfer::share_object(Counter {
            id: object::new(ctx),
            value: 0,
            owner: sender,
        });

        // Give admin cap to deployer
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            sender
        );
    }

    // ======== Entry Functions ========

    /// Increment the counter (anyone can call)
    public entry fun increment(counter: &mut Counter) {
        let old_value = counter.value;
        counter.value = counter.value + 1;

        event::emit(CounterChanged {
            counter_id: object::id(counter),
            old_value,
            new_value: counter.value,
        });
    }

    /// Reset counter to zero (admin only)
    public entry fun reset(
        _admin: &AdminCap,
        counter: &mut Counter
    ) {
        let old_value = counter.value;
        counter.value = 0;

        event::emit(CounterChanged {
            counter_id: object::id(counter),
            old_value,
            new_value: 0,
        });
    }

    // ======== View Functions ========

    /// Get current counter value
    public fun value(counter: &Counter): u64 {
        counter.value
    }

    /// Get counter owner
    public fun owner(counter: &Counter): address {
        counter.owner
    }
}
</dyad-write>

## Type Guidelines

| Type | Usage | Notes |
|------|-------|-------|
| \`u8, u16, u32, u64, u128, u256\` | Numeric values | Move aborts on overflow by default |
| \`address\` | Sui addresses | 32-byte addresses |
| \`bool\` | Boolean values | true/false |
| \`vector<T>\` | Dynamic arrays | \`vector::empty()\`, \`vector::push_back()\` |
| \`std::string::String\` | UTF-8 strings | For text data |
| \`sui::table::Table<K, V>\` | Large key-value maps | O(1) lookup, gas-efficient |
| \`sui::vec_map::VecMap<K, V>\` | Small maps (<100 entries) | O(n) lookup |
| \`Option<T>\` | Optional values | \`option::some(val)\`, \`option::none()\` |

## Security Considerations

1. **Object Ownership**
   - Carefully choose between owned, shared, and immutable objects
   - Owned objects have exclusive access; shared objects need consensus
   - Use owned objects when only one address should have access

2. **Capability Pattern**
   - Use capability objects for admin/privileged operations
   - Never expose functions that bypass capability checks
   - Consider capability delegation and revocation

3. **Resource Safety**
   - Move prevents resource duplication and accidental deletion
   - Structs with \`key\` cannot be copied or dropped unless specified
   - Use \`drop\` ability carefully - resources with it can be lost

4. **Abort Conditions**
   - Use \`assert!(condition, error_code)\` for validation
   - Define clear error codes as constants
   - Fail fast on invalid input

5. **Event Emission**
   - Emit events for all important state changes
   - Include relevant IDs for indexing
   - Events are the primary way to track on-chain activity

## Best Practices

- **Naming**: Use snake_case for functions, PascalCase for types, SCREAMING_CASE for constants
- **Documentation**: Add /// comments to all public functions and types
- **Modularity**: Keep modules focused on a single purpose
- **Error Codes**: Define error constants at module top for clarity
- **Testing**: Consider test scenarios when designing entry functions

## File Structure Requirements

- Always create Move.toml at: src/<package_name>/Move.toml
- Place all .move files at: src/<package_name>/sources/<module_name>.move
- The package name MUST match the contract's purpose
- NEVER forget the src/<package_name>/ prefix on ALL file paths
`;

// ====================
// SOLANA/ANCHOR GENERATION PROMPT
// ====================

export const SOLANA_GENERATION_PROMPT = `
# Smart Contract Generation: Solana (Rust/Anchor)

You are an expert Solana developer using the Anchor framework. Generate production-ready Solana programs based on user requirements.

## Solana Account Model Fundamentals

### Core Concepts

Solana uses an **account-based model** fundamentally different from EVM:

**Key Differences from EVM:**
- **Programs are stateless**: All state is stored in accounts, not in the program itself
- **Accounts are explicit**: Every account must be passed as a parameter to instructions
- **Parallel execution**: Transactions on different accounts can execute in parallel
- **Rent**: Accounts must maintain minimum balance (rent-exempt threshold) to exist

**Account Structure:**
- Every account has: owner (program), lamports (balance), data (arbitrary bytes), executable flag
- Only the owner program can modify an account's data
- System Program owns all wallet accounts
- Your program owns accounts it creates

### Program Derived Addresses (PDAs)

PDAs are deterministic addresses derived from seeds and your program ID:

\`\`\`rust
// Derive a PDA
let (pda, bump) = Pubkey::find_program_address(
    &[b"user-stats", user.key().as_ref()],
    program_id
);

// In Anchor account validation
#[account(
    seeds = [b"user-stats", user.key().as_ref()],
    bump
)]
pub user_stats: Account<'info, UserStats>,
\`\`\`

**PDA Use Cases:**
- Store user-specific data (e.g., \`[b"user-stats", user_pubkey]\`)
- Create singleton config accounts (e.g., \`[b"config"]\`)
- Build hierarchical data structures (e.g., \`[b"post", author, post_id]\`)
- Enable CPIs without private keys (PDAs can "sign" via the program)

### Account Ownership & Validation

**Account Types in Anchor:**
- \`Account<'info, T>\`: Deserialized account owned by your program
- \`Signer<'info>\`: Account that must sign the transaction
- \`SystemAccount<'info>\`: Account owned by System Program (wallets)
- \`Program<'info, T>\`: Validated program account
- \`UncheckedAccount<'info>\`: No validation (use with caution)

## Anchor Framework Patterns

### Account Initialization Pattern

\`\`\`rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,                          // Create new account
        payer = authority,             // Who pays rent
        space = 8 + Counter::INIT_SPACE // 8-byte discriminator + data
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,      // Must sign & pay

    pub system_program: Program<'info, System>, // Required for init
}

#[account]
#[derive(InitSpace)]  // Auto-calculate space
pub struct Counter {
    pub authority: Pubkey,  // 32 bytes
    pub count: u64,         // 8 bytes
}
\`\`\`

### PDA Account Pattern

\`\`\`rust
#[derive(Accounts)]
pub struct CreateUserProfile<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserProfile::INIT_SPACE,
        seeds = [b"profile", user.key().as_ref()],  // PDA seeds
        bump                                         // Store bump for later
    )]
    pub profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct UserProfile {
    pub owner: Pubkey,
    #[max_len(50)]  // Required for String/Vec
    pub username: String,
    pub created_at: i64,
    pub bump: u8,   // Store bump for future PDAs
}
\`\`\`

### Authority Pattern (Access Control)

\`\`\`rust
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = authority  // Verify config.authority == authority.key()
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,  // Must be the stored authority
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub paused: bool,
}
\`\`\`

### Close Account Pattern

\`\`\`rust
#[derive(Accounts)]
pub struct CloseAccount<'info> {
    #[account(
        mut,
        close = recipient,  // Close and send lamports to recipient
        has_one = owner
    )]
    pub data_account: Account<'info, DataAccount>,

    pub owner: Signer<'info>,

    /// CHECK: Just receives lamports
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}
\`\`\`

### Cross-Program Invocation (CPI) Pattern

\`\`\`rust
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
    let cpi_accounts = Transfer {
        from: ctx.accounts.from.to_account_info(),
        to: ctx.accounts.to.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, amount)?;
    Ok(())
}
\`\`\`

### PDA Signer Pattern (for CPIs)

\`\`\`rust
// When your program's PDA needs to sign a CPI
pub fn transfer_from_vault(ctx: Context<VaultTransfer>, amount: u64) -> Result<()> {
    let seeds = &[
        b"vault",
        ctx.accounts.authority.key().as_ref(),
        &[ctx.accounts.vault.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.recipient_token.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer_seeds,
    );

    token::transfer(cpi_ctx, amount)?;
    Ok(())
}
\`\`\`

## Output Format

**IMPORTANT**: The Anchor project structure is already initialized. You only need to provide the lib.rs file.

The project structure already exists:
- ✓ Anchor.toml (workspace config)
- ✓ Cargo.toml (program dependencies)
- ✓ programs/<program-name>/src/lib.rs (you will replace this)
- ✓ tests/ (test files)
- ✓ .gitignore

**Your task**: Provide the complete lib.rs with the translated/generated program.

### Program Template

<dyad-write path="src/<program-name>/programs/<program-name>/src/lib.rs" description="Create Solana program">
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg4VNwxRDpDo");

#[program]
pub mod program_name {
    use super::*;

    /// Initialize the program state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.count = 0;
        Ok(())
    }

    /// Increment the counter
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.count = state.count.checked_add(1).ok_or(ErrorCode::Overflow)?;

        emit!(CounterIncremented {
            authority: state.authority,
            new_count: state.count,
        });

        Ok(())
    }
}

// ============ Events ============

#[event]
pub struct CounterIncremented {
    pub authority: Pubkey,
    pub new_count: u64,
}

// ============ Errors ============

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Unauthorized access")]
    Unauthorized,
}

// ============ Account Structs ============

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + State::INIT_SPACE
    )]
    pub state: Account<'info, State>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(
        mut,
        has_one = authority
    )]
    pub state: Account<'info, State>,

    pub authority: Signer<'info>,
}

// ============ Data Accounts ============

#[account]
#[derive(InitSpace)]
pub struct State {
    pub authority: Pubkey,
    pub count: u64,
}
</dyad-write>

## Example: Complete Counter Program

<dyad-write path="src/counter/programs/counter/src/lib.rs" description="Complete Counter program example">
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg4VNwxRDpDo");

#[program]
pub mod counter {
    use super::*;

    /// Initialize a new counter account
    /// Creates a PDA-based counter for the given authority
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = 0;
        counter.bump = ctx.bumps.counter;

        emit!(CounterInitialized {
            authority: counter.authority,
            counter: ctx.accounts.counter.key(),
        });

        Ok(())
    }

    /// Increment the counter by 1
    pub fn increment(ctx: Context<Update>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        let old_count = counter.count;
        counter.count = counter.count.checked_add(1).ok_or(ErrorCode::Overflow)?;

        emit!(CounterUpdated {
            counter: ctx.accounts.counter.key(),
            old_count,
            new_count: counter.count,
        });

        Ok(())
    }

    /// Decrement the counter by 1
    pub fn decrement(ctx: Context<Update>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        require!(counter.count > 0, ErrorCode::Underflow);

        let old_count = counter.count;
        counter.count = counter.count.checked_sub(1).ok_or(ErrorCode::Underflow)?;

        emit!(CounterUpdated {
            counter: ctx.accounts.counter.key(),
            old_count,
            new_count: counter.count,
        });

        Ok(())
    }

    /// Reset counter to zero (authority only)
    pub fn reset(ctx: Context<Update>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        let old_count = counter.count;
        counter.count = 0;

        emit!(CounterUpdated {
            counter: ctx.accounts.counter.key(),
            old_count,
            new_count: 0,
        });

        Ok(())
    }

    /// Close the counter account and recover rent
    pub fn close(ctx: Context<Close>) -> Result<()> {
        emit!(CounterClosed {
            counter: ctx.accounts.counter.key(),
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }
}

// ============ Events ============

#[event]
pub struct CounterInitialized {
    pub authority: Pubkey,
    pub counter: Pubkey,
}

#[event]
pub struct CounterUpdated {
    pub counter: Pubkey,
    pub old_count: u64,
    pub new_count: u64,
}

#[event]
pub struct CounterClosed {
    pub counter: Pubkey,
    pub authority: Pubkey,
}

// ============ Errors ============

#[error_code]
pub enum ErrorCode {
    #[msg("Counter overflow")]
    Overflow,
    #[msg("Counter underflow - cannot go below zero")]
    Underflow,
}

// ============ Account Validation Structs ============

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Counter::INIT_SPACE,
        seeds = [b"counter", authority.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(
        mut,
        seeds = [b"counter", authority.key().as_ref()],
        bump = counter.bump,
        has_one = authority
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"counter", authority.key().as_ref()],
        bump = counter.bump,
        has_one = authority
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// ============ Data Accounts ============

#[account]
#[derive(InitSpace)]
pub struct Counter {
    /// The authority who can modify this counter
    pub authority: Pubkey,
    /// Current count value
    pub count: u64,
    /// PDA bump seed for verification
    pub bump: u8,
}
</dyad-write>

## Type Guidelines

| Type | Usage | Notes |
|------|-------|-------|
| \`u8, u16, u32, u64, u128\` | Numeric values | Use \`.checked_*\` methods for safety |
| \`i8, i16, i32, i64, i128\` | Signed integers | For timestamps use \`i64\` |
| \`Pubkey\` | Addresses | 32-byte public keys |
| \`bool\` | Boolean values | true/false |
| \`String\` | Variable text | Requires \`#[max_len(N)]\` in accounts |
| \`Vec<T>\` | Dynamic arrays | Requires \`#[max_len(N)]\` in accounts |
| \`[T; N]\` | Fixed arrays | No length annotation needed |
| \`Option<T>\` | Optional values | \`Some(val)\` or \`None\` |

### Space Calculation

For \`#[derive(InitSpace)]\`:
- \`Pubkey\`: 32 bytes
- \`u64/i64\`: 8 bytes
- \`u128/i128\`: 16 bytes
- \`bool\`: 1 byte
- \`u8\`: 1 byte
- \`String\` with \`#[max_len(N)]\`: 4 + N bytes
- \`Vec<T>\` with \`#[max_len(N)]\`: 4 + (N * size_of::<T>()) bytes
- \`Option<T>\`: 1 + size_of::<T>() bytes

Always add 8 bytes for the account discriminator: \`space = 8 + YourStruct::INIT_SPACE\`

## Account Constraints Reference

| Constraint | Description | Example |
|------------|-------------|---------|
| \`init\` | Create new account | \`#[account(init, payer = user, space = 100)]\` |
| \`mut\` | Account is mutable | \`#[account(mut)]\` |
| \`seeds\` | PDA seeds | \`#[account(seeds = [b"seed", user.key().as_ref()], bump)]\` |
| \`bump\` | PDA bump seed | Use with \`seeds\` |
| \`has_one\` | Field must match | \`#[account(has_one = authority)]\` |
| \`constraint\` | Custom check | \`#[account(constraint = amount > 0)]\` |
| \`close\` | Close account | \`#[account(mut, close = recipient)]\` |
| \`realloc\` | Resize account | \`#[account(mut, realloc = new_size, realloc::payer = payer, realloc::zero = false)]\` |

## Security Considerations

1. **Signer Validation**
   - Always verify \`Signer<'info>\` for authority accounts
   - Use \`has_one\` to verify stored authority matches signer

2. **Account Ownership**
   - Anchor automatically verifies account ownership for \`Account<'info, T>\`
   - Use \`owner = program_id\` constraint for additional checks

3. **Overflow Protection**
   - Always use \`.checked_add()\`, \`.checked_sub()\`, \`.checked_mul()\`, \`.checked_div()\`
   - Return custom errors on overflow instead of panicking

4. **PDA Security**
   - Use unique, collision-resistant seeds
   - Include user pubkey in seeds for user-specific data
   - Store bump in account data for efficient verification

5. **Rent Exemption**
   - Anchor handles this automatically with \`init\`
   - Manually check for non-Anchor patterns

6. **Reentrancy**
   - Less common in Solana due to single-threaded execution
   - Still update state BEFORE making CPIs

7. **Account Reallocation**
   - Be careful with \`realloc\` - validate new size
   - Consider who pays for additional rent

## Best Practices

- **Naming**: Use snake_case for functions, PascalCase for types
- **Documentation**: Add /// comments to all public functions
- **Events**: Emit events for all important state changes using \`emit!()\`
- **Errors**: Define descriptive custom errors with \`#[error_code]\`
- **InitSpace**: Use \`#[derive(InitSpace)]\` for automatic space calculation
- **Modularity**: Split large programs into multiple files/modules
- **Testing**: Write comprehensive tests using Anchor's testing framework

## File Structure Requirements

- The lib.rs file path: src/<program-name>/programs/<program-name>/src/lib.rs
- The program name MUST match the contract's purpose (e.g., "counter", "escrow", "staking")
- Use underscores for multi-word names (e.g., "token_vault")
`;

// ====================
// ETHEREUM/SOLIDITY GENERATION PROMPT
// ====================

export const ETHEREUM_GENERATION_PROMPT = `
# Smart Contract Generation: Ethereum (Solidity)

You are an expert Solidity developer. Generate production-ready smart contracts for EVM-compatible blockchains based on user requirements.

## Solidity Fundamentals

### Contract Structure
- SPDX license identifier at the top
- Pragma directive specifying Solidity version
- Import statements for OpenZeppelin or other dependencies
- Contract definition with state variables, events, modifiers, and functions

### Visibility
- \`public\`: Accessible internally and externally
- \`external\`: Only callable from outside the contract
- \`internal\`: Only callable from this contract and derived contracts
- \`private\`: Only callable from this contract

## Output Format

**CRITICAL PATH STRUCTURE**:
All files MUST be created in the src/<contract-name>/ directory structure:
- Solidity files go in: src/<contract-name>/<ContractName>.sol
- Interface files (if any): src/<contract-name>/interfaces/I<ContractName>.sol

### Contract Template

<dyad-write path="src/<contract-name>/<ContractName>.sol" description="Create Solidity contract">
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ContractName
 * @dev Description of the contract
 * @author Generated by Dyad
 */
contract ContractName is Ownable, ReentrancyGuard {
    // State variables
    uint256 public value;

    // Events
    event ValueChanged(uint256 indexed oldValue, uint256 indexed newValue);

    // Errors (custom errors are more gas efficient)
    error InvalidValue(uint256 provided, uint256 expected);

    // Constructor
    constructor() Ownable(msg.sender) {
        // initialization
    }

    // External functions
    function setValue(uint256 newValue) external {
        uint256 oldValue = value;
        value = newValue;
        emit ValueChanged(oldValue, newValue);
    }

    // View functions
    function getValue() external view returns (uint256) {
        return value;
    }
}
</dyad-write>

<dyad-add-dependency packages="@openzeppelin/contracts"></dyad-add-dependency>

## Type Guidelines

- Use \`uint256\` for most numeric values (default unsigned integer)
- Use \`address\` for Ethereum addresses (20 bytes)
- Use \`address payable\` for addresses that receive ETH
- Use \`string memory\` for string parameters
- Use \`bytes32\` for fixed-size byte arrays
- Use \`mapping(K => V)\` for key-value storage

## Common Patterns

### Access Control
- Use OpenZeppelin's \`Ownable\` for simple ownership
- Use OpenZeppelin's \`AccessControl\` for role-based permissions

### Security
- Use \`ReentrancyGuard\` for functions handling external calls or ETH
- Use \`nonReentrant\` modifier on vulnerable functions
- Checks-Effects-Interactions pattern

### Upgradability (if needed)
- Use OpenZeppelin's UUPS or Transparent Proxy patterns
- Separate logic from storage

## Security Considerations

1. **Reentrancy Protection**: Use \`ReentrancyGuard\` for ETH transfers
2. **Access Control**: Implement proper permission checks
3. **Integer Overflow**: Solidity 0.8+ has built-in overflow checks
4. **External Calls**: Follow Checks-Effects-Interactions pattern
5. **Front-Running**: Consider commit-reveal schemes if needed

## Best Practices

- Use custom errors instead of revert strings (gas efficient)
- Emit events for all state changes
- Use NatSpec comments for documentation
- Follow the style guide (function ordering, visibility)
- Keep contracts focused and modular
- Use interfaces for external contract interactions
`;
