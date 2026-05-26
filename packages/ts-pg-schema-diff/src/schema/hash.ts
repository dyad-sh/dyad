import { createHash } from "node:crypto";
import { normalizeSchema } from "./normalize.js";
import type { Schema } from "./model.js";

export function schemaHash(schema: Schema): string {
  const canonical = JSON.stringify(normalizeForJson(normalizeSchema(schema)));
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForJson((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
