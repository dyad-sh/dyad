export type SqlSchemaMutationReason =
  | "schema_definition"
  | "authorization"
  | "metadata"
  | "dynamic_execution"
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
  | { readonly type: "word"; readonly value: string }
  | { readonly type: "symbol"; readonly value: "(" | ")" | "," | ";" };

type SqlWalkerCallbacks = {
  readonly onNormalChar?: (context: {
    readonly char: string;
    readonly index: number;
  }) => number | void;
};

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

  return {
    sql: trimmed,
    mutatesSchema: false,
    reason: null,
    command: first,
  };
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
  return tokens.find((token) => token.type === "word")?.value ?? null;
}

function wordAt(tokens: readonly Token[], index: number): string | null {
  const words = tokens.filter((token) => token.type === "word");
  return words[index]?.value ?? null;
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

    if (depth !== 0) continue;
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
      if (char === "(" || char === ")" || char === "," || char === ";") {
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
          i += 1;
        } else {
          state = "normal";
        }
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
