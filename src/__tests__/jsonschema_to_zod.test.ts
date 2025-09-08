import { describe, it, expect } from "vitest";
import { jsonSchemaToZod, summarizeJsonSchemaInputs } from "@/ipc/utils/jsonschema_to_zod";
import { z } from "zod";

describe("jsonSchemaToZod", () => {
  it("converts simple object with required string", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "integer" },
      },
      required: ["query"],
    };
    const zodSchema = jsonSchemaToZod(schema);
    const parsed = zodSchema.parse({ query: "hello", count: 3 });
    expect(parsed.query).toBe("hello");
    expect(parsed.count).toBe(3);
    expect(() => zodSchema.parse({})).toThrow();
  });

  it("handles enum and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { enum: ["fast", "accurate"] },
        tags: { type: "array", items: { type: "string" } },
      },
    };
    const zodSchema = jsonSchemaToZod(schema);
    const parsed = zodSchema.parse({ mode: "fast", tags: ["a", "b"] });
    expect(parsed.mode).toBe("fast");
    expect(Array.isArray(parsed.tags)).toBe(true);
  });
});

describe("summarizeJsonSchemaInputs", () => {
  it("summarizes object inputs", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "integer" },
      },
      required: ["query"],
    };
    const summary = summarizeJsonSchemaInputs(schema)!;
    expect(summary).toContain("query (string, required)");
    expect(summary).toContain("count (integer");
    expect(summary).toContain("optional)");
  });
});

