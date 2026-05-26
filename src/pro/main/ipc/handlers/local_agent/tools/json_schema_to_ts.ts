/**
 * Convert a JSON Schema fragment to a TypeScript type string. Used by
 * the sandbox-script tool to render MCP-tool input schemas into the
 * `declare function` block the LLM sees.
 *
 * Coverage spans primitives, type-as-array unions, objects (with
 * properties / required / patternProperties / additionalProperties /
 * unevaluatedProperties), arrays + tuples (items / prefixItems /
 * additionalItems), enum, const, allOf / anyOf / oneOf, if / then / else
 * as a discriminated union, local `$ref` against `$defs` and
 * `definitions` (with cycle detection), and the OpenAPI `nullable: true`
 * extension.
 *
 * Documented spec deviations and library-coverage omissions live with
 * the test suite in `json_schema_to_ts.spec.ts`. Anything that changes
 * the rendered output should be backed by a test there.
 */
export function jsonSchemaToTs(
  schema: any,
  indent = 0,
  ctx?: JsonSchemaToTsCtx,
): string {
  const realCtx = ctx ?? { root: schema, visited: new Set() };
  return appendNullableSuffix(
    schema,
    jsonSchemaToTsInner(schema, indent, realCtx),
  );
}

/**
 * Internal recursion context: the root schema for `$ref` resolution and
 * the set of refs currently being resolved (for cycle detection).
 */
interface JsonSchemaToTsCtx {
  root: any;
  visited: Set<string>;
}

/**
 * Returns a copy of `schema` with the listed keywords removed. Used to
 * "strip" combinator keywords before merging the remaining sibling
 * constraints into each branch.
 */
function stripKeywords(schema: any, keywords: string[]): any {
  if (!schema || typeof schema !== "object") return schema;
  const out: any = {};
  for (const key of Object.keys(schema)) {
    if (!keywords.includes(key)) out[key] = schema[key];
  }
  return out;
}

/**
 * Set of JSON Schema keywords that affect the rendered TypeScript type.
 * Schemas carrying only ignored keywords (runtime validations,
 * annotations, custom extensions) are treated as `unknown` because they
 * place no static constraint.
 */
const STRUCTURAL_KEYWORDS = new Set([
  "type",
  "properties",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "required",
  "items",
  "prefixItems",
  "additionalItems",
  "unevaluatedItems",
  "enum",
  "const",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$dynamicRef",
  "nullable",
]);
function hasStructuralKeyword(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  for (const key of Object.keys(schema)) {
    if (STRUCTURAL_KEYWORDS.has(key)) return true;
  }
  return false;
}

/**
 * Identifies schemas that should be merged as objects rather than
 * intersected as opaque types. Object-shaped means the schema has any
 * keyword that only makes sense on an object (or explicitly sets
 * `type: "object"`), and doesn't set a conflicting non-object type.
 */
function isObjectShaped(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (typeof schema.type === "string" && schema.type !== "object") return false;
  if (Array.isArray(schema.type) && !schema.type.includes("object"))
    return false;
  return (
    schema.type === "object" ||
    schema.properties !== undefined ||
    schema.patternProperties !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.unevaluatedProperties !== undefined ||
    Array.isArray(schema.required)
  );
}

/**
 * Merge a list of object-shaped JSON Schemas into a single virtual
 * schema. Properties are combined (later branches override earlier);
 * `required` is unioned; `patternProperties` are combined; explicit
 * `false` on `additionalProperties` / `unevaluatedProperties` wins
 * (closure dominates). The result feeds back into `jsonSchemaToTs` for
 * rendering, so the index-signature logic etc. is reused unchanged.
 */
