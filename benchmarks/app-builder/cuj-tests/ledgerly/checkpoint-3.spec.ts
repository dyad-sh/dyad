// Ledgerly — checkpoint 3 CUJ suite (design/app-4-ledgerly.md, M3 CUJ table +
// M3 security probes). 11 CUJs (4 regression + 7 new) + 11 probes.
//
// Conventions (design "Test fixtures & conventions"): the suite is NOT serial.
// Every test provisions its own personas, chart, entries and periods through
// the `ledger` fixture — nothing is inherited from a sibling test, so a failure
// can never skip (and thereby silently void) another scenario. Raw-HTTP legs go
// through `context.request` (real persona cookies); every id comes from a
// pinned surface (GET /api/me, /api/accounts, /api/entries, /api/periods,
// /api/audit, or the pinned data-* attributes); every account name, memo and
// period name carries this test's token.
//
// Money is asserted as exact integer cents against the pinned `…Cents` fields
// and read from the DOM only through `numericText`. Calendar dates are compared
// byte for byte against the pinned `data-entry-date` / `data-period-start` /
// `data-period-end` attributes and the pinned JSON `date` / `startDate` /
// `endDate`. Audit timestamps are never compared as strings: `data-audit-time`
// and `createdAt` are parsed with `Date.parse` and compared as instants, so
// `Z` vs `+00:00` and differing fractional-second precision cannot flip an
// assertion.
import {
  test,
  expect,
  accountsById,
  balanceMap,
  closePeriod,
  closePeriodViaApi,
  createAccountFor,
  createAccountViaApi,
  createEntryFor,
  createEntryViaApi,
  createPeriod,
  createPeriodViaApi,
  createPostedEntry,
  entryCount,
  entryFingerprint,
  expectNamesId,
  getEntry,
  getMe,
  getPeriod,
  hrefPath,
  listAccounts,
  listAudit,
  listEntries,
  listPeriods,
  numericText,
  postEntry,
  postEntryViaApi,
  reopenPeriod,
  reverseEntry,
  reverseEntryViaApi,
  sumBalances,
  ENTRY_A_CENTS,
  ENTRY_A_DATE,
  ENTRY_B_CENTS,
  type AuditJson,
  type Chart,
  type EntryInput,
  type EntryJson,
  type EntryLineJson,
  type Persona,
} from "./fixtures";
import { type APIResponse, type Locator } from "@playwright/test";

// The single reference period every period test uses. Hard-coded in March 2026
// (never `new Date()`), so nothing depends on when the suite runs.
const MAR_START = "2026-03-01";
const MAR_END = "2026-03-31";
/** Inside the reference period — the date every "locked" draft carries. */
const LOCKED_DATE = "2026-03-20";
/** Outside the reference period — the positive-control write date. */
const OUTSIDE_DATE = "2026-04-10";
const SMALL_DOLLARS = "10.00";
const SMALL_CENTS = 1000;

/** The only four audit actions M3 allows. */
const AUDIT_ACTIONS = [
  "entry.posted",
  "entry.reversed",
  "period.closed",
  "period.reopened",
];

/** Denied-or-not-found, for a cross-persona read that may legitimately 404. */
const DENIED = [401, 403, 404];

// ---------------------------------------------------------------------------
// Local helpers (nothing here belongs in fixtures.ts — all of it is specific to
// the checkpoint-3 scenarios).
// ---------------------------------------------------------------------------

/** A balanced Cash-debit / Revenue-credit entry, in dollars-with-two-decimals. */
function cashRevenueEntry(
  chart: Chart,
  memo: string,
  date: string,
  dollars: string,
): EntryInput {
  return {
    date,
    memo,
    lines: [
      { accountId: chart.cash.id, debit: dollars },
      { accountId: chart.revenue.id, credit: dollars },
    ],
  };
}

/**
 * Every probe in this suite asserts "non-2xx", never a single status code:
 * `resp.ok()` is exactly 200–299, so a 3xx (with `maxRedirects: 0`) and a 4xx
 * both read as refused. The invariant re-read that follows carries the verdict.
 */
function expectRefused(resp: APIResponse, label: string) {
  expect(resp.ok(), `${label} → ${resp.status()}`).toBe(false);
}

/**
 * DOM money: formatting-insensitive, compared against the pinned integer cents
 * the test itself computed. Exact integer equality is reserved for the JSON.
 */
async function expectDollars(locator: Locator, cents: number, label: string) {
  await expect(locator).toBeVisible({ timeout: 15_000 });
  expect(await numericText(locator), label).toBeCloseTo(cents / 100, 2);
}

/**
 * A pinned entry link (`entry-reverses-link` / `entry-reversed-by-link`) points
 * at a specific entry. M2 pins the test id but not the element kind, so accept
 * an anchor's href and fall back to following the control.
 *
 * Both legs compare a WHOLE path, never a substring: "/journal/123" contains
 * "12", so `toContain(targetId)` would be satisfied by a link to the wrong
 * entry — which is exactly the defect this helper exists to catch.
 */
async function expectEntryLink(
  actor: Persona,
  testId: string,
  targetId: string,
) {
  const link = actor.page.getByTestId(testId).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  const target = `/journal/${targetId}`;
  const href = await link.getAttribute("href");
  if (href) {
    expect(
      hrefPath(href, actor.page.url()),
      `${testId} points at ${targetId}`,
    ).toBe(target);
    return;
  }
  await link.click();
  await expect
    .poll(() => hrefPath(actor.page.url(), actor.page.url()), {
      timeout: 15_000,
      message: `${testId} navigates to ${target}`,
    })
    .toBe(target);
}

/**
 * The period lock, seen from the UI. M3 pins `period-locked-badge` on a draft
 * dated inside a closed period and `entry-error` for the refusal message, but
 * hiding `entry-post-button` outright is an equally correct reading of "nothing
 * may change the posted ledger inside it" — so when the control is absent the
 * refusal is proven through the pinned API leg instead. Either way the entry
 * must still be a draft afterwards.
 */
async function expectPostRefusedByLock(actor: Persona, entryId: string) {
  await actor.page.goto(`/journal/${entryId}`);
  await expect(actor.page.getByTestId("period-locked-badge")).toBeVisible({
    timeout: 15_000,
  });
  const button = actor.page.getByTestId("entry-post-button");
  if (await button.count()) {
    await button.first().click();
    await expect(actor.page.getByTestId("entry-error")).toBeVisible({
      timeout: 15_000,
    });
    await actor.page.waitForLoadState("networkidle").catch(() => {});
  } else {
    const resp = await actor.ctx.request.post(`/api/entries/${entryId}/post`, {
      maxRedirects: 0,
    });
    expectRefused(resp, "posting a draft dated inside a closed period");
  }
  // Re-navigate rather than reload: a refusal that still routed away would make
  // a reload assert against the wrong page.
  await actor.page.goto(`/journal/${entryId}`);
  await expect(actor.page.getByTestId("entry-detail-status")).toHaveText(
    /^\s*draft\s*$/i,
  );
}

/** Read the pinned data-* attributes off every rendered row of one test id. */
function rowAttributes(
  rows: Locator,
  attribute: string,
): Promise<Array<string | null>> {
  return rows.evaluateAll(
    (els, attr) => els.map((el) => el.getAttribute(attr)),
    attribute,
  );
}

