import { canonicalizeJson } from "../schema/canonicalize.js";

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}
