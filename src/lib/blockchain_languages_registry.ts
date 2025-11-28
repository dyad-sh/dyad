/**
 * Blockchain Language Registry
 *
 * Central registry for all supported blockchain smart contract languages,
 * their metadata, and translation capabilities.
 */

export interface BlockchainLanguage {
  id: string;
  name: string;
  displayName: string;
  fileExtension: string;
  monacoLanguageId: string;
  description: string;
  ecosystem: string[];
  category: "evm" | "move" | "wasm" | "non-evm";
  icon?: string; // Optional emoji or icon identifier
  documentationUrl?: string;
  features: {
    hasObjects?: boolean; // Object-oriented like Sui Move
    hasCapabilities?: boolean; // Capability-based security
    hasResourceSafety?: boolean; // Linear types/resource safety
    supportsParallelExecution?: boolean;
  };
}

export const BLOCKCHAIN_LANGUAGES: Record<string, BlockchainLanguage> = {
  solidity: {
    id: "solidity",
    name: "solidity",
    displayName: "Solidity",
    fileExtension: ".sol",
    monacoLanguageId: "sol",
    description: "EVM smart contract language",
    ecosystem: ["Ethereum", "Polygon", "BSC", "Arbitrum", "Optimism"],
    category: "evm",
    icon: "⟠",
    documentationUrl: "https://docs.soliditylang.org",
    features: {
      hasObjects: false,
      hasCapabilities: false,
      hasResourceSafety: false,
      supportsParallelExecution: false,
    },
  },

  sui_move: {
    id: "sui_move",
    name: "sui_move",
    displayName: "Sui Move",
    fileExtension: ".move",
    monacoLanguageId: "move",
    description: "Object-centric Move for Sui blockchain",
    ecosystem: ["Sui"],
    category: "move",
    icon: "🌊",
    documentationUrl: "https://docs.sui.io/build/move",
    features: {
      hasObjects: true,
      hasCapabilities: true,
      hasResourceSafety: true,
      supportsParallelExecution: true,
    },
  },

  aptos_move: {
    id: "aptos_move",
    name: "aptos_move",
    displayName: "Aptos Move",
    fileExtension: ".move",
    monacoLanguageId: "move",
    description: "Account-centric Move for Aptos blockchain",
    ecosystem: ["Aptos"],
    category: "move",
    icon: "🅰️",
    documentationUrl: "https://aptos.dev/move/move-on-aptos",
    features: {
      hasObjects: false,
      hasCapabilities: true,
      hasResourceSafety: true,
      supportsParallelExecution: true,
    },
  },

  solana_rust: {
    id: "solana_rust",
    name: "solana_rust",
    displayName: "Rust/Anchor",
    fileExtension: ".rs",
    monacoLanguageId: "rust",
    description: "Rust-based programs for Solana (often using Anchor framework)",
    ecosystem: ["Solana"],
    category: "non-evm",
    icon: "◎",
    documentationUrl: "https://docs.solana.com/developing/on-chain-programs/overview",
    features: {
      hasObjects: false,
      hasCapabilities: false,
      hasResourceSafety: true,
      supportsParallelExecution: true,
    },
  },

  cairo: {
    id: "cairo",
    name: "cairo",
    displayName: "Cairo",
    fileExtension: ".cairo",
    monacoLanguageId: "cairo",
    description: "StarkNet's Turing-complete language",
    ecosystem: ["StarkNet", "StarkEx"],
    category: "non-evm",
    icon: "🏛️",
    documentationUrl: "https://www.cairo-lang.org/docs",
    features: {
      hasObjects: false,
      hasCapabilities: false,
      hasResourceSafety: false,
      supportsParallelExecution: false,
    },
  },

  vyper: {
    id: "vyper",
    name: "vyper",
    displayName: "Vyper",
    fileExtension: ".vy",
    monacoLanguageId: "python", // Vyper is Python-like
    description: "Pythonic smart contract language for EVM",
    ecosystem: ["Ethereum", "Polygon", "BSC"],
    category: "evm",
    icon: "🐍",
    documentationUrl: "https://docs.vyperlang.org",
    features: {
      hasObjects: false,
      hasCapabilities: false,
      hasResourceSafety: false,
      supportsParallelExecution: false,
    },
  },

  cosmwasm_rust: {
    id: "cosmwasm_rust",
    name: "cosmwasm_rust",
    displayName: "CosmWasm (Rust)",
    fileExtension: ".rs",
    monacoLanguageId: "rust",
    description: "WebAssembly smart contracts for Cosmos ecosystem",
    ecosystem: ["Cosmos", "Terra", "Juno", "Osmosis"],
    category: "wasm",
    icon: "⚛️",
    documentationUrl: "https://docs.cosmwasm.com",
    features: {
      hasObjects: false,
      hasCapabilities: false,
      hasResourceSafety: true,
      supportsParallelExecution: false,
    },
  },
};

/**
 * Translation support matrix
 * Maps source language → target languages that are supported
 */
export interface TranslationPair {
  source: string;
  target: string;
  status: "implemented" | "planned" | "experimental";
  quality: "high" | "medium" | "low"; // Expected translation quality
  notes?: string;
}

