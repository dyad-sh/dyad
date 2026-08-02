// Ledgerly — checkpoint 2 CUJ suite (design/app-4-ledgerly.md, M2 CUJ table +
// M2 security probes). 12 CUJs (4 regression + 8 new) + 9 probes.
//
// Conventions (design "Test fixtures & conventions"): the suite is NOT serial.
// Every test provisions its own personas, books, chart and entries through the
// `ledger` fixture — nothing is inherited from a sibling test, so a failure can
// never skip (and thereby silently void) another scenario. The four regression
// rows replay their checkpoint-1 steps unchanged: M1 has no balance surface, so
// none of them needs a "post it first" adaptation.
//
// Raw-HTTP probes go through `context.request` (real persona cookies) or a
// cookie-less `anonRequest()`; every id comes from a pinned surface
// (GET /api/me, GET /api/accounts, GET /api/entries, GET /api/books,
// GET /api/books/[id]/members), and an id handed across personas is always
// captured from the VICTIM's own pinned surface. Money is asserted as integer
// cents against the pinned `…Cents` fields and read from the DOM only through
// `numericText`; entry dates are compared byte for byte against the pinned
// `data-entry-date` attribute and the pinned JSON `date`.
//
// Every probe asserts the invariant, not the status code: each one re-reads a
// pinned surface and requires the entry count, the entry's stored fields, the
// account balances or the membership set to be unchanged, and each implements
// the design row's positive control in the same test.
import {
  test,
  expect,
  accountsByCode,
  activateBook,
  addMember,
  anonRequest,
  balanceMap,
  createAccountFor,
  createAccountViaApi,
  createEntryFor,
  createEntryViaApi,
  createPostedEntry,
  entryFingerprint,
  getEntry,
  getMe,
  hrefPath,
  listAccounts,
  listBooks,
  listEntries,
  listMembers,
  memberRow,
  numericText,
  personalBookName,
  postEntry,
  postEntryViaApi,
  reverseEntry,
  reverseEntryViaApi,
  signIn,
  signOut,
  sumBalances,
  switchBook,
  waitForSession,
  ENTRY_A_CENTS,
  ENTRY_A_DATE,
  ENTRY_B_CENTS,
  ENTRY_B_DATE,
  REFERENCE_BALANCES,
  REFERENCE_CHART,
  RENT_CENTS,
  SUPPLIES_CENTS,
  UUID_RE,
  type AccountJson,
  type BookJson,
  type Chart,
  type EntryJson,
  type MeJson,
  type Persona,
} from "./fixtures";

// An unauthenticated GET of a JSON endpoint must deny; a redirect to the
// sign-in page carrying no data is equally acceptable (design S1).
const DENIED_OR_REDIRECT = [401, 403, 301, 302, 303, 307, 308];

/**
 * The five reference accounts created through the pinned `POST /api/accounts`
 * rather than the form. Probe setup only — the CUJs that own the account form
 * drive it themselves through `ledger.referenceChart()`.
 */
async function apiChart(actor: Persona, token: string): Promise<Chart> {
  const chart = {} as Chart;
  for (const spec of REFERENCE_CHART) {
    const name = `${spec.label} ${token}`;
    const id = await createAccountViaApi(actor, {
      code: spec.code,
      name,
      type: spec.type,
    });
    chart[spec.key] = { id, code: spec.code, name, type: spec.type };
  }
  return chart;
}

/** The book's highest allocated `entryNumber` (0 when nothing is posted). */
function maxEntryNumber(entries: EntryJson[]): number {
  return entries.reduce(
    (max, e) => Math.max(max, Number(e.entryNumber ?? 0) || 0),
    0,
  );
}

/** `<userId>:<role>` for every member of a book — a set comparable before/after. */
function memberSet(members: Array<{ userId: string; role: string }>): string[] {
  return members.map((m) => `${m.userId}:${m.role}`).sort();
}

/**
 * No entry in the actor's active book may reference an account of another
 * book: read every entry's detail and require each line's `accountId` to be
 * one of the book's own accounts.
 */
async function expectNoEntrySpansBooks(actor: Persona, label: string) {
  const own = new Set((await listAccounts(actor.ctx)).map((a) => String(a.id)));
  for (const entry of await listEntries(actor.ctx)) {
    const detail = await getEntry(actor.ctx, String(entry.id));
    for (const line of detail.lines ?? []) {
      expect(
        own.has(String(line.accountId)),
        `${label}: entry ${entry.id} has a line in another book's account`,
      ).toBe(true);
    }
  }
}

/** M2 pins exactly one personal book per user, named `<user name>'s Books`. */
function expectOnePersonalBook(
  books: BookJson[],
  bookName: string,
  when: string,
) {
  expect(
    books.filter((b) => b.name === bookName),
    `exactly one book named "${bookName}" ${when}`,
  ).toHaveLength(1);
  expect(books, `exactly one book in total ${when}`).toHaveLength(1);
}

/**
 * The texts of the pinned `book-switcher-option`s. The prompt pins the test
 * ids without pinning the element kind, so handle both a `<select>` (options
 * are in the DOM already) and a menu that renders them on click — exactly as
 * the fixture's `switchBook` does.
 */
async function bookSwitcherOptions(actor: Persona): Promise<string[]> {
  const switcher = actor.page.getByTestId("book-switcher").first();
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== "select") await switcher.click();
  const options = actor.page.getByTestId("book-switcher-option");
  await expect
    .poll(() => options.count(), {
      timeout: 15_000,
      message: "the pinned book-switcher-option list",
    })
    .toBeGreaterThan(0);
  return (await options.allTextContents()).map((t) => t.trim());
}

