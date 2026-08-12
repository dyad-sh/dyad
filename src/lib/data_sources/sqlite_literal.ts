/**
 * Encoding values as SQLite literals.
 *
 * This exists only because `wrangler d1 execute` takes a SQL string and no
 * bind parameters. Everywhere a parameterised transport is available, values
 * are bound and this file is not involved — binding is safer, and losing that
 * is the cost of browser sign-in rather than a choice.
 *
 * Given that, the encoder is deliberately narrow: it accepts a few types,
 * refuses everything else, and never tries to be clever about a value it does
 * not recognise. A rejected query is a bad afternoon; an escaped-wrong one is
 * a lost database.
 */

export class UnsupportedLiteralError extends Error {}

/**
 * One value as a SQLite literal.
 *
 * Strings are single-quoted with embedded quotes doubled, which is SQLite's
 * only string escape: there are no backslash escapes, so a doubled quote
 * cannot be undone by one. Anything containing a null byte is refused, since
 * SQLite truncates at it and the stored value would not be the one checked.
 */
export function toSqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";

  if (typeof value === "boolean") return value ? "1" : "0";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UnsupportedLiteralError(
        "Only finite numbers can be used in a query.",
      );
    }
    return String(value);
  }

  if (typeof value === "string") {
    if (value.includes("\0")) {
      throw new UnsupportedLiteralError(
        "A value containing a null byte cannot be used in a query.",
      );
    }
    return `'${value.replace(/'/g, "''")}'`;
  }

  throw new UnsupportedLiteralError(
    `Values of type ${typeof value} cannot be used in a query.`,
  );
}

/**
 * Substitutes each `?` in a statement with the next encoded value.
 *
 * Placeholders inside string literals are left alone: the statement is scanned
 * character by character rather than split on `?`, because a `?` inside a
 * quoted value is data, not a placeholder, and treating it as one would shift
 * every value after it by a position.
 */
export function inlineParameters(sql: string, params: unknown[]): string {
  let out = "";
  let index = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (inString) {
      out += char;
      if (char === "'") {
        // A doubled quote is an escaped quote, not the end of the string.
        if (sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      out += char;
      continue;
    }

    if (char === "?") {
      if (index >= params.length) {
        throw new UnsupportedLiteralError(
          "This query has more placeholders than values.",
        );
      }
      out += toSqliteLiteral(params[index]);
      index += 1;
      continue;
    }

    out += char;
  }

  if (index !== params.length) {
    throw new UnsupportedLiteralError(
      "This query has more values than placeholders.",
    );
  }

  return out;
}
