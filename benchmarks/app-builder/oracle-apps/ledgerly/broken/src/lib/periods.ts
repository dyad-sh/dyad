import { sql, toInt } from "@/db";
import type { LedgerContext } from "@/lib/context";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  calendarDate,
  requiredString,
} from "@/lib/validate";

export const PERIOD_STATUSES = ["open", "closed"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export type Period = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  totalDebitCents: number;
  totalCreditCents: number;
};

export type PeriodInput = { name: string; startDate: string; endDate: string };

export function parsePeriodInput(body: Record<string, unknown>): PeriodInput {
  const input = {
    name: requiredString(body.name, "Name"),
    startDate: calendarDate(body.startDate, "Start date"),
    endDate: calendarDate(body.endDate, "End date"),
  };
  if (input.endDate < input.startDate) {
    throw new ValidationError("A period's end date cannot precede its start.");
  }
  return input;
}

/**
 * A period's totals are the debits and the credits of the book's POSTED
 * entries dated inside it, BOTH boundary dates included.
 *
 * The predicate is on the entry's own calendar date — not on `posted_at`, and
 * not on a timestamp — so an entry belongs to the period its date falls in and
 * to no other, whatever time zone anything is running in. Aggregated in SQL
 * over integer columns, so a total is always an exact integer.
 */
const PERIOD_COLUMNS = sql.unsafe(`
  p.id,
  p.name,
  to_char(p.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(p.end_date, 'YYYY-MM-DD') AS "endDate",
  p.status,
  COALESCE(t.debits, 0)::bigint AS "totalDebitCents",
  COALESCE(t.credits, 0)::bigint AS "totalCreditCents"
`);

const PERIOD_TOTALS = sql.unsafe(`
  LEFT JOIN LATERAL (
    SELECT SUM(l.debit_cents) AS debits, SUM(l.credit_cents) AS credits
    FROM entries e
    JOIN entry_lines l ON l.entry_id = e.id
    WHERE e.book_id = p.book_id
      AND e.status = 'posted'
      AND e.entry_date >= p.start_date
      AND e.entry_date <= p.end_date
  ) t ON true
`);

function toPeriod(row: Record<string, unknown>): Period {
  return {
    id: String(row.id),
    name: String(row.name),
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    status: row.status as PeriodStatus,
    totalDebitCents: toInt(row.totalDebitCents),
    totalCreditCents: toInt(row.totalCreditCents),
  };
}

export async function listPeriods(bookId: string): Promise<Period[]> {
  const rows = (await sql`
    SELECT ${PERIOD_COLUMNS}
    FROM periods p
    ${PERIOD_TOTALS}
    WHERE p.book_id = ${bookId}
    ORDER BY p.start_date DESC, p.id DESC
  `) as Record<string, unknown>[];
  return rows.map(toPeriod);
}

export async function getPeriod(
  bookId: string,
  periodId: string,
): Promise<Period | null> {
  const rows = (await sql`
    SELECT ${PERIOD_COLUMNS}
    FROM periods p
    ${PERIOD_TOTALS}
    WHERE p.book_id = ${bookId} AND p.id = ${periodId}
  `) as Record<string, unknown>[];
  return rows.length === 0 ? null : toPeriod(rows[0]);
}

export async function requirePeriod(
  bookId: string,
  periodId: string,
): Promise<Period> {
  const period = await getPeriod(bookId, periodId);
  if (!period) throw new NotFoundError("Period not found.");
  return period;
}

/** Creates a period. Two periods in one book may not overlap. */
export async function createPeriod(
  bookId: string,
  input: PeriodInput,
): Promise<Period> {
  const rows = (await sql`
    INSERT INTO periods (book_id, name, start_date, end_date)
    SELECT ${bookId}, ${input.name}, ${input.startDate}::date, ${input.endDate}::date
    WHERE NOT EXISTS (
      SELECT 1 FROM periods p
      WHERE p.book_id = ${bookId}
        AND daterange(p.start_date, p.end_date, '[]')
            && daterange(${input.startDate}::date, ${input.endDate}::date, '[]')
    )
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) {
    throw new ValidationError(
      "That period overlaps one this book already has.",
    );
  }
  return requirePeriod(bookId, rows[0].id);
}

/**
 * Closes or reopens a period and appends its audit row in the SAME statement,
 * so the status change and the trail commit together or not at all. The actor
 * is the session user; nothing is read from a request body.
 */
export async function setPeriodStatus(
  ctx: LedgerContext,
  periodId: string,
  next: PeriodStatus,
): Promise<Period> {
  const from: PeriodStatus = next === "closed" ? "open" : "closed";
  const action = next === "closed" ? "period.closed" : "period.reopened";

  const rows = (await sql`
    WITH target AS (
      SELECT p.id
      FROM periods p
      WHERE p.id = ${periodId}
        AND p.book_id = ${ctx.bookId}
        AND p.status = ${from}
      FOR UPDATE
    ), changed AS (
      UPDATE periods
      SET status = ${next}
      WHERE id = (SELECT id FROM target)
      RETURNING id
    ), trail AS (
      INSERT INTO audit_log (book_id, action, actor_user_id, actor_email, target_id)
      SELECT ${ctx.bookId}, ${action}, ${ctx.user.id}, ${ctx.user.email}, changed.id
      FROM changed
      RETURNING id
    )
    SELECT id FROM changed
  `) as { id: string }[];

  if (rows.length === 0) {
    // The period exists (the caller was allowed to read it) but is not in the
    // state this transition starts from.
    await requirePeriod(ctx.bookId, periodId);
    throw new ConflictError(
      next === "closed"
        ? "That period is already closed."
        : "That period is already open.",
    );
  }
  return requirePeriod(ctx.bookId, periodId);
}

/**
 * The period lock, in one place.
 *
 * While a period is closed nothing may change the posted ledger inside it, so
 * every write that can touch a dated row asks this first — posting, creating
 * as posted, reversing, and editing or deleting a draft. It is evaluated
 * against the ENTRY'S date, never against today's.
 */
export async function assertPeriodOpen(
  bookId: string,
  date: string,
): Promise<void> {
  const rows = (await sql`
    SELECT name FROM periods
    WHERE book_id = ${bookId}
      AND status = 'closed'
      AND ${date}::date >= start_date
      AND ${date}::date <= end_date
    LIMIT 1
  `) as { name: string }[];
  if (rows.length > 0) {
    throw new ConflictError(
      `The period "${rows[0].name}" is closed; reopen it to change entries dated inside it.`,
    );
  }
}

/** True when this date falls inside a closed period of the book. */
export async function isDateLocked(
  bookId: string,
  date: string,
): Promise<boolean> {
  try {
    await assertPeriodOpen(bookId, date);
    return false;
  } catch {
    return true;
  }
}
