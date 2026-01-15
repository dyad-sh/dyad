import * as monaco from "monaco-editor";
import { loadWASM } from "onigasm";
import { Registry } from "monaco-textmate";
import { wireTmGrammars } from "monaco-editor-textmate";
import log from "electron-log";

const logger = log.scope("blockchain_languages");

/**
 * REAL SOLUTION for blockchain languages in Monaco Editor
 *
 * Solidity: Built-in ✅
 * Rust: Built-in ✅
 * Move: Use TextMate grammar (maintained by Move team)
 */

let isInitialized = false;

export async function initializeBlockchainLanguages() {
  if (isInitialized) {
    logger.info("⚠️ Blockchain languages already initialized, skipping...");
    return;
  }
  isInitialized = true;
  // === SOLIDITY ===
  // Already built into Monaco! Just use language: 'sol'
  logger.info('✅ Solidity support: Built-in (use language: "sol")');

  // === RUST ===
  // Already built into Monaco! Just use language: 'rust'
  logger.info('✅ Rust support: Built-in (use language: "rust")');

  // === MOVE ===
  // We need to add Move using TextMate grammar
  try {
    logger.info("🔄 Loading Move language support...");

    // Load WASM for regex engine
    logger.info("🔄 Loading onigasm WASM...");
    await loadWASM(`https://unpkg.com/onigasm@2.2.5/lib/onigasm.wasm`);
    logger.info("✅ Onigasm WASM loaded");

    // Create registry for TextMate grammars
    logger.info("🔄 Creating TextMate registry...");
    const registry = new Registry({
      getGrammarDefinition: async (scopeName) => {
        if (scopeName === "source.move") {
          // Fetch the Move TextMate grammar from damirka/move-syntax
          logger.info("🔄 Fetching Move grammar from GitHub...");
          const response = await fetch(
            "https://raw.githubusercontent.com/damirka/move-syntax/master/syntaxes/move.tmLanguage.json",
          );
          if (!response.ok) {
            throw new Error(
              `Failed to fetch grammar: ${response.status} ${response.statusText}`,
            );
          }
          const content = await response.text();
          logger.info("✅ Move grammar fetched successfully");
          return {
            format: "json",
            content,
          };
        }
        throw new Error(`Unknown scope: ${scopeName}`);
      },
    });

    // Register Move language
    logger.info("🔄 Registering Move language in Monaco...");
    monaco.languages.register({
      id: "move",
      extensions: [".move"],
      aliases: ["Move", "move"],
    });
    logger.info("✅ Move language registered");

    // Wire the TextMate grammar to Monaco
    logger.info("🔄 Wiring TextMate grammar to Monaco...");
    await wireTmGrammars(monaco, registry, new Map([["move", "source.move"]]));

    logger.info("✅ Move support: Loaded from TextMate grammar");
  } catch (error) {
    logger.error(
      "❌ Failed to initialize Move language with TextMate:",
      error,
    );
    logger.info("🔄 Falling back to Monarch tokenizer...");
    // Fallback to basic Monarch tokenizer if TextMate fails
    try {
      registerMoveMonarch();
    } catch (fallbackError) {
      logger.error("❌ Monarch fallback also failed:", fallbackError);
    }
  }

  // === TOML ===
  // Add TOML support for Move.toml config files
  logger.info("🔄 Registering TOML language...");
  registerTomlLanguage();
}

/**
 * Fallback: Simple Monarch tokenizer for Move
 * (In case TextMate loading fails)
 */