/** Every non-zero `…Cents` value anywhere in a JSON body (leak detection). */
function nonZeroCents(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) nonZeroCents(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/Cents$/.test(key) && typeof v === "number" && v !== 0) out.push(v);
      else nonZeroCents(v, out);
    }
  }
  return out;
}

/**
 * Every scalar (string or number) anywhere in a JSON body, stringified. Ids and
 * amounts are matched against THIS with exact element equality — never as a
 * substring of the raw response text, where a short value collides by
 * coincidence with an unrelated number in the same body (an id `12` is a
 * substring of `"totalDebitCents":1299`, and `9999999` of `99999990`).
 */
function scalarValues(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) scalarValues(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      scalarValues(v, out);
    }
    return out;
  }
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
  }
  return out;
}

/** The book's current highest `entryNumber` (0 when nothing is posted yet). */
function maxEntryNumber(entries: EntryJson[]): number {
  return entries.reduce(
    (max, e) =>
      typeof e.entryNumber === "number" ? Math.max(max, e.entryNumber) : max,
    0,
  );
}

/** Index an entry's lines by account id. */
function linesByAccount(entry: EntryJson): Map<string, EntryLineJson> {
  return new Map((entry.lines ?? []).map((l) => [String(l.accountId), l]));
}

test.describe("ledgerly checkpoint 3", () => {
  // ---- regression CUJs (carried over from M1/M2) ----

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
    await expectDollars(
      row.getByTestId("entry-row-total"),
      ENTRY_A_CENTS,
      "entry-row-total",
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

  test("led-m2-04 a draft is posted and numbered", async ({ ledger }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entryId = await createEntryFor(owner, ledger.entryA(chart));

    await owner.page.goto(`/journal/${entryId}`);
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*draft\s*$/i,
    );
    const numberCell = owner.page.getByTestId("entry-detail-number");
    if (await numberCell.count()) {
      const shown = (await numberCell.first().textContent()) ?? "";
      expect(
        shown.replace(/\D/g, ""),
        "entry-detail-number is empty while the entry is a draft",
      ).toBe("");
    }
    const before = await getEntry(owner.ctx, entryId);
    expect(before.status).toBe("draft");
    expect(before.entryNumber ?? null).toBeNull();
    expect(before.postedAt ?? null).toBeNull();

    await postEntry(owner, entryId);
    await owner.page.reload();
    await expect(owner.page.getByTestId("entry-detail-status")).toHaveText(
      /^\s*posted\s*$/i,
    );
    const shownNumber = await numericText(
      owner.page.getByTestId("entry-detail-number"),
    );
    expect(Number.isInteger(shownNumber)).toBe(true);
    expect(shownNumber).toBeGreaterThan(0);

    const after = await getEntry(owner.ctx, entryId);
    expect(after.status).toBe("posted");
    expect(Number.isInteger(after.entryNumber)).toBe(true);
    expect(after.entryNumber as number).toBeGreaterThan(0);
    expect(
      after.postedAt ?? null,
      "postedAt is stamped on posting",
    ).toBeTruthy();
  });

  test("led-m2-06 reversing a posted entry restores the balances", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entryId = await createEntryFor(owner, ledger.entryA(chart));
    // Captured BEFORE posting (every balance is 0 — only posted entries count).
    const beforePost = balanceMap(await listAccounts(owner.ctx));

    await postEntry(owner, entryId);
    await reverseEntry(owner, entryId);

    const original = await getEntry(owner.ctx, entryId);
    const reversalId = String(original.reversedByEntryId ?? "");
    expect(reversalId, "the original carries reversedByEntryId").toBeTruthy();
    const reversal = await getEntry(owner.ctx, reversalId);
    expect(String(reversal.reversesEntryId ?? "")).toBe(entryId);
    expect(reversal.status).toBe("posted");
    expect(Number.isInteger(reversal.entryNumber)).toBe(true);
    expect(reversal.date, "a reversal keeps the original's date").toBe(
      ENTRY_A_DATE,
    );

    const mirrored = linesByAccount(reversal);
    expect(mirrored.get(chart.cash.id)?.creditCents).toBe(ENTRY_A_CENTS);
    expect(mirrored.get(chart.cash.id)?.debitCents).toBe(0);
    expect(mirrored.get(chart.revenue.id)?.debitCents).toBe(ENTRY_A_CENTS);
    expect(mirrored.get(chart.revenue.id)?.creditCents).toBe(0);

    await owner.page.goto(`/journal/${entryId}`);
    await expectEntryLink(owner, "entry-reversed-by-link", reversalId);
    await owner.page.goto(`/journal/${reversalId}`);
    await expectEntryLink(owner, "entry-reverses-link", entryId);

    const accounts = await listAccounts(owner.ctx);
    expect(
      balanceMap(accounts),
      "a reversal returns every balance to its pre-post value",
    ).toEqual(beforePost);
    expect(sumBalances(accounts, "debit")).toBe(
      sumBalances(accounts, "credit"),
    );
  });

  test("led-m2-07 a draft moves nothing and posting moves exactly two accounts", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);

    const atStart = await listAccounts(owner.ctx);
    expect(sumBalances(atStart, "debit")).toBe(sumBalances(atStart, "credit"));
    const before = balanceMap(atStart);

    const entryId = await createEntryFor(owner, ledger.entryA(chart));
    const withDraft = await listAccounts(owner.ctx);
    expect(
      balanceMap(withDraft),
      "an outstanding draft moves no balance at all",
    ).toEqual(before);
    expect(sumBalances(withDraft, "debit")).toBe(
      sumBalances(withDraft, "credit"),
    );

    await postEntry(owner, entryId);
    const posted = await listAccounts(owner.ctx);
    const after = balanceMap(posted);
    expect(sumBalances(posted, "debit")).toBe(sumBalances(posted, "credit"));
    const moved = Object.keys(after)
      .filter((id) => after[id] !== before[id])
      .sort();
    expect(moved, "exactly the two accounts the entry touches move").toEqual(
      [chart.cash.id, chart.revenue.id].sort(),
    );
    // Each positive in its own normal direction: Cash is debit-normal, Revenue
    // credit-normal, so both move by +125010.
    expect(after[chart.cash.id] - before[chart.cash.id]).toBe(ENTRY_A_CENTS);
    expect(after[chart.revenue.id] - before[chart.revenue.id]).toBe(
      ENTRY_A_CENTS,
    );
    for (const account of posted) {
      expect(
        Number.isInteger(account.balanceCents),
        `balanceCents of ${account.code} is an integer`,
      ).toBe(true);
    }
  });

  // ---- new M3 CUJs ----

  test("led-m3-01 a period is created, totalled and closed", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    await createPostedEntry(owner, ledger.entryB(chart));
    const expectedTotal = ENTRY_A_CENTS + ENTRY_B_CENTS;

    const periodName = ledger.name("Mar");
    const periodId = await createPeriod(owner, {
      name: periodName,
      startDate: MAR_START,
      endDate: MAR_END,
    });

    await owner.page.goto("/periods");
    const row = owner.page
      .getByTestId("period-row")
      .filter({ hasText: periodName })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-period-start", MAR_START);
    await expect(row).toHaveAttribute("data-period-end", MAR_END);
    await expect(row.getByTestId("period-row-status")).toHaveText(
      /^\s*open\s*$/i,
    );

    const open = await getPeriod(owner.ctx, periodId);
    expect(open.startDate, "startDate echoes back byte-identically").toBe(
      MAR_START,
    );
    expect(open.endDate, "endDate echoes back byte-identically").toBe(MAR_END);
    expect(open.status).toBe("open");
    expect(open.totalDebitCents).toBe(expectedTotal);
    expect(open.totalCreditCents).toBe(expectedTotal);
    expect(Number.isInteger(open.totalDebitCents)).toBe(true);
    expect(Number.isInteger(open.totalCreditCents)).toBe(true);

    await owner.page.goto(`/periods/${periodId}`);
    await expect(owner.page.getByTestId("period-detail-name")).toContainText(
      periodName,
    );
    await expect(owner.page.getByTestId("period-status")).toHaveText(
      /^\s*open\s*$/i,
    );
    await expectDollars(
      owner.page.getByTestId("period-total-debit"),
      expectedTotal,
      "period-total-debit",
    );
    await expectDollars(
      owner.page.getByTestId("period-total-credit"),
      expectedTotal,
      "period-total-credit",
    );

    await closePeriod(owner, periodId);
    const closed = await getPeriod(owner.ctx, periodId);
    expect(closed.status).toBe("closed");
    expect(closed.startDate, "closing does not shift a boundary").toBe(
      MAR_START,
    );
    expect(closed.endDate).toBe(MAR_END);
    expect(closed.totalDebitCents).toBe(expectedTotal);
    expect(closed.totalCreditCents).toBe(expectedTotal);

    await owner.page.goto("/periods");
    await expect(row.getByTestId("period-row-status")).toHaveText(
      /^\s*closed\s*$/i,
    );
  });

  test("led-m3-02 a closed period refuses a post from the UI", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    const periodId = await createPeriod(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });
    await closePeriod(owner, periodId);
    const before = await getPeriod(owner.ctx, periodId);

    const draftId = await createEntryFor(
      owner,
      cashRevenueEntry(
        chart,
        ledger.name("Locked draft"),
        LOCKED_DATE,
        SMALL_DOLLARS,
      ),
    );
    await expectPostRefusedByLock(owner, draftId);

    const entry = await getEntry(owner.ctx, draftId);
    expect(entry.status, "the draft stays a draft").toBe("draft");
    expect(entry.entryNumber ?? null, "no number was burned").toBeNull();

    const after = await getPeriod(owner.ctx, periodId);
    expect(
      after.totalDebitCents,
      "the closed period's totals are unchanged",
    ).toBe(before.totalDebitCents);
    expect(after.totalCreditCents).toBe(before.totalCreditCents);
  });

  test("led-m3-03 reopening a period restores posting", async ({ ledger }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    const periodId = await createPeriod(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });
    await closePeriod(owner, periodId);

    const draftId = await createEntryFor(
      owner,
      cashRevenueEntry(
        chart,
        ledger.name("Reopened draft"),
        LOCKED_DATE,
        SMALL_DOLLARS,
      ),
    );
    await expectPostRefusedByLock(owner, draftId);

    await reopenPeriod(owner, periodId);
    await expect(owner.page.getByTestId("period-status")).toHaveText(
      /^\s*open\s*$/i,
    );
    const reopened = await getPeriod(owner.ctx, periodId);
    expect(reopened.status).toBe("open");

    await postEntry(owner, draftId);
    const entry = await getEntry(owner.ctx, draftId);
    expect(entry.status, "the post now succeeds").toBe("posted");
    expect(Number.isInteger(entry.entryNumber)).toBe(true);
    expect(entry.entryNumber as number).toBeGreaterThan(0);

    const after = await getPeriod(owner.ctx, periodId);
    expect(
      after.totalDebitCents,
      "the period total grows by exactly this entry's total",
    ).toBe(reopened.totalDebitCents + SMALL_CENTS);
    expect(after.totalCreditCents).toBe(after.totalDebitCents);

    await owner.page.goto(`/periods/${periodId}`);
    await expectDollars(
      owner.page.getByTestId("period-total-debit"),
      after.totalDebitCents,
      "period-total-debit after reopening and posting",
    );
    await expectDollars(
      owner.page.getByTestId("period-total-credit"),
      after.totalCreditCents,
      "period-total-credit after reopening and posting",
    );
  });

  test("led-m3-04 a bookkeeper sees periods read-only", async ({ ledger }) => {
    const world = await ledger.setupBookWithClerk();
    const periodName = ledger.name("Mar");
    const periodId = await createPeriod(world.owner, {
      name: periodName,
      startDate: MAR_START,
      endDate: MAR_END,
    });

    // The clerk reads the list — read-only, but not empty.
    await world.clerk.page.goto("/periods");
    await expect(
      world.clerk.page
        .getByTestId("period-row")
        .filter({ hasText: periodName }),
    ).toHaveCount(1);

    // Close/reopen controls are absent, or present-and-inert.
    await world.clerk.page.goto(`/periods/${periodId}`);
    await expect(world.clerk.page.getByTestId("period-status")).toHaveText(
      /^\s*open\s*$/i,
    );
    const closeButton = world.clerk.page.getByTestId("period-close-button");
    if (await closeButton.count()) {
      await closeButton
        .first()
        .click({ timeout: 15_000 })
        .catch(() => {});
      await world.clerk.page.waitForLoadState("networkidle").catch(() => {});
    }
    expect(
      (await getPeriod(world.owner.ctx, periodId)).status,
      "a bookkeeper's close leaves the period open",
    ).toBe("open");

    // With the period genuinely closed by the owner, the reopen control is the
    // one under test.
    await closePeriodViaApi(world.owner, periodId);
    await world.clerk.page.goto(`/periods/${periodId}`);
    await expect(world.clerk.page.getByTestId("period-status")).toHaveText(
      /^\s*closed\s*$/i,
    );
    const reopenButton = world.clerk.page.getByTestId("period-reopen-button");
    if (await reopenButton.count()) {
      await reopenButton
        .first()
        .click({ timeout: 15_000 })
        .catch(() => {});
      await world.clerk.page.waitForLoadState("networkidle").catch(() => {});
    }
    expect(
      (await getPeriod(world.owner.ctx, periodId)).status,
      "a bookkeeper's reopen leaves the period closed",
    ).toBe("closed");

    // Positive control: the clerk can still create and post an entry dated
    // outside every closed period.
    const clerkEntryId = await createEntryFor(
      world.clerk,
      cashRevenueEntry(
        world.chart,
        ledger.name("Clerk entry"),
        "2026-05-05",
        "12.00",
      ),
    );
    await postEntry(world.clerk, clerkEntryId);
    expect((await getEntry(world.clerk.ctx, clerkEntryId)).status).toBe(
      "posted",
    );
  });

  test("led-m3-05 the audit trail covers every pinned action", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    const periodId = await createPeriod(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });
    await closePeriod(owner, periodId);
    const draftId = await createEntryFor(
      owner,
      cashRevenueEntry(
        chart,
        ledger.name("Audited draft"),
        LOCKED_DATE,
        SMALL_DOLLARS,
      ),
    );
    await expectPostRefusedByLock(owner, draftId);
    await reopenPeriod(owner, periodId);
    await postEntry(owner, draftId);
    await reverseEntry(owner, postedId);

    await owner.page.goto("/audit");
    const rows = owner.page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const actions = await rowAttributes(rows, "data-audit-action");
    for (const action of AUDIT_ACTIONS) {
      expect(actions, `the trail carries a ${action} row`).toContain(action);
    }

    // Instants, never strings: `Date.parse` on the pinned attribute.
    const ids = await rowAttributes(rows, "data-audit-id");
    const times = (await rowAttributes(rows, "data-audit-time")).map((t) =>
      Date.parse(t ?? ""),
    );
    for (let i = 0; i < times.length; i++) {
      expect(
        Number.isNaN(times[i]),
        `audit row ${i} has a parseable data-audit-time`,
      ).toBe(false);
    }
    for (let i = 1; i < times.length; i++) {
      expect(
        times[i],
        "the trail is newest first (non-increasing instants)",
      ).toBeLessThanOrEqual(times[i - 1]);
    }

    const api = await listAudit(owner.ctx);
    const byId = new Map(api.map((r) => [String(r.id), r]));
    for (let i = 0; i < ids.length; i++) {
      const row = byId.get(String(ids[i]));
      expect(row, `GET /api/audit carries row ${ids[i]}`).toBeTruthy();
      // Tolerance of one second: the attribute and the JSON may differ in
      // fractional-second precision, which the design explicitly permits.
      expect(
        Math.abs(Date.parse(row!.createdAt) - times[i]),
        "data-audit-time and createdAt are the same instant",
      ).toBeLessThan(1000);
    }

    const actors = await rows.getByTestId("audit-row-actor").allTextContents();
    expect(actors.length).toBeGreaterThan(0);
    for (const actor of actors) {
      expect(actor, "audit-row-actor is the acting persona's email").toContain(
        owner.who.email,
      );
    }

    const postedRow = api.find(
      (r) => r.action === "entry.posted" && String(r.targetId) === postedId,
    );
    expect(
      postedRow,
      "an entry.posted row targets the entry that was posted",
    ).toBeTruthy();
    const domRow = owner.page.locator(
      `[data-testid="audit-row"][data-audit-id="${postedRow!.id}"]`,
    );
    // The id must be named as a WHOLE token: `toContainText(postedId)` would be
    // satisfied by a cell showing a DIFFERENT id that merely contains this one,
    // and this is a positive control — it exists to prove the row renders the
    // entry it targets.
    await expectNamesId(
      domRow.getByTestId("audit-row-target"),
      postedId,
      "audit-row-target is the entry that was posted",
    );
  });

  test("led-m3-06 the audit filter keeps the real actor", async ({
    ledger,
  }) => {
    const world = await ledger.setupBookWithClerk();
    const clerkEntryId = await createEntryFor(
      world.clerk,
      cashRevenueEntry(
        world.chart,
        ledger.name("Clerk posted"),
        "2026-05-05",
        "15.00",
      ),
    );
    await postEntry(world.clerk, clerkEntryId);

    await world.owner.page.goto("/audit");
    await world.owner.page
      .getByTestId("audit-filter-action")
      .selectOption("entry.posted");
    await world.owner.page.getByTestId("audit-filter-apply").click();
    await world.owner.page.waitForLoadState("networkidle").catch(() => {});

    const rows = world.owner.page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const actions = await rowAttributes(rows, "data-audit-action");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action, "every visible row is an entry.posted row").toBe(
        "entry.posted",
      );
    }

    const api = await listAudit(world.owner.ctx, "entry.posted");
    const domIds = (await rowAttributes(rows, "data-audit-id")).map((v) =>
      String(v),
    );
    expect(
      new Set(domIds),
      "the filtered page and GET /api/audit?action= agree on the id set",
    ).toEqual(new Set(api.map((r) => String(r.id))));

    const clerkRow = api.find((r) => String(r.targetId) === clerkEntryId);
    expect(clerkRow, "the clerk's posting is audited").toBeTruthy();
    expect(clerkRow!.actorEmail).toBe(world.clerk.who.email);
    expect(String(clerkRow!.actorUserId)).toBe(await world.clerk.userId());

    const domRow = world.owner.page.locator(
      `[data-testid="audit-row"][data-audit-id="${clerkRow!.id}"]`,
    );
    await expect(domRow.getByTestId("audit-row-actor")).toContainText(
      world.clerk.who.email,
    );
    await expect(domRow.getByTestId("audit-row-actor")).not.toContainText(
      world.owner.who.email,
    );
  });

  test("led-m3-08 boundary dates reconcile against the account balances", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const cashId = await createAccountFor(owner, {
      code: "1000",
      name: ledger.name("Cash"),
      type: "debit",
    });
    const revenueId = await createAccountFor(owner, {
      code: "4000",
      name: ledger.name("Revenue"),
      type: "credit",
    });
    const periodId = await createPeriod(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });

    const samples = [
      { date: "2026-02-28", dollars: "11.11", cents: 1111 },
      { date: MAR_START, dollars: "22.22", cents: 2222 },
      { date: MAR_END, dollars: "44.44", cents: 4444 },
      { date: "2026-04-01", dollars: "88.88", cents: 8888 },
    ];
    const entryIds: Record<string, string> = {};
    for (const sample of samples) {
      entryIds[sample.date] = await createPostedEntry(owner, {
        date: sample.date,
        memo: ledger.name(`Boundary ${sample.date}`),
        lines: [
          { accountId: cashId, debit: sample.dollars },
          { accountId: revenueId, credit: sample.dollars },
        ],
      });
    }

    // Surface 1: the period, whose date predicate is the inclusive range.
    const insideCents = 2222 + 4444;
    const period = await getPeriod(owner.ctx, periodId);
    expect(
      period.totalDebitCents,
      "both boundary dates are included and nothing shifted a day",
    ).toBe(insideCents);
    expect(period.totalCreditCents).toBe(insideCents);
    expect(Number.isInteger(period.totalDebitCents)).toBe(true);
    expect(Number.isInteger(period.totalCreditCents)).toBe(true);

    await owner.page.goto(`/periods/${periodId}`);
    await expectDollars(
      owner.page.getByTestId("period-total-debit"),
      insideCents,
      "period-total-debit",
    );
    await expectDollars(
      owner.page.getByTestId("period-total-credit"),
      insideCents,
      "period-total-credit",
    );

    // Surface 2: the account balances, which use no date predicate at all.
    const allCents = 1111 + 2222 + 4444 + 8888;
    const byId = accountsById(await listAccounts(owner.ctx));
    expect(byId.get(cashId)?.balanceCents).toBe(allCents);
    expect(byId.get(revenueId)?.balanceCents).toBe(allCents);

    // Every stored date is byte-identical to what was sent, on both surfaces.
    await owner.page.goto("/journal");
    for (const sample of samples) {
      const entryId = entryIds[sample.date];
      const entry = await getEntry(owner.ctx, entryId);
      expect(entry.date, `GET /api/entries/${entryId} date`).toBe(sample.date);
      await expect(
        owner.page.locator(
          `[data-testid="entry-row"][data-entry-id="${entryId}"]`,
        ),
      ).toHaveAttribute("data-entry-date", sample.date);
    }
  });

  // ---- security probes ----

  test("led-m3-s01 a closed period refuses every write into it", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    const draftId = await createEntryViaApi(
      owner,
      cashRevenueEntry(
        chart,
        ledger.name("Locked draft"),
        LOCKED_DATE,
        SMALL_DOLLARS,
      ),
    );
    const periodId = await createPeriodViaApi(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });
    await closePeriodViaApi(owner, periodId);

    const periodBefore = await getPeriod(owner.ctx, periodId);
    const balancesBefore = balanceMap(await listAccounts(owner.ctx));
    const draftBefore = entryFingerprint(await getEntry(owner.ctx, draftId));
    const countBefore = await entryCount(owner.ctx);

    const insideMemo = ledger.name("Create posted inside");
    const attacks: Array<{ label: string; run: () => Promise<APIResponse> }> = [
      {
        label: "POST /api/entries {status:'posted'} dated inside the period",
        run: () =>
          owner.ctx.request.post("/api/entries", {
            data: {
              date: "2026-03-10",
              memo: insideMemo,
              status: "posted",
              lines: [
                {
                  accountId: chart.cash.id,
                  debitCents: SMALL_CENTS,
                  creditCents: 0,
                },
                {
                  accountId: chart.revenue.id,
                  debitCents: 0,
                  creditCents: SMALL_CENTS,
                },
              ],
            },
            maxRedirects: 0,
          }),
      },
      {
        label: "POST /api/entries/{D}/post",
        run: () =>
          owner.ctx.request.post(`/api/entries/${draftId}/post`, {
            maxRedirects: 0,
          }),
      },
      {
        label: "POST /api/entries/{E}/reverse",
        run: () =>
          owner.ctx.request.post(`/api/entries/${postedId}/reverse`, {
            maxRedirects: 0,
          }),
      },
      {
        label: "PATCH /api/entries/{D}",
        run: () =>
          owner.ctx.request.patch(`/api/entries/${draftId}`, {
            data: { memo: "x" },
            maxRedirects: 0,
          }),
      },
      {
        label: "DELETE /api/entries/{D}",
        run: () =>
          owner.ctx.request.delete(`/api/entries/${draftId}`, {
            maxRedirects: 0,
          }),
      },
    ];

    for (const attack of attacks) {
      const resp = await attack.run();
      expectRefused(resp, attack.label);
      // A 409 is necessary but never sufficient: prove the ledger is untouched.
      expect(await entryCount(owner.ctx), `${attack.label} wrote nothing`).toBe(
        countBefore,
      );
    }

    const periodAfter = await getPeriod(owner.ctx, periodId);
    expect(periodAfter.totalDebitCents).toBe(periodBefore.totalDebitCents);
    expect(periodAfter.totalCreditCents).toBe(periodBefore.totalCreditCents);
    expect(balanceMap(await listAccounts(owner.ctx))).toEqual(balancesBefore);
    expect(entryFingerprint(await getEntry(owner.ctx, draftId))).toEqual(
      draftBefore,
    );
    const draftNow = await getEntry(owner.ctx, draftId);
    expect(draftNow.status).toBe("draft");
    expect(draftNow.entryNumber ?? null).toBeNull();
    expect(
      (await getEntry(owner.ctx, postedId)).reversedByEntryId ?? null,
      "the refused reversal created nothing",
    ).toBeNull();
    expect((await listEntries(owner.ctx)).map((e) => e.memo)).not.toContain(
      insideMemo,
    );

    // Positive control, run last: a posted write OUTSIDE the book's only period
    // succeeds, so an app that refuses every write cannot pass.
    const controlMemo = ledger.name("Control outside");
    const control = await owner.ctx.request.post("/api/entries", {
      data: {
        date: OUTSIDE_DATE,
        memo: controlMemo,
        status: "posted",
        lines: [
          { accountId: chart.cash.id, debitCents: SMALL_CENTS, creditCents: 0 },
          {
            accountId: chart.revenue.id,
            debitCents: 0,
            creditCents: SMALL_CENTS,
          },
        ],
      },
    });
    expect(control.ok(), `the control POST → ${control.status()}`).toBe(true);
    expect(await entryCount(owner.ctx)).toBe(countBefore + 1);
  });

  test("led-m3-s02 a bookkeeper cannot close or reopen a period", async ({
    ledger,
  }) => {
    const world = await ledger.setupBookWithClerk();
    const periodId = await createPeriodViaApi(world.owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });

    const seenByClerk = (await listPeriods(world.clerk.ctx)).find(
      (p) => String(p.id) === periodId,
    );
    expect(seenByClerk, "a bookkeeper reads the period list").toBeTruthy();
    expect(seenByClerk!.status).toBe("open");

    const close = await world.clerk.ctx.request.post(
      `/api/periods/${periodId}/close`,
      { maxRedirects: 0 },
    );
    expect(close.status(), "a bookkeeper's close").toBe(403);
    const reopen = await world.clerk.ctx.request.post(
      `/api/periods/${periodId}/reopen`,
      { maxRedirects: 0 },
    );
    expect(reopen.status(), "a bookkeeper's reopen").toBe(403);
    // PATCH /api/periods/[id] is deliberately not a pinned route, so 403, 404
    // and 405 are all acceptable — only a 2xx fails.
    const patch = await world.clerk.ctx.request.patch(
      `/api/periods/${periodId}`,
      { data: { status: "closed" }, maxRedirects: 0 },
    );
    expectRefused(patch, "PATCH /api/periods/{P} {status:'closed'}");

    expect(
      (await getPeriod(world.owner.ctx, periodId)).status,
      "the period is still open server-side",
    ).toBe("open");
    expect(
      (await listAudit(world.owner.ctx)).map((r) => r.action),
      "no period.closed row was appended",
    ).not.toContain("period.closed");

    // The close never took effect: the owner can still post inside P.
    const insideId = await createEntryViaApi(
      world.owner,
      cashRevenueEntry(
        world.chart,
        ledger.name("Inside open period"),
        LOCKED_DATE,
        SMALL_DOLLARS,
      ),
    );
    await postEntryViaApi(world.owner, insideId);
    expect((await getEntry(world.owner.ctx, insideId)).status).toBe("posted");

    // Positive control, run last: an endpoint that 403s everybody cannot pass.
    await closePeriodViaApi(world.owner, periodId);
    expect((await getPeriod(world.owner.ctx, periodId)).status).toBe("closed");
  });

  test("led-m3-s03 a non-member reads no period or audit data", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    const bookId = await owner.bookId();
    const periodName = ledger.name("Mar");
    const periodId = await createPeriodViaApi(owner, {
      name: periodName,
      startDate: MAR_START,
      endDate: MAR_END,
    });

    const outsider = await ledger.outsider();
    const secrets = [periodName, chart.cash.name, chart.revenue.name];

    for (const path of [
      "/api/periods",
      `/api/periods/${periodId}`,
      `/api/accounts?bookId=${bookId}`,
      `/api/audit?bookId=${bookId}`,
    ]) {
      const resp = await outsider.ctx.request.get(path, { maxRedirects: 0 });
      const text = await resp.text();
      if (!resp.ok()) {
        expect(DENIED, `${path} for a non-member`).toContain(resp.status());
      } else {
        // A 200 is only acceptable when it carries the outsider's own (empty)
        // data and none of B1's.
        const body = await resp.json().catch(() => null);
        expect(
          nonZeroCents(body),
          `${path} leaks a non-zero …Cents value`,
        ).toEqual([]);
        if (Array.isArray(body)) {
          for (const item of body as Array<Record<string, unknown>>) {
            expect(
              String(item?.code ?? ""),
              `${path} leaks B1's account code`,
            ).not.toBe("1000");
          }
        }
      }
      for (const secret of secrets) {
        expect(text, `${path} must not leak "${secret}"`).not.toContain(secret);
      }
    }

    const close = await outsider.ctx.request.post(
      `/api/periods/${periodId}/close`,
      { maxRedirects: 0 },
    );
    expect(DENIED, "a non-member's close").toContain(close.status());
    expect((await getPeriod(owner.ctx, periodId)).status).toBe("open");
    await owner.page.goto(`/periods/${periodId}`);
    await expect(owner.page.getByTestId("period-status")).toHaveText(
      /^\s*open\s*$/i,
    );
  });

  test("led-m3-s04 a posted entry cannot be rewritten or deleted", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    const draftId = await createEntryViaApi(
      owner,
      cashRevenueEntry(
        chart,
        ledger.name("Editable draft"),
        OUTSIDE_DATE,
        SMALL_DOLLARS,
      ),
    );

    const before = await getEntry(owner.ctx, postedId);
    const fingerprint = entryFingerprint(before);
    const auditBefore = await listAudit(owner.ctx);
    const countBefore = await entryCount(owner.ctx);

    const attacks: Array<{ label: string; run: () => Promise<APIResponse> }> = [
      {
        label: "PATCH {lines:[…doubled…]}",
        run: () =>
          owner.ctx.request.patch(`/api/entries/${postedId}`, {
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
            maxRedirects: 0,
          }),
      },
      {
        label: "PATCH {date:'2026-04-01'}",
        run: () =>
          owner.ctx.request.patch(`/api/entries/${postedId}`, {
            data: { date: "2026-04-01" },
            maxRedirects: 0,
          }),
      },
      {
        label: "PATCH {status:'draft'}",
        run: () =>
          owner.ctx.request.patch(`/api/entries/${postedId}`, {
            data: { status: "draft" },
            maxRedirects: 0,
          }),
      },
      {
        label: "PATCH {entryNumber:9999}",
        run: () =>
          owner.ctx.request.patch(`/api/entries/${postedId}`, {
            data: { entryNumber: 9999 },
            maxRedirects: 0,
          }),
      },
      {
        label: "PUT /api/entries/{E}",
        run: () =>
          owner.ctx.request.put(`/api/entries/${postedId}`, {
            data: { memo: ledger.name("Rewritten") },
            maxRedirects: 0,
          }),
      },
      {
        label: "DELETE /api/entries/{E}",
        run: () =>
          owner.ctx.request.delete(`/api/entries/${postedId}`, {
            maxRedirects: 0,
          }),
      },
    ];

    for (const attack of attacks) {
      const resp = await attack.run();
      expectRefused(resp, attack.label);
      expect(
        entryFingerprint(await getEntry(owner.ctx, postedId)),
        `${attack.label} changed a posted entry`,
      ).toEqual(fingerprint);
    }
    expect(await entryCount(owner.ctx)).toBe(countBefore);

    const auditAfter = await listAudit(owner.ctx);
    expect(auditAfter.length, "a refused write appends no audit row").toBe(
      auditBefore.length,
    );
    for (const row of auditAfter) {
      expect(AUDIT_ACTIONS, `audit action "${row.action}"`).toContain(
        row.action,
      );
    }

    // Positive control, run last: a handler that refuses every PATCH fails.
    const editedMemo = ledger.name("Draft edited");
    const control = await owner.ctx.request.patch(`/api/entries/${draftId}`, {
      data: { memo: editedMemo },
    });
    expect(control.ok(), `the draft PATCH → ${control.status()}`).toBe(true);
    expect((await getEntry(owner.ctx, draftId)).memo).toBe(editedMemo);
  });

  test("led-m3-s05 an entry cannot be reversed twice", async ({ ledger }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    // The legitimate reversal is the probe's positive control.
    await reverseEntryViaApi(owner, postedId);
    const original = await getEntry(owner.ctx, postedId);
    const reversalId = String(original.reversedByEntryId ?? "");
    expect(reversalId, "the legitimate reversal exists").toBeTruthy();

    // The draft deliberately touches Rent/Supplies, so Cash and Revenue stay
    // touched only by E and its reversal.
    const draftId = await createEntryViaApi(owner, {
      date: OUTSIDE_DATE,
      memo: ledger.name("Unreversible draft"),
      lines: [
        { accountId: chart.rent.id, debit: SMALL_DOLLARS },
        { accountId: chart.supplies.id, credit: SMALL_DOLLARS },
      ],
    });

    const countBefore = await entryCount(owner.ctx);
    for (const [label, target] of [
      ["a second reversal of E", postedId],
      ["reversing the reversal R", reversalId],
      ["reversing a draft D", draftId],
    ] as const) {
      const resp = await owner.ctx.request.post(
        `/api/entries/${target}/reverse`,
        { maxRedirects: 0 },
      );
      expect(resp.status(), label).toBe(409);
    }

    expect(
      await entryCount(owner.ctx),
      "the entry count grew by zero across the whole probe",
    ).toBe(countBefore);
    const entries = await listEntries(owner.ctx);
    expect(
      entries.filter((e) => String(e.reversesEntryId ?? "") === postedId),
      "exactly one entry reverses E",
    ).toHaveLength(1);

    const accounts = await listAccounts(owner.ctx);
    const byId = accountsById(accounts);
    // A second reversal would drive these to −125010 / +125010; exactly 0 is
    // the only value consistent with one posting and one reversal.
    expect(byId.get(chart.cash.id)?.balanceCents).toBe(0);
    expect(byId.get(chart.revenue.id)?.balanceCents).toBe(0);
    expect(sumBalances(accounts, "debit")).toBe(
      sumBalances(accounts, "credit"),
    );
  });

  test("led-m3-s06 a reversal mirrors the stored original, not the body", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const postedId = await createPostedEntry(owner, ledger.entryA(chart));
    const periodId = await createPeriodViaApi(owner, {
      name: ledger.name("Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });

    const outsider = await ledger.outsider();
    const otherBookId = await outsider.bookId();
    const outsiderEntriesBefore = await listEntries(outsider.ctx);

    const original = await getEntry(owner.ctx, postedId);
    const maxBefore = maxEntryNumber(await listEntries(owner.ctx));

    const resp = await owner.ctx.request.post(
      `/api/entries/${postedId}/reverse`,
      {
        data: {
          lines: [
            { accountId: chart.cash.id, debitCents: 9999999, creditCents: 0 },
          ],
          date: LOCKED_DATE,
          bookId: otherBookId,
          status: "draft",
          entryNumber: 1,
        },
      },
    );
    expect(resp.ok(), `POST …/reverse → ${resp.status()}`).toBe(true);

    const afterOriginal = await getEntry(owner.ctx, postedId);
    const reversalId = String(afterOriginal.reversedByEntryId ?? "");
    expect(reversalId).toBeTruthy();
    const reversal = await getEntry(owner.ctx, reversalId);

    expect(reversal.date, "the body's date is ignored").toBe(original.date);
    expect(reversal.status, "the body's status is ignored").toBe("posted");
    expect(Number.isInteger(reversal.entryNumber)).toBe(true);
    expect(
      reversal.entryNumber,
      "the reversal continues B1's own sequence",
    ).toBe(maxBefore + 1);

    const mirrored = linesByAccount(reversal);
    expect(mirrored.size, "the reversal mirrors every original line").toBe(
      (original.lines ?? []).length,
    );
    for (const line of original.lines ?? []) {
      const mirror = mirrored.get(String(line.accountId));
      expect(mirror, `a mirrored line for ${line.accountId}`).toBeTruthy();
      expect(mirror!.debitCents).toBe(line.creditCents);
      expect(mirror!.creditCents).toBe(line.debitCents);
    }

    expect(
      await listEntries(outsider.ctx),
      "the reversal did not land in the book named by the body",
    ).toEqual(outsiderEntriesBefore);

    const accounts = await listAccounts(owner.ctx);
    expect(sumBalances(accounts, "debit")).toBe(
      sumBalances(accounts, "credit"),
    );
    for (const account of accounts) {
      expect(account.balanceCents).not.toBe(9999999);
    }
    const period = await getPeriod(owner.ctx, periodId);
    expect(period.totalDebitCents).not.toBe(9999999);
    expect(period.totalCreditCents).not.toBe(9999999);
    for (const path of [
      "/api/entries",
      `/api/entries/${reversalId}`,
      "/api/accounts",
      `/api/periods/${periodId}`,
    ]) {
      // Matched as a FIELD VALUE, not as a substring of the raw body: these
      // payloads legitimately carry integers, so `not.toContain("9999999")`
      // could fail on an unrelated number that merely spans those digits.
      const body = await (
        await owner.ctx.request.get(path)
      )
        .json()
        .catch(() => null);
      expect(body, `${path} answers JSON`).not.toBeNull();
      expect(
        scalarValues(body),
        `${path} must not carry the injected amount`,
      ).not.toContain("9999999");
    }
  });

  test("led-m3-s07 thirty-six postings stay exact integers", async ({
    ledger,
  }) => {
    // Every step here is HTTP: 36 sequential writes plus UI-driven setup would
    // not fit the 120 s per-test budget on a slow-but-correct app.
    const owner = await ledger.owner();
    const debitId = await createAccountViaApi(owner, {
      code: "9100",
      name: ledger.name("Volume Debit"),
      type: "debit",
    });
    const creditId = await createAccountViaApi(owner, {
      code: "9200",
      name: ledger.name("Volume Credit"),
      type: "credit",
    });
    const periodId = await createPeriodViaApi(owner, {
      name: ledger.name("Volume Mar"),
      startDate: MAR_START,
      endDate: MAR_END,
    });

    // The cycle sums to 70000 cents; three cycles are 210000. Chosen because
    // summing these as float dollars lands on 210000.0000000001 in post order.
    const CYCLE = [
      98, 38, 69, 4808, 4890, 1294, 1071, 6317, 15844, 8167, 14965, 12439,
    ];
    const WRITES = 36;
    let expectedCents = 0;
    for (let i = 0; i < WRITES; i++) {
      const cents = CYCLE[i % CYCLE.length];
      const day = String((i % 31) + 1).padStart(2, "0");
      const resp = await owner.ctx.request.post("/api/entries", {
        data: {
          date: `2026-03-${day}`,
          memo: `${ledger.name("Volume")} ${String(i).padStart(2, "0")}`,
          status: "posted",
          lines: [
            { accountId: debitId, debitCents: cents, creditCents: 0 },
            { accountId: creditId, debitCents: 0, creditCents: cents },
          ],
        },
      });
      expect(resp.ok(), `volume write ${i} → ${resp.status()}`).toBe(true);
      expectedCents += cents;
    }
    expect(expectedCents, "the fixture's own arithmetic").toBe(210000);

    const accounts = await listAccounts(owner.ctx);
    const byId = accountsById(accounts);
    expect(byId.get(debitId)?.balanceCents).toBe(expectedCents);
    expect(byId.get(creditId)?.balanceCents).toBe(expectedCents);
    for (const account of accounts) {
      expect(
        Number.isInteger(account.balanceCents),
        `balanceCents of ${account.code} is an exact integer`,
      ).toBe(true);
    }

    const period = await getPeriod(owner.ctx, periodId);
    expect(period.totalDebitCents).toBe(expectedCents);
    expect(period.totalCreditCents).toBe(expectedCents);
    expect(Number.isInteger(period.totalDebitCents)).toBe(true);
    expect(Number.isInteger(period.totalCreditCents)).toBe(true);

    const entries = await listEntries(owner.ctx);
    expect(entries).toHaveLength(WRITES);
    for (const entry of entries) {
      expect(Number.isInteger(entry.totalDebitCents)).toBe(true);
      expect(Number.isInteger(entry.totalCreditCents)).toBe(true);
      expect(Number.isInteger(entry.entryNumber)).toBe(true);
    }
    expect(
      new Set(entries.map((e) => e.entryNumber)).size,
      "36 distinct entry numbers",
    ).toBe(WRITES);
  });

  test("led-m3-s08 the audit trail is append-only", async ({ ledger }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));
    const outsider = await ledger.outsider();
    const outsiderId = await outsider.userId();

    const before = await listAudit(owner.ctx);
    expect(
      before.length,
      "the trail is non-empty before the probe",
    ).toBeGreaterThan(0);
    const auditId = String(before[0].id);

    const attacks: Array<{ label: string; run: () => Promise<APIResponse> }> = [
      {
        label: "DELETE /api/audit",
        run: () => owner.ctx.request.delete("/api/audit", { maxRedirects: 0 }),
      },
      {
        label: "PATCH /api/audit",
        run: () =>
          owner.ctx.request.patch("/api/audit", {
            data: { action: "period.reopened" },
            maxRedirects: 0,
          }),
      },
      {
        label: "PUT /api/audit",
        run: () =>
          owner.ctx.request.put("/api/audit", {
            data: { action: "period.reopened" },
            maxRedirects: 0,
          }),
      },
      {
        label: "DELETE /api/audit/{auditId}",
        run: () =>
          owner.ctx.request.delete(`/api/audit/${auditId}`, {
            maxRedirects: 0,
          }),
      },
      {
        label: "PUT /api/audit/{auditId}",
        run: () =>
          owner.ctx.request.put(`/api/audit/${auditId}`, {
            data: { action: "period.reopened" },
            maxRedirects: 0,
          }),
      },
      {
        label: "PATCH /api/audit/{auditId} rewriting the actor and the action",
        run: () =>
          owner.ctx.request.patch(`/api/audit/${auditId}`, {
            data: {
              action: "period.reopened",
              actorEmail: outsider.who.email,
              actorUserId: outsiderId,
              targetId: chart.cash.id,
            },
            maxRedirects: 0,
          }),
      },
    ];

    for (const attack of attacks) {
      expectRefused(await attack.run(), attack.label);
    }

    // Content equality is the point: a handler that answers 200 and rewrites a
    // row's actor passes a count-and-id check while destroying append-only.
    const after = await listAudit(owner.ctx);
    expect(
      after,
      "GET /api/audit deep-equals the captured rows, field for field and in order",
    ).toEqual(before);
  });

  test("led-m3-s09 the audit actor is the session user, never the body", async ({
    ledger,
  }) => {
    const world = await ledger.setupBookWithClerk();
    const ownerId = await world.owner.userId();
    const clerkId = await world.clerk.userId();

    const draftId = await createEntryViaApi(
      world.clerk,
      cashRevenueEntry(
        world.chart,
        ledger.name("Clerk spoof draft"),
        "2026-05-05",
        "15.00",
      ),
    );
    const resp = await world.clerk.ctx.request.post(
      `/api/entries/${draftId}/post`,
      {
        data: {
          actorUserId: ownerId,
          actorEmail: world.owner.who.email,
          role: "owner",
        },
      },
    );
    expect(resp.ok(), `a bookkeeper may post → ${resp.status()}`).toBe(true);
    expect((await getEntry(world.clerk.ctx, draftId)).status).toBe("posted");

    const rows = (await listAudit(world.owner.ctx)).filter(
      (r) => String(r.targetId) === draftId,
    );
    expect(rows.length, "the posting was audited").toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actorEmail, "the actor is the session user").toBe(
        world.clerk.who.email,
      );
      expect(String(row.actorUserId)).toBe(clerkId);
      expect(row.actorEmail).not.toBe(world.owner.who.email);
      expect(String(row.actorUserId)).not.toBe(ownerId);
    }

    const me = await getMe(world.clerk.ctx);
    const membership = (me.memberships ?? []).find(
      (m) => String(m.bookId) === world.bookId,
    );
    expect(membership?.role, "the body did not promote the clerk").toBe(
      "bookkeeper",
    );
  });

  test("led-m3-s10 the audit trail never crosses a book boundary", async ({
    ledger,
  }) => {
    const world = await ledger.setupBookWithClerk();
    const outsider = await ledger.outsider();
    const otherBookId = await outsider.bookId();
    const tillId = await createAccountViaApi(outsider, {
      code: "1000",
      name: ledger.name("Till"),
      type: "debit",
    });
    const salesId = await createAccountViaApi(outsider, {
      code: "4000",
      name: ledger.name("Sales"),
      type: "credit",
    });
    const otherEntryId = await createPostedEntry(outsider, {
      date: ENTRY_A_DATE,
      memo: ledger.name("Outsider posting"),
      lines: [
        { accountId: tillId, debit: "33.00" },
        { accountId: salesId, credit: "33.00" },
      ],
    });

    // Positive control: each persona's own trail carries their own posting, so
    // an audit endpoint that returns [] to everybody cannot pass vacuously.
    const outsiderAudit = await listAudit(outsider.ctx);
    expect(
      outsiderAudit.some(
        (r) =>
          r.action === "entry.posted" &&
          String(r.targetId) === otherEntryId &&
          r.actorEmail === outsider.who.email,
      ),
      "the outsider's own trail carries their own entry.posted row",
    ).toBe(true);
    const clerkAudit = await listAudit(world.clerk.ctx);
    expect(
      clerkAudit.some(
        (r) =>
          r.action === "entry.posted" &&
          String(r.targetId) === world.entryAId &&
          r.actorEmail === world.owner.who.email,
      ),
      "the clerk's own trail carries B1's entry.posted row",
    ).toBe(true);

    for (const row of outsiderAudit) {
      expect(row.actorEmail, "the outsider's trail holds only B2 rows").toBe(
        outsider.who.email,
      );
    }
    for (const row of clerkAudit) {
      expect(
        [world.owner.who.email, world.clerk.who.email],
        "the clerk's trail holds only B1 rows",
      ).toContain(row.actorEmail);
    }

    // Emails carry RUN_ID and cannot collide, so they are matched against the
    // raw body. The two entry ids are matched as FIELD VALUES below instead: an
    // audit body legitimately carries its own ids and instants, so a short id
    // would be a substring of an unrelated one by coincidence.
    const b1Emails = [world.owner.who.email, world.clerk.who.email];
    const b1Ids = [world.entryAId, world.entryBId];
    for (const path of [
      "/api/audit",
      `/api/audit?bookId=${world.bookId}`,
      `/api/audit?action=entry.posted&bookId=${world.bookId}`,
    ]) {
      const resp = await outsider.ctx.request.get(path, { maxRedirects: 0 });
      if (!resp.ok()) {
        expect(DENIED, `${path} for a non-member`).toContain(resp.status());
        continue;
      }
      const text = await resp.text();
      for (const email of b1Emails) {
        expect(text, `${path} must not leak "${email}"`).not.toContain(email);
      }
      const body = (await resp.json().catch(() => null)) as AuditJson[] | null;
      expect(body, `${path} answers JSON`).not.toBeNull();
      const values = scalarValues(body);
      for (const id of b1Ids) {
        expect(values, `${path} must not leak B1's entry ${id}`).not.toContain(
          String(id),
        );
      }
    }

    const crossRead = await world.clerk.ctx.request.get(
      `/api/audit?bookId=${otherBookId}`,
      { maxRedirects: 0 },
    );
    if (!crossRead.ok()) {
      expect(DENIED, "the clerk reading B2's trail").toContain(
        crossRead.status(),
      );
    } else {
      // Same split: the email is a RUN_ID-scoped string, the entry id is
      // matched as a field value so a short id cannot collide with an
      // unrelated number in B1's own trail.
      const text = await crossRead.text();
      expect(text).not.toContain(outsider.who.email);
      const body = (await crossRead.json().catch(() => null)) as
        | AuditJson[]
        | null;
      expect(body, "the cross-book audit read answers JSON").not.toBeNull();
      expect(
        scalarValues(body),
        "the clerk's cross-book read must not leak B2's entry id",
      ).not.toContain(String(otherEntryId));
    }
  });

  test("led-m3-s11 negative and fractional amounts are refused", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    await createPostedEntry(owner, ledger.entryA(chart));

    const countBefore = await entryCount(owner.ctx);
    const balancesBefore = balanceMap(await listAccounts(owner.ctx));

    // Both shapes satisfy every M1 rule — two or more lines, exactly one amount
    // above zero per line, total debits equal total credits, total above zero —
    // so only M3's amount rule can reject them.
    const shapes = [
      {
        label: "an amount that is negative",
        memo: ledger.name("Bad negative"),
        lines: [
          { accountId: chart.cash.id, debitCents: 10000, creditCents: -5000 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 15000 },
        ],
      },
      {
        label: "an amount that is not a whole number",
        memo: ledger.name("Bad fractional"),
        lines: [
          { accountId: chart.cash.id, debitCents: 10000, creditCents: 0 },
          { accountId: chart.rent.id, debitCents: 10.5, creditCents: 0 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 10010.5 },
        ],
      },
    ];

    for (const shape of shapes) {
      const resp = await owner.ctx.request.post("/api/entries", {
        data: { date: OUTSIDE_DATE, memo: shape.memo, lines: shape.lines },
        maxRedirects: 0,
      });
      expect(resp.status(), shape.label).toBe(400);
      const body = await resp.json().catch(() => null);
      expect(
        body && typeof body === "object" && "error" in body,
        `${shape.label} answers { "error": "<message>" }`,
      ).toBe(true);
      // An app that stores the bad amount and answers 400 fails on the ledger.
      const entries = await listEntries(owner.ctx);
      expect(entries.length, `${shape.label} wrote nothing`).toBe(countBefore);
      expect(entries.map((e) => e.memo)).not.toContain(shape.memo);
      expect(
        balanceMap(await listAccounts(owner.ctx)),
        `${shape.label} moved a balance`,
      ).toEqual(balancesBefore);
    }

    // Positive control: a route that rejects every write cannot pass.
    const controlMemo = ledger.name("Control balanced");
    const control = await owner.ctx.request.post("/api/entries", {
      data: {
        date: OUTSIDE_DATE,
        memo: controlMemo,
        lines: [
          { accountId: chart.cash.id, debitCents: 10000, creditCents: 0 },
          { accountId: chart.revenue.id, debitCents: 0, creditCents: 10000 },
        ],
      },
    });
    expect(control.ok(), `the control POST → ${control.status()}`).toBe(true);
    const after = await listEntries(owner.ctx);
    expect(after.length).toBe(countBefore + 1);
    expect(after.map((e) => e.memo)).toContain(controlMemo);
  });
});
