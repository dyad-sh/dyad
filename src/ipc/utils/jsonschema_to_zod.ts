import { z } from "zod";

// A best-effort converter from a (subset of) JSON Schema to Zod.
// This intentionally handles only the most common cases we see from MCP servers
// (object with properties, arrays, primitive types, enums) and falls back to z.any()
// whenever the structure is too complex or unsupported.
export function jsonSchemaToZod(schema: any, depth = 0): z.ZodTypeAny {
  try {
    if (!schema || typeof schema !== "object") return z.any();

    if (depth > 6) return z.any(); // avoid deep recursion

    // If it's an OpenAI function schema-like wrapper { type: 'object', properties: {...}, required: [...] }
    if (schema.const !== undefined) {
      const v = schema.const;
      // z.literal supports string/number/boolean
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return z.literal(v);
      return z.any();
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      const allString = schema.enum.every((v: any) => typeof v === "string");
      if (allString) return z.enum(schema.enum as [string, ...string[]]);
      // For non-string enums, create a union of literals
      return z.union((schema.enum as any[]).map((v) => z.literal(v as any)) as [any, any]);
    }

    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      const subs = schema.anyOf.map((s: any) => jsonSchemaToZod(s, depth + 1));
      return subs.length ? z.union(subs as [any, any]) : z.any();
    }

    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      const subs = schema.oneOf.map((s: any) => jsonSchemaToZod(s, depth + 1));
      return subs.length ? z.union(subs as [any, any]) : z.any();
    }

    if (schema.allOf && Array.isArray(schema.allOf)) {
      const subs = schema.allOf.map((s: any) => jsonSchemaToZod(s, depth + 1));
      // Intersect all, fallback to last if intersect not available
      try {
        return (subs as z.ZodTypeAny[]).reduce((acc, cur) => acc.and(cur));
      } catch {
        return subs.pop() || z.any();
      }
    }

    // Nullable via type: ['string', 'null'] or explicit nullable
    if (Array.isArray(schema.type)) {
      const types = schema.type as any[];
      const withoutNull = types.filter((t) => t !== "null");
      const zType = withoutNull.length === 1 ? jsonSchemaToZod({ ...schema, type: withoutNull[0] }, depth + 1) : z.any();
      return types.includes("null") ? zType.nullable() : zType;
    }

    switch (schema.type) {
      case "string":
        return z.string();
      case "integer":
      case "number":
        return z.number();
      case "boolean":
        return z.boolean();
      case "array": {
        const itemSchema = jsonSchemaToZod(schema.items, depth + 1);
        return z.array(itemSchema ?? z.any());
      }
      case "object": {
        const props = schema.properties || {};
        const required: string[] = Array.isArray(schema.required) ? schema.required : [];
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries<any>(props)) {
          const converted = jsonSchemaToZod(value, depth + 1);
          shape[key] = required.includes(key) ? converted : converted.optional();
        }
        // If no properties, allow any object
        const base = Object.keys(shape).length > 0 ? z.object(shape) : z.record(z.any());
        if (schema.additionalProperties === false) {
          try {
            return (base as z.ZodObject<any>).strict();
          } catch {
            return base as any;
          }
        }
        return base as any;
      }
      default:
        return z.any();
    }
  } catch {
    return z.any();
  }
}

export function summarizeJsonSchemaInputs(schema: any): string | undefined {
  try {
    if (!schema || typeof schema !== "object") return undefined;
    const obj = schema.type === "object" ? schema : schema.schema || schema.definition || schema;
    if (!obj || obj.type !== "object" || typeof obj.properties !== "object") return undefined;
    const required: string[] = Array.isArray(obj.required) ? obj.required : [];
    const parts: string[] = [];
    for (const [key, prop] of Object.entries<any>(obj.properties)) {
      const t = Array.isArray(prop?.type) ? (prop.type as any[]).filter((x) => x !== "null").join("|") : prop?.type || inferTypeFromSchema(prop);
      const req = required.includes(key) ? "required" : "optional";
      parts.push(`${key} (${t || "any"}, ${req})`);
    }
    return parts.length ? `Inputs: ${parts.join(", ")}` : undefined;
  } catch {
    return undefined;
  }
}

function inferTypeFromSchema(s: any): string | undefined {
  if (!s) return undefined;
  if (s.enum) return "enum";
  if (s.const !== undefined) return typeof s.const;
  if (s.properties) return "object";
  if (s.items) return "array";
  return undefined;
}
