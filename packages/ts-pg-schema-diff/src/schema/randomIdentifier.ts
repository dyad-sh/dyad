import { randomBytes } from "node:crypto";

export function randomPostgresIdentifierToken(): string {
  return randomBytes(16)
    .toString("base64")
    .replaceAll("+", "$")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function temporaryNotNullConstraintName(): string {
  return `pgschemadiff_tmpnn_${randomPostgresIdentifierToken()}`;
}

export function temporaryIndexName(originalName: string): string {
  const prefix = "pgschemadiff_tmpidx_";
  const suffix = `_${randomPostgresIdentifierToken()}`;
  const maxIdentifierLength = 63;
  const maxOriginalLength = maxIdentifierLength - prefix.length - suffix.length;
  const truncated = originalName.slice(0, Math.max(0, maxOriginalLength));
  return `${prefix}${truncated}${suffix}`;
}