function registerMoveMonarch() {
  logger.info("🔄 Registering Move with Monarch tokenizer...");
  monaco.languages.register({
    id: "move",
    extensions: [".move"],
    aliases: ["Move", "move"],
  });

  monaco.languages.setMonarchTokensProvider("move", {
    keywords: [
      "module",
      "struct",
      "fun",
      "public",
      "entry",
      "native",
      "const",
      "let",
      "mut",
      "if",
      "else",
      "while",
      "loop",
      "return",
      "abort",
      "break",
      "continue",
      "use",
      "as",
      "has",
      "key",
      "store",
      "copy",
      "drop",
      "acquires",
      "move",
      "borrow",
      "address",
      "signer",
      "script",
      "friend",
      "inline",
      "macro",
      "spec",
      "apply",
      "pragma",
      "invariant",
      "ensures",
      "requires",
      "aborts_if",
      "modifies",
      "emits",
      "global",
      "exists",
      "assert",
      "assume",
    ],
    typeKeywords: [
      "u8",
      "u16",
      "u32",
      "u64",
      "u128",
      "u256",
      "bool",
      "address",
      "vector",
      "signer",
    ],

    operators: [
      "=",
      ">",
      "<",
      "!",
      "~",
      "?",
      ":",
      "==",
      "<=",
      ">=",
      "!=",
      "&&",
      "||",
      "++",
      "--",
      "+",
      "-",
      "*",
      "/",
      "&",
      "|",
      "^",
      "%",
      "<<",
      ">>",
      ">>>",
      "+=",
      "-=",
      "*=",
      "/=",
      "&=",
      "|=",
      "^=",
      "%=",
      "<<=",
      ">>=",
      ">>>=",
      "=>",
    ],

    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes:
      /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // Attributes/annotations
        [/#\[.*?\]/, "annotation"],

        // Function definitions
        [/\b(fun)\s+([a-zA-Z_]\w*)/, ["keyword", "entity.name.function"]],

        // Struct definitions
        [/\b(struct)\s+([a-zA-Z_]\w*)/, ["keyword", "entity.name.type"]],

        // Module definitions
        [/\b(module)\s+([a-zA-Z_]\w*)/, ["keyword", "entity.name.type"]],

        // Abilities
        [/\b(has)\s+(key|store|copy|drop)\b/, ["keyword", "keyword"]],

        // Identifiers and keywords
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "support.type",
              "@default": "identifier",
            },
          },
        ],

        // Whitespace
        { include: "@whitespace" },

        // Addresses
        [/@0x[0-9a-fA-F]+/, "number.hex"],
        [/0x[0-9a-fA-F]+/, "number.hex"],

        // Numbers
        [/\d+u8|u16|u32|u64|u128|u256/, "number"],
        [/\d+/, "number"],

        // Delimiters
        [/[{}()[\]]/, "@brackets"],
        [/[<>](?!@symbols)/, "@brackets"],
        [
          /@symbols/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],

        // Strings
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],

        // Characters
        [/'[^\\']'/, "string"],
        [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
        [/'/, "string.invalid"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, "white"],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],

      comment: [
        [/[^/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],

      string: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],
    },
  });

  logger.info("✅ Move support: Monarch tokenizer registered successfully");
}

/**
 * Register TOML language support
 * Used for Move.toml, Cargo.toml, and other config files
 */
function registerTomlLanguage() {
  logger.info("🔄 Registering TOML with Monarch tokenizer...");

  monaco.languages.register({
    id: "toml",
    extensions: [".toml"],
    aliases: ["TOML", "toml"],
  });

  monaco.languages.setMonarchTokensProvider("toml", {
    keywords: ["true", "false"],

    tokenizer: {
      root: [
        // Section headers [section]
        [/^\s*\[[^\]]+\]/, "entity.name.section"],

        // Table array headers [[section]]
        [/^\s*\[\[[^\]]+\]\]/, "entity.name.section"],

        // Comments
        [/#.*$/, "comment"],

        // Keys (before =)
        [/^\s*[a-zA-Z_][\w-]*(?=\s*=)/, "key"],
        [/[a-zA-Z_][\w-]*(?=\s*=)/, "key"],

        // Quoted keys
        [/"[^"]*?"(?=\s*=)/, "key"],
        [/'[^']*?'(?=\s*=)/, "key"],

        // Strings (double-quoted)
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],

        // Strings (single-quoted)
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, "string", "@string_single"],

        // Multi-line strings
        [/'''/, "string", "@string_multi_single"],
        [/"""/, "string", "@string_multi_double"],

        // Dates and times (ISO 8601)
        [
          /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?/,
          "number",
        ],
        [/\d{2}:\d{2}:\d{2}(\.\d+)?/, "number"],

        // Numbers
        [/[+-]?\d+\.\d+([eE][+-]?\d+)?/, "number.float"],
        [/[+-]?\d+([eE][+-]?\d+)?/, "number"],
        [/[+-]?0x[0-9a-fA-F]+/, "number.hex"],
        [/[+-]?0o[0-7]+/, "number.octal"],
        [/[+-]?0b[01]+/, "number.binary"],
        [/[+-]?inf/, "number"],
        [/[+-]?nan/, "number"],

        // Booleans
        [/\b(true|false)\b/, "keyword"],

        // Whitespace
        [/[ \t\r\n]+/, "white"],

        // Delimiters
        [/[{}()[\]]/, "@brackets"],
        [/[,.]/, "delimiter"],
      ],

      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],

      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],

      string_multi_double: [
        [/[^"]+/, "string"],
        [/"""/, "string", "@pop"],
        [/"/, "string"],
      ],

      string_multi_single: [
        [/[^']+/, "string"],
        [/'''/, "string", "@pop"],
        [/'/, "string"],
      ],
    },
  });

  logger.info("✅ TOML support: Monarch tokenizer registered successfully");
}

/**
 * Helper: Get language from file extension
 */
export function getLanguageFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    sol: "sol", // Solidity
    move: "move", // Move
    rs: "rust", // Rust/Solana
    ts: "typescript",
    js: "javascript",
    json: "json",
    md: "markdown",
  };

  return languageMap[ext || ""] || "plaintext";
}

/**
 * Check what languages are available
 */
export function listAvailableLanguages() {
  const languages = monaco.languages.getLanguages();
  logger.info(
    "Available languages:",
    languages.map((l) => l.id),
  );
  return languages;
}
