# Scripts

This directory contains utility scripts for the project.

## extract-codebase.ts

A script that extracts code files from a directory, respecting `.gitignore` rules, and outputs them in a format suitable for LLM consumption.

### Usage

```bash
# Make the script executable first
chmod +x scripts/extract-codebase.ts

# Run with default options (current directory, output to codebase-extract.md)
./scripts/extract-codebase.ts

# Specify a source directory and output file
./scripts/extract-codebase.ts ./src ./output.md
```

### Features

- Walks through the specified directory recursively
- Respects all `.gitignore` rules
- Extracts files with extensions: .ts, .tsx, .js, .jsx, .css
- Formats output with markdown code blocks, including file paths
- Writes all extracted code to a single markdown file

## verify-release-assets.js

A script that verifies all expected binary assets are present in the GitHub release for the current version in `package.json`.

### Usage

```bash
# Set GITHUB_TOKEN environment variable
export GITHUB_TOKEN=your_github_token

# Run the verification script
npm run verify-release

# Or run directly
node scripts/verify-release-assets.js
```

### Expected Assets

The script verifies the presence of these 7 assets for each release:

1. `coney-{version}-1.x86_64.rpm` (Linux RPM)
2. `coney-{version}-full.nupkg` (Windows NuGet package)
3. `coney-{version}.Setup.exe` (Windows installer)
4. `coney-darwin-arm64-{version}.zip` (macOS Apple Silicon)
5. `coney-darwin-x64-{version}.zip` (macOS Intel)
6. `coney_{version}_amd64.deb` (Linux DEB)
7. `RELEASES` (Windows update manifest)

### Features

- Reads version from `package.json` automatically
- Fetches release information from GitHub API
- Lists all expected vs actual assets
- Fails with clear error messages if assets are missing
- Shows warnings for unexpected assets
- Provides detailed release summary on success
