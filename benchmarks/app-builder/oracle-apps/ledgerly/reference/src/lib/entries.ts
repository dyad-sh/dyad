import { sql, toInt } from "@/db";
import { listAccountIds } from "@/lib/accounts";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  calendarDate,
  optionalString,
  referenceId,
  wholeCents,
} from "@/lib/validate";

export const ENTRY_STATUSES = ["draft", "posted"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export type EntryLine = {
  id: string;
  accountId: string;
  debitCents: number;
  creditCents: number;
};

export type Entry = {
  id: string;
  date: string;
  memo: string;
  totalDebitCents: number;
  totalCreditCents: number;
  status: EntryStatus;
  entryNumber: number | null;
  postedAt: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
};

export type EntryDetail = Entry & { lines: EntryLine[] };

export type LineInput = {
  accountId: string;
  debitCents: number;
  creditCents: number;
};

export type EntryInput = {
  date: string;
  memo: string;
  lines: LineInput[];
};

// ---------------------------------------------------------------- rules ----

/**
 * The balance rule and the line rules, in one place.
 *
 * Both the form path and the API path funnel through here, so a rule can never
 * be enforced in the browser only, and a handler added in a later milestone
 * cannot forget one. It is deliberately pure: it decides, it does not write.
 */
export function parseEntryInput(body: Record<string, unknown>): EntryInput {
  const date = calendarDate(body.date, "Entry date");
  const memo = optionalString(body.memo, "Memo");
  return { date, memo, lines: parseLines(body.lines) };
}

export function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("An entry needs a list of lines.");
  }

  const lines: LineInput[] = raw.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ValidationError(`Line ${index + 1} is not a line.`);
    }
    const line = value as Record<string, unknown>;
    const debitCents = wholeCents(line.debitCents, `Line ${index + 1} debit`);
    const creditCents = wholeCents(line.creditCents, `Line ${index + 1} credit`);
    if ((debitCents > 0) === (creditCents > 0)) {
      throw new ValidationError(
        `Line ${index + 1} must carry either a debit or a credit above zero, not both and not neither.`,
      );
    }
    return {
      accountId: referenceId(line.accountId, `Line ${index + 1} account`),
      debitCents,
      creditCents,
    };
  });

  assertBalances(lines);
  return lines;
}

/** Total debits equal total credits, and that total is above zero. */
export function assertBalances(lines: LineInput[]): void {
  if (lines.length < 2) {
    throw new ValidationError("An entry needs at least two lines.");
  }
  const debits = lines.reduce((sum, l) => sum + l.debitCents, 0);
  const credits = lines.reduce((sum, l) => sum + l.creditCents, 0);
  if (debits !== credits) {
    throw new ValidationError(
      `Debits and credits must be equal: debits are ${debits} cents and credits are ${credits} cents.`,
    );
  }
  if (debits <= 0) {
    throw new ValidationError("An entry's total must be above zero.");
  }
}

/**
 * Every account named by a line must belong to THIS book. Checked against the
 * book's own chart rather than trusted from the request, so an id belonging to
 * another book cannot pull a foreign account into a line.
 */
export async function assertBookAccounts(
  bookId: string,
  lines: LineInput[],
): Promise<void> {
  const owned = await listAccountIds(bookId);
  for (const [index, line] of lines.entries()) {
    if (!owned.has(line.accountId)) {
      throw new ValidationError(
        `Line ${index + 1} names an account that is not in this book's chart of accounts.`,
      );
    }
  }
}

// ---------------------------------------------------------------- reads ----

/** The pinned entry columns, shared by the list and the detail read. */
const ENTRY_COLUMNS = sql.unsafe(`
  e.id,
  to_char(e.entry_date, 'YYYY-MM-DD') AS date,
  e.memo,
  e.status,
  e.entry_number AS "entryNumber",
  e.posted_at AS "postedAt",
  e.reverses_entry_id AS "reversesEntryId",
  e.reversed_by_entry_id AS "reversedByEntryId",
  COALESCE(SUM(l.debit_cents), 0)::bigint AS "totalDebitCents",
  COALESCE(SUM(l.credit_cents), 0)::bigint AS "totalCreditCents"
`);

function toEntry(row: Record<string, unknown>): Entry {
  const postedAt = row.postedAt;
  return {
    id: String(row.id),
    date: String(row.date),
    memo: String(row.memo ?? ""),
    totalDebitCents: toInt(row.totalDebitCents),
    totalCreditCents: toInt(row.totalCreditCents),
    status: row.status as EntryStatus,
    entryNumber: row.entryNumber === null ? null : toInt(row.entryNumber),
    postedAt:
      postedAt === null || postedAt === undefined
        ? null
        : postedAt instanceof Date
          ? postedAt.toISOString()
          : String(postedAt),
    reversesEntryId: (row.reversesEntryId as string | null) ?? null,
    reversedByEntryId: (row.reversedByEntryId as string | null) ?? null,
  };
}

