// Ledgerly — checkpoint 1 CUJ suite (design/app-4-ledgerly.md, M1 CUJ table +
// M1 security probes). 9 CUJs + 3 probes.
//
// Conventions (design "Test fixtures & conventions"): the suite is NOT serial.
// Every test provisions its own personas, chart and entries through the
// `ledger` fixture — nothing is inherited from a sibling test, so a failure can
// never skip (and thereby silently void) another scenario. Raw-HTTP probes go
// through `context.request` (real persona cookies) or a cookie-less
// `anonRequest()`; ids come only from pinned surfaces (GET /api/me,
// GET /api/accounts, GET /api/entries); every account name and memo carries
// this test's token. Money is asserted as integer cents against the pinned
// `…Cents` fields and read from the DOM only through `numericText`; the entry
// date is compared byte for byte against the pinned `data-entry-date`
// attribute and the pinned JSON `date`, never parsed out of rendered text.
import {
  test,
  expect,
  anonRequest,
  accountsByCode,
  createAccountFor,
  createEntryFor,
  entryCount,
  entryFingerprint,
  expectSignedIn,
  fillAccountForm,
  fillEntryForm,
  getEntry,
  getMe,
  listAccounts,
  listEntries,
  numericText,
  settleAfterSubmit,
  signIn,
  signOut,
  waitForSession,
  ENTRY_A_CENTS,
  ENTRY_A_DATE,
  ENTRY_A_DOLLARS,
  ENTRY_B_CENTS,
  ENTRY_B_DATE,
  REFERENCE_CHART,
  RENT_CENTS,
  SUPPLIES_CENTS,
  UUID_RE,
} from "./fixtures";

// An unauthenticated GET of a JSON endpoint must deny; a redirect to the
// sign-in page carrying no data is equally acceptable (design S1).
const DENIED_OR_REDIRECT = [401, 403, 301, 302, 303, 307, 308];