test.describe("ledgerly checkpoint 2", () => {
  // ---- regression (checkpoint-1 rows, replayed unchanged) ----

  test("led-m1-01 sign-up and sign-in both land in a book", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    await expect(owner.page).toHaveURL(/\/accounts\/?$/, { timeout: 15_000 });
    const afterSignUp = await getMe(owner.ctx);
    expect(afterSignUp.email).toBe(owner.who.email);
    expect(typeof afterSignUp.id, "GET /api/me id is a string").toBe("string");
    expect(String(afterSignUp.id).length).toBeGreaterThan(0);
    // M2 pins the personal book to sign-up as well as sign-in, so a signed-up
    // user is never left bookless — that is what makes this row satisfiable.
    expect(
      afterSignUp.activeBookId,
      "activeBookId from the first authenticated read onward",
    ).toBeTruthy();

    await signOut(owner.page);
    await owner.page.goto("/");
    await owner.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });

    await signIn(owner.page, owner.who);
    await waitForSession(owner.page, owner.ctx);
    // M1 pins `/` → /accounts while signed in: the authenticated landing.
    await owner.page.goto("/");
    await owner.page.waitForURL("**/accounts", { timeout: 15_000 });
    const afterSignIn = await getMe(owner.ctx);
    expect(afterSignIn.email).toBe(owner.who.email);
    expect(String(afterSignIn.id)).toBe(String(afterSignUp.id));
    expect(
      afterSignIn.activeBookId,
      "activeBookId after signing in again",
    ).toBeTruthy();
  });

  test("led-m1-04 the chart of accounts sorts by code", async ({ ledger }) => {
    const owner = await ledger.owner();
    await ledger.referenceChart(owner);

    await owner.page.goto("/accounts");
    const rows = owner.page
      .getByTestId("account-row")
      .filter({ hasText: ledger.token });
    await expect(rows).toHaveCount(REFERENCE_CHART.length);
    const codes = (
      await rows.getByTestId("account-row-code").allTextContents()
    ).map((t) => t.trim());
    expect(codes, "account-row-code ascending").toEqual(
      REFERENCE_CHART.map((s) => s.code),
    );
    for (let i = 0; i < REFERENCE_CHART.length; i++) {
      const spec = REFERENCE_CHART[i];
      await expect(rows.nth(i).getByTestId("account-row-name")).toContainText(
        `${spec.label} ${ledger.token}`,
      );
      await expect(rows.nth(i).getByTestId("account-row-type")).toHaveText(
        new RegExp(`^\\s*${spec.type}\\s*$`, "i"),
      );
    }

    // A new user's personal book starts empty, so the count is exact.
    const accounts = await listAccounts(owner.ctx);
    expect(accounts).toHaveLength(REFERENCE_CHART.length);
    const byCode = accountsByCode(accounts);
    for (const spec of REFERENCE_CHART) {
      const row = byCode.get(spec.code);
      expect(row, `GET /api/accounts carries code ${spec.code}`).toBeTruthy();
      expect(row!.type).toBe(spec.type);
      expect(row!.name).toContain(ledger.token);
      expect(
        String(row!.id),
        `account ${spec.code} id is a UUID, not a sequential integer`,
      ).toMatch(UUID_RE);
    }
  });

  test("led-m1-06 a balanced two-line entry converts dollars exactly", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryA(chart);
    const entryId = await createEntryFor(owner, entry);

    await owner.page.goto("/journal");
    const row = owner.page
      .getByTestId("entry-row")
      .filter({ hasText: entry.memo })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-entry-date", ENTRY_A_DATE);
    expect(await numericText(row.getByTestId("entry-row-total"))).toBeCloseTo(
      1250.1,
      2,
    );

    const json = (await listEntries(owner.ctx)).find(
      (e) => String(e.id) === entryId,
    );
    expect(
      json,
      "the created entry in the pinned GET /api/entries",
    ).toBeTruthy();
    expect(json!.date, "date is returned as the typed YYYY-MM-DD string").toBe(
      ENTRY_A_DATE,
    );
    // 125009 fails here — this is the truncation check.
    expect(json!.totalDebitCents).toBe(ENTRY_A_CENTS);
    expect(json!.totalCreditCents).toBe(ENTRY_A_CENTS);
    expect(Number.isInteger(json!.totalDebitCents)).toBe(true);
    expect(Number.isInteger(json!.totalCreditCents)).toBe(true);
  });

  test("led-m1-08 a three-line entry keeps every line exact", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryB(chart);
    // Needs no adaptation: M2 leaves a new entry a draft and nothing this row
    // reads depends on posting.
    const entryId = await createEntryFor(owner, entry);

    await owner.page.goto(`/journal/${entryId}`);
    await expect(owner.page.getByTestId("entry-line")).toHaveCount(3);
    expect(
      await numericText(owner.page.getByTestId("entry-detail-total-debit")),
    ).toBeCloseTo(500.1, 2);
    expect(
      await numericText(owner.page.getByTestId("entry-detail-total-credit")),
    ).toBeCloseTo(500.1, 2);

    const detail = await getEntry(owner.ctx, entryId);
    expect(detail.date).toBe(ENTRY_B_DATE);
    expect(detail.lines, "three lines on the detail endpoint").toHaveLength(3);
    expect(detail.totalDebitCents).toBe(ENTRY_B_CENTS);
    expect(detail.totalCreditCents).toBe(ENTRY_B_CENTS);
    const byAccount = new Map(
      (detail.lines ?? []).map((l) => [String(l.accountId), l]),
    );
    // A truncating conversion reaches 42000 + 8009 ≠ 50010 and cannot create
    // this entry at all.
    expect(byAccount.get(chart.rent.id)?.debitCents).toBe(RENT_CENTS);
    expect(byAccount.get(chart.supplies.id)?.debitCents).toBe(SUPPLIES_CENTS);
    expect(byAccount.get(chart.cash.id)?.creditCents).toBe(ENTRY_B_CENTS);
    for (const line of detail.lines ?? []) {
      expect(Number.isInteger(line.debitCents)).toBe(true);
      expect(Number.isInteger(line.creditCents)).toBe(true);
    }
  });

  // ---- new checkpoint-2 scenarios ----

  test("led-m2-02 one user creates the same code in two books", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const b1Name = personalBookName(owner.who);
    const clerk = await ledger.clerk();
    const b3 = await clerk.bookId();
    const b3Name = personalBookName(clerk.who);
    expect(String(b3), "the clerk's personal book is not the owner's").not.toBe(
      String(b1),
    );
    await addMember(owner, b1, clerk.who.email, "bookkeeper");

    // THE CLERK, not the owner, creates code 1000 in both books: the same user
    // creating the same code twice is what M1's per-user unique index refuses,
    // so both creates succeeding is the evidence that it was dropped for a
    // book-scoped constraint.
    const cashName = `Cash ${ledger.token}`;
    const tillName = `Till ${ledger.token}`;
    await switchBook(clerk, b1Name);
    const cashId = await createAccountFor(clerk, {
      code: "1000",
      name: cashName,
      type: "debit",
    });
    await switchBook(clerk, b3Name);
    const tillId = await createAccountFor(clerk, {
      code: "1000",
      name: tillName,
      type: "debit",
    });
    expect(String(tillId)).not.toBe(String(cashId));

    // B3 (active): exactly its own row with code 1000, and none of B1's.
    await clerk.page.goto("/accounts");
    await expect(
      clerk.page.getByTestId("account-row").filter({ hasText: tillName }),
    ).toHaveCount(1);
    await expect(
      clerk.page.getByTestId("account-row").filter({ hasText: cashName }),
    ).toHaveCount(0);
    const b3Accounts = await listAccounts(clerk.ctx);
    expect(
      b3Accounts.filter((a) => String(a.code) === "1000"),
      "B3 holds exactly one account with code 1000",
    ).toHaveLength(1);
    expect(b3Accounts.map((a) => a.name)).not.toContain(cashName);

    // B1: the mirror image.
    await switchBook(clerk, b1Name);
    await clerk.page.goto("/accounts");
    await expect(
      clerk.page.getByTestId("account-row").filter({ hasText: cashName }),
    ).toHaveCount(1);
    await expect(
      clerk.page.getByTestId("account-row").filter({ hasText: tillName }),
    ).toHaveCount(0);
    const b1Accounts = await listAccounts(clerk.ctx);
    expect(
      b1Accounts.filter((a) => String(a.code) === "1000"),
      "B1 holds exactly one account with code 1000",
    ).toHaveLength(1);
    expect(b1Accounts.map((a) => a.name)).not.toContain(tillName);
    // The owner sees B1's account too, and never B3's.
    const ownerAccounts = await listAccounts(owner.ctx);
    expect(ownerAccounts.map((a) => a.name)).toContain(cashName);
    expect(ownerAccounts.map((a) => a.name)).not.toContain(tillName);
  });

  test("led-m2-03 an owner adds a bookkeeper who switches into the book", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const b1Name = personalBookName(owner.who);
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryA(chart);
    const entryId = await createEntryFor(owner, entry);
    await postEntryViaApi(owner, entryId);

    const clerk = await ledger.clerk();
    const clerkId = await clerk.userId();
    await addMember(owner, b1, clerk.who.email, "bookkeeper");

    await owner.page.goto(`/books/${b1}/members`);
    await expect(owner.page.getByTestId("members-list")).toBeVisible();
    await expect(owner.page.getByTestId("member-row")).toHaveCount(2);
    const row = memberRow(owner.page, clerkId);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("member-row-email")).toContainText(
      clerk.who.email,
    );
    // Located by data-user-id and matched with exact equality: never a
    // page-wide text search for a role word.
    await expect(row.getByTestId("member-row-role")).toHaveText(
      /^\s*bookkeeper\s*$/i,
    );

    await clerk.page.reload();
    const me = await getMe(clerk.ctx);
    const membership = (me.memberships ?? []).find(
      (m) => String(m.bookId) === String(b1),
    );
    expect(
      membership,
      "the clerk's own /api/me memberships list the owner's book",
    ).toBeTruthy();
    expect(membership!.role).toBe("bookkeeper");
    expect(membership!.bookName).toBe(b1Name);
    const options = await bookSwitcherOptions(clerk);
    expect(
      options.some((t) => t.includes(b1Name)),
      `book-switcher-option for "${b1Name}" (got ${JSON.stringify(options)})`,
    ).toBe(true);

    await clerk.page.reload();
    await switchBook(clerk, b1Name);
    await clerk.page.goto("/journal");
    await expect(
      clerk.page.getByTestId("entry-row").filter({ hasText: entry.memo }),
    ).toHaveCount(1);
    expect((await listEntries(clerk.ctx)).map((e) => e.memo)).toContain(
      entry.memo,
    );
  });

  test("led-m2-04 posting a draft stamps a number and a time", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entryId = await createEntryFor(owner, ledger.entryA(chart));

    await owner.page.goto(`/journal/${entryId}`);
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*draft\s*$/i,
    );
    const numberCell = owner.page.getByTestId("entry-detail-number");
    if (await numberCell.count()) {
      const shown = ((await numberCell.first().textContent()) ?? "").trim();
      expect(
        shown,
        "entry-detail-number carries no number while the entry is a draft",
      ).not.toMatch(/\d/);
    }
    const before = await getEntry(owner.ctx, entryId);
    expect(before.status).toBe("draft");
    expect(before.entryNumber ?? null, "entryNumber is null while draft").toBe(
      null,
    );
    expect(before.postedAt ?? null, "postedAt is null while draft").toBe(null);

    await owner.page.getByTestId("entry-post-button").click();
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /posted/i,
      { timeout: 15_000 },
    );
    await owner.page.reload();
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*posted\s*$/i,
    );
    const shownNumber = await numericText(
      owner.page.getByTestId("entry-detail-number").first(),
    );
    expect(
      Number.isInteger(shownNumber),
      `entry-detail-number shows an integer (got ${shownNumber})`,
    ).toBe(true);
    expect(shownNumber).toBeGreaterThan(0);

    const after = await getEntry(owner.ctx, entryId);
    expect(after.status).toBe("posted");
    expect(after.postedAt, "postedAt is stamped by posting").toBeTruthy();
    expect(
      Number.isInteger(after.entryNumber as number),
      "entryNumber is an integer",
    ).toBe(true);
    expect(after.entryNumber as number).toBeGreaterThan(0);
  });

  test("led-m2-05 a draft offers edit and delete, a posted entry only reversal", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const draftId = await createEntryViaApi(owner, ledger.entryA(chart));
    const postedId = await createPostedEntry(owner, ledger.entryB(chart));

    await owner.page.goto(`/journal/${draftId}`);
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*draft\s*$/i,
    );
    await expect(owner.page.getByTestId("entry-edit-button")).toBeVisible();
    await expect(owner.page.getByTestId("entry-delete-button")).toBeVisible();
    await expect(owner.page.getByTestId("entry-reverse-button")).toHaveCount(0);

    const before = entryFingerprint(await getEntry(owner.ctx, postedId));
    await owner.page.goto(`/journal/${postedId}`);
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*posted\s*$/i,
    );
    await expect(owner.page.getByTestId("entry-reverse-button")).toBeVisible();

    // Absent, or present-and-inert: clicking must leave the entry unchanged.
    const edit = owner.page.getByTestId("entry-edit-button");
    if (await edit.count()) {
      await edit
        .first()
        .click()
        .catch(() => {});
      await owner.page.waitForLoadState("networkidle").catch(() => {});
    }
    await owner.page.goto(`/journal/${postedId}`);
    const remove = owner.page.getByTestId("entry-delete-button");
    if (await remove.count()) {
      await remove
        .first()
        .click()
        .catch(() => {});
      const confirm = owner.page.getByTestId("entry-delete-confirm");
      if (await confirm.count()) {
        await confirm
          .first()
          .click()
          .catch(() => {});
      }
      await owner.page.waitForLoadState("networkidle").catch(() => {});
    }
    const resp = await owner.ctx.request.get(`/api/entries/${postedId}`);
    expect(
      resp.status(),
      "a posted entry survives its edit/delete controls",
    ).toBe(200);
    expect(entryFingerprint(await resp.json())).toEqual(before);
  });

  test("led-m2-06 reversing a posted entry mirrors it and restores balances", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entryId = await createEntryFor(owner, ledger.entryA(chart));

    // Captured BEFORE posting: only posted entries count, so this is 0.
    const beforePost = balanceMap(await listAccounts(owner.ctx));
    expect(beforePost[chart.cash.id], "a draft moves nothing").toBe(0);
    expect(beforePost[chart.revenue.id]).toBe(0);

    await postEntry(owner, entryId);
    await reverseEntry(owner, entryId);

    const original = await getEntry(owner.ctx, entryId);
    const reversalId = String(original.reversedByEntryId ?? "");
    expect(reversalId, "reversedByEntryId is set on the original").toBeTruthy();
    const reversal = await getEntry(owner.ctx, reversalId);
    expect(String(reversal.reversesEntryId)).toBe(String(entryId));
    expect(reversal.status).toBe("posted");
    expect(
      Number.isInteger(reversal.entryNumber as number),
      "the reversal carries its own entryNumber",
    ).toBe(true);
    expect(reversal.entryNumber).not.toBe(original.entryNumber);
    expect(reversal.date, "the reversal keeps the original's date").toBe(
      ENTRY_A_DATE,
    );
    const revLines = new Map(
      (reversal.lines ?? []).map((l) => [String(l.accountId), l]),
    );
    expect(revLines.get(chart.cash.id)?.creditCents).toBe(ENTRY_A_CENTS);
    expect(revLines.get(chart.cash.id)?.debitCents).toBe(0);
    expect(revLines.get(chart.revenue.id)?.debitCents).toBe(ENTRY_A_CENTS);
    expect(revLines.get(chart.revenue.id)?.creditCents).toBe(0);

    // Both pinned links, in both directions. The href is compared as a WHOLE
    // path, never `toContain(id)`: "/journal/123" contains "12", so a link to
    // the wrong entry would satisfy a substring check.
    await owner.page.goto(`/journal/${entryId}`);
    const reversedBy = owner.page.getByTestId("entry-reversed-by-link").first();
    await expect(reversedBy).toBeVisible();
    const forwardHref = await reversedBy.getAttribute("href");
    if (forwardHref) {
      expect(
        hrefPath(forwardHref, owner.page.url()),
        "entry-reversed-by-link points at the reversal",
      ).toBe(`/journal/${reversalId}`);
    }
    await owner.page.goto(`/journal/${reversalId}`);
    const reverses = owner.page.getByTestId("entry-reverses-link").first();
    await expect(reverses).toBeVisible();
    const backHref = await reverses.getAttribute("href");
    if (backHref) {
      expect(
        hrefPath(backHref, owner.page.url()),
        "entry-reverses-link points at the original",
      ).toBe(`/journal/${entryId}`);
    }

    const after = await listAccounts(owner.ctx);
    const afterMap = balanceMap(after);
    expect(
      afterMap[chart.cash.id],
      "Cash is back to its pre-post balance",
    ).toBe(beforePost[chart.cash.id]);
    expect(
      afterMap[chart.revenue.id],
      "Revenue is back to its pre-post balance",
    ).toBe(beforePost[chart.revenue.id]);
    expect(sumBalances(after, "debit")).toBe(sumBalances(after, "credit"));
  });

  test("led-m2-07 a draft moves nothing and posting moves exactly two accounts", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);

    const first = await listAccounts(owner.ctx);
    const beforeMap = balanceMap(first);
    expect(sumBalances(first, "debit")).toBe(sumBalances(first, "credit"));

    const entryId = await createEntryFor(owner, ledger.entryA(chart));
    const second = await listAccounts(owner.ctx);
    expect(balanceMap(second), "a draft moves no balance").toEqual(beforeMap);
    expect(sumBalances(second, "debit")).toBe(sumBalances(second, "credit"));

    await postEntryViaApi(owner, entryId);
    const third = await listAccounts(owner.ctx);
    const afterMap = balanceMap(third);
    expect(sumBalances(third, "debit")).toBe(sumBalances(third, "credit"));
    for (const a of third) {
      expect(
        Number.isInteger(Number(a.balanceCents)),
        `balanceCents of account ${a.code} is an integer`,
      ).toBe(true);
    }
    const moved = Object.keys(afterMap)
      .filter((id) => afterMap[id] !== (beforeMap[id] ?? 0))
      .sort();
    expect(moved, "exactly the two accounts the entry touches move").toEqual(
      [chart.cash.id, chart.revenue.id].sort(),
    );
    expect(afterMap[chart.cash.id] - (beforeMap[chart.cash.id] ?? 0)).toBe(
      ENTRY_A_CENTS,
    );
    expect(
      afterMap[chart.revenue.id] - (beforeMap[chart.revenue.id] ?? 0),
    ).toBe(ENTRY_A_CENTS);
  });

  test("led-m2-08 every balance is positive in its own normal direction", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    await createPostedEntry(owner, ledger.entryB(chart));

    const accounts = await listAccounts(owner.ctx);
    expect(
      accounts,
      "every account of the book is returned, including untouched ones",
    ).toHaveLength(REFERENCE_CHART.length);
    const byCode = accountsByCode(accounts);
    for (const spec of REFERENCE_CHART) {
      const row = byCode.get(spec.code);
      expect(row, `GET /api/accounts carries code ${spec.code}`).toBeTruthy();
      expect(row!.type).toBe(spec.type);
      expect(
        Number.isInteger(Number(row!.balanceCents)),
        `balanceCents of ${spec.code} is an integer`,
      ).toBe(true);
      // Revenue is credit-normal, so 125010 — not −125010.
      expect(
        Number(row!.balanceCents),
        `${spec.code} ${spec.label} balanceCents in its own normal direction`,
      ).toBe(REFERENCE_BALANCES[spec.key]);
    }
    expect(sumBalances(accounts, "debit")).toBe(ENTRY_A_CENTS);
    expect(sumBalances(accounts, "credit")).toBe(ENTRY_A_CENTS);
  });

  test("led-m2-09 exactly one personal book survives re-sign-in and a burst", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const bookName = personalBookName(owner.who);
    expectOnePersonalBook(
      await listBooks(owner.ctx),
      bookName,
      "after sign-up",
    );

    await signOut(owner.page);
    await signIn(owner.page, owner.who);
    await waitForSession(owner.page, owner.ctx);
    expectOnePersonalBook(
      await listBooks(owner.ctx),
      bookName,
      "after signing in a second time",
    );

    // Concurrency-safe by construction: `context.request` fires these in
    // parallel, which page navigation could not.
    const burst = await Promise.all([
      ...Array.from({ length: 8 }, () => owner.ctx.request.get("/api/me")),
      ...Array.from({ length: 3 }, () => owner.ctx.request.get("/accounts")),
    ]);
    const mes: MeJson[] = [];
    for (const resp of burst.slice(0, 8)) {
      expect(resp.status(), "GET /api/me during the burst").toBe(200);
      mes.push((await resp.json()) as MeJson);
    }
    for (const me of mes) {
      expect(me.activeBookId, "activeBookId during the burst").toBeTruthy();
      expect(String(me.activeBookId)).toBe(String(mes[0].activeBookId));
      expect(
        me.memberships ?? [],
        "memberships has length 1 throughout",
      ).toHaveLength(1);
    }
    expectOnePersonalBook(
      await listBooks(owner.ctx),
      bookName,
      "after the concurrent burst",
    );
  });

  // ---- security probes ----

  test("led-m2-s01 unauthenticated reads are denied and leak nothing", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const chart = await apiChart(owner, ledger.token);
    const entry = ledger.entryA(chart);
    const entryId = await createPostedEntry(owner, entry);

    const secrets = [
      entry.memo,
      chart.cash.name,
      chart.revenue.name,
      owner.who.email,
      String(ENTRY_A_CENTS),
    ];
    const anon = await anonRequest();
    try {
      for (const path of [
        "/api/me",
        "/api/books",
        "/api/accounts",
        "/api/entries",
        `/api/entries/${entryId}`,
        `/api/books/${b1}/members`,
      ]) {
        const resp = await anon.get(path, { maxRedirects: 0 });
        expect(DENIED_OR_REDIRECT, `${path} without a session`).toContain(
          resp.status(),
        );
        const text = await resp.text();
        for (const secret of secrets) {
          expect(text, `${path} must not leak "${secret}"`).not.toContain(
            secret,
          );
        }
      }
    } finally {
      await anon.dispose();
    }
  });

  test("led-m2-s02 a non-member cannot read a book by id, query or header", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const chart = await apiChart(owner, ledger.token);
    const entry = ledger.entryA(chart);
    const entryId = await createPostedEntry(owner, entry);

    const outsider = await ledger.outsider();
    const b2 = await outsider.bookId();
    expect(String(b2)).not.toBe(String(b1));

    const secrets = [
      entry.memo,
      ...REFERENCE_CHART.map((s) => `${s.label} ${ledger.token}`),
      String(ENTRY_A_CENTS),
    ];
    // Every id below was captured from the OWNER's pinned surfaces and handed
    // to the outsider — that hand-over is the point of the probe.
    const attacks: Array<{
      label: string;
      path: string;
      headers?: Record<string, string>;
    }> = [
      { label: "GET /api/entries", path: "/api/entries" },
      { label: "GET /api/entries/{a}", path: `/api/entries/${entryId}` },
      {
        label: "GET /api/accounts?bookId={B1}",
        path: `/api/accounts?bookId=${b1}`,
      },
      {
        label: "GET /api/entries?bookId={B1}",
        path: `/api/entries?bookId=${b1}`,
      },
      {
        label: "GET /api/accounts with X-Book-Id: {B1}",
        path: "/api/accounts",
        headers: { "X-Book-Id": String(b1) },
      },
    ];
    for (const attack of attacks) {
      const resp = await outsider.ctx.request.get(attack.path, {
        headers: attack.headers,
        maxRedirects: 0,
      });
      expect([200, 403, 404], attack.label).toContain(resp.status());
      const text = await resp.text();
      for (const secret of secrets) {
        expect(text, `${attack.label} must not leak "${secret}"`).not.toContain(
          secret,
        );
      }
      if (resp.status() === 200) {
        const body = await resp.json().catch(() => null);
        const rows = Array.isArray(body) ? (body as AccountJson[]) : [];
        for (const row of rows) {
          expect(
            Number(row.balanceCents ?? 0),
            `${attack.label} returns only B2's own (zero) data`,
          ).toBe(0);
        }
      }
    }

    // Positive control: the owner's own read still returns B1 in full.
    const own = await listAccounts(owner.ctx);
    expect(own).toHaveLength(REFERENCE_CHART.length);
    const byCode = accountsByCode(own);
    expect(Number(byCode.get("1000")?.balanceCents)).toBe(ENTRY_A_CENTS);
    expect(Number(byCode.get("4000")?.balanceCents)).toBe(ENTRY_A_CENTS);
  });

  test("led-m2-s03 activating another book is refused and moves nothing", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const chart = await apiChart(owner, ledger.token);
    const entry = ledger.entryA(chart);
    await createPostedEntry(owner, entry);

    const outsider = await ledger.outsider();
    const b2 = await outsider.bookId();

    const resp = await outsider.ctx.request.post(`/api/books/${b1}/activate`, {
      maxRedirects: 0,
    });
    expect(
      [401, 403, 404],
      "activating a book the caller does not belong to",
    ).toContain(resp.status());

    // A 403 that nevertheless moved the caller's active book fails.
    const entries = await listEntries(outsider.ctx);
    expect(entries.map((e) => e.memo)).not.toContain(entry.memo);
    expect(entries, "the outsider's own book is still empty").toHaveLength(0);
    const me = await getMe(outsider.ctx);
    expect(String(me.activeBookId), "activeBookId is unchanged").toBe(
      String(b2),
    );
    expect(
      (me.memberships ?? []).map((m) => String(m.bookId)),
      "memberships still exclude B1",
    ).not.toContain(String(b1));

    // Positive control, run last: a route that 404s for everybody cannot pass.
    const control = await outsider.ctx.request.post(
      `/api/books/${b2}/activate`,
    );
    expect(
      control.status(),
      "activating one's OWN book",
    ).toBeGreaterThanOrEqual(200);
    expect(control.status()).toBeLessThan(300);
    expect(String((await getMe(outsider.ctx)).activeBookId)).toBe(String(b2));
  });

  test("led-m2-s04 a posted entry is immutable to PATCH and DELETE", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await apiChart(owner, ledger.token);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    const draftId = await createEntryViaApi(owner, ledger.entryB(chart));

    const before = entryFingerprint(await getEntry(owner.ctx, postedId));
    const balancesBefore = balanceMap(await listAccounts(owner.ctx));
    const attackMemo = ledger.name("Attack edited");

    const patches: Array<{ label: string; data: Record<string, unknown> }> = [
      { label: "{memo}", data: { memo: attackMemo } },
      { label: "{date}", data: { date: "2026-04-01" } },
      {
        label: "{lines} with doubled amounts",
        data: {
          lines: [
            {
              accountId: chart.cash.id,
              debitCents: ENTRY_A_CENTS * 2,
              creditCents: 0,
            },
            {
              accountId: chart.revenue.id,
              debitCents: 0,
              creditCents: ENTRY_A_CENTS * 2,
            },
          ],
        },
      },
      { label: "{status:'draft'}", data: { status: "draft" } },
      { label: "{entryNumber:9999}", data: { entryNumber: 9999 } },
    ];
    for (const patch of patches) {
      const resp = await owner.ctx.request.patch(`/api/entries/${postedId}`, {
        data: patch.data,
        maxRedirects: 0,
      });
      expect(
        resp.status(),
        `PATCH ${patch.label} on a posted entry is non-2xx`,
      ).toBeGreaterThanOrEqual(400);
      // A 409 is necessary but never sufficient: re-read and compare.
      expect(
        entryFingerprint(await getEntry(owner.ctx, postedId)),
        `PATCH ${patch.label} changed nothing`,
      ).toEqual(before);
    }

    const removed = await owner.ctx.request.delete(`/api/entries/${postedId}`, {
      maxRedirects: 0,
    });
    expect(
      removed.status(),
      "DELETE on a posted entry is non-2xx",
    ).toBeGreaterThanOrEqual(400);
    const reread = await owner.ctx.request.get(`/api/entries/${postedId}`);
    expect(reread.status(), "the posted entry still exists").toBe(200);
    expect(entryFingerprint(await reread.json())).toEqual(before);
    expect(
      balanceMap(await listAccounts(owner.ctx)),
      "no balance moved during the attack",
    ).toEqual(balancesBefore);

    // Positive control, run last: the same PATCH on the DRAFT succeeds, so a
    // route that refuses every PATCH cannot pass — and it moves no balance.
    const newMemo = ledger.name("Edited draft");
    const control = await owner.ctx.request.patch(`/api/entries/${draftId}`, {
      data: { memo: newMemo },
    });
    expect(control.status(), "PATCH {memo} on a draft").toBeGreaterThanOrEqual(
      200,
    );
    expect(control.status()).toBeLessThan(300);
    expect((await getEntry(owner.ctx, draftId)).memo).toBe(newMemo);
    expect(
      balanceMap(await listAccounts(owner.ctx)),
      "a draft edit moves no balance",
    ).toEqual(balancesBefore);
  });

  test("led-m2-s05 malformed entries are refused and burn no entry number", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await apiChart(owner, ledger.token);
    await createPostedEntry(owner, ledger.entryA(chart));

    const before = await listEntries(owner.ctx);
    const n = before.length;
    const maxNumber = maxEntryNumber(before);
    expect(
      maxNumber,
      "the setup's posted entry has an entryNumber",
    ).toBeGreaterThan(0);
    const balancesBefore = balanceMap(await listAccounts(owner.ctx));

    const shapes: Array<{
      label: string;
      memo: string;
      lines: Array<{
        accountId: string;
        debitCents: number;
        creditCents: number;
      }>;
      status?: string;
    }> = [
      {
        label: "total debits do not equal total credits",
        memo: ledger.name("Bad unbalanced"),
        lines: [
          { accountId: chart.cash.id, debitCents: 100000, creditCents: 0 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 90000 },
        ],
      },
      {
        label: "fewer than two lines",
        memo: ledger.name("Bad single line"),
        lines: [{ accountId: chart.cash.id, debitCents: 5000, creditCents: 0 }],
      },
      {
        label: "a line with both a debit and a credit above zero",
        memo: ledger.name("Bad both amounts"),
        lines: [
          { accountId: chart.cash.id, debitCents: 5000, creditCents: 5000 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 0 },
        ],
      },
      {
        label: "unbalanced with status posted",
        memo: ledger.name("Bad unbalanced posted"),
        status: "posted",
        lines: [
          { accountId: chart.cash.id, debitCents: 100000, creditCents: 0 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 90000 },
        ],
      },
      {
        label: "both amounts above zero with status posted",
        memo: ledger.name("Bad both amounts posted"),
        status: "posted",
        lines: [
          { accountId: chart.cash.id, debitCents: 5000, creditCents: 5000 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 0 },
        ],
      },
    ];

    for (const shape of shapes) {
      const resp = await owner.ctx.request.post("/api/entries", {
        data: {
          date: ENTRY_A_DATE,
          memo: shape.memo,
          lines: shape.lines,
          ...(shape.status ? { status: shape.status } : {}),
        },
        maxRedirects: 0,
      });
      expect(resp.status(), shape.label).toBe(400);
      const entries = await listEntries(owner.ctx);
      expect(entries.length, `${shape.label} wrote nothing`).toBe(n);
      expect(entries.map((e) => e.memo)).not.toContain(shape.memo);
    }
    expect(
      balanceMap(await listAccounts(owner.ctx)),
      "no balance moved",
    ).toEqual(balancesBefore);

    // Positive control: posting still works, and it takes the very next
    // number — a refused post must not burn one.
    const controlId = await createPostedEntry(owner, ledger.entryB(chart));
    const control = await getEntry(owner.ctx, controlId);
    expect(
      control.entryNumber,
      "the next successful post is the captured maximum + 1",
    ).toBe(maxNumber + 1);
  });

  test("led-m2-s06 an entry cannot reference another book's accounts", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await apiChart(owner, ledger.token);

    // The outsider's own book B2, with names that are not prefixes of B1's.
    const outsider = await ledger.outsider();
    const vaultName = ledger.name("Vault");
    const incomeName = ledger.name("Income");
    const vaultId = await createAccountViaApi(outsider, {
      code: "1000",
      name: vaultName,
      type: "debit",
    });
    const incomeId = await createAccountViaApi(outsider, {
      code: "4000",
      name: incomeName,
      type: "credit",
    });

    const b1CountBefore = (await listEntries(owner.ctx)).length;
    const b2BalancesBefore = balanceMap(await listAccounts(outsider.ctx));

    // Both shapes are BALANCED, so the balance rule cannot be what rejects
    // them — only the book-scoping check can.
    const attacks = [
      {
        label: "both lines from another book",
        memo: ledger.name("Cross book both"),
        lines: [
          { accountId: vaultId, debitCents: 10000, creditCents: 0 },
          { accountId: incomeId, debitCents: 0, creditCents: 10000 },
        ],
      },
      {
        label: "one line from each book",
        memo: ledger.name("Cross book split"),
        lines: [
          { accountId: chart.cash.id, debitCents: 10000, creditCents: 0 },
          { accountId: incomeId, debitCents: 0, creditCents: 10000 },
        ],
      },
    ];
    for (const attack of attacks) {
      const resp = await owner.ctx.request.post("/api/entries", {
        data: { date: ENTRY_A_DATE, memo: attack.memo, lines: attack.lines },
        maxRedirects: 0,
      });
      expect([400, 403, 404], attack.label).toContain(resp.status());
    }

    expect((await listEntries(owner.ctx)).length, "B1 gained no entry").toBe(
      b1CountBefore,
    );
    expect(
      balanceMap(await listAccounts(outsider.ctx)),
      "every balanceCents in B2 is unchanged",
    ).toEqual(b2BalancesBefore);
    await expectNoEntrySpansBooks(owner, "B1");
    await expectNoEntrySpansBooks(outsider, "B2");

    // Positive control, run after those reads: the same balanced entry against
    // B1's OWN account ids is accepted.
    const controlMemo = ledger.name("Control balanced");
    const control = await owner.ctx.request.post("/api/entries", {
      data: {
        date: ENTRY_A_DATE,
        memo: controlMemo,
        lines: [
          { accountId: chart.cash.id, debitCents: 10000, creditCents: 0 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 10000 },
        ],
      },
    });
    expect(
      control.status(),
      "the balanced control entry in B1's own accounts",
    ).toBeGreaterThanOrEqual(200);
    expect(control.status()).toBeLessThan(300);
    const b1After = await listEntries(owner.ctx);
    expect(b1After.length).toBe(b1CountBefore + 1);
    expect(b1After.map((e) => e.memo)).toContain(controlMemo);
  });

  test("led-m2-s07 a non-member cannot post or reverse another book's entry", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await apiChart(owner, ledger.token);
    const entry = ledger.entryA(chart);
    // {a} is handed over from the OWNER's own pinned GET /api/entries.
    const entryId = await createPostedEntry(owner, entry);

    const outsider = await ledger.outsider();
    const b1CountBefore = (await listEntries(owner.ctx)).length;
    const b1BalancesBefore = balanceMap(await listAccounts(owner.ctx));
    const outsiderCountBefore = (await listEntries(outsider.ctx)).length;

    for (const path of [
      `/api/entries/${entryId}/reverse`,
      `/api/entries/${entryId}/post`,
    ]) {
      const resp = await outsider.ctx.request.post(path, { maxRedirects: 0 });
      // 409 is allowed: {a} is already posted, so an app that resolves the
      // entry before the membership check may answer with the state conflict.
      // The invariants below carry the verdict.
      expect([401, 403, 404, 409], `${path} as a non-member`).toContain(
        resp.status(),
      );
    }

    const after = await getEntry(owner.ctx, entryId);
    expect(
      after.reversedByEntryId ?? null,
      "the owner's entry was not reversed",
    ).toBe(null);
    expect((await listEntries(owner.ctx)).length, "B1's entry count").toBe(
      b1CountBefore,
    );
    expect(
      balanceMap(await listAccounts(owner.ctx)),
      "every B1 balanceCents is unchanged",
    ).toEqual(b1BalancesBefore);
    expect(
      (await listEntries(outsider.ctx)).length,
      "the outsider's own book gained no entry",
    ).toBe(outsiderCountBefore);

    // Positive control, run after those reads: the OWNER's own reversal works,
    // so a reverse route that 404s for everyone cannot pass.
    await reverseEntryViaApi(owner, entryId);
    const reversalId = String(
      (await getEntry(owner.ctx, entryId)).reversedByEntryId ?? "",
    );
    expect(reversalId, "the owner's reversal is linked").toBeTruthy();
    const reversal = await getEntry(owner.ctx, reversalId);
    const revLines = new Map(
      (reversal.lines ?? []).map((l) => [String(l.accountId), l]),
    );
    expect(revLines.get(chart.cash.id)?.creditCents).toBe(ENTRY_A_CENTS);
    expect(revLines.get(chart.revenue.id)?.debitCents).toBe(ENTRY_A_CENTS);
  });

  test("led-m2-s08 posting authority and numbering are scoped to the book", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const chart = await apiChart(owner, ledger.token);
    await createPostedEntry(owner, ledger.entryA(chart));
    // The draft {d}, handed to both attackers from the owner's pinned surface.
    const draftId = await createEntryViaApi(owner, ledger.entryB(chart));

    const clerk = await ledger.clerk();
    const clerkId = await clerk.userId();
    const b3 = await clerk.bookId();
    // The owner's own add is the positive control that member-add works at all.
    await addMember(owner, b1, clerk.who.email, "bookkeeper");
    const outsider = await ledger.outsider();
    const b2 = await outsider.bookId();
    expect(String(b2)).not.toBe(String(b1));

    // (a) The clerk acts on B1's draft while their ACTIVE book is B3.
    await activateBook(clerk, b3);
    const membersBefore = memberSet(await listMembers(owner.ctx, b1));
    expect(
      membersBefore,
      "the owner's own add of the clerk landed (positive control)",
    ).toContain(`${clerkId}:bookkeeper`);
    const b1Before = await listEntries(owner.ctx);
    const b1MaxBefore = maxEntryNumber(b1Before);
    const b3Before = await listEntries(clerk.ctx);
    const b3MaxBefore = maxEntryNumber(b3Before);

    const postFromB3 = await clerk.ctx.request.post(
      `/api/entries/${draftId}/post`,
      { maxRedirects: 0 },
    );
    // Invariant-only: no prompt pins whether an entity route resolves from the
    // entry's book or the caller's active book, so either outcome is legal —
    // what is scored is that numbering never leaks across books.
    const b3After = await listEntries(clerk.ctx);
    expect(b3After.length, "no entry appears in B3").toBe(b3Before.length);
    expect(maxEntryNumber(b3After), "B3's numbering is untouched").toBe(
      b3MaxBefore,
    );
    const afterA = await getEntry(owner.ctx, draftId);
    if (postFromB3.ok()) {
      expect(afterA.status, "a successful post posts it in B1").toBe("posted");
      expect(
        afterA.entryNumber,
        "the number continues B1's sequence, not the caller's active book's",
      ).toBe(b1MaxBefore + 1);
    } else {
      expect(
        [403, 404],
        "a refusal resolves the entry from the caller's active book",
      ).toContain(postFromB3.status());
      expect(afterA.status, "a refused post leaves the draft a draft").toBe(
        "draft",
      );
    }

    // (b) The outsider owns B2 — which confers nothing in B1.
    const stateBeforeB = entryFingerprint(afterA);
    const b1CountBeforeB = (await listEntries(owner.ctx)).length;
    const b1BalancesBeforeB = balanceMap(await listAccounts(owner.ctx));
    const b2CountBefore = (await listEntries(outsider.ctx)).length;
    const crossMemo = ledger.name("Outsider posted");

    const outsiderAttacks: Array<{
      label: string;
      run: () => Promise<{ status(): number }>;
    }> = [
      {
        label: "POST /api/entries/{d}/post",
        run: () =>
          outsider.ctx.request.post(`/api/entries/${draftId}/post`, {
            maxRedirects: 0,
          }),
      },
      {
        label: "POST /api/entries/{d}/reverse",
        run: () =>
          outsider.ctx.request.post(`/api/entries/${draftId}/reverse`, {
            maxRedirects: 0,
          }),
      },
      {
        label: "POST /api/entries {status:'posted'} with B1 account ids",
        run: () =>
          outsider.ctx.request.post("/api/entries", {
            data: {
              date: ENTRY_A_DATE,
              memo: crossMemo,
              status: "posted",
              lines: [
                { accountId: chart.cash.id, debitCents: 10000, creditCents: 0 },
                {
                  accountId: chart.revenue.id,
                  debitCents: 0,
                  creditCents: 10000,
                },
              ],
            },
            maxRedirects: 0,
          }),
      },
    ];
    for (const attack of outsiderAttacks) {
      const resp = await attack.run();
      // 409 is legitimate: M2 pins reversing a draft as 409, and {d} may be one.
      // 400 likewise: the POST names no book, so a correct server resolves the
      // outsider's own active book and rejects B1's account ids as unknown —
      // body validation, not authorization. led-m2-s06 accepts 400 for the
      // identical cross-book shape; the four invariant re-reads below are what
      // actually carry this probe's verdict.
      expect([400, 401, 403, 404, 409], attack.label).toContain(resp.status());
    }

    expect(
      entryFingerprint(await getEntry(owner.ctx, draftId)),
      "{d}'s state is untouched by the outsider",
    ).toEqual(stateBeforeB);
    expect((await listEntries(owner.ctx)).length, "B1's entry count").toBe(
      b1CountBeforeB,
    );
    expect(
      balanceMap(await listAccounts(owner.ctx)),
      "every B1 balanceCents is unchanged",
    ).toEqual(b1BalancesBeforeB);
    const b2After = await listEntries(outsider.ctx);
    expect(b2After.length, "B2 gained no entry").toBe(b2CountBefore);
    expect(b2After.map((e) => e.memo)).not.toContain(crossMemo);
  });

  // Split out of led-m2-s08 so that it is scored on its own: Playwright aborts
  // a test at its first failed assertion, so while this lived as that probe's
  // last leg, any app that failed one of the earlier legs was never scored on
  // "only owners add members" at all.
  test("led-m2-s09 a bookkeeper cannot add a member", async ({ ledger }) => {
    const owner = await ledger.owner();
    const b1 = await owner.bookId();
    const clerk = await ledger.clerk();
    const clerkId = await clerk.userId();
    // The owner's own add is the positive control that member-add works at all.
    await addMember(owner, b1, clerk.who.email, "bookkeeper");
    const outsider = await ledger.outsider();

    const membersBefore = memberSet(await listMembers(owner.ctx, b1));
    expect(
      membersBefore,
      "the owner's own add of the clerk landed (positive control)",
    ).toContain(`${clerkId}:bookkeeper`);

    // The outsider's address is used precisely because they exist but are NOT
    // a member of B1, so no "already a member" answer can stand in for the
    // role check, and no "unknown user" 404 can either.
    const add = await clerk.ctx.request.post(`/api/books/${b1}/members`, {
      data: { email: outsider.who.email, role: "owner" },
      maxRedirects: 0,
    });
    expect(add.status(), "a bookkeeper adding a member to B1").toBe(403);
    expect(
      memberSet(await listMembers(owner.ctx, b1)),
      "B1's member set is unchanged",
    ).toEqual(membersBefore);
    const clerkMe = await getMe(clerk.ctx);
    const clerkMembership = (clerkMe.memberships ?? []).find(
      (m) => String(m.bookId) === String(b1),
    );
    expect(clerkMembership?.role, "the clerk is still a bookkeeper in B1").toBe(
      "bookkeeper",
    );
    const outsiderMe = await getMe(outsider.ctx);
    expect(
      (outsiderMe.memberships ?? []).map((m) => String(m.bookId)),
      "the outsider gained no membership in B1",
    ).not.toContain(String(b1));
  });
});