function mergeSchemas(sources: any[]): any {
  const merged: any = { type: "object" };
  const props: Record<string, any> = {};
  const required = new Set<string>();
  const patternProps: Record<string, any> = {};
  let ap: unknown = undefined;
  let up: unknown = undefined;

  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    if (s.properties && typeof s.properties === "object") {
      for (const k of Object.keys(s.properties)) {
        // Property-level type conflict detection: if two branches both
        // assert `type` on the same property with incompatible values,
        // the merged shape is unsatisfiable.
        const existing = props[k];
        const incoming = s.properties[k];
        if (
          existing &&
          incoming &&
          typeof existing === "object" &&
          typeof incoming === "object" &&
          typeof existing.type === "string" &&
          typeof incoming.type === "string" &&
          existing.type !== incoming.type
        ) {
          return { __impossible: true };
        }
        props[k] = incoming;
      }
    }
    if (Array.isArray(s.required)) {
      for (const r of s.required) required.add(r);
    }
    if (s.patternProperties && typeof s.patternProperties === "object") {
      for (const k of Object.keys(s.patternProperties)) {
        patternProps[k] = s.patternProperties[k];
      }
    }
    if ("additionalProperties" in s) {
      ap =
        ap === false || s.additionalProperties === false
          ? false
          : s.additionalProperties;
    }
    if ("unevaluatedProperties" in s) {
      up =
        up === false || s.unevaluatedProperties === false
          ? false
          : s.unevaluatedProperties;
    }
  }

  if (Object.keys(props).length > 0) merged.properties = props;
  if (required.size > 0) merged.required = [...required];
  if (Object.keys(patternProps).length > 0)
    merged.patternProperties = patternProps;
  if (ap !== undefined) merged.additionalProperties = ap;
  if (up !== undefined) merged.unevaluatedProperties = up;
  return merged;
}

/**
 * Build the two virtual schemas that an if/then/else dispatch should
 * render as a discriminated union. For each `properties: { X: { const:
 * V } }` discriminator in the `if` condition, the then-branch narrows
 * X to the const V (and marks it required); the else-branch narrows X
 * to the complement when the parent's X is an enum (with a single
 * remaining value collapsing to a const). When the complement can't be
 * computed, the else-branch leaves X with the parent's broader type.
 */
function computeIfThenElseBranches(
  parent: any,
  ifSchema: any,
  thenSchema: any,
  elseSchema: any,
): { thenBranch: any; elseBranch: any } {
  const ifProps =
    (ifSchema &&
      typeof ifSchema === "object" &&
      typeof ifSchema.properties === "object" &&
      ifSchema.properties) ||
    {};
  const thenNarrow: any = { properties: {}, required: [] };
  const elseNarrow: any = { properties: {}, required: [] };

  for (const key of Object.keys(ifProps)) {
    const cond = ifProps[key];
    if (cond && typeof cond === "object" && "const" in cond) {
      const constVal = cond.const;
      thenNarrow.properties[key] = { const: constVal };
      thenNarrow.required.push(key);

      const parentProp = parent?.properties?.[key];
      if (parentProp && Array.isArray(parentProp.enum)) {
        const remaining = parentProp.enum.filter(
          (v: unknown) => JSON.stringify(v) !== JSON.stringify(constVal),
        );
        if (remaining.length === 1) {
          elseNarrow.properties[key] = { const: remaining[0] };
          elseNarrow.required.push(key);
        } else if (remaining.length > 1) {
          elseNarrow.properties[key] = { enum: remaining };
          elseNarrow.required.push(key);
        }
        // 0 remaining → can't narrow; leave parent's property unchanged.
      }
      // No enum on parent's property → can't compute complement; leave
      // parent's property unchanged on the else branch.
    }
  }

  const thenSources: any[] = [parent, thenNarrow];
  if (thenSchema && typeof thenSchema === "object")
    thenSources.push(thenSchema);
  const elseSources: any[] = [parent, elseNarrow];
  if (elseSchema && typeof elseSchema === "object")
    elseSources.push(elseSchema);

  return {
    thenBranch: mergeSchemas(thenSources),
    elseBranch: mergeSchemas(elseSources),
  };
}

/**
 * Render any JSON-serializable value as a TypeScript literal type.
 * Used for `const` and `enum` so non-primitive values (objects, arrays)
 * become valid TS literal types like `{ "a": 1 }` instead of
 * `[object Object]`.
 */
function renderLiteralType(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  // Objects and arrays: JSON encoding doubles as a valid TS literal type.
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown";
  }
}

/**
 * Walk a JSON Pointer fragment (`#/foo/bar`) against `root` and return
 * the target subschema, or `null` if any segment is missing.
 */
function resolveLocalRef(root: any, ref: string): any {
  if (!ref.startsWith("#/")) return null;
  const segments = ref
    .slice(2)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = root;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in cur) {
      cur = cur[seg];
    } else {
      return null;
    }
  }
  return cur;
}

