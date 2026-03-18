import log from "electron-log";

const logger = log.scope("undo_sql_generator");

/**
 * Given a forward DDL SQL string (potentially multi-statement),
 * returns the reverse SQL to undo those changes, or null if any
 * statement cannot be reversed.
 *
 * Conservative principle: return null rather than incorrect undo-SQL.
 */
export function generateUndoSql(forwardSql: string): string | null {
  const statements = splitStatements(forwardSql);
  if (statements.length === 0) {
    return null;
  }

  const undoStatements: string[] = [];
  for (const stmt of statements) {
    const undo = generateUndoForStatement(stmt);
    if (undo === null) {
      logger.warn(
        `Cannot generate undo-SQL for statement: ${stmt.slice(0, 100)}...`,
      );
      return null;
    }
    undoStatements.push(undo);
  }

  // Reverse order so undo is applied in reverse chronological order
  undoStatements.reverse();
  return undoStatements.join(";\n") + ";";
}

/**
 * Split a SQL string into individual statements by semicolons,
 * respecting string literals and dollar-quoted strings.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted string
    if (ch === "'") {
      const end = findClosingQuote(sql, i, "'");
      current += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Dollar-quoted string (e.g., $$ or $tag$)
    if (ch === "$") {
      const tagMatch = sql.slice(i).match(/^(\$[^$]*\$)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          continue;
        }
      }
    }

    // Line comment
    if (ch === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i);
      if (newline === -1) {
        i = sql.length;
      } else {
        i = newline + 1;
      }
      continue;
    }

    // Block comment
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        i = sql.length;
      } else {
        i = end + 2;
      }
      continue;
    }

    // Statement separator
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

function findClosingQuote(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      // Check for escaped quote (double quote)
      if (i + 1 < sql.length && sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return sql.length - 1;
}

/**
 * Generate undo SQL for a single DDL statement.
 * Returns null if the statement cannot be reversed.
 */
function generateUndoForStatement(stmt: string): string | null {
  // Normalize whitespace for pattern matching
  const normalized = stmt.replace(/\s+/g, " ").trim();

  // Check for non-public schema references
  if (containsNonPublicSchema(normalized)) {
    logger.warn(`Non-public schema detected, skipping undo generation`);
    return null;
  }

  // Try each pattern in order
  return (
    tryCreateTable(normalized) ??
    tryAlterTableAddColumn(normalized) ??
    tryCreateIndex(normalized) ??
    tryCreatePolicy(normalized) ??
    tryEnableRls(normalized) ??
    tryDisableRls(normalized) ??
    tryCreateFunction(normalized) ??
    tryCreateTrigger(normalized) ??
    tryDropTable(normalized) ??
    tryDropColumn(normalized) ??
    tryCreateType(normalized) ??
    tryAlterTableAlterColumn(normalized) ??
    tryCreateExtension(normalized) ??
    null
  );
}

// Pattern: CREATE TABLE [IF NOT EXISTS] [schema.]<name> (...)
function tryCreateTable(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
  );
  if (match) {
    return `DROP TABLE IF EXISTS ${match[1]}`;
  }
  return null;
}

// Pattern: ALTER TABLE [schema.]<table> ADD [COLUMN] <col> <type> [...]
function tryAlterTableAddColumn(sql: string): string | null {
  const match = sql.match(
    /^ALTER\s+TABLE\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+ADD\s+(?:COLUMN\s+)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+/i,
  );
  if (match) {
    return `ALTER TABLE ${match[1]} DROP COLUMN IF EXISTS ${match[2]}`;
  }
  return null;
}

// Pattern: CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] <name> ON <table>
function tryCreateIndex(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+ON\s+/i,
  );
  if (match) {
    return `DROP INDEX IF EXISTS ${match[1]}`;
  }
  return null;
}

// Pattern: CREATE POLICY <name> ON <table>
function tryCreatePolicy(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+POLICY\s+("?[a-zA-Z_][a-zA-Z0-9_ ]*"?)\s+ON\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
  );
  if (match) {
    return `DROP POLICY IF EXISTS ${match[1]} ON ${match[2]}`;
  }
  return null;
}

// Pattern: ALTER TABLE <table> ENABLE ROW LEVEL SECURITY
function tryEnableRls(sql: string): string | null {
  const match = sql.match(
    /^ALTER\s+TABLE\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY$/i,
  );
  if (match) {
    return `ALTER TABLE ${match[1]} DISABLE ROW LEVEL SECURITY`;
  }
  return null;
}

// Pattern: ALTER TABLE <table> DISABLE ROW LEVEL SECURITY
function tryDisableRls(sql: string): string | null {
  const match = sql.match(
    /^ALTER\s+TABLE\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY$/i,
  );
  if (match) {
    return `ALTER TABLE ${match[1]} ENABLE ROW LEVEL SECURITY`;
  }
  return null;
}

