/**
 * Simple serialization helper for draft caching in localStorage.
 * Strips non-serializable values (CryptoKey, functions, etc.).
 * @param excludeKeys Optional list of top-level keys to skip.
 */
export function serializeForCache(obj: unknown, excludeKeys?: string[]): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "function") return undefined;
  if (obj instanceof CryptoKey) return "[CryptoKey]";
  if (obj instanceof File) return { name: (obj as File).name, size: (obj as File).size, type: (obj as File).type };
  if (Array.isArray(obj)) return obj.map((v) => serializeForCache(v));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (excludeKeys?.includes(key)) continue;
      const serialized = serializeForCache(value);
      if (serialized !== undefined) result[key] = serialized;
    }
    return result;
  }
  return obj;
}