// OpenAPI-style `nullable: true` is not standard JSON Schema, but many
// real-world MCP servers emit it (especially those derived from OpenAPI
// specs). When set, append ` | null` to whatever inner type we produced.
function appendNullableSuffix(schema: any, rendered: string): string {
  if (
    schema &&
    typeof schema === "object" &&
    schema.nullable === true &&
    rendered !== "never" &&
    !rendered.endsWith("null") &&
    !/\| null\b/.test(rendered)
  ) {
    return `${rendered} | null`;
  }
  return rendered;
}

function jsonSchemaToTsInner(
  schema: any,
  indent: number,
  ctx: JsonSchemaToTsCtx,
): string {
  // JSON Schema boolean schemas: `true` accepts anything, `false` rejects
  // everything. Map to `unknown` / `never` accordingly.
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if (!schema || typeof schema !== "object") {
    return "unknown";
  }

  // A schema that carries only ignored keywords (runtime validations,
  // annotations, custom extensions) places no type-level constraint and
  // renders as `unknown`. Without this, `{minLength: 3}` would fall
  // through to the object case and produce `Record<string, unknown>`,
  // which would then pollute intersections like `string & ...`.
  if (!hasStructuralKeyword(schema)) {
    return "unknown";
  }

  // `not` describes a type complement that has no TypeScript equivalent.
  // When `not` is the only structural keyword, the schema accepts any
  // value not matching the negated subschema — we can't narrow that, so
  // it renders as `unknown`. When `not` appears alongside other
  // structural keywords, we drop it silently and render the rest
  // (deliberate lossy choice — see deviation #3 in the spec file).
  if (schema.not !== undefined) {
    const hasOther = Object.keys(schema).some(
      (k) => STRUCTURAL_KEYWORDS.has(k) && k !== "not",
    );
    if (!hasOther) return "unknown";
    return jsonSchemaToTs(stripKeywords(schema, ["not"]), indent, ctx);
  }

  // $ref: resolve local JSON Pointers (`#/$defs/X`, `#/definitions/X`)
  // against the root schema. Remote refs (http://, file://, relative
  // paths) and unresolved local refs both render as `unknown` (SSRF
  // rationale lives in deviation #7 in the spec file). Cycle detection
  // ensures recursive schemas (e.g. tree nodes) terminate.
  if (typeof schema.$ref === "string") {
    const ref: string = schema.$ref;
    if (!ref.startsWith("#/")) return "unknown";
    if (ctx.visited.has(ref)) return "unknown";
    const resolved = resolveLocalRef(ctx.root, ref);
    if (!resolved || typeof resolved !== "object") return "unknown";
    const nextCtx: JsonSchemaToTsCtx = {
      root: ctx.root,
      visited: new Set([...ctx.visited, ref]),
    };
    // Sibling keywords next to `$ref` apply alongside the resolved
    // schema. Merge when both sides are object-shaped; intersect
    // otherwise. Metadata-only siblings (e.g. `description`) fall
    // through to the plain resolved render.
    const siblings = stripKeywords(schema, ["$ref"]);
    if (hasStructuralKeyword(siblings)) {
      if (isObjectShaped(resolved) && isObjectShaped(siblings)) {
        return jsonSchemaToTs(
          mergeSchemas([resolved, siblings]),
          indent,
          nextCtx,
        );
      }
      return `${jsonSchemaToTs(resolved, indent, nextCtx)} & ${jsonSchemaToTs(
        siblings,
        indent,
        nextCtx,
      )}`;
    }
    return jsonSchemaToTs(resolved, indent, nextCtx);
  }
  if (typeof schema.$dynamicRef === "string") {
    // Dynamic refs intentionally not resolved (deviation #8 in spec file).
    return "unknown";
  }

  // if/then/else: emit a discriminated union of (parent + if-narrowed +
  // then) | (parent + if-complement-narrowed + else). When the `if`
  // condition is `properties: {X: {const: V}}`, we narrow X to the
  // const V on the then-branch (and to the complement on the else-
  // branch, when computable from a parent enum). See deviation list
  // and the simplification it documents.
  if (schema.if && typeof schema.if === "object") {
    const parent = stripKeywords(schema, ["if", "then", "else"]);
    const { thenBranch, elseBranch } = computeIfThenElseBranches(
      parent,
      schema.if,
      schema.then,
      schema.else,
    );
    return `${jsonSchemaToTs(thenBranch, indent, ctx)} | ${jsonSchemaToTs(
      elseBranch,
      indent,
      ctx,
    )}`;
  }

  // anyOf / oneOf: merge each variant with the sibling constraints in
  // the parent (the schema with the combinator stripped). Render each
  // merged variant and join with `|`. oneOf collapses to the same shape
  // as anyOf — TypeScript can't express "exactly one branch matches."
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants: any[] = schema.anyOf ?? schema.oneOf;
    const parent = stripKeywords(schema, ["anyOf", "oneOf"]);
    const parentNonEmpty = hasStructuralKeyword(parent);
    return variants
      .map((v: any) => {
        // No parent constraints → render the variant alone.
        if (!parentNonEmpty) return jsonSchemaToTs(v, indent, ctx);
        // Both sides object-shaped → merge into a single shape per branch.
        if (isObjectShaped(parent) && isObjectShaped(v)) {
          return jsonSchemaToTs(mergeSchemas([parent, v]), indent, ctx);
        }
        // Unmergeable: render the variant alone. Parent constraints are
        // dropped for that branch (best-effort).
        return jsonSchemaToTs(v, indent, ctx);
      })
      .join(" | ");
  }

  // allOf: gather parent + branches, then either merge into a single
  // object schema (when all sources are object-shaped) or fall back to
  // a literal `T1 & T2` intersection.
  if (Array.isArray(schema.allOf)) {
    const parent = stripKeywords(schema, ["allOf"]);
    const sources = [parent, ...schema.allOf].filter(hasStructuralKeyword);
    if (sources.length === 0) return "unknown";
    if (sources.length === 1) {
      return jsonSchemaToTs(sources[0], indent, ctx);
    }
    // Impossible-schema detection: allOf branches that declare
    // conflicting primitive `type`s can never be satisfied at the same
    // time, so collapse to `never`.
    const declaredTypes = new Set<string>();
    for (const s of sources) {
      if (typeof s.type === "string") declaredTypes.add(s.type);
    }
    if (declaredTypes.size > 1) return "never";
    if (sources.every(isObjectShaped)) {
      const merged = mergeSchemas(sources);
      if (merged.__impossible) return "never";
      return jsonSchemaToTs(merged, indent, ctx);
    }
    return sources.map((s) => jsonSchemaToTs(s, indent, ctx)).join(" & ");
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(renderLiteralType).join(" | ");
  }
  if (schema.const !== undefined) {
    return renderLiteralType(schema.const);
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return type
      .map((t: string) => jsonSchemaToTs({ ...schema, type: t }, indent, ctx))
      .join(" | ");
  }

  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      // Detect tuple-shaped arrays:
      //   - `prefixItems` (when present and an array) lists the tuple
      //     elements; `items` is then a single schema describing any
      //     element past the prefix.
      //   - Otherwise, if `items` is an array, it lists the tuple
      //     elements; `additionalItems` describes any element past the
      //     prefix.
      // A non-array `items` (or absent items) means the array is
      // homogeneous and falls through to the `Array<T>` rendering below.
      const prefixSrc = Array.isArray(schema.prefixItems)
        ? schema.prefixItems
        : Array.isArray(schema.items)
          ? schema.items
          : null;
      if (prefixSrc) {
        const rest = Array.isArray(schema.prefixItems)
          ? schema.items
          : schema.additionalItems;
        // Omitted `minItems` defaults to 0 — instances may be empty.
        const minItems =
          typeof schema.minItems === "number" ? schema.minItems : 0;
        const maxItems =
          typeof schema.maxItems === "number" &&
          schema.maxItems < prefixSrc.length
            ? schema.maxItems
            : prefixSrc.length;
        const parts = prefixSrc.slice(0, maxItems).map((s: any, i: number) => {
          const t = jsonSchemaToTs(s, indent, ctx);
          return i >= minItems ? `${t}?` : t;
        });
        if (rest === false) {
          return `[${parts.join(", ")}]`;
        }
        // When the rest schema is absent or `true`, additional elements past
        // the tuple prefix are unrestricted (any value), so render as
        // `...unknown[]`. Otherwise render the rest schema as the rest type.
        const restType =
          rest === true || rest === undefined
            ? "unknown"
            : jsonSchemaToTs(rest, indent, ctx);
        return `[${parts.join(", ")}, ...${restType}[]]`;
      }
      const items = schema.items
        ? jsonSchemaToTs(schema.items, indent, ctx)
        : "unknown";
      return `Array<${items}>`;
    }
    case "object":
    case undefined: {
      const props = schema.properties ?? {};
      const required: string[] = Array.isArray(schema.required)
        ? schema.required
        : [];
      const keys = Object.keys(props);
      const rawIndexType = buildIndexSignatureType(schema, indent, ctx);
      // When named properties exist alongside a typed index signature
      // (`additionalProperties`, `unevaluatedProperties`, or
      // `patternProperties`), TypeScript's `T & Record<string, U>` would
      // require each named property to satisfy `U` too — which yields
      // `never` when the named property type isn't assignable to `U`
      // (e.g. `{id?: number} & Record<string, string>` makes `id` impossible
      // to set). Per JSON Schema, those keywords only constrain keys
      // outside `properties`. Widening the index to `unknown` matches
      // json-schema-to-ts's behavior and avoids the conflict. The empty-
      // object branch above keeps the precise type, since there's no
      // named-prop conflict possible there.
      const indexType =
        keys.length > 0 && rawIndexType && rawIndexType !== "unknown"
          ? "unknown"
          : rawIndexType;
      if (keys.length === 0) {
        return indexType ? `Record<string, ${indexType}>` : "{}";
      }
      const pad = "  ".repeat(indent + 1);
      const closePad = "  ".repeat(indent);
      const lines = keys.map((key) => {
        const optional = required.includes(key) ? "" : "?";
        const propSchema = props[key];
        const desc = propSchema?.description;
        const typeStr = jsonSchemaToTs(propSchema, indent + 1, ctx);
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
          ? key
          : JSON.stringify(key);
        const docLine = desc
          ? `${pad}/** ${String(desc).replace(/\s+/g, " ").trim().replace(/\*\//g, "*\\/")} */\n`
          : "";
        return `${docLine}${pad}${safeKey}${optional}: ${typeStr};`;
      });
      const body = `{\n${lines.join("\n")}\n${closePad}}`;
      return indexType ? `${body} & Record<string, ${indexType}>` : body;
    }
    default:
      return "unknown";
  }
}

