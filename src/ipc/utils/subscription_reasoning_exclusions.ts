import { createHash } from "node:crypto";

const MAX_SCOPES = 128;
const MAX_HASHES_PER_SCOPE = 2_048;

function reasoningHash(item: unknown): string | undefined {
  if (
    !item ||
    typeof item !== "object" ||
    !("type" in item) ||
    item.type !== "reasoning" ||
    !("encrypted_content" in item) ||
    typeof item.encrypted_content !== "string" ||
    !item.encrypted_content
  )
    return undefined;
  return createHash("sha256").update(item.encrypted_content).digest("hex");
}

/** Remove complete encrypted reasoning items, preserving all other wire items. */
export function excludeSubscriptionReasoning(
  input: unknown[],
  excluded?: ReadonlySet<string>,
): { input: unknown[]; hashes: Set<string> } {
  const hashes = new Set<string>();
  return {
    input: input.filter((item) => {
      const hash = reasoningHash(item);
      if (!hash || (excluded && !excluded.has(hash))) return true;
      hashes.add(hash);
      return false;
    }),
    hashes,
  };
}

/** Process-local, bounded cache. It never stores credentials or reasoning text. */
export class SubscriptionReasoningExclusions {
  private readonly scopes = new Map<string, Set<string>>();

  filter(scope: string, input: unknown[]): unknown[] {
    const hashes = this.scopes.get(scope);
    if (!hashes) return input;
    this.scopes.delete(scope);
    this.scopes.set(scope, hashes);
    return excludeSubscriptionReasoning(input, hashes).input;
  }

  remember(scope: string, hashes: ReadonlySet<string>): void {
    const remembered = this.scopes.get(scope) ?? new Set<string>();
    for (const hash of hashes) remembered.add(hash);
    while (remembered.size > MAX_HASHES_PER_SCOPE)
      remembered.delete(remembered.values().next().value!);
    this.scopes.delete(scope);
    this.scopes.set(scope, remembered);
    while (this.scopes.size > MAX_SCOPES)
      this.scopes.delete(this.scopes.keys().next().value!);
  }
}