test.describe("ledgerly checkpoint 1", () => {
  test("led-m1-01 sign-up lands on /accounts with a live session", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    await expect(owner.page).toHaveURL(/\/accounts\/?$/, { timeout: 15_000 });
    await expectSignedIn(owner.page, owner.who.email);
    const me = await getMe(owner.ctx);
    expect(me.email).toBe(owner.who.email);
    expect(typeof me.id, "GET /api/me id is a string").toBe("string");
    expect(String(me.id).length).toBeGreaterThan(0);
  });

  test("led-m1-02 sign out and sign back in", async ({ ledger }) => {
    const owner = await ledger.owner();
    await signOut(owner.page);
    // M1 pins `/` → /auth/sign-in when signed out: the step's landing check.
    await owner.page.goto("/");
    await owner.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });

    await signIn(owner.page, owner.who);
    await waitForSession(owner.page, owner.ctx);
    const me = await getMe(owner.ctx);
    expect(me.email).toBe(owner.who.email);
    await owner.page.goto("/accounts");
    await expect(owner.page).toHaveURL(/\/accounts\/?$/);
    await expect(owner.page.getByTestId("accounts-empty")).toBeVisible();
  });

  test("led-m1-03 signed-out routes redirect and leak nothing", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const cashName = `Cash ${ledger.token}`;
    const revenueName = `Revenue ${ledger.token}`;
    const cashId = await createAccountFor(owner, {
      code: "1000",
      name: cashName,
      type: "debit",
    });
    const revenueId = await createAccountFor(owner, {
      code: "4000",
      name: revenueName,
      type: "credit",
    });
    const memo = ledger.name("Entry A");
    await createEntryFor(owner, {
      date: ENTRY_A_DATE,
      memo,
      lines: [
        { accountId: cashId, debit: ENTRY_A_DOLLARS },
        { accountId: revenueId, credit: ENTRY_A_DOLLARS },
      ],
    });

    // Positive control: the owner's own pages DO show both, so the leak
    // assertions below cannot pass merely because nothing existed to leak.
    await owner.page.goto("/accounts");
    await expect(
      owner.page.getByTestId("account-row").filter({ hasText: cashName }),
    ).toHaveCount(1);
    await expect(
      owner.page.getByTestId("account-row").filter({ hasText: revenueName }),
    ).toHaveCount(1);
    await owner.page.goto("/journal");
    await expect(
      owner.page.getByTestId("entry-row").filter({ hasText: memo }),
    ).toHaveCount(1);

    const anon = await ledger.signedOutPage();
    for (const path of ["/", "/accounts", "/journal", "/journal/new"]) {
      await anon.goto(path);
      await anon.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      const html = await anon.content();
      expect(html, `${path} must not leak "${cashName}"`).not.toContain(
        cashName,
      );
      expect(html, `${path} must not leak "${revenueName}"`).not.toContain(
        revenueName,
      );
      expect(html, `${path} must not leak the memo`).not.toContain(memo);
    }
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

    // M1 pins "seed nothing", so the count is exact.
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

  test("led-m1-05 a duplicate account code is refused", async ({ ledger }) => {
    const owner = await ledger.owner();
    // The five reference creates are the positive control: they all succeed.
    await ledger.referenceChart(owner);
    const before = await listAccounts(owner.ctx);
    expect(before).toHaveLength(REFERENCE_CHART.length);

    // Deliberately NOT "Petty Cash …": no record name may contain another's,
    // and "Cash ${token}" is a substring of "Petty Cash ${token}".
    const duplicateName = ledger.name("Duplicate Code");
    await fillAccountForm(owner.page, {
      code: "1000",
      name: duplicateName,
      type: "credit",
    });
    await owner.page.getByTestId("account-form-submit").click();
    // M1 pins no error element for a duplicate code, so the verdict is the
    // ledger, not a message: wait for the request to settle, then re-read.
    await owner.page.waitForLoadState("networkidle").catch(() => {});

    const after = await listAccounts(owner.ctx);
    expect(after, "nothing was created").toHaveLength(REFERENCE_CHART.length);
    expect(after.map((a) => String(a.id)).sort()).toEqual(
      before.map((a) => String(a.id)).sort(),
    );

    await owner.page.goto("/accounts");
    const codeCells = (
      await owner.page.getByTestId("account-row-code").allTextContents()
    ).map((t) => t.trim());
    expect(codeCells.filter((c) => c === "1000")).toHaveLength(1);
    await expect(
      owner.page.getByTestId("account-row").filter({ hasText: duplicateName }),
    ).toHaveCount(0);
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

  test("led-m1-07 an unbalanced entry is refused, then corrected", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const before = await entryCount(owner.ctx);
    const memo = ledger.name("Unbalanced then fixed");

    await fillEntryForm(owner.page, {
      date: ENTRY_A_DATE,
      memo,
      lines: [
        { accountId: chart.cash.id, debit: "1000.00" },
        { accountId: chart.revenue.id, credit: "900.00" },
      ],
    });
    // M1 forbids disabling the submit control.
    await expect(owner.page.getByTestId("entry-submit")).toBeEnabled();
    await owner.page.getByTestId("entry-submit").click();
    await expect(owner.page.getByTestId("entry-error")).toBeVisible({
      timeout: 15_000,
    });
    await owner.page.waitForLoadState("networkidle").catch(() => {});
    expect(
      await entryCount(owner.ctx),
      "an unbalanced submit writes nothing",
    ).toBe(before);

    // Correcting the credit is the positive control that distinguishes "the
    // balance rule fired" from "creating entries is broken".
    await owner.page
      .getByTestId("entry-line-row")
      .nth(1)
      .getByTestId("line-credit")
      .fill("1000.00");
    await expect(owner.page.getByTestId("entry-submit")).toBeEnabled();
    await owner.page.getByTestId("entry-submit").click();
    await settleAfterSubmit(owner.page);

    await owner.page.goto("/journal");
    await expect(
      owner.page.getByTestId("entry-row").filter({ hasText: memo }),
    ).toHaveCount(1);
    expect(await entryCount(owner.ctx)).toBe(before + 1);
  });

  test("led-m1-08 a three-line entry keeps every line exact", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryB(chart);
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

  test("led-m1-11 a second user starts empty and sees nothing of the first", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryA(chart);
    await createEntryFor(owner, entry);

    // Positive control: the owner's own pages show all five accounts and the
    // entry, so the outsider's empty pages below are a real isolation result.
    await owner.page.goto("/accounts");
    await expect(
      owner.page.getByTestId("account-row").filter({ hasText: ledger.token }),
    ).toHaveCount(REFERENCE_CHART.length);
    await owner.page.goto("/journal");
    await expect(
      owner.page.getByTestId("entry-row").filter({ hasText: entry.memo }),
    ).toHaveCount(1);

    const outsider = await ledger.outsider();
    await outsider.page.goto("/accounts");
    await expect(outsider.page.getByTestId("accounts-empty")).toBeVisible();
    await expect(outsider.page.getByTestId("account-row")).toHaveCount(0);
    let html = await outsider.page.content();
    for (const spec of REFERENCE_CHART) {
      expect(html).not.toContain(`${spec.label} ${ledger.token}`);
    }

    await outsider.page.goto("/journal");
    await expect(outsider.page.getByTestId("journal-empty")).toBeVisible();
    await expect(outsider.page.getByTestId("entry-row")).toHaveCount(0);
    html = await outsider.page.content();
    expect(html).not.toContain(entry.memo);

    const me = await getMe(outsider.ctx);
    expect(me.email).toBe(outsider.who.email);
    expect(await listAccounts(outsider.ctx)).toEqual([]);
    expect(await listEntries(outsider.ctx)).toEqual([]);
  });

  // ---- security probes ----

  test("led-m1-s01 unauthenticated reads are denied and leak nothing", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryA(chart);
    const entryId = await createEntryFor(owner, entry);

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
        "/api/accounts",
        "/api/entries",
        `/api/entries/${entryId}`,
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

  test("led-m1-s02 another signed-in user cannot read the owner's records", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const entry = ledger.entryA(chart);
    const entryId = await createEntryFor(owner, entry);
    // Captured before the attack so the positive control can prove the owner's
    // own record survived it unchanged.
    const before = entryFingerprint(await getEntry(owner.ctx, entryId));

    const outsider = await ledger.outsider();
    const resp = await outsider.ctx.request.get(`/api/entries/${entryId}`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(resp.status());
    const text = await resp.text();
    expect(text).not.toContain(entry.memo);
    expect(text).not.toContain(chart.cash.name);
    expect(text).not.toContain(chart.revenue.name);
    expect(await listEntries(outsider.ctx)).toEqual([]);
    expect(await listAccounts(outsider.ctx)).toEqual([]);

    // Positive control: a blanket 404 for everyone cannot pass.
    const ownerRead = await owner.ctx.request.get(`/api/entries/${entryId}`);
    expect(ownerRead.status()).toBe(200);
    expect(entryFingerprint(await ownerRead.json())).toEqual(before);
  });

  test("led-m1-s03 malformed entries are refused by the API and write nothing", async ({
    ledger,
  }) => {
    const owner = await ledger.owner();
    const chart = await ledger.referenceChart(owner);
    const n = await entryCount(owner.ctx);

    const shapes = [
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
    ];

    for (const shape of shapes) {
      const resp = await owner.ctx.request.post("/api/entries", {
        data: { date: ENTRY_A_DATE, memo: shape.memo, lines: shape.lines },
        maxRedirects: 0,
      });
      expect(resp.status(), shape.label).toBe(400);
      const body = await resp.json().catch(() => null);
      expect(
        body && typeof body === "object" && "error" in body,
        `${shape.label} answers { "error": "<message>" }`,
      ).toBe(true);
      // A 400 is necessary but never sufficient: prove the ledger is untouched.
      const entries = await listEntries(owner.ctx);
      expect(entries.length, `${shape.label} wrote nothing`).toBe(n);
      expect(entries.map((e) => e.memo)).not.toContain(shape.memo);
    }

    // Positive control: a route that rejects every write cannot pass.
    const controlMemo = ledger.name("Control balanced");
    const control = await owner.ctx.request.post("/api/entries", {
      data: {
        date: ENTRY_A_DATE,
        memo: controlMemo,
        lines: [
          {
            accountId: chart.cash.id,
            debitCents: ENTRY_A_CENTS,
            creditCents: 0,
          },
          {
            accountId: chart.revenue.id,
            debitCents: 0,
            creditCents: ENTRY_A_CENTS,
          },
        ],
      },
    });
    expect(
      control.status(),
      "the well-formed control POST",
    ).toBeGreaterThanOrEqual(200);
    expect(control.status()).toBeLessThan(300);
    const afterControl = await listEntries(owner.ctx);
    expect(afterControl.length).toBe(n + 1);
    expect(afterControl.map((e) => e.memo)).toContain(controlMemo);
  });
});
