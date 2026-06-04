export type SqlSchemaMutationReason =
  | "schema_definition"
  | "authorization"
  | "metadata"
  | "dynamic_execution"
  | "schema_function"
  | "select_into"
  | "unparseable_or_incomplete";

export type SqlSchemaMutationStatement = {
  readonly sql: string;
  readonly mutatesSchema: boolean;
  readonly reason: SqlSchemaMutationReason | null;
  readonly command: string | null;
};

export type SqlSchemaMutationAnalysis = {
  readonly mutatesSchema: boolean;
  readonly statements: readonly SqlSchemaMutationStatement[];
};

type SplitStatement = {
  readonly sql: string;
  readonly incomplete: boolean;
};

type Token =
  | {
      readonly type: "word";
      readonly value: string;
      readonly quoted?: true;
      readonly raw?: string;
    }
  | { readonly type: "symbol"; readonly value: "(" | ")" | "," | ";" | "." };

type SqlWalkerCallbacks = {
  readonly onNormalChar?: (context: {
    readonly char: string;
    readonly index: number;
  }) => number | void;
  readonly onDoubleQuotedIdentifier?: (context: {
    readonly identifier: string;
    readonly startIndex: number;
    readonly endIndex: number;
  }) => void;
};

// Extension-provided functions that perform DDL/catalog mutation inside their
// body. A first-keyword classifier can't see these, so `SELECT add_dimension(...)`
// would otherwise look like an ordinary read. Names are stored uppercased to
// match `tokenizeStatement` output. Keep this list to distinctive names only:
// generic-sounding ones (e.g. cron's `schedule`) belong in
// QUALIFIED_SCHEMA_FUNCTIONS so a user function of the same name isn't flagged.
const SCHEMA_FUNCTIONS: ReadonlySet<string> = new Set([
  // PostGIS (core)
  "ADDGEOMETRYCOLUMN",
  "DROPGEOMETRYCOLUMN",
  "DROPGEOMETRYTABLE",
  "POPULATE_GEOMETRY_COLUMNS",
  // PostGIS topology (these create/drop whole schemas)
  "CREATETOPOLOGY",
  "DROPTOPOLOGY",
  "ADDTOPOGEOMETRYCOLUMN",
  "DROPTOPOGEOMETRYCOLUMN",
  // PostGIS raster
  "ADDRASTERCONSTRAINTS",
  "DROPRASTERCONSTRAINTS",
  // TimescaleDB
  "CREATE_HYPERTABLE",
  "CREATE_DISTRIBUTED_HYPERTABLE",
  "ADD_DIMENSION",
  // Citus
  "CREATE_DISTRIBUTED_TABLE",
  "CREATE_REFERENCE_TABLE",
  "UNDISTRIBUTE_TABLE",
  "ALTER_DISTRIBUTED_TABLE",
  "CREATE_DISTRIBUTED_FUNCTION",
  // pg_partman
  "CREATE_PARENT",
  "CREATE_SUB_PARENT",
  "RUN_MAINTENANCE",
  "UNDO_PARTITION",
  // Arbitrary-DDL escape hatch: the payload is opaque, so flag the call.
  "DBLINK_EXEC",
]);

// Functions whose bare names are too generic to match safely. They only count
// when written schema-qualified (e.g. `cron.schedule(...)`).
const QUALIFIED_SCHEMA_FUNCTIONS: ReadonlyMap<string, string> = new Map([
  ["SCHEDULE", "CRON"],
  ["SCHEDULE_IN_DATABASE", "CRON"],
  ["UNSCHEDULE", "CRON"],
  ["ALTER_JOB", "CRON"],
]);

export function detectSqlSchemaMutation(
  sql: string,
): SqlSchemaMutationAnalysis {
  const statements = splitSqlStatements(sql).map(classifyStatement);
  return {
    mutatesSchema: statements.some((statement) => statement.mutatesSchema),
    statements,
  };
}

function classifyStatement(
  statement: SplitStatement,
): SqlSchemaMutationStatement {
  const trimmed = statement.sql.trim();
  if (statement.incomplete) {
    return mutating(trimmed, "unparseable_or_incomplete", null);
  }

  const tokens = tokenizeStatement(trimmed);
  const first = firstWord(tokens);
  if (first === null) {
    return {
      sql: trimmed,
      mutatesSchema: false,
      reason: null,
      command: null,
    };
  }

  switch (first) {
    case "CREATE":
    case "ALTER":
    case "DROP":
      return mutating(trimmed, "schema_definition", first);
    case "GRANT":
    case "REVOKE":
      return mutating(trimmed, "authorization", first);
    case "COMMENT":
      return mutating(trimmed, "metadata", first);
    case "DO":
    case "CALL":
      return mutating(trimmed, "dynamic_execution", first);
    case "SECURITY":
      if (wordAt(tokens, 1) === "LABEL") {
        return mutating(trimmed, "metadata", "SECURITY LABEL");
      }
      break;
    case "IMPORT":
      if (wordAt(tokens, 1) === "FOREIGN" && wordAt(tokens, 2) === "SCHEMA") {
        return mutating(trimmed, "schema_definition", "IMPORT FOREIGN SCHEMA");
      }
      break;
    case "SELECT":
    case "WITH":
      if (hasTopLevelSelectInto(tokens)) {
        return mutating(trimmed, "select_into", first);
      }
      break;
  }

  if (shouldScanForSchemaFunctions(first, tokens)) {
    // Fallback for statements that didn't classify on their leading keyword: a
    // known extension function (e.g. `SELECT create_hypertable(...)`) mutates
    // schema even though the statement reads like a plain SELECT/DML.
    const schemaFunction = findSchemaFunctionCall(tokens);
    if (schemaFunction !== null) {
      return mutating(trimmed, "schema_function", schemaFunction);
    }
  }

  return {
    sql: trimmed,
    mutatesSchema: false,
    reason: null,
    command: first,
  };
}

