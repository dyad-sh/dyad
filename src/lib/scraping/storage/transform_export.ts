/**
 * Transform + Export Pipeline — Data transformation, PII detection, and export.
 *
 * Supports JSON, JSONL, CSV, and Markdown export formats.
 * Includes field mapping, PII stripping, and deduplication.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import log from "electron-log";
import type { ExportFormat, ExportOptions, PIIDetectionResult, PIIFinding } from "../types";

const logger = log.scope("scraping:export");

// ── PII Detection ───────────────────────────────────────────────────────────

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[\s-]?){13,19}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
} as const;

/**
 * Scan data for potential PII.
 */
export function detectPII(data: Record<string, unknown>[]): PIIDetectionResult {
  const findings: PIIFinding[] = [];

  for (const record of data) {
    for (const [field, value] of Object.entries(record)) {
      if (typeof value !== "string") continue;

      for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
        const matches = value.match(pattern);
        if (matches) {
          for (const match of matches) {
            findings.push({
              type: piiType as PIIFinding["type"],
              value: maskPII(match),
              field,
              confidence: piiType === "email" ? 0.95 : 0.8,
            });
          }
        }
      }
    }
  }

  return {
    hasPII: findings.length > 0,
    findings,
  };
}

/**
 * Strip PII from data records, replacing with [REDACTED].
 */
export function stripPII(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return data.map((record) => {
    const cleaned = { ...record };
    for (const [field, value] of Object.entries(cleaned)) {
      if (typeof value !== "string") continue;
      let v = value;
      for (const pattern of Object.values(PII_PATTERNS)) {
        v = v.replace(pattern, "[REDACTED]");
      }
      cleaned[field] = v;
    }
    return cleaned;
  });
}

function maskPII(value: string): string {
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "*".repeat(value.length - 4) + value.slice(-2);
}

// ── Deduplication ───────────────────────────────────────────────────────────

/**
 * Remove duplicate records based on a content hash.
 */
export function deduplicateRecords(
  data: Record<string, unknown>[],
  keyFields?: string[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  return data.filter((record) => {
    const key = keyFields
      ? keyFields.map((f) => String(record[f] ?? "")).join("|")
      : JSON.stringify(record);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Field Mapping ───────────────────────────────────────────────────────────

/**
 * Rename/filter fields in data records.
 */
export function mapFields(
  data: Record<string, unknown>[],
  mapping: Record<string, string>,
): Record<string, unknown>[] {
  return data.map((record) => {
    const mapped: Record<string, unknown> = {};
    for (const [from, to] of Object.entries(mapping)) {
      if (from in record) {
        mapped[to] = record[from];
      }
    }
    return mapped;
  });
}

// ── Export Functions ────────────────────────────────────────────────────────

/**
 * Export data to a file in the specified format.
 */
export async function exportData(
  data: Record<string, unknown>[],
  options: ExportOptions,
): Promise<{ path: string; records: number; bytes: number }> {
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let content: string;

  switch (options.format) {
    case "json":
      content = JSON.stringify(
        options.fields ? selectFields(data, options.fields) : data,
        null,
        options.pretty ? 2 : undefined,
      );
      break;

    case "jsonl":
      content = (options.fields ? selectFields(data, options.fields) : data)
        .map((r) => JSON.stringify(r))
        .join("\n");
      break;

    case "csv":
      content = toCSV(
        options.fields ? selectFields(data, options.fields) : data,
        options.delimiter ?? ",",
      );
      break;

    case "markdown":
      content = toMarkdownTable(
        options.fields ? selectFields(data, options.fields) : data,
      );
      break;

    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  await fs.promises.writeFile(options.outputPath, content, "utf-8");
  const stats = await fs.promises.stat(options.outputPath);

  logger.info(
    `Exported ${data.length} records as ${options.format} to ${options.outputPath} (${stats.size} bytes)`,
  );

  return {
    path: options.outputPath,
    records: data.length,
    bytes: stats.size,
  };
}

/**
 * Get default export directory.
 */
export function getExportDir(): string {
  return path.join(app.getPath("userData"), "scraping-exports");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function selectFields(
  data: Record<string, unknown>[],
  fields: string[],
): Record<string, unknown>[] {
  return data.map((record) => {
    const selected: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in record) selected[field] = record[field];
    }
    return selected;
  });
}

function toCSV(data: Record<string, unknown>[], delimiter: string): string {
  if (data.length === 0) return "";

  const allKeys = [...new Set(data.flatMap((r) => Object.keys(r)))];
  const lines: string[] = [];

  // Header
  lines.push(allKeys.map((k) => escapeCsvField(k, delimiter)).join(delimiter));

  // Rows
  for (const record of data) {
    const row = allKeys.map((k) => {
      const val = record[k];
      if (val == null) return "";
      return escapeCsvField(String(val), delimiter);
    });
    lines.push(row.join(delimiter));
  }

  return lines.join("\n");
}

function escapeCsvField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toMarkdownTable(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";

  const keys = [...new Set(data.flatMap((r) => Object.keys(r)))];
  const lines: string[] = [];

  // Header
  lines.push(`| ${keys.join(" | ")} |`);
  lines.push(`| ${keys.map(() => "---").join(" | ")} |`);

  // Rows
  for (const record of data) {
    const row = keys.map((k) => {
      const val = record[k];
      if (val == null) return "";
      return String(val).replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
    lines.push(`| ${row.join(" | ")} |`);
  }

  return lines.join("\n");
}