// Pattern: CREATE [OR REPLACE] FUNCTION <name>(...)
function tryCreateFunction(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(/i,
  );
  if (match) {
    // Extract full function signature for DROP (need params for overloaded functions)
    // For simplicity, drop without params — works when there's no overloading
    return `DROP FUNCTION IF EXISTS ${match[1]}`;
  }
  return null;
}

// Pattern: CREATE [OR REPLACE] TRIGGER <name> ... ON <table>
function tryCreateTrigger(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+.*?\s+ON\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
  );
  if (match) {
    return `DROP TRIGGER IF EXISTS ${match[1]} ON ${match[2]}`;
  }
  return null;
}

// Pattern: DROP TABLE — not reversible
function tryDropTable(sql: string): string | null {
  if (/^DROP\s+TABLE/i.test(sql)) {
    logger.warn("DROP TABLE is not reversible");
    return null;
  }
  return undefined as unknown as null;
}

// Pattern: ALTER TABLE ... DROP COLUMN — not reversible
function tryDropColumn(sql: string): string | null {
  if (/^ALTER\s+TABLE\s+.*\s+DROP\s+(?:COLUMN\s+)?/i.test(sql)) {
    logger.warn("DROP COLUMN is not reversible without stored data");
    return null;
  }
  return undefined as unknown as null;
}

// Pattern: CREATE TYPE <name> AS ENUM (...)
function tryCreateType(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+TYPE\s+(?:(?:public|"public")\.)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+/i,
  );
  if (match) {
    return `DROP TYPE IF EXISTS ${match[1]}`;
  }
  return null;
}

// Pattern: ALTER TABLE <table> ALTER COLUMN <col> SET/DROP NOT NULL, SET DEFAULT, etc.
function tryAlterTableAlterColumn(sql: string): string | null {
  // ALTER COLUMN changes are complex and not safely reversible without knowing prior state
  if (/^ALTER\s+TABLE\s+.*\s+ALTER\s+(?:COLUMN\s+)?/i.test(sql)) {
    logger.warn("ALTER COLUMN is not safely reversible without prior state");
    return null;
  }
  return undefined as unknown as null;
}

// Pattern: CREATE EXTENSION [IF NOT EXISTS] <name>
function tryCreateExtension(sql: string): string | null {
  const match = sql.match(
    /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[a-zA-Z_][a-zA-Z0-9_-]*"?)/i,
  );
  if (match) {
    return `DROP EXTENSION IF EXISTS ${match[1]}`;
  }
  return null;
}

/**
 * Check if SQL references non-public schemas that we should not auto-undo.
 * Only triggers when the DDL target itself is in a non-public schema,
 * not when there's a FK reference to one (e.g., REFERENCES auth.users).
 */
function containsNonPublicSchema(sql: string): boolean {
  // Strip REFERENCES clauses so FK references to auth/storage don't false-positive
  const withoutRefs = sql.replace(
    /REFERENCES\s+(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?\.)?(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi,
    "",
  );

  // Match schema-qualified names that are NOT public
  const schemaMatch = withoutRefs.match(
    /(?<!\w)(?:auth|storage|vault|extensions|pgbouncer|realtime|supabase_functions|supabase_migrations)\./i,
  );
  return schemaMatch !== null;
}

/**
 * Generate a human-readable summary of what undo-SQL will do.
 */
export function summarizeUndoSql(undoSql: string): string[] {
  const statements = splitStatements(undoSql);
  return statements.map((stmt) => {
    const normalized = stmt.replace(/\s+/g, " ").trim();

    const dropTable = normalized.match(
      /^DROP\s+TABLE\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropTable) return `Drop table ${dropTable[1]}`;

    const dropCol = normalized.match(
      /^ALTER\s+TABLE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropCol) return `Remove column ${dropCol[2]} from ${dropCol[1]}`;

    const dropIndex = normalized.match(
      /^DROP\s+INDEX\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropIndex) return `Drop index ${dropIndex[1]}`;

    const dropPolicy = normalized.match(
      /^DROP\s+POLICY\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_ ]*"?)\s+ON\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropPolicy)
      return `Remove policy ${dropPolicy[1]} from ${dropPolicy[2]}`;

    const disableRls = normalized.match(
      /^ALTER\s+TABLE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    if (disableRls) return `Disable RLS on ${disableRls[1]}`;

    const enableRls = normalized.match(
      /^ALTER\s+TABLE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    if (enableRls) return `Enable RLS on ${enableRls[1]}`;

    const dropFunc = normalized.match(
      /^DROP\s+FUNCTION\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropFunc) return `Drop function ${dropFunc[1]}`;

    const dropTrigger = normalized.match(
      /^DROP\s+TRIGGER\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+ON\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropTrigger)
      return `Remove trigger ${dropTrigger[1]} from ${dropTrigger[2]}`;

    const dropType = normalized.match(
      /^DROP\s+TYPE\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)/i,
    );
    if (dropType) return `Drop type ${dropType[1]}`;

    const dropExt = normalized.match(
      /^DROP\s+EXTENSION\s+IF\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_-]*"?)/i,
    );
    if (dropExt) return `Drop extension ${dropExt[1]}`;

    return normalized;
  });
}