function findSchemaFunctionCall(tokens: readonly Token[]): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i];
    if (open?.type !== "symbol" || open.value !== "(") continue;

    const name = tokens[i - 1];
    const nameValue = identifierTokenValue(name);
    if (nameValue === null) continue;

    if (SCHEMA_FUNCTIONS.has(nameValue)) return nameValue;

    const requiredQualifier = QUALIFIED_SCHEMA_FUNCTIONS.get(nameValue);
    if (requiredQualifier !== undefined) {
      const dot = tokens[i - 2];
      const qualifier = tokens[i - 3];
      if (
        dot?.type === "symbol" &&
        dot.value === "." &&
        identifierTokenValue(qualifier) === requiredQualifier
      ) {
        return nameValue;
      }
    }
  }
  return null;
}

function shouldScanForSchemaFunctions(
  first: string,
  tokens: readonly Token[],
): boolean {
  switch (first) {
    case "SELECT":
    case "WITH":
    case "INSERT":
    case "UPDATE":
    case "DELETE":
    case "MERGE":
    case "VALUES":
    case "COPY":
      return true;
    case "EXPLAIN":
      return explainExecutesStatement(tokens);
  }

  return false;
}

function explainExecutesStatement(tokens: readonly Token[]): boolean {
  const explainIndex = tokens.findIndex((token) =>
    isUnquotedWord(token, "EXPLAIN"),
  );
  if (explainIndex === -1) return false;

  const next = tokens[explainIndex + 1];
  if (isUnquotedWord(next, "ANALYZE")) return true;

  if (next?.type === "symbol" && next.value === "(") {
    return explainOptionsEnableAnalyze(tokens, explainIndex + 1);
  }

  return false;
}

function explainOptionsEnableAnalyze(
  tokens: readonly Token[],
  openIndex: number,
): boolean {
  let depth = 1;

  for (let i = openIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.type === "symbol") {
      if (token.value === "(") {
        depth += 1;
      } else if (token.value === ")") {
        depth -= 1;
        if (depth === 0) return false;
      }
      continue;
    }

    if (depth !== 1 || !isUnquotedWord(token, "ANALYZE")) continue;

    const value = nextTopLevelToken(tokens, i + 1, depth);
    if (
      isUnquotedWord(value, "FALSE") ||
      isUnquotedWord(value, "OFF") ||
      isUnquotedWord(value, "NO")
    ) {
      return false;
    }

    return true;
  }

  return false;
}

function nextTopLevelToken(
  tokens: readonly Token[],
  startIndex: number,
  initialDepth: number,
): Token | undefined {
  let depth = initialDepth;

  for (let i = startIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.type === "symbol") {
      if (token.value === "(") {
        depth += 1;
        continue;
      }
      if (token.value === ")") {
        depth -= 1;
        if (depth < initialDepth) return token;
        continue;
      }
      if (depth === initialDepth) return token;
      continue;
    }

    if (depth === initialDepth) return token;
  }

  return undefined;
}

function identifierTokenValue(token: Token | undefined): string | null {
  if (token?.type !== "word") return null;
  if (token.quoted !== true) return token.value;

  // PostgreSQL folds unquoted identifiers to lowercase. A quoted call to an
  // extension function is equivalent only when the quoted spelling is already
  // lowercase, e.g. "create_hypertable"().
  const raw = token.raw;
  if (raw === undefined || raw !== raw.toLowerCase()) return null;
  return raw.toUpperCase();
}

function mutating(
  sql: string,
  reason: SqlSchemaMutationReason,
  command: string | null,
): SqlSchemaMutationStatement {
  return {
    sql,
    mutatesSchema: true,
    reason,
    command,
  };
}

function firstWord(tokens: readonly Token[]): string | null {
  return tokens.find((token) => isUnquotedWord(token))?.value ?? null;
}

function wordAt(tokens: readonly Token[], index: number): string | null {
  const words = tokens.filter((token) => isUnquotedWord(token));
  return words[index]?.value ?? null;
}

function isUnquotedWord(
  token: Token | undefined,
  value?: string,
): token is Extract<Token, { readonly type: "word" }> {
  return (
    token?.type === "word" &&
    token.quoted !== true &&
    (value === undefined || token.value === value)
  );
}

