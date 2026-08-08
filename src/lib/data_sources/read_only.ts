/**
 * Statement-level read-only enforcement.
 *
 * This is the second of three boundaries, and the only one that sees raw SQL.
 * The first is the query plan type, which cannot express a write at all. The
 * third is the database role, which should be SELECT-only. This sits between
 * them and guards the introspection path, where we do build SQL text.
 *
 * It is deliberately a whitelist. A blacklist of dangerous keywords is a game
 * you lose eventually: comment tricks, unicode homoglyphs, string splitting,
 * dollar quoting, and every year somebody finds another one. So a statement is
 * refused unless it is recognisably a single read, and anything ambiguous is
 * refused rather than parsed harder.
 *
 * The UI saying "Read Only" is not the boundary. This is.
 */

export type ReadOnlyRejection = {
  code:
    | "multiple_statements"
    | "not_a_read"
    | "forbidden_keyword"
    | "empty"
    | "too_long";
  message: string;
};

export type ReadOnlyCheck =
  | { ok: true; sql: string }
  | { ok: false; rejection: ReadOnlyRejection };

/**
 * Statements a read may begin with.
 *
 * WITH is included because real introspection uses CTEs, but a WITH may still
 * contain a writable CTE (`WITH x AS (DELETE ... RETURNING ...)`), so the
 * keyword scan below still applies to it.
 */
const READ_PREFIXES = ["select", "with", "explain", "show", "table", "values"];

/**
 * Words that must not appear anywhere in a read, as whole words.
 *
 * Checked after comments and string literals are stripped, so a row of data
 * containing the word "delete" cannot trip it and a statement genuinely
 * containing DELETE cannot hide it inside a comment.
 */
const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "upsert",
  "merge",
  "create",
  "alter",
  "drop",
  "truncate",
  "grant",
  "revoke",
  "comment",
  "copy",
  "call",
  "do",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "lock",
  "listen",
  "notify",
  "prepare",
  "execute",
  "declare",
  "fetch",
  "move",
  "close",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "set",
  "reset",
  "refresh",
  "import",
  "security",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "lo_import",
  "lo_export",
  "dblink",
  "pg_sleep",
];

/** Guards against a pathological statement being handed to the parser. */
const MAX_SQL_LENGTH = 20_000;

/**
 * Removes comments and string literals.
 *
 * Both are places a forbidden word can legitimately live, and both are places
 * an attacker would try to hide one. Replacing rather than deleting keeps
 * token boundaries intact so words cannot be glued together into new ones.
 */
export function stripCommentsAndLiterals(sql: string): string {
  let out = "";
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    // Line comment.
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index);
      out += " ";
      index = end === -1 ? sql.length : end;
      continue;
    }

    // Block comment. Postgres nests them, so track the depth.
    if (rest.startsWith("/*")) {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < sql.length && depth > 0) {
        if (sql.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sql.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      out += " ";
      index = cursor;
      continue;
    }

    // Single-quoted literal, with '' as the escape.
    if (rest.startsWith("'")) {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === "'") {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      out += " '' ";
      index = cursor;
      continue;
    }

    // Double-quoted identifier: kept, because an identifier is not a keyword
    // and stripping it would let a table named "users" look like a bare word.
    if (rest.startsWith('"')) {
      const end = sql.indexOf('"', index + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += " ident ";
      index = stop;
      continue;
    }

    // Dollar-quoted string, the classic way to smuggle a payload.
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      out += " '' ";
      index = end === -1 ? sql.length : end + tag.length;
      continue;
    }

    out += sql[index];
    index += 1;
  }

  return out;
}

/** Splits on semicolons that are not inside a literal or comment. */
function statementCount(stripped: string): number {
  return stripped
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

/**
 * Decides whether a statement may run against a connected database.
 *
 * Returns the original SQL on success, never a rewritten version: silently
 * editing someone's query is how a guard becomes a source of bugs.
 */
export function assertReadOnly(sql: string): ReadOnlyCheck {
  const trimmed = (sql ?? "").trim();

  if (!trimmed) {
    return {
      ok: false,
      rejection: { code: "empty", message: "The query is empty." },
    };
  }
  if (trimmed.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      rejection: {
        code: "too_long",
        message: "The query is too long to check safely.",
      },
    };
  }

  const stripped = stripCommentsAndLiterals(trimmed);

  if (statementCount(stripped) > 1) {
    return {
      ok: false,
      rejection: {
        code: "multiple_statements",
        message: "Only one statement may run at a time; this contains several.",
      },
    };
  }

  const firstWord = /^\s*([a-z_]+)/i.exec(stripped)?.[1]?.toLowerCase() ?? "";
  if (!READ_PREFIXES.includes(firstWord)) {
    return {
      ok: false,
      rejection: {
        code: "not_a_read",
        message: `Connected data sources are read-only, and "${firstWord.toUpperCase() || "this"}" is not a read.`,
      },
    };
  }

  const words = new Set(
    stripped.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [],
  );
  for (const forbidden of FORBIDDEN) {
    if (words.has(forbidden)) {
      return {
        ok: false,
        rejection: {
          code: "forbidden_keyword",
          message: `Connected data sources are read-only, so "${forbidden.toUpperCase()}" is not permitted.`,
        },
      };
    }
  }

  return { ok: true, sql: trimmed };
}

/**
 * Strips secrets out of a driver error before it can reach a renderer or log.
 *
 * A libpq error can carry the whole connection string, and a connection string
 * carries the password. This is the last thing standing between that and an
 * error toast.
 */
export function sanitiseDatabaseError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown database error";

  return (
    raw
      // postgres://user:password@host -> postgres://user:***@host
      .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1***$2")
      // Any remaining URI with credentials.
      .replace(/([a-z]+:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1***$2")
      // password=... in a keyword connection string.
      .replace(/password\s*=\s*\S+/gi, "password=***")
      // Bearer tokens and long opaque keys.
      .replace(
        /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
        "***",
      )
      // Supabase's current keys are sb_secret_… and sb_publishable_…; the
      // older projects still carry sbp_. Match the family, not one spelling.
      .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{4,}/gi, "***")
      .replace(/\bsb[ps]_[A-Za-z0-9_-]{8,}/g, "***")
      .slice(0, 500)
  );
}
