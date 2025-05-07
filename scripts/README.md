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
