/**
 * Reading a Supabase project's schema from its PostgREST OpenAPI document.
 *
 * Asking someone for a database password to connect an integration is the kind
 * of friction that stops the integration being used, so discovery goes through
 * the same REST endpoint the key was issued for. `GET /rest/v1/` returns an
 * OpenAPI description of everything that key is allowed to see, which has two
 * happy consequences: the connect form needs nothing but a URL and a key, and
 * the schema we discover is automatically the schema the key can actually
 * read. Row-level security is respected because we never went around it.
 *
 * The trade is real and worth stating: this sees exposed tables rather than
 * the whole database. A table PostgREST does not publish is a table MyMeta
 * cannot see, which is the correct behaviour for a key-scoped integration.
 *
 * Pure parsing, so the shape of every odd document can be tested without a
 * project to point at.
 */

export type ParsedColumn = {
  columnName: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  description: string;
  primaryKey: boolean;
  isUnique: boolean;
  /** Set when PostgREST records this column as a foreign key. */
  references: { table: string; column: string } | null;
};

export type ParsedTable = {
  schemaName: string;
  tableName: string;
  tableType: "table" | "view";
  description: string;
  columns: ParsedColumn[];
};

export type ParsedRelationship = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

export type ParsedSchema = {
  tables: ParsedTable[];
  relationships: ParsedRelationship[];
};

/**
 * PostgREST hides key information inside the human-readable description.
 *
 * A primary key is marked `<pk/>`; a foreign key is marked
 * `<fk table='other' column='id'/>`. Undocumented in the sense that it is a
 * rendering detail rather than a contract, so both patterns are matched
 * loosely and their absence is survivable: a missing marker costs us a
 * relationship, not the whole discovery.
 */
const PRIMARY_KEY_MARKER = /<pk\s*\/>/i;
const FOREIGN_KEY_MARKER =
  /<fk\s+table=['"]([^'"]+)['"]\s+column=['"]([^'"]+)['"]\s*\/>/i;

/** Strips the machine markers so what is left reads as a comment. */
function cleanDescription(raw: string): string {
  return raw
    .replace(/<pk\s*\/>/gi, "")
    .replace(/<fk[^>]*\/>/gi, "")
    .replace(/^Note:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * OpenAPI type plus format into something recognisable.
 *
 * `format` carries the real Postgres type (`uuid`, `timestamp with time
 * zone`, `jsonb`), and that is what a person and an agent both want to see;
 * `type` alone would flatten half the schema to "string".
 */
function resolveType(property: Record<string, unknown>): string {
  const format = typeof property.format === "string" ? property.format : "";
  const type = typeof property.type === "string" ? property.type : "";
  return format || type || "unknown";
}

type OpenApiDocument = {
  definitions?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  basePath?: string;
  info?: { title?: string; description?: string };
};

/**
 * Turns the OpenAPI document into tables, columns and relationships.
 *
 * Written to survive a malformed document rather than to trust one: anything
 * unrecognised is skipped, because a project with one strange definition
 * should still discover the other forty.
 */
export function parsePostgrestSchema(
  document: unknown,
  schemaName = "public",
): ParsedSchema {
  const doc = (document ?? {}) as OpenApiDocument;
  const definitions = doc.definitions;
  if (!definitions || typeof definitions !== "object") {
    return { tables: [], relationships: [] };
  }

  const tables: ParsedTable[] = [];
  const relationships: ParsedRelationship[] = [];

  for (const [tableName, rawDefinition] of Object.entries(definitions)) {
    if (!rawDefinition || typeof rawDefinition !== "object") continue;
    const definition = rawDefinition as {
      properties?: Record<string, unknown>;
      required?: unknown;
      description?: unknown;
    };

    const properties = definition.properties;
    if (!properties || typeof properties !== "object") continue;

    // `required` lists the columns that cannot be null on insert, which is the
    // closest thing the document has to NOT NULL.
    const required = new Set(
      Array.isArray(definition.required)
        ? definition.required.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
    );

    const columns: ParsedColumn[] = [];

    for (const [columnName, rawProperty] of Object.entries(properties)) {
      if (!rawProperty || typeof rawProperty !== "object") continue;
      const property = rawProperty as Record<string, unknown>;
      const rawDescription =
        typeof property.description === "string" ? property.description : "";

      const foreignKey = FOREIGN_KEY_MARKER.exec(rawDescription);
      const references = foreignKey
        ? { table: foreignKey[1]!, column: foreignKey[2]! }
        : null;

      if (references) {
        relationships.push({
          sourceTable: tableName,
          sourceColumn: columnName,
          targetTable: references.table,
          targetColumn: references.column,
        });
      }

      const primaryKey = PRIMARY_KEY_MARKER.test(rawDescription);

      columns.push({
        columnName,
        dataType: resolveType(property),
        nullable: !required.has(columnName) && !primaryKey,
        defaultValue:
          property.default === undefined || property.default === null
            ? null
            : String(property.default),
        description: cleanDescription(rawDescription),
        primaryKey,
        // The document does not distinguish unique constraints from primary
        // keys, so claiming one would be inventing information.
        isUnique: primaryKey,
        references,
      });
    }

    if (columns.length === 0) continue;

    tables.push({
      schemaName,
      tableName,
      // A definition with no primary key is usually a view. It is a guess,
      // labelled as the weaker signal it is.
      tableType: columns.some((column) => column.primaryKey) ? "table" : "view",
      description:
        typeof definition.description === "string"
          ? cleanDescription(definition.description)
          : "",
      columns,
    });
  }

  // Stable ordering, so two syncs of an unchanged project produce the same
  // catalogue and a diff means something.
  tables.sort((a, b) => a.tableName.localeCompare(b.tableName));

  return { tables, relationships };
}

/**
 * Classifies why a REST call failed.
 *
 * The distinction matters to the user: a wrong key is something they can fix
 * in ten seconds, an unreachable project is not, and telling them "failed"
 * makes both look the same.
 */
export type ConnectionFailure =
  | "auth"
  | "not_found"
  | "unreachable"
  | "unknown";

export function classifyHttpStatus(status: number): ConnectionFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status >= 500) return "unreachable";
  return "unknown";
}

/** Whether a string looks like a Supabase key of any current or legacy form. */
export function looksLikeSupabaseKey(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Current: sb_publishable_… / sb_secret_…  Legacy: a JWT.
  return (
    /^sb_(publishable|secret)_[A-Za-z0-9_-]{8,}$/.test(trimmed) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)
  );
}

/**
 * A short, human-quotable identifier for a saved key.
 *
 * Exists so a card and a support conversation can refer to "SUP-8F3A21"
 * instead of to the secret itself. Generated from random bytes rather than
 * derived from the key, because anything derived from a secret is a small
 * leak of that secret.
 */
export function generateKeyId(random: () => number = Math.random): string {
  const alphabet = "0123456789ABCDEF";
  let suffix = "";
  for (let index = 0; index < 6; index++) {
    suffix += alphabet[Math.floor(random() * alphabet.length)] ?? "0";
  }
  return `SUP-${suffix}`;
}