/**
 * Collect everything that contributes to an object's string index signature:
 * `patternProperties` value schemas, `additionalProperties`, and (best-effort)
 * `unevaluatedProperties`. Returns the rendered union of those types, or
 * `null` when the schema is closed (no index signature should be emitted).
 */
function buildIndexSignatureType(
  schema: any,
  indent: number,
  ctx: JsonSchemaToTsCtx,
): string | null {
  const ap = schema.additionalProperties;
  const up = schema.unevaluatedProperties;

  // Explicit `false` on either keyword closes the object — no index
  // signature, only patternProperties (if any) still apply.
  const closed = ap === false || up === false;

  const parts: string[] = [];
  const patternProps = schema.patternProperties;
  if (patternProps && typeof patternProps === "object") {
    for (const key of Object.keys(patternProps)) {
      parts.push(jsonSchemaToTs(patternProps[key], indent, ctx));
    }
  }

  if (closed) {
    if (parts.length === 0) return null;
    return Array.from(new Set(parts)).join(" | ");
  }

  // Both keywords restrict "extra" keys past properties/patternProperties.
  // unevaluatedProperties also accounts for keys defined by composed
  // subschemas (allOf/anyOf/etc.) — we don't track that, so the two are
  // treated as equivalent here.
  for (const value of [ap, up]) {
    if (value === true) {
      parts.push("unknown");
    } else if (value && typeof value === "object") {
      parts.push(jsonSchemaToTs(value, indent, ctx));
    }
  }

  // Spec default for an unspecified additionalProperties is `true`.
  // When neither keyword is set and we have no patternProperties either,
  // honor the default and emit `unknown` so the rendered type accepts
  // additional keys, matching what the schema actually validates.
  if (parts.length === 0 && ap === undefined && up === undefined) {
    parts.push("unknown");
  }

  if (parts.length === 0) return null;
  // Deduplicate identical fragments so e.g. patternProperties + matching
  // additionalProperties don't render as `string | string`.
  return Array.from(new Set(parts)).join(" | ");
}