function hasTopLevelSelectInto(tokens: readonly Token[]): boolean {
  let depth = 0;
  let sawTopLevelSelect = false;

  for (const token of tokens) {
    if (token.type === "symbol") {
      if (token.value === "(") depth += 1;
      if (token.value === ")") depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || !isUnquotedWord(token)) continue;
    if (token.value === "SELECT") {
      sawTopLevelSelect = true;
      continue;
    }
    if (!sawTopLevelSelect) continue;
    if (token.value === "INTO") return true;
    if (token.value === "FROM") return false;
  }

  return false;
}

function splitSqlStatements(sql: string): SplitStatement[] {
  const statements: SplitStatement[] = [];
  let start = 0;

  const incomplete = walkSql(sql, {
    onNormalChar: ({ char, index }) => {
      if (char !== ";") return;
      pushStatement(statements, sql.slice(start, index), false);
      start = index + 1;
    },
  });

  pushStatement(statements, sql.slice(start), incomplete);
  return statements;
}

function pushStatement(
  statements: SplitStatement[],
  sql: string,
  incomplete: boolean,
): void {
  if (sql.trim().length === 0 && !incomplete) return;
  statements.push({ sql, incomplete });
}

function readDollarTag(sql: string, start: number): string | null {
  if (sql[start + 1] === "$") return "$$";
  if (!/[A-Za-z_]/u.test(sql[start + 1] ?? "")) return null;

  let index = start + 1;
  while (index < sql.length && /[A-Za-z0-9_]/u.test(sql[index] ?? "")) {
    index += 1;
  }
  if (sql[index] !== "$") return null;
  return sql.slice(start, index + 1);
}

function tokenizeStatement(sql: string): Token[] {
  const tokens: Token[] = [];

  walkSql(sql, {
    onNormalChar: ({ char, index }) => {
      if (
        char === "(" ||
        char === ")" ||
        char === "," ||
        char === ";" ||
        char === "."
      ) {
        tokens.push({ type: "symbol", value: char });
        return undefined;
      }

      if (/[A-Za-z_]/u.test(char)) {
        let end = index + 1;
        while (end < sql.length && /[A-Za-z0-9_$]/u.test(sql[end] ?? "")) {
          end += 1;
        }
        tokens.push({
          type: "word",
          value: sql.slice(index, end).toUpperCase(),
        });
        return end - 1;
      }
      return undefined;
    },
    onDoubleQuotedIdentifier: ({ identifier }) => {
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(identifier)) return;
      tokens.push({
        type: "word",
        value: identifier.toUpperCase(),
        quoted: true,
        raw: identifier,
      });
    },
  });

  return tokens;
}

function walkSql(sql: string, callbacks: SqlWalkerCallbacks): boolean {
  let state:
    | "normal"
    | "single_quote"
    | "double_quote"
    | "line_comment"
    | "block_comment"
    | "dollar_quote" = "normal";
  let blockDepth = 0;
  let dollarTag = "";
  let doubleQuotedIdentifier = "";
  let doubleQuotedIdentifierStart = -1;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i] ?? "";
    const next = sql[i + 1];

    if (state === "line_comment") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block_comment") {
      if (char === "/" && next === "*") {
        blockDepth += 1;
        i += 1;
        continue;
      }
      if (char === "*" && next === "/") {
        blockDepth -= 1;
        i += 1;
        if (blockDepth === 0) state = "normal";
      }
      continue;
    }
    if (state === "single_quote") {
      if (char === "'") {
        if (next === "'") {
          i += 1;
        } else {
          state = "normal";
        }
      }
      continue;
    }
    if (state === "double_quote") {
      if (char === '"') {
        if (next === '"') {
          doubleQuotedIdentifier += '"';
          i += 1;
        } else {
          state = "normal";
          callbacks.onDoubleQuotedIdentifier?.({
            identifier: doubleQuotedIdentifier,
            startIndex: doubleQuotedIdentifierStart,
            endIndex: i,
          });
        }
      } else {
        doubleQuotedIdentifier += char;
      }
      continue;
    }
    if (state === "dollar_quote") {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        state = "normal";
      }
      continue;
    }

    if (char === "-" && next === "-") {
      state = "line_comment";
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block_comment";
      blockDepth = 1;
      i += 1;
      continue;
    }
    if (char === "'") {
      state = "single_quote";
      continue;
    }
    if (char === '"') {
      state = "double_quote";
      doubleQuotedIdentifier = "";
      doubleQuotedIdentifierStart = i;
      continue;
    }
    if (char === "$") {
      const tag = readDollarTag(sql, i);
      if (tag !== null) {
        dollarTag = tag;
        state = "dollar_quote";
        i += tag.length - 1;
        continue;
      }
    }

    const nextIndex = callbacks.onNormalChar?.({ char, index: i });
    if (typeof nextIndex === "number") {
      i = nextIndex;
    }
  }

  return state !== "normal";
}
