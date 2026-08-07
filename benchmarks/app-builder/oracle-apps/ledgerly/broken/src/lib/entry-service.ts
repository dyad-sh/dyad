import type { LedgerContext } from "@/lib/context";
import {
  assertBookAccounts,
  assertBalances,
  createEntry,
  deleteEntry,
  markPostedWithoutNumber,
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

  const id = await createEntry(ctx.bookId, ctx.user.id, input);
  if (status === "posted") {
    // ORACLE-DEFECT L11 (trips led-m3-s01): this path no longer asks whether
    // the entry's date falls inside a CLOSED period. The pinned
    // `POST /api/entries/[id]/post` still does, which is why the UI CUJs that
    // exercise the lock keep passing and only the API notices.
    // ORACLE-DEFECT L12 (trips led-m3-s07): and it flips the status itself
    // instead of calling `postEntryWrite`, so no entry number is allocated
    // from the book's sequence and no audit row is appended.
    await markPostedWithoutNumber(ctx.bookId, id);
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
  // ORACLE-DEFECT L7 (trips led-m3-s04): `assertMutable(entry)` -- "a posted
  // entry is immutable" -- is gone from this path. The detail page still hides
  // the edit and delete controls once an entry is posted, so the browser flow
  // is unchanged; only the JSON API rewrites a posted entry.
  // ORACLE-DEFECT L11 (trips led-m3-s01): the period lock is gone from here
  // too, so a draft dated inside a closed period is editable.
  void entry;

  // Whitelist. `id`, `status`, `entryNumber`, `bookId`, `postedAt` and the
  // reversal links are never settable by a client, in any milestone.
  const patch: { date?: string; memo?: string; lines?: LineInput[] } = {};
  if (body.date !== undefined) patch.date = calendarDate(body.date, "Entry date");
  if (body.memo !== undefined) patch.memo = optionalString(body.memo, "Memo");
  if (body.lines !== undefined) {
    patch.lines = parseLines(body.lines);
    await assertBookAccounts(ctx.bookId, patch.lines);
  }
  await updateEntry(ctx.bookId, entryId, patch);
  return requireEntry(ctx.bookId, entryId);
}

/** `DELETE /api/entries/[id]` — a draft only; a posted entry is a 409. */
export async function deleteEntryWrite(
  ctx: LedgerContext,
  entryId: string,
): Promise<void> {
  const entry = await requireEntry(ctx.bookId, entryId);
  // ORACLE-DEFECTS L7 and L11 (trip led-m3-s04 and led-m3-s01): the same two
  // removals on the delete path.
  void entry;
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
  body: Record<string, unknown> = {},
): Promise<EntryDetail> {
  const entry = await requireEntry(ctx.bookId, entryId);
  if (entry.status === "posted") {
    throw new ConflictError("That entry is already posted.");
  }
  assertBalances(entry.lines);
  await assertPeriodOpen(ctx.bookId, entry.date);

  // ORACLE-DEFECT L16 (trips led-m3-s09): the acting user is taken from the
  // request body when it names one, instead of always being the session user,
  // so a caller can file their own posting under somebody else's name.
  const actor = {
    id: typeof body.actorUserId === "string" ? body.actorUserId : ctx.user.id,
    email:
      typeof body.actorEmail === "string" ? body.actorEmail : ctx.user.email,
  };
  const number = await postEntry(ctx.bookId, entryId, actor);
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
  body: Record<string, unknown> = {},
): Promise<EntryDetail> {
  const entry = await requireEntry(ctx.bookId, entryId);
  if (entry.status !== "posted") {
    throw new ConflictError("Only a posted entry can be reversed.");
  }
  // ORACLE-DEFECT L13 (trips led-m3-s05): "a reversal cannot itself be
  // reversed" and "an entry may be reversed once" are gone from here and from
  // the statement, so an entry can be reversed any number of times.
  // ORACLE-DEFECT L11 (trips led-m3-s01): so is the period lock, so a posted
  // entry inside a closed period can still be reversed.

  // ORACLE-DEFECT L14 (trips led-m3-s06): a reversal is no longer an exact
  // mirror of its original -- `lines` and `date` from the request body win
  // over the stored values when they are present.
  const override = {
    date:
      typeof body.date === "string"
        ? calendarDate(body.date, "Entry date")
        : undefined,
    lines: body.lines === undefined ? undefined : parseLinesLoosely(body.lines),
  };
  const reversalId = await reverseEntry(ctx.bookId, entryId, ctx.user, override);
  if (reversalId === null) {
    throw new ConflictError("That entry could not be reversed.");
  }
  return requireEntry(ctx.bookId, reversalId);
}

export { getEntry };


/**
 * ORACLE-DEFECT L14 (trips led-m3-s06): the lines a reverse request body
 * carries are taken at face value -- no balance rule, no line rule, no
 * book-scoping check, because "the caller is only correcting their own
 * entry".
 */
function parseLinesLoosely(raw: unknown): LineInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((value) => {
    const line = (value ?? {}) as Record<string, unknown>;
    return {
      accountId: String(line.accountId ?? ""),
      debitCents: Number(line.debitCents ?? 0),
      creditCents: Number(line.creditCents ?? 0),
    };
  });
}