/** The book's journal, newest date first. */
export async function listEntries(bookId: string): Promise<Entry[]> {
  const rows = (await sql`
    SELECT ${ENTRY_COLUMNS}
    FROM entries e
    LEFT JOIN entry_lines l ON l.entry_id = e.id
    WHERE e.book_id = ${bookId}
    GROUP BY e.id
    ORDER BY e.entry_date DESC, e.created_at DESC
  `) as Record<string, unknown>[];
  return rows.map(toEntry);
}

/** One entry with its lines, or null when it is not in this book. */
export async function getEntry(
  bookId: string,
  entryId: string,
): Promise<EntryDetail | null> {
  const rows = (await sql`
    SELECT ${ENTRY_COLUMNS}
    FROM entries e
    LEFT JOIN entry_lines l ON l.entry_id = e.id
    WHERE e.book_id = ${bookId} AND e.id = ${entryId}
    GROUP BY e.id
  `) as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const lineRows = (await sql`
    SELECT id,
           account_id AS "accountId",
           debit_cents AS "debitCents",
           credit_cents AS "creditCents"
    FROM entry_lines
    WHERE entry_id = ${entryId}
    ORDER BY line_no ASC, id ASC
  `) as Record<string, unknown>[];

  return {
    ...toEntry(rows[0]),
    lines: lineRows.map((row) => ({
      id: String(row.id),
      accountId: String(row.accountId),
      debitCents: toInt(row.debitCents),
      creditCents: toInt(row.creditCents),
    })),
  };
}

/** The entry, or a 404 the caller cannot tell from "it belongs to a stranger". */
export async function requireEntry(
  bookId: string,
  entryId: string,
): Promise<EntryDetail> {
  const entry = await getEntry(bookId, entryId);
  if (!entry) throw new NotFoundError("Entry not found.");
  return entry;
}

// --------------------------------------------------------------- writes ----

/** A posted entry is immutable — every write path starts here. */
export function assertMutable(entry: Entry): void {
  if (entry.status === "posted") {
    throw new ConflictError(
      "A posted entry is immutable; correct it with a reversing entry.",
    );
  }
}

function linesPayload(lines: LineInput[]): string {
  return JSON.stringify(lines.map((line, i) => ({ ...line, lineNo: i })));
}

/**
 * Writes the entry and its lines in one statement, so an entry can never exist
 * without the lines that balance it.
 */
export async function createEntry(
  bookId: string,
  userId: string,
  input: EntryInput,
): Promise<string> {
  const rows = (await sql`
    WITH new_entry AS (
      INSERT INTO entries (book_id, created_by, entry_date, memo)
      VALUES (${bookId}, ${userId}, ${input.date}::date, ${input.memo})
      RETURNING id
    ), new_lines AS (
      INSERT INTO entry_lines (entry_id, account_id, line_no, debit_cents, credit_cents)
      SELECT new_entry.id,
             (line->>'accountId')::uuid,
             (line->>'lineNo')::int,
             (line->>'debitCents')::int,
             (line->>'creditCents')::int
      FROM new_entry, jsonb_array_elements(${linesPayload(input.lines)}::jsonb) AS line
      RETURNING entry_id
    )
    SELECT id FROM new_entry
  `) as { id: string }[];
  return rows[0].id;
}

/** Replaces a draft's date, memo and/or lines. Never touches a posted entry. */
export async function updateEntry(
  bookId: string,
  entryId: string,
  patch: { date?: string; memo?: string; lines?: LineInput[] },
): Promise<void> {
  if (patch.date !== undefined || patch.memo !== undefined) {
    await sql`
      UPDATE entries
      SET entry_date = COALESCE(${patch.date ?? null}::date, entry_date),
          memo = COALESCE(${patch.memo ?? null}::text, memo)
      WHERE id = ${entryId} AND book_id = ${bookId} AND status = 'draft'
    `;
  }
  if (patch.lines !== undefined) {
    await sql`
      WITH target AS (
        SELECT id FROM entries
        WHERE id = ${entryId} AND book_id = ${bookId} AND status = 'draft'
      ), cleared AS (
        DELETE FROM entry_lines
        WHERE entry_id = (SELECT id FROM target)
        RETURNING id
      )
      INSERT INTO entry_lines (entry_id, account_id, line_no, debit_cents, credit_cents)
      SELECT target.id,
             (line->>'accountId')::uuid,
             (line->>'lineNo')::int,
             (line->>'debitCents')::int,
             (line->>'creditCents')::int
      FROM target, jsonb_array_elements(${linesPayload(patch.lines)}::jsonb) AS line
    `;
  }
}

