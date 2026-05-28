import { createHash } from "node:crypto";
import { canonicalizeJson } from "./canonicalize.js";
import { normalizeSchema } from "./normalize.js";
import type { Schema } from "./model.js";

export function schemaHash(schema: Schema): string {
  const canonical = JSON.stringify(canonicalizeJson(normalizeSchema(schema)));
  return createHash("sha256").update(canonical).digest("hex");
}