export const TRANSLATION_MATRIX: TranslationPair[] = [
  // Solidity translations
  {
    source: "solidity",
    target: "sui_move",
    status: "implemented",
    quality: "high",
    notes: "Fully supported with EVM→Sui object model translation",
  },
  {
    source: "solidity",
    target: "aptos_move",
    status: "planned",
    quality: "medium",
    notes: "Requires account model mapping",
  },
  {
    source: "solidity",
    target: "solana_rust",
    status: "implemented",
    quality: "medium",
    notes: "Requires Anchor framework setup",
  },
  {
    source: "solidity",
    target: "vyper",
    status: "planned",
    quality: "high",
    notes: "Both are EVM languages, straightforward syntax translation",
  },
  {
    source: "solidity",
    target: "cairo",
    status: "planned",
    quality: "low",
    notes: "Very different execution models",
  },

  // Sui Move translations
  {
    source: "sui_move",
    target: "solidity",
    status: "planned",
    quality: "medium",
    notes: "Object model → contract storage translation needed",
  },
  {
    source: "sui_move",
    target: "aptos_move",
    status: "planned",
    quality: "high",
    notes: "Same language family, mainly API differences",
  },

  // Aptos Move translations
  {
    source: "aptos_move",
    target: "sui_move",
    status: "planned",
    quality: "high",
    notes: "Account model → object model translation",
  },

  // Solana translations
  {
    source: "solana_rust",
    target: "solidity",
    status: "planned",
    quality: "medium",
    notes: "Account/instruction model → contract model",
  },
  {
    source: "solana_rust",
    target: "cosmwasm_rust",
    status: "planned",
    quality: "high",
    notes: "Both Rust-based, different execution contexts",
  },

  // Vyper translations
  {
    source: "vyper",
    target: "solidity",
    status: "planned",
    quality: "high",
    notes: "Both EVM languages",
  },
];

/**
 * Get supported translation targets for a given source language
 */
export function getSupportedTargets(sourceLanguageId: string): TranslationPair[] {
  return TRANSLATION_MATRIX.filter((pair) => pair.source === sourceLanguageId);
}

/**
 * Check if a translation pair is supported
 */
export function isTranslationSupported(
  sourceId: string,
  targetId: string
): TranslationPair | undefined {
  return TRANSLATION_MATRIX.find(
    (pair) => pair.source === sourceId && pair.target === targetId
  );
}

/**
 * Get all languages that can be translation sources
 */
export function getSourceLanguages(): BlockchainLanguage[] {
  const sourceIds = new Set(TRANSLATION_MATRIX.map((pair) => pair.source));
  return Object.values(BLOCKCHAIN_LANGUAGES).filter((lang) =>
    sourceIds.has(lang.id)
  );
}

/**
 * Get all languages that can be translation targets from a source
 */
export function getTargetLanguages(sourceId: string): BlockchainLanguage[] {
  const pairs = getSupportedTargets(sourceId);
  return pairs
    .map((pair) => BLOCKCHAIN_LANGUAGES[pair.target])
    .filter((lang): lang is BlockchainLanguage => lang !== undefined);
}

/**
 * Get EVM flavor options for Solidity
 */
export interface EVMFlavor {
  id: string;
  name: string;
  description: string;
  solidityVersion: string;
  features: string[];
}

export const EVM_FLAVORS: Record<string, EVMFlavor> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    description: "Ethereum mainnet",
    solidityVersion: "^0.8.0",
    features: ["CREATE2", "SELFDESTRUCT", "EIP-1559"],
  },
  polygon: {
    id: "polygon",
    name: "Polygon PoS",
    description: "Polygon (formerly Matic) PoS chain",
    solidityVersion: "^0.8.0",
    features: ["EVM-equivalent", "Low gas fees"],
  },
  bsc: {
    id: "bsc",
    name: "BNB Chain",
    description: "BNB Smart Chain (BSC)",
    solidityVersion: "^0.8.0",
    features: ["EVM-compatible", "Fast finality"],
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum",
    description: "Arbitrum L2 rollup",
    solidityVersion: "^0.8.0",
    features: ["EVM-equivalent L2", "Optimistic rollup"],
  },
  optimism: {
    id: "optimism",
    name: "Optimism",
    description: "Optimism L2 rollup",
    solidityVersion: "^0.8.0",
    features: ["EVM-equivalent L2", "Optimistic rollup", "Bedrock upgrade"],
  },
  base: {
    id: "base",
    name: "Base",
    description: "Base L2 by Coinbase (built on OP Stack)",
    solidityVersion: "^0.8.0",
    features: ["EVM-equivalent L2", "OP Stack"],
  },
  avalanche: {
    id: "avalanche",
    name: "Avalanche C-Chain",
    description: "Avalanche Contract Chain",
    solidityVersion: "^0.8.0",
    features: ["EVM-compatible", "Subnet support"],
  },
};

/**
 * Helper to get display name with ecosystem
 */
export function getLanguageDisplayText(languageId: string): string {
  const lang = BLOCKCHAIN_LANGUAGES[languageId];
  if (!lang) return languageId;

  if (lang.ecosystem.length === 1) {
    return `${lang.displayName} (${lang.ecosystem[0]})`;
  }
  return lang.displayName;
}
