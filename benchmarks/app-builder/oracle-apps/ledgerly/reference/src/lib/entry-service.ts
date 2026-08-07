import type { LedgerContext } from "@/lib/context";
import {
  assertBookAccounts,
  assertBalances,
  assertMutable,
  createEntry,
  deleteEntry,
  getEntry,
  parseEntryInput,
  parseLines,
  postEntry,
  requireEntry,
  reverseEntry,
  updateEntry,
  type EntryDetail,
  type LineInput,
} from "@/lib/entries";
import { assertPeriodOpen } from "@/lib/periods";
import {
  ConflictError,
  calendarDate,
  enumValue,
  optionalString,
} from "@/lib/validate";

/**
 * Every write that can touch the ledger goes through this module.
 *
 * The three invariants that outlive any one feature — a posted entry is
 * immutable, an entry balances, and a closed period is frozen — are conditions
 * that must hold at the top of EVERY write path: the form's, the API's, and
 * the ones a later milestone adds. Funnelling all of them through five
 * functions is what keeps that true, instead of an `if (status === 'posted')`
 * scattered through some handlers and forgotten in others.
 *
 * The period lock is always evaluated against the ENTRY'S date, never against
 * today's, and always before anything is written.
 */

/** `POST /api/entries` — creates a draft, or creates and posts in one go. */
export async function createEntryWrite(
  ctx: LedgerContext,
  body: Record<string, unknown>,
): Promise<EntryDetail> {
  const input = parseEntryInput(body);
  const status =
    body.status === undefined || body.status === null
      ? "draft"
      : enumValue(body.status, ["draft", "posted"] as const, "Status");

  await assertBookAccounts(ctx.bookId, input.lines);
  // Refused BEFORE the draft is written, so a locked period leaves no trace of
  // the attempt in the journal.
  if (status === "posted") await assertPeriodOpen(ctx.bookId, input.date);

  const id = await createEntry(ctx.bookId, ctx.user.id, input);
  if (status === "posted") {
    try {
      await postEntryWrite(ctx, id);
    } catch (error) {
      // Nothing half-written: the entry was asked for as posted, so if it
      // cannot be posted it must not survive as a draft either.
      await deleteEntry(ctx.bookId, id);
      throw error;
    }
  }
  return requireEntry(ctx.bookId, id);
}

/** `PATCH /api/entries/[id]` — a draft only; a posted entry is a 409. */
export async function patchEntryWrite(
  ctx: LedgerContext,
  entryId: string,
  body: Record<string, unknown>,
): Promise<EntryDetail> {
  const entry = await requireEntry(ctx.bookId, entryId);
  assertMutable(entry);
  await assertPeriodOpen(ctx.bookId, entry.date);

  // Whitelist. `id`, `status`, `entryNumber`, `bookId`, `postedAt` and the
  // reversal links are never settable by a client, in any milestone.
  const patch: { date?: string; memo?: string; lines?: LineInput[] } = {};
  if (body.date !== undefined) patch.date = calendarDate(body.date, "Entry date");
  if (body.memo !== undefined) patch.memo = optionalString(body.memo, "Memo");
  if (body.lines !== undefined) {
    patch.lines = parseLines(body.lines);
    await assertBookAccounts(ctx.bookId, patch.lines);
  }
  // Moving an entry INTO a closed period is as much a change to that period's
  // ledger as editing one already inside it.
  if (patch.date !== undefined) await assertPeriodOpen(ctx.bookId, patch.date);

  await updateEntry(ctx.bookId, entryId, patch);
  return requireEntry(ctx.bookId, entryId);
}

/** `DELETE /api/entries/[id]` — a draft only; a posted entry is a 409. */
export async function deleteEntryWrite(
  ctx: LedgerContext,
  entryId: string,
): Promise<void> {
  const entry = await requireEntry(ctx.bookId, entryId);
  assertMutable(entry);
  await assertPeriodOpen(ctx.bookId, entry.date);
  await deleteEntry(ctx.bookId, entryId);
}

/**
 * `POST /api/entries/[id]/post` — revalidates the balance rule, then flips the
 * entry to `posted`, allocates its number and appends its audit row in a
 * single statement. Nothing in the request body is read: the actor is always
 * the session user.
 */
export async function postEntryWrite(
  ctx: LedgerContext,
  entryId: string,
): Promise<EntryDetail> {
  const entry = await requireEntry(ctx.bookId, entryId);
  if (entry.status === "posted") {
    throw new ConflictError("That entry is already posted.");
  }
  assertBalances(entry.lines);
  await assertPeriodOpen(ctx.bookId, entry.date);

  const number = await postEntry(ctx.bookId, entryId, ctx.user);
  if (number === null) {
    throw new ConflictError("That entry could not be posted.");
  }
  return requireEntry(ctx.bookId, entryId);
}

/**
 * `POST /api/entries/[id]/reverse` — the only correction to a posted entry.
 * The mirror is derived entirely from the stored original, so any `lines`,
 * amount, `date`, `status`, `entryNumber`, `bookId`, `id` or actor field in
 * the request body is ignored.
 */
export async function reverseEntryWrite(
  ctx: LedgerContext,
  entryId: string,
): Promise<EntryDetail> {
  const entry = await requireEntry(ctx.bookId, entryId);
  if (entry.status !== "posted") {
    throw new ConflictError("Only a posted entry can be reversed.");
  }
  if (entry.reversesEntryId) {
    throw new ConflictError("A reversal cannot itself be reversed.");
  }
  if (entry.reversedByEntryId) {
    throw new ConflictError("That entry has already been reversed.");
  }
  // The reversal carries the original's date, so it lands in the same period.
  await assertPeriodOpen(ctx.bookId, entry.date);

  const reversalId = await reverseEntry(ctx.bookId, entryId, ctx.user);
  if (reversalId === null) {
    throw new ConflictError("That entry could not be reversed.");
  }
  return requireEntry(ctx.bookId, reversalId);
}

export { getEntry };
