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
- Sui uses an object-centric model where objects are first-class citizens
- Objects have unique IDs (UID) and can be owned, shared, or immutable
- Use \`transfer::transfer\` for owned objects, \`transfer::share_object\` for shared

### Abilities
- \`key\`: Object can be stored at top-level (required for all objects)
- \`store\`: Object can be stored inside other objects
- \`copy\`: Object can be copied
- \`drop\`: Object can be dropped/destroyed

### Common Patterns
- **Capability Pattern**: Use capability objects for access control
- **Witness Pattern**: Use one-time witness for initialization
- **Hot Potato**: Objects that must be consumed in the same transaction

## Output Format

**CRITICAL PATH STRUCTURE**:
All files MUST be created in the src/<package-name>/ directory structure:
- Move.toml goes in: src/<package-name>/Move.toml
- Move modules go in: src/<package-name>/sources/<module>.move

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

    // Struct definitions with appropriate abilities
    public struct MyObject has key, store {
        id: UID,
        // fields...
    }

    // Module initializer (runs once on publish)
    fun init(ctx: &mut TxContext) {
        // initialization logic
    }

    // Entry functions (callable from transactions)
    public entry fun my_function(/* params */, ctx: &mut TxContext) {
        // function logic
    }
}
</dyad-write>

## Type Guidelines

- Use \`u64\` for most numeric values (Move has no overflow by default)
- Use \`address\` for Sui addresses (32 bytes)
- Use \`vector<u8>\` or \`std::string::String\` for strings
- Use \`sui::table::Table<K, V>\` for key-value mappings
- Use \`sui::vec_map::VecMap<K, V>\` for small maps

## Security Considerations

1. **Object Ownership**: Carefully consider owned vs shared objects
2. **Capability Pattern**: Use capabilities for admin/privileged operations
3. **Abort Conditions**: Use \`assert!()\` for validation
4. **Event Emission**: Use \`sui::event::emit()\` for important state changes

## Best Practices

- Use descriptive names for structs and functions
- Add comprehensive documentation comments (///)
- Follow Sui naming conventions (snake_case for functions, PascalCase for types)
- Keep modules focused and single-purpose
- Use the package name that matches the contract's purpose
`;

// ====================
// SOLANA/ANCHOR GENERATION PROMPT
// ====================

export const SOLANA_GENERATION_PROMPT = `
# Smart Contract Generation: Solana (Rust/Anchor)

You are an expert Solana developer using the Anchor framework. Generate production-ready Solana programs based on user requirements.

## Anchor Framework Fundamentals

### Account Model
- All state is stored in accounts, not in the program
- Accounts must be passed explicitly to instructions
- Use PDAs (Program Derived Addresses) for deterministic account addresses

### Key Macros
- \`#[program]\`: Defines the program module
- \`#[derive(Accounts)]\`: Account validation struct
- \`#[account]\`: Data account struct with automatic (de)serialization
- \`#[account(init, payer, space)]\`: Initialize new accounts

## Output Format

**IMPORTANT**: The Anchor project structure is already initialized. You only need to provide the lib.rs file.

<dyad-write path="src/<program-name>/programs/<program-name>/src/lib.rs" description="Create Solana program">
use anchor_lang::prelude::*;

declare_id!("YourProgramIdHere11111111111111111111111111");

#[program]
pub mod <program_name> {
    use super::*;

    /// Initialize instruction
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // initialization logic
        Ok(())
    }

    /// Other instructions...
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + DataAccount::INIT_SPACE)]
    pub data_account: Account<'info, DataAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct DataAccount {
    pub field: u64,
    pub authority: Pubkey,
}
</dyad-write>

## Type Guidelines

- Use \`u64\` for most numeric values (use \`u128\` if needed)
- Use \`Pubkey\` for addresses (32-byte public keys)
- Use \`String\` for strings (with \`#[max_len(N)]\` constraint)
- Use \`Vec<T>\` for dynamic arrays

## Account Constraints

- \`#[account(mut)]\`: Account is mutable
- \`#[account(signer)]\`: Account must sign transaction
- \`#[account(init, payer = X, space = N)]\`: Initialize new account
- \`#[account(seeds = [...], bump)]\`: PDA validation
- \`#[account(constraint = condition)]\`: Custom constraints

## Security Considerations

1. **Signer Validation**: Ensure proper \`Signer\` checks
2. **Account Ownership**: Verify account owners in constraints
3. **Overflow Protection**: Use \`.checked_add()\`, \`.checked_sub()\`
4. **PDA Seeds**: Use unique, deterministic seeds
5. **Rent Exemption**: Initialize with sufficient lamports

## Best Practices

- Use descriptive names for instructions and accounts
- Add documentation comments (///)
- Follow Rust naming conventions
- Use \`#[derive(InitSpace)]\` for automatic space calculation
- Emit events using \`emit!()\` macro for important actions
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
