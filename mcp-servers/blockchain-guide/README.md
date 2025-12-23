# Blockchain Translation Guide MCP Server v2.0

**Clean, universal, and production-ready blockchain documentation server.**

A custom MCP server that provides LLM-optimized documentation, version information, and translation patterns for smart contract transpilation across Solana, Sui, and Anchor.

## What's New in v2.0

✅ **Simplified to 4 essential tools** (down from 9)
✅ **Universal design** - Same tools work for all blockchains
✅ **LLM-first approach** - Serves full 645KB Solana docs for model to read
✅ **No overengineering** - Removed complex URL mapping, HTML parsing, search logic
✅ **Better release notes** - Now includes 3000+ chars with documentation links
✅ **GitHub token support** - Optional for higher rate limits

## Architecture

### Design Principles

1. **Separation of Concerns**: This MCP serves static/cached content. Use separate web-search MCP for dynamic URL fetching (e.g., https://github.com/mrkrsl/web-search-mcp).
2. **Universal Support**: Same tools work for Solana, Sui, Anchor, and future blockchains.
3. **LLM-First**: Serves full documentation (645KB for Solana) - let the model read and understand.
4. **No Overengineering**: No complex URL mapping, HTML parsing, or search logic.

## Tools

### 1. `fetch-ecosystem-docs`
**What it does:** Fetches full LLM-optimized documentation
**Use case:** Model needs comprehensive current documentation

```typescript
fetch-ecosystem-docs({ ecosystem: 'solana' })
→ Returns 645KB from solana.com/llms.txt with:
  - Current APIs and patterns
  - Code examples
  - Best practices
```

**Supported ecosystems:**
- `solana` - Full Solana documentation (645KB from llms.txt)
- `sui` - Sui documentation links (when llms.txt becomes available)
- `anchor` - Anchor framework documentation links

### 2. `fetch-latest-releases`
**What it does:** Gets current versions + full release notes from GitHub
**Use case:** Model needs to know current version and breaking changes

```typescript
fetch-latest-releases({ ecosystem: 'anchor' })
→ Returns:
  - Version: v0.32.1
  - Full release notes (3000+ chars)
  - Documentation links from release
  - Breaking changes (if any)
  - New features
  - Bug fixes
```

**Supported ecosystems:** `solana`, `anchor`, `sui`, `all`

### 3. `get-translation-guide`
**What it does:** Provides translation patterns between languages
**Use case:** Model needs to understand core differences and patterns

```typescript
get-translation-guide({ from: 'solidity', to: 'solana' })
→ Returns:
  - Account model differences
  - PDA patterns
  - Security constraints
  - Code examples
  - Best practices
```

**Supported translations:**
- `solidity → solana`
- `solidity → sui`

### 4. `check-feature-compatibility`
**What it does:** Quick lookup for specific Solidity features
**Use case:** Model needs to know how to translate a specific feature

```typescript
check-feature-compatibility({ feature: 'mapping', target: 'solana' })
→ "Use PDA accounts with seeds based on keys. Each entry is a separate account."
```

**Supported features:**
`mapping`, `modifier`, `event`, `inheritance`, `payable`, `constructor`, `require/assert`

## Example Translation Flow

```
User: "Translate this ERC20 contract to Solana Anchor"

Model:
1. fetch-ecosystem-docs({ ecosystem: 'solana' })
   → Gets 645KB of Solana documentation
   → Sees token program patterns, PDA patterns, current APIs

2. fetch-latest-releases({ ecosystem: 'anchor' })
   → Gets current version: v0.32.1
   → Sees release notes mentioning new token_interface module
   → Sees documentation links for migration

3. get-translation-guide({ from: 'solidity', to: 'solana' })
   → Gets translation patterns for accounts, PDAs, instructions
   → Understands security constraints

4. Generates Anchor code using:
   ✓ Current version (0.32.1)
   ✓ Current APIs (token_interface from release notes)
   ✓ Patterns from documentation
   ✓ Translation guidelines

Result: Compiles successfully on first try ✅
```

## Configuration

### For Dyad (Automatic)

The blockchain-guide MCP server is **automatically configured** when you run Dyad!

- ✅ Seeded into database on first run
- ✅ Enabled by default
- ✅ No manual configuration needed
- ✅ Path automatically resolved for dev/production

### For Claude Desktop (Manual)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blockchain-guide": {
      "command": "node",
      "args": ["/absolute/path/to/dyad/mcp-servers/blockchain-guide/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_token_here"  // Optional, for higher rate limits
      }
    }
  }
}
```

### Optional: GitHub Token

For higher API rate limits and better release notes:

```bash
export GITHUB_TOKEN="your_github_personal_access_token"
# or
export GH_TOKEN="your_github_personal_access_token"
```

## Development

### Build

```bash
npm install
npm run build       # Compile TypeScript to dist/
npm run rebuild     # Clean + build
```

### Testing

```bash
npm run test          # Original 32 tests
npm run test-simple   # Quick 4-tool verification
npm test             # Same as test
```

Expected output:
```
🧪 Testing Simplified MCP Server v2.0

Available Tools: 4

1. fetch-ecosystem-docs
2. fetch-latest-releases
3. get-translation-guide
4. check-feature-compatibility

✅ All Tests Passed!
```

### Dev Mode

```bash
npm run dev         # Hot reload with tsx
npm run build:watch # Watch mode compilation
```

## What's NOT Included (By Design)

These were removed in v2.0 for simplicity and separation of concerns:

❌ **URL mapping logic** - Use separate web-search MCP
❌ **HTML parsing** - Model uses provided links with web-search MCP
❌ **Documentation search** - Model reads full docs
❌ **Code search** - GitHub Code Search requires auth, better handled by web-search MCP

## File Structure

```
blockchain-guide/
├── index.ts                    # Main MCP server v2.0 (560 lines)
├── test.ts                     # Original 32 static tests
├── test-simple.ts              # Quick 4-tool verification
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript config
├── README.md                   # This file
└── dist/                       # Compiled output
    └── index.js
```

## Next Steps

1. ✅ **MCP Server Complete** - v2.0 simplified and universal
2. 🔄 **Add Web-Search MCP** - For dynamic URL fetching
3. 📝 **Integration** - Implement Tier 1-3 from ACTION_PLAN_SUMMARY.md

## Changelog

### v2.0.0 (December 9, 2025)
- ✅ Simplified to 4 essential tools (from 9)
- ✅ Universal design for all blockchains
- ✅ Removed complex URL mapping and HTML parsing
- ✅ Added GitHub token support
- ✅ Improved release notes (3000+ char limit)
- ✅ Added documentation URL extraction
- ✅ Clean, maintainable architecture
- ✅ Serves full 645KB Solana llms.txt

### v1.0.0 (Previous)
- Had 9 tools (over-engineered)
- Complex URL mapping logic
- HTML parsing functionality
- Search tools (redundant with full docs)

## Benefits

1. **Overcomes LLM knowledge cutoffs**: Provides current version information from GitHub
2. **Comprehensive documentation**: Full 645KB of Solana docs for the model
3. **Accurate translations**: Tested patterns and best practices
4. **Reduces errors**: Prevents outdated API usage
5. **Speeds up development**: Model has everything it needs
6. **Easy to extend**: Simple to add new blockchains

## License

MIT

---

**Status:** ✅ Production Ready
**Version:** 2.0.0
**Auto-starts:** Yes (seeded in Dyad DB)
**Tested:** All tests passing
**Maintained:** Active
