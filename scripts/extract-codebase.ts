#!/usr/bin/env node

// Add type module declaration at the top
// @ts-check
// @ts-ignore
// eslint-disable-next-line
// @ts-nocheck

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { isIgnored } from "isomorphic-git";
import log from "electron-log";

const logger = log.scope("extract-codebase");

// File extensions to include
const ALLOWED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css"];

// Function to check if a path is ignored by gitignore
async function isGitIgnored(
  filePath: string,
  baseDir: string
): Promise<boolean> {
  try {
    const relativePath = path.relative(baseDir, filePath);
    return await isIgnored({ fs, dir: baseDir, filepath: relativePath });
  } catch (error) {
    logger.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}

// Function to recursively walk a directory
async function walkDirectory(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];

  // Read directory contents
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip if the entry is git ignored
    if (await isGitIgnored(fullPath, baseDir)) {
      continue;
    }

    if (entry.isDirectory()) {
      // Recursively process subdirectories
      const subDirFiles = await walkDirectory(fullPath, baseDir);
      files.push(...subDirFiles);
    } else if (entry.isFile()) {
      // Check file extension
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// Function to read file contents and format for LLM consumption
function formatFile(filePath: string, baseDir: string): string {
  try {
    const relativePath = path.relative(baseDir, filePath);

    // Check if the file is in components/ui directory
    if (
      relativePath.includes("eslint.config") ||
      relativePath.includes("components/ui") ||
      relativePath.includes("components\\ui")
    ) {
      return `## File: ${relativePath}\n\n`;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    return `## File: ${relativePath}\n\`\`\`${path
      .extname(filePath)
      .substring(1)}\n${content}\n\`\`\`\n\n`;
  } catch (error) {
    logger.error(`Error reading file: ${filePath}`, error);
    return `## File: ${filePath}\nError reading file: ${error}\n\n`;
  }
}

async function main() {
  // Get command line arguments
  const args = process.argv.slice(2);
  const scaffoldDir = args[0] || process.cwd();
  const outputFile = args[1] || "codebase-extract.md";

  console.log(`Extracting code from: ${scaffoldDir}`);
  console.log(`Output will be written to: ${outputFile}`);

  // Walk directory and get all files
  const files = await walkDirectory(scaffoldDir, scaffoldDir);
  console.log(`Found ${files.length} code files`);

  // Format files
  let output = `# Codebase Extract\nGenerated on: ${new Date().toISOString()}\nTotal files: ${
    files.length
  }\n\n`;

  for (const file of files) {
    output += formatFile(file, scaffoldDir);
  }

  // Write to output file
  fs.writeFileSync(outputFile, output);
  console.log(`Extraction complete. Output written to ${outputFile}`);
}
