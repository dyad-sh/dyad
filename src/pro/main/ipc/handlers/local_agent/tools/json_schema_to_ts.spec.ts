import { describe, expect, it } from "vitest";
import { jsonSchemaToTs } from "./json_schema_to_ts";

// Test layout mirrors `json-schema-to-ts`'s `src/tests/readme/` directory
// (one describe per file there) so coverage parity is visible at a glance.
describe("jsonSchemaToTs", () => {
  describe("primitive", () => {
    it("renders each primitive type", () => {
      expect(jsonSchemaToTs({ type: "string" })).toBe("string");
      expect(jsonSchemaToTs({ type: "number" })).toBe("number");
      expect(jsonSchemaToTs({ type: "integer" })).toBe("number");
      expect(jsonSchemaToTs({ type: "boolean" })).toBe("boolean");
      expect(jsonSchemaToTs({ type: "null" })).toBe("null");
    });

    it("renders type-as-array as a union", () => {
      expect(jsonSchemaToTs({ type: ["string", "null"] })).toBe(
        "string | null",
      );
    });
  });

  describe("boolean schemas", () => {
    it("renders the `true` schema as `unknown`", () => {
      expect(jsonSchemaToTs(true as any)).toBe("unknown");
    });

    it("renders the `false` schema as `never`", () => {
      expect(jsonSchemaToTs(false as any)).toBe("never");
    });
  });

  describe("array", () => {
    it("renders arrays of primitives and arrays of objects", () => {
      expect(jsonSchemaToTs({ type: "array", items: { type: "string" } })).toBe(
        "Array<string>",
      );
      expect(jsonSchemaToTs({ type: "array" })).toBe("Array<unknown>");
      const arrOfObj = jsonSchemaToTs({
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "number" } },
          required: ["id"],
        },
      });
      // Nested object inherits the spec-default additionalProperties: true,
      // so the rendered element type includes the `unknown` index signature.
      expect(arrOfObj).toMatchInlineSnapshot(`
        "Array<{
          id: number;
        } & Record<string, unknown>>"
      `);
    });
  });

  describe("tuple", () => {
    it("renders items-as-array as a tuple with all prefix elements optional (minItems defaults to 0)", () => {
      // No minItems → all prefix elements optional so empty and partial
      // tuples type-check.
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }],
        }),
      ).toBe("[boolean?, string?, ...unknown[]]");
    });

    it("renders items-as-array with additionalItems: false as a closed optional tuple", () => {
      // Closed tuple without minItems still accepts shorter prefixes
      // (and the empty array) — prefix elements remain optional.
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }],
          additionalItems: false,
        }),
      ).toBe("[boolean?, string?]");
    });

    it("renders items-as-array with typed additionalItems as a rest tuple", () => {
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }],
          additionalItems: { type: "number" },
        }),
      ).toBe("[boolean?, string?, ...number[]]");
    });

    it("honors minItems by marking trailing elements optional and maxItems by clamping length", () => {
      // 1 required, 2 allowed → second element optional, no rest.
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }],
          additionalItems: false,
          minItems: 1,
          maxItems: 2,
        }),
      ).toBe("[boolean, string?]");
      // maxItems < tuple length → clamped. With default minItems=0
      // both remaining elements are optional.
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }, { type: "number" }],
          additionalItems: false,
          maxItems: 2,
        }),
      ).toBe("[boolean?, string?]");
    });

    it("renders prefixItems the same as items-as-array, treating items as the rest type", () => {
      expect(
        jsonSchemaToTs({
          type: "array",
          prefixItems: [{ type: "boolean" }, { type: "string" }],
          items: { type: "number" },
        }),
      ).toBe("[boolean?, string?, ...number[]]");
      // prefixItems without `items` follows the same default as items-as-array
      // without `additionalItems`: unrestricted → ...unknown[] rest.
      expect(
        jsonSchemaToTs({
          type: "array",
          prefixItems: [{ type: "boolean" }],
        }),
      ).toBe("[boolean?, ...unknown[]]");
      // prefixItems with items: false → closed tuple.
      expect(
        jsonSchemaToTs({
          type: "array",
          prefixItems: [{ type: "boolean" }],
          items: false,
        }),
      ).toBe("[boolean?]");
    });

    it("renders all prefix items as required when minItems matches the tuple length", () => {
      // Explicit minItems pins the required count.
      expect(
        jsonSchemaToTs({
          type: "array",
          items: [{ type: "boolean" }, { type: "string" }],
          additionalItems: false,
          minItems: 2,
        }),
      ).toBe("[boolean, string]");
    });
  });

  describe("object", () => {
    it("renders objects with required and optional properties", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
      });
      // additionalProperties is unspecified, so the JSON Schema spec
      // default (`true`) applies — the rendered shape carries an `unknown`
      // index signature.
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
          age?: number;
        } & Record<string, unknown>"
      `);
    });

    it("emits JSDoc comments from property descriptions", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL" },
        },
        required: ["url"],
      });
      expect(out).toContain("/** Target URL */");
      expect(out).toContain("url: string;");
    });

    it("collapses multi-line property descriptions into a single line", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Target URL\n  to fetch\n\n  (must be HTTPS)",
          },
        },
        required: ["url"],
      });
      // Newlines in a JSDoc body break out of the `/** ... */` envelope when
      // rendered, so the property description must be flattened to a single
      // line like the tool-level description is.
      expect(out).toContain("/** Target URL to fetch (must be HTTPS) */");
      expect(out).not.toMatch(/\/\*\*[^*]*\n[^*]*\*\//);
    });

    it("renders additionalProperties as Record when there are no named properties", () => {
      expect(
        jsonSchemaToTs({ type: "object", additionalProperties: true }),
      ).toBe("Record<string, unknown>");
      expect(
        jsonSchemaToTs({
          type: "object",
          additionalProperties: { type: "number" },
        }),
      ).toBe("Record<string, number>");
    });

    it("renders additionalProperties: false as a closed object", () => {
      // Explicit `false` closes the object — no index signature.
      const out = jsonSchemaToTs({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          a: string;
        }"
      `);
    });

    it("renders implicit and explicit additionalProperties: true the same way", () => {
      // JSON Schema's spec default is `true`. We honor it: implicit and
      // explicit both produce the same `& Record<string, unknown>` index
      // signature.
      const implicit = jsonSchemaToTs({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      });
      const explicitTrue = jsonSchemaToTs({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: true,
      });
      expect(implicit).toMatchInlineSnapshot(`
        "{
          a: string;
        } & Record<string, unknown>"
      `);
      expect(explicitTrue).toBe(implicit);
    });

    it("renders an empty object schema as Record<string, unknown> (spec-default additionalProperties)", () => {
      // No named properties, no patternProperties, no additionalProperties
      // setting → falls back to the spec default of `true`, producing an
      // open `Record<string, unknown>`. An explicitly closed empty object
      // is tested by the additionalProperties: false case below.
      expect(jsonSchemaToTs({ type: "object" })).toBe(
        "Record<string, unknown>",
      );
      expect(jsonSchemaToTs({ type: "object", properties: {} })).toBe(
        "Record<string, unknown>",
      );
      expect(
        jsonSchemaToTs({ type: "object", additionalProperties: false }),
      ).toBe("{}");
    });

    it("quotes property keys that aren't valid JS identifiers", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: { "with-hyphen": { type: "string" } },
        required: ["with-hyphen"],
      });
      expect(out).toContain('"with-hyphen": string;');
    });

    it("merges named properties with additionalProperties by widening the index to unknown", () => {
      // Widening prevents the `{name: string} & Record<string, number>`
      // contradiction. See deviation #13.
      const out = jsonSchemaToTs({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: { type: "number" },
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown>"
      `);
    });

    it("widens the index to unknown when a typed additionalProperties would conflict with a named-prop type", () => {
      // `number: number` next to string additionalProperties — widen so
      // the number prop doesn't have to satisfy the string index.
      const out = jsonSchemaToTs({
        type: "object",
        properties: {
          number: { type: "number" },
          streetName: { type: "string" },
        },
        required: ["number", "streetName"],
        additionalProperties: { type: "string" },
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          number: number;
          streetName: string;
        } & Record<string, unknown>"
      `);
    });

    it("renders patternProperties as a string index union", () => {
      // Only patternProperties, no named properties.
      expect(
        jsonSchemaToTs({
          type: "object",
          patternProperties: { "^x-": { type: "string" } },
        }),
      ).toBe("Record<string, string>");
      // patternProperties + additionalProperties unify into one union signature.
      expect(
        jsonSchemaToTs({
          type: "object",
          patternProperties: { "^x-": { type: "string" } },
          additionalProperties: { type: "number" },
        }),
      ).toBe("Record<string, string | number>");
      // Named props + patternProperties: same widening as typed
      // additionalProperties.
      const hybrid = jsonSchemaToTs({
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
        patternProperties: { "^x-": { type: "string" } },
      });
      expect(hybrid).toMatchInlineSnapshot(`
        "{
          id: number;
        } & Record<string, unknown>"
      `);
    });

    it("supports unevaluatedProperties: false (closed schema)", () => {
      // unevaluatedProperties: false means no index signature; named
      // properties stand alone.
      const out = jsonSchemaToTs({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        unevaluatedProperties: false,
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        }"
      `);
    });

    it("supports unevaluatedProperties: <schema> (widens to unknown when named props exist)", () => {
      // Same widening as typed additionalProperties.
      const out = jsonSchemaToTs({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        unevaluatedProperties: { type: "boolean" },
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown>"
      `);
    });

    it("merges allOf branches' properties under unevaluatedProperties: false (closed schema with composition)", () => {
      const out = jsonSchemaToTs({
        allOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
            required: ["a"],
          },
          {
            type: "object",
            properties: { b: { type: "number" } },
            required: ["b"],
          },
        ],
        unevaluatedProperties: false,
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          a: string;
          b: number;
        }"
      `);
    });

    // Omitted: defaulted-property strict mode (json-schema-to-ts treats a
    // property carrying `default` as required in the output type). From a
    // tool *caller*'s perspective, `default` means the server fills the
    // value when omitted, so the property remains optional — which matches
    // our default behavior (covered by "renders objects with required and
    // optional properties" above).
  });

  describe("enum", () => {
    it("renders string and number enums as literal unions", () => {
      expect(jsonSchemaToTs({ enum: ["red", "blue", "green"] })).toBe(
        '"red" | "blue" | "green"',
      );
      expect(jsonSchemaToTs({ enum: [1, 2, 3] })).toBe("1 | 2 | 3");
    });

    it("renders heterogeneous enums (mixing booleans, numbers, strings)", () => {
      expect(jsonSchemaToTs({ enum: [true, 42, "foo", null] })).toBe(
        'true | 42 | "foo" | null',
      );
    });

    it("renders enums whose values are objects or arrays as literal types", () => {
      expect(jsonSchemaToTs({ enum: [{ foo: "bar" }, [1, 2]] })).toBe(
        '{"foo":"bar"} | [1,2]',
      );
    });

    // Omitted: deriving an enum schema from a TypeScript enum
    // (`Object.values(Food)`). That's a TS-side input transformation, not
    // a JSON Schema feature. The resulting JSON Schema (an enum of strings)
    // is covered by "renders string and number enums" above.
  });

  describe("const", () => {
    it("renders primitive const values as literal types", () => {
      expect(jsonSchemaToTs({ const: "fixed" })).toBe('"fixed"');
      expect(jsonSchemaToTs({ const: 42 })).toBe("42");
      expect(jsonSchemaToTs({ const: true })).toBe("true");
      expect(jsonSchemaToTs({ const: null })).toBe("null");
    });

    it("renders const values that are objects or arrays as literal types", () => {
      expect(jsonSchemaToTs({ const: { foo: "bar", n: 1 } })).toBe(
        '{"foo":"bar","n":1}',
      );
      expect(jsonSchemaToTs({ const: ["a", "b"] })).toBe('["a","b"]');
    });
  });

  describe("allOf", () => {
    it("merges allOf object branches into a single shape", () => {
      const out = jsonSchemaToTs({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "number" } } },
        ],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          a?: string;
          b?: number;
        } & Record<string, unknown>"
      `);
    });

    it("falls back to intersection rendering when allOf branches are not all object-shaped", () => {
      // allOf of primitive type assertions can't be merged into an object
      // shape, so we emit the literal `T1 & T2` intersection. TypeScript
      // reduces the impossible cases on its own.
      expect(
        jsonSchemaToTs({
          allOf: [{ type: "string" }, { minLength: 3 }],
        }),
      ).toBe("string");
    });

    it("merges allOf object branches into a single shape with required + optional properties", () => {
      const out = jsonSchemaToTs({
        allOf: [
          {
            type: "object",
            properties: { address: { type: "string" } },
            required: ["address"],
          },
          {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          {
            type: "object",
            properties: { state: { type: "string" } },
            required: ["state"],
          },
          {
            type: "object",
            properties: { type: { enum: ["residential", "business"] } },
          },
        ],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          address: string;
          city: string;
          state: string;
          type?: "residential" | "business";
        } & Record<string, unknown>"
      `);
    });

    it("merges allOf with sibling constraints (allOf + properties) instead of dropping the parent", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
        allOf: [
          {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        ],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          id: number;
          name: string;
        } & Record<string, unknown>"
      `);
    });

    it("narrows allOf of incompatible primitive types to `never` (impossible-schema detection)", () => {
      expect(
        jsonSchemaToTs({ allOf: [{ type: "string" }, { type: "number" }] }),
      ).toBe("never");
    });
  });

  describe("anyOf", () => {
    it("renders anyOf as a union of the branches", () => {
      expect(
        jsonSchemaToTs({ anyOf: [{ type: "string" }, { type: "number" }] }),
      ).toBe("string | number");
    });

    it("merges anyOf with sibling constraints (e.g. base properties + variant anyOf)", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: { bool: { type: "boolean" } },
        required: ["bool"],
        anyOf: [
          {
            properties: { str: { type: "string" } },
            required: ["str"],
          },
          { properties: { num: { type: "number" } } },
        ],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          bool: boolean;
          str: string;
        } & Record<string, unknown> | {
          bool: boolean;
          num?: number;
        } & Record<string, unknown>"
      `);
    });
  });

  describe("oneOf", () => {
    it("renders oneOf as a union of the branches", () => {
      expect(
        jsonSchemaToTs({ oneOf: [{ type: "boolean" }, { type: "null" }] }),
      ).toBe("boolean | null");
    });

    it("renders oneOf with discriminator-style required-property variants", () => {
      const out = jsonSchemaToTs({
        oneOf: [
          {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
          {
            type: "object",
            properties: { color: { enum: ["black", "brown", "white"] } },
          },
        ],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown> | {
          color?: "black" | "brown" | "white";
        } & Record<string, unknown>"
      `);
    });
  });

  describe("not", () => {
    // `not` requires a type-level complement operator that does not exist
    // in TypeScript. Any output narrower than `unknown` would be wrong, so
    // we drop the `not` keyword from rendering entirely: a bare `not`
    // schema is `unknown`, and when `not` appears alongside other
    // constraints, those constraints render and the `not` is ignored.
    it("renders a bare `not` schema as `unknown`", () => {
      expect(jsonSchemaToTs({ not: { type: "string" } })).toBe("unknown");
    });

    it("ignores `not` when other constraints are present", () => {
      expect(jsonSchemaToTs({ type: "string", not: { const: "foo" } })).toBe(
        "string",
      );
      const out = jsonSchemaToTs({
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
        not: { properties: { x: { const: "bad" } } },
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          x: string;
        } & Record<string, unknown>"
      `);
    });
  });

  describe("ifThenElse", () => {
    it("renders if/then/else as a discriminated union of then | else, narrowing the discriminator on each branch", () => {
      // When the `if` condition is `properties: { X: { const: V } }`, a
      // matching instance must have X present and equal to V. We therefore
      // emit the discriminator as required (not optional) in both branches.
      // This is a deliberate simplification — strict JSON Schema semantics
      // permit X to be absent (since `properties` is permissive) — but it
      // matches the discriminator-style use that this keyword is for.
      const out = jsonSchemaToTs({
        type: "object",
        properties: { animal: { enum: ["dog", "cat"] } },
        if: { properties: { animal: { const: "dog" } } },
        then: {
          properties: { dogBreed: { type: "string" } },
          required: ["dogBreed"],
        },
        else: {
          properties: { catBreed: { type: "string" } },
          required: ["catBreed"],
        },
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          animal: "dog";
          dogBreed: string;
        } & Record<string, unknown> | {
          animal: "cat";
          catBreed: string;
        } & Record<string, unknown>"
      `);
    });

    it("treats a missing `then` or `else` branch as the unconstrained sibling", () => {
      // No `else`: when `if` matches, then-branch with narrowed discriminator.
      // When `if` doesn't match, only the parent shape applies (with x as
      // the parent's broader type).
      const noElse = jsonSchemaToTs({
        type: "object",
        properties: { x: { type: "string" } },
        if: { properties: { x: { const: "a" } } },
        then: {
          properties: { y: { type: "number" } },
          required: ["y"],
        },
      });
      expect(noElse).toMatchInlineSnapshot(`
        "{
          x: "a";
          y: number;
        } & Record<string, unknown> | {
          x?: string;
        } & Record<string, unknown>"
      `);
      // No `then`: when `if` matches, only the parent shape with the
      // discriminator narrowed and required. When it doesn't, else applies.
      const noThen = jsonSchemaToTs({
        type: "object",
        properties: { x: { type: "string" } },
        if: { properties: { x: { const: "a" } } },
        else: {
          properties: { y: { type: "number" } },
          required: ["y"],
        },
      });
      expect(noThen).toMatchInlineSnapshot(`
        "{
          x: "a";
        } & Record<string, unknown> | {
          x?: string;
          y: number;
        } & Record<string, unknown>"
      `);
    });
  });

  describe("nullable", () => {
    it("appends `| null` for OpenAPI-style nullable: true on primitives", () => {
      expect(jsonSchemaToTs({ type: "string", nullable: true })).toBe(
        "string | null",
      );
      expect(jsonSchemaToTs({ type: "integer", nullable: true })).toBe(
        "number | null",
      );
    });

    it("appends `| null` to object schemas with nullable: true", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        nullable: true,
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown> | null"
      `);
    });

    it("propagates nullable through nested property schemas", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: { name: { type: "string", nullable: true } },
        required: ["name"],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string | null;
        } & Record<string, unknown>"
      `);
    });

    it("does not double-append when the rendered type already ends in null", () => {
      expect(jsonSchemaToTs({ type: "null", nullable: true })).toBe("null");
      expect(
        jsonSchemaToTs({
          anyOf: [{ type: "string" }, { type: "null" }],
          nullable: true,
        }),
      ).toBe("string | null");
    });
  });

  describe("definitions & $ref", () => {
    // Local $ref / $defs / definitions only. Remote refs (http://, file://)
    // are deliberately not implemented — the schema author would otherwise
    // get to make the Dyad main process fetch arbitrary URLs (SSRF). An
    // unresolved or remote $ref renders as `unknown`.
    it("resolves local $ref against $defs", () => {
      const out = jsonSchemaToTs({
        $defs: {
          User: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        $ref: "#/$defs/User",
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown>"
      `);
    });

    it("resolves local $ref against the legacy `definitions` keyword", () => {
      const out = jsonSchemaToTs({
        definitions: {
          User: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        $ref: "#/definitions/User",
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
        } & Record<string, unknown>"
      `);
    });

    it("breaks cycles by emitting `unknown` for the recursive position", () => {
      const out = jsonSchemaToTs({
        $defs: {
          Tree: {
            type: "object",
            properties: {
              value: { type: "string" },
              child: { $ref: "#/$defs/Tree" },
            },
          },
        },
        $ref: "#/$defs/Tree",
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          value?: string;
          child?: unknown;
        } & Record<string, unknown>"
      `);
    });

    it("renders unresolved or remote $ref as `unknown`", () => {
      expect(jsonSchemaToTs({ $ref: "http://example.com/foo.json" })).toBe(
        "unknown",
      );
      expect(jsonSchemaToTs({ $ref: "./other.json" })).toBe("unknown");
      expect(jsonSchemaToTs({ $ref: "#/$defs/Missing" })).toBe("unknown");
    });

    it("merges sibling structural keywords with the resolved $ref schema", () => {
      // Sibling `required` and `additionalProperties` apply alongside
      // the resolved schema. `false` wins for additionalProperties.
      const out = jsonSchemaToTs({
        $defs: {
          Person: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
            },
            required: ["firstName"],
            additionalProperties: false,
          },
        },
        $ref: "#/$defs/Person",
        required: ["lastName"],
        additionalProperties: true,
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          firstName: string;
          lastName: string;
        }"
      `);
    });

    it("treats metadata-only siblings next to $ref as no-ops on the rendered type", () => {
      // Non-structural siblings (e.g. `description`) skip the merge path.
      const out = jsonSchemaToTs({
        $defs: { Name: { type: "string" } },
        $ref: "#/$defs/Name",
        description: "user-facing name",
      });
      expect(out).toBe("string");
    });
  });

  describe("intro / end-to-end", () => {
    it("returns 'unknown' for missing or malformed schema", () => {
      expect(jsonSchemaToTs(null)).toBe("unknown");
      expect(jsonSchemaToTs(undefined)).toBe("unknown");
      expect(jsonSchemaToTs({ type: "garbage" })).toBe("unknown");
    });

    it("renders the README dog-schema example end-to-end (matches json-schema-to-ts intro)", () => {
      const out = jsonSchemaToTs({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
          hobbies: { type: "array", items: { type: "string" } },
          favoriteFood: { enum: ["pizza", "taco", "fries"] },
        },
        required: ["name", "age"],
      });
      expect(out).toMatchInlineSnapshot(`
        "{
          name: string;
          age: number;
          hobbies?: Array<string>;
          favoriteFood?: "pizza" | "taco" | "fries";
        } & Record<string, unknown>"
      `);
    });

    it("emits `never` for an unsatisfiable allOf composition", () => {
      const out = jsonSchemaToTs({
        allOf: [
          {
            type: "object",
            properties: { x: { type: "string" } },
            additionalProperties: false,
            required: ["x"],
          },
          {
            type: "object",
            properties: { x: { type: "number" } },
            additionalProperties: false,
            required: ["x"],
          },
        ],
      });
      expect(out).toBe("never");
    });
  });

  // ==========================================================================
  // Documented spec deviations (audited against JSON Schema 2020-12 core +
  // validation vocabularies). Keywords we don't render either map to runtime
  // constraints TypeScript can't express, are metadata, or are deliberately
  // limited for security.
  //
  //   1. Runtime validation keywords are ignored:
  //        String:  format, pattern, minLength, maxLength, contentEncoding,
  //                 contentMediaType, contentSchema
  //        Number:  minimum, maximum, exclusiveMinimum, exclusiveMaximum,
  //                 multipleOf
  //        Array:   uniqueItems, contains, minContains, maxContains, and
  //                 minItems/maxItems on non-tuple arrays
  //        Object:  minProperties, maxProperties, propertyNames,
  //                 dependentRequired, dependentSchemas
  //   2. `oneOf` renders as a union, same as `anyOf`. TypeScript can't
  //      express "exactly one branch matches" at the type level.
  //   3. `not` is dropped — TypeScript has no general type-complement
  //      operator. A bare `not` schema renders as `unknown`.
  //   4. Annotation / metadata keywords are ignored: `title`, `default`,
  //      `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`,
  //      `$schema`, `$vocabulary`, `$id`, `$anchor`. `description` is
  //      preserved as JSDoc when on an object property.
  //   5. `required` keys that don't appear in `properties` are dropped from
  //      the rendered shape — instance must have them per spec, but we have
  //      no type to associate with them.
  //   6. `nullable: true` is an OpenAPI extension, not standard JSON Schema.
  //      Honored because many MCP servers come from OpenAPI specs.
  //   7. Remote `$ref` (http://, file://, relative file paths) renders as
  //      `unknown`. Resolving them would let third-party schemas trigger
  //      arbitrary URL fetches from the Dyad main process (SSRF defense).
  //   8. Dynamic refs (`$dynamicAnchor` / `$dynamicRef`) are not resolved —
  //      they encode runtime polymorphic dispatch with no static equivalent.
  //   9. `unevaluatedItems` is not applied. The standalone-schema case is
  //      equivalent to `additionalItems`, which our tuple branch handles via
  //      the rest type. Full composition-aware semantics would require
  //      tracking which items each branch evaluated.
  //  10. Custom-keyword extensions (library-specific JSON Schema
  //      vocabularies) are not interpreted.
  //  11. A schema with no `type` keyword but with object-shaped keywords
  //      (properties, required, etc.) is rendered as an object. Per spec
  //      such schemas also accept non-object instances trivially; we treat
  //      the object reading as the intended one.
  //  12. The bare `{}` schema (and any schema whose only keywords we ignore)
  //      renders as `unknown`. Matches the spec — those schemas accept any
  //      value — and prevents "no constraint" branches from polluting
  //      intersections like `string & Record<...>`.
  //  13. When an object schema has named `properties` AND a typed index
  //      signature (from `additionalProperties`, `unevaluatedProperties`, or
  //      `patternProperties`), the index signature is widened to `unknown`.
  //      The spec says those keywords only apply to keys outside
  //      `properties`, but TS has no "all keys except X" index, so naive
  //      intersection would make every named-prop type satisfy the index
  //      too — collapsing to `never` on conflict (e.g. number id vs string
  //      additionalProperties). Matches json-schema-to-ts's behavior.
  //  14. allOf / anyOf branches with `additionalProperties: false` do not
  //      restrict the combined shape. Per spec, a closed branch listing
  //      only `{num}` forbids any sibling/parent property in that branch.
  //      We merge properties across branches and let the closed setting
  //      dominate, over-permitting keys the closed branch forbids. Effect:
  //      model may include forbidden properties; MCP server's validator
  //      rejects the call and the model retries. Self-correcting via
  //      tool-error feedback, but wastes a call. Library tracks per-branch
  //      evaluated keys to handle this correctly. Out of scope.
  //
  // ==========================================================================
  // Deliberate omissions vs. the json-schema-to-ts test suite. Each has a
  // concrete reason (not "rare in practice"):
  //
  //   - extensions.type.test.ts:
  //     The library's `ExtendedJSONSchema` mechanism for user-defined
  //     custom keywords. Not part of standard JSON Schema; no MCP server
  //     can emit a schema that exercises it.
  //
  //   - deserialization.test.ts:
  //     Runtime value validation, not type rendering. Orthogonal to what
  //     this module does.
  //
  //   - references.test.ts (remote URI cases):
  //     SSRF defense (deviation #7); renders as `unknown`.
  //
  //   - not.type.test.ts (all 7 cases):
  //     `not` describes a type complement, an operator TypeScript does not
  //     have (deviation #3).
  //
  //   - object.type.test.ts case 7 ("defaulted property strict mode"):
  //     json-schema-to-ts has an option that turns `default` into "this
  //     property is required in the type". For a tool *caller*, `default`
  //     means "server fills it in if omitted", so the property stays
  //     optional — our default behavior already.
  //
  //   - enum.type.test.ts case 2 (TS-enum derivation):
  //     A TypeScript-side input transformation (`Object.values(Food)`).
  //     The resulting JSON Schema (enum of strings) is already covered.
  //
  //   - intro.type.test.ts case 2 (`asConst` helper):
  //     A TypeScript convenience helper, not JSON Schema content. The
  //     schema it produces is already covered by intro case 1.
});
