import { sql, toInt } from "@/db";
import { ConflictError, enumValue, requiredString } from "@/lib/validate";

export const ACCOUNT_TYPES = ["debit", "credit"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** Integer cents, positive in this account's own normal direction. */
  balanceCents: number;
};

/**
 * The chart of accounts with each account's balance, sorted by code.
 *
 * The balance is an aggregate over the book's POSTED lines — drafts move
 * nothing — computed in SQL over integer columns, in the account's normal
 * direction: debits minus credits for a `debit` account, credits minus debits
 * for a `credit` one. One query for the whole chart, not one per account.
 */
export async function listAccounts(bookId: string): Promise<Account[]> {
  const rows = (await sql`
    SELECT a.id,
           a.code,
           a.name,
           a.type,
           CASE a.type
             WHEN 'debit'  THEN COALESCE(t.debits, 0) - COALESCE(t.credits, 0)
             ELSE               COALESCE(t.credits, 0) - COALESCE(t.debits, 0)
           END::bigint AS "balanceCents"
    FROM accounts a
    LEFT JOIN (
      SELECT l.account_id,
             SUM(l.debit_cents)  AS debits,
             SUM(l.credit_cents) AS credits
      FROM entry_lines l
      JOIN entries e ON e.id = l.entry_id
      WHERE e.book_id = ${bookId} AND e.status = 'posted'
      GROUP BY l.account_id
    ) t ON t.account_id = a.id
    WHERE a.book_id = ${bookId}
    ORDER BY a.code ASC
  `) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    type: row.type as AccountType,
    balanceCents: toInt(row.balanceCents),
  }));
}

/** Just the ids, for the "does this line name one of this book's accounts?" check. */
export async function listAccountIds(bookId: string): Promise<Set<string>> {
  const rows = (await sql`
    SELECT id FROM accounts WHERE book_id = ${bookId}
  `) as { id: string }[];
  return new Set(rows.map((row) => String(row.id)));
}

export type AccountInput = { code: string; name: string; type: AccountType };

/** Validates the shape of an account payload. */
export function parseAccountInput(body: Record<string, unknown>): AccountInput {
  return {
    code: requiredString(body.code, "Code", 64),
    name: requiredString(body.name, "Name"),
    type: enumValue(body.type, ACCOUNT_TYPES, "Type"),
  };
}

/**
 * Creates an account in a book. The per-book uniqueness of a code is enforced
 * by the unique index, not by a read-then-insert two concurrent requests could
 * both pass, so a duplicate writes nothing at all.
 */
export async function createAccount(
  bookId: string,
  input: AccountInput,
): Promise<Account> {
  const rows = (await sql`
    INSERT INTO accounts (book_id, code, name, type)
    VALUES (${bookId}, ${input.code}, ${input.name}, ${input.type})
    ON CONFLICT (book_id, code) DO NOTHING
    RETURNING id, code, name, type
  `) as Omit<Account, "balanceCents">[];
  if (rows.length === 0) {
    throw new ConflictError(
      `Account code ${input.code} is already in use in this book.`,
    );
  }
  return { ...rows[0], balanceCents: 0 };
}