export async function deleteEntry(
  bookId: string,
  entryId: string,
): Promise<void> {
  await sql`
    DELETE FROM entries
    WHERE id = ${entryId} AND book_id = ${bookId} AND status = 'draft'
  `;
}

/**
 * Posts a draft: one statement, so the number allocation and the status change
 * commit together or not at all.
 *
 * The number comes from the book's own counter, bumped under that row's lock,
 * and the bump is conditional on the draft still being a draft (`target` takes
 * `FOR UPDATE` first). A refused post therefore burns no number and two
 * concurrent posts cannot be handed the same one.
 */
export async function postEntry(
  bookId: string,
  entryId: string,
  actor: { id: string; email: string },
): Promise<number | null> {
  const rows = (await sql`
    WITH target AS (
      SELECT e.id
      FROM entries e
      WHERE e.id = ${entryId} AND e.book_id = ${bookId} AND e.status = 'draft'
      FOR UPDATE
    ), bump AS (
      UPDATE books
      SET next_entry_number = next_entry_number + 1
      WHERE id = ${bookId} AND EXISTS (SELECT 1 FROM target)
      RETURNING next_entry_number - 1 AS n
    ), posted AS (
      UPDATE entries
      SET status = 'posted', posted_at = now(), entry_number = (SELECT n FROM bump)
      WHERE id = (SELECT id FROM target)
      RETURNING id, entry_number AS "entryNumber"
    ), trail AS (
      INSERT INTO audit_log (book_id, action, actor_user_id, actor_email, target_id)
      SELECT ${bookId}, 'entry.posted', ${actor.id}, ${actor.email}, posted.id
      FROM posted
      RETURNING id
    )
    SELECT "entryNumber" FROM posted
  `) as { entryNumber: number }[];
  return rows.length === 0 ? null : toInt(rows[0].entryNumber);
}

/**
 * Creates and posts the mirror of a posted entry, in one statement.
 *
 * Every value of the reversal is derived from the STORED original — the same
 * accounts, the same date, each line's debit and credit swapped — so nothing a
 * request body carries can influence what gets written. Both links are set in
 * the same statement, and the partial unique index on `reverses_entry_id` is
 * what makes "an entry may be reversed once" true even under a race.
 */
export async function reverseEntry(
  bookId: string,
  entryId: string,
  actor: { id: string; email: string },
): Promise<string | null> {
  const rows = (await sql`
    WITH target AS (
      SELECT e.id, e.book_id, e.entry_date, e.entry_number
      FROM entries e
      WHERE e.id = ${entryId}
        AND e.book_id = ${bookId}
        AND e.status = 'posted'
        AND e.reverses_entry_id IS NULL
        AND e.reversed_by_entry_id IS NULL
      FOR UPDATE
    ), bump AS (
      UPDATE books
      SET next_entry_number = next_entry_number + 1
      WHERE id = ${bookId} AND EXISTS (SELECT 1 FROM target)
      RETURNING next_entry_number - 1 AS n
    ), reversal AS (
      INSERT INTO entries (
        book_id, created_by, entry_date, memo,
        status, entry_number, posted_at, reverses_entry_id
      )
      SELECT t.book_id, ${actor.id}, t.entry_date,
             'Reversal of entry #' || t.entry_number,
             'posted', b.n, now(), t.id
      FROM target t, bump b
      RETURNING id, reverses_entry_id
    ), mirrored AS (
      INSERT INTO entry_lines (entry_id, account_id, line_no, debit_cents, credit_cents)
      SELECT r.id, l.account_id, l.line_no, l.credit_cents, l.debit_cents
      FROM reversal r
      JOIN entry_lines l ON l.entry_id = r.reverses_entry_id
      RETURNING entry_id
    ), linked AS (
      UPDATE entries
      SET reversed_by_entry_id = (SELECT id FROM reversal)
      WHERE id = (SELECT reverses_entry_id FROM reversal)
      RETURNING id
    ), trail AS (
      INSERT INTO audit_log (book_id, action, actor_user_id, actor_email, target_id)
      SELECT ${bookId}, 'entry.reversed', ${actor.id}, ${actor.email},
             reversal.reverses_entry_id
      FROM reversal
      RETURNING id
    )
    SELECT id FROM reversal
  `) as { id: string }[];
  return rows.length === 0 ? null : rows[0].id;
}
