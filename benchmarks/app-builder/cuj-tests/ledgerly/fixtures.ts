// Shared Ledgerly suite helpers (design/app-4-ledgerly.md, "Test fixtures &
// conventions"). Imported by all three checkpoint suites.
//
// Independence contract: the checkpoint suites are NOT serial. Every test
// provisions the exact world it needs through the `ledger` fixture exported
// here and asserts only its own scenario, so a failure can never skip — and
// thereby silently void — a sibling test. `Ledger` owns every browser context
// it opens and closes them in fixture teardown, so videos flush and Postgres
// connections do not leak even when a test fails mid-flight.
//
// Personas: owner / clerk / outsider. The bookkeeping persona is `clerk`, never
// `keeper`: "keeper" is a substring of the pinned role value `bookkeeper`, so a
// persona of that name would put the same string into both `member-row-email`
// and `member-row-role` of the SAME row and turn any text locator on it into a
// strict-mode violation. No persona name is a prefix or substring of another.
//
// Money and dates never cross an assertion as formatted text: integer cents
// come from the pinned `…Cents` JSON fields, calendar dates from the pinned
// `data-entry-date` / `data-period-start` / `data-period-end` attributes and
// the pinned JSON `date` / `startDate` / `endDate` strings, and instants from
// `data-audit-time` / `createdAt` parsed with `Date.parse`. DOM money is only
// ever read through `numericText`, which is formatting-insensitive.
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { videoOpts } from "../video-context";

export { expect };

// Unique per process: timestamp + random token, so repeated runs against the
// same database (and sibling suites) never collide on an identity or a record
// name. Per-test uniqueness comes from `Ledger.token` on top of this.
export const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
export const PASSWORD = "Passw0rd!Ledger1";

export type Role = "owner" | "clerk" | "outsider";
export type AccountType = "debit" | "credit";
export type EntryStatus = "draft" | "posted";
export type PeriodStatus = "open" | "closed";
export type MemberRole = "owner" | "bookkeeper";

export interface Identity {
  name: string;
  email: string;
  password: string;
}

const rand = () =>
  Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);

// Unique token for one string (identities, memos, markers) when a caller needs
// more than the per-test token. Tests share one database, so every string a
// test asserts on must be unique to the *test*, not merely to the run.
export function uniq(label?: string): string {
  const token = `${RUN_ID}-${rand()}`;
  return label ? `${label} ${token}` : token;
}

// Escape a persona-supplied string for use inside a RegExp.
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Design-pinned identity shape: ledger-${RUN_ID}-<role>-<scope>@example.com.
// The display name carries the token too, because M2 derives the personal book
// name from it (`<user name>'s Books`) and the design requires every book name
// to carry the test's token so `book-switcher-option` text locators cannot
// collide across sibling tests sharing one database.
export function identity(role: string, scope: string): Identity {
  return {
    name: `Ledger ${role[0].toUpperCase()}${role.slice(1)} ${RUN_ID}-${scope}`,
    email: `ledger-${RUN_ID}-${role}-${scope}@example.com`,
    password: PASSWORD,
  };
}

/** M2: the name of a user's auto-created personal book. */
export function personalBookName(who: Identity): string {
  return `${who.name}'s Books`;
}

// Ids are pinned as UUIDs (M1: "Ids are UUIDs, not sequential integers").
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Reference data (design "Test fixtures & conventions")
// ---------------------------------------------------------------------------

export type ChartKey = "cash" | "receivable" | "revenue" | "rent" | "supplies";

export interface ChartSpec {
  key: ChartKey;
  code: string;
  label: string;
  type: AccountType;
}

/**
 * Reference chart of accounts. Codes are fixed constants because they are
 * unique per user (M1) / per book (M2+) and every test provisions its own
 * persona; names carry the test token so text locators never collide.
 */
export const REFERENCE_CHART: readonly ChartSpec[] = [
  { key: "cash", code: "1000", label: "Cash", type: "debit" },
  { key: "receivable", code: "1200", label: "Receivable", type: "debit" },
  { key: "revenue", code: "4000", label: "Revenue", type: "credit" },
  { key: "rent", code: "6000", label: "Rent", type: "debit" },
  { key: "supplies", code: "6100", label: "Supplies", type: "debit" },
];

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export type Chart = Record<ChartKey, ChartAccount>;

export const ENTRY_A_DATE = "2026-03-05";
export const ENTRY_A_DOLLARS = "1250.10";
/** `Math.trunc(parseFloat("1250.10") * 100)` is 125009 — the truncation trap. */
export const ENTRY_A_CENTS = 125010;

export const ENTRY_B_DATE = "2026-03-12";
export const ENTRY_B_CENTS = 50010;
export const RENT_CENTS = 42000;
/** `Math.trunc(parseFloat("80.10") * 100)` is 8009 — the truncation trap. */
export const SUPPLIES_CENTS = 8010;

/**
 * M2+ balances after ENTRY_A and ENTRY_B are both posted, each positive in its
 * own normal direction (Revenue is `credit`-normal, so `125010`, not −125010).
 */
export const REFERENCE_BALANCES: Record<ChartKey, number> = {
  cash: 75000,
  receivable: 0,
  revenue: ENTRY_A_CENTS,
  rent: RENT_CENTS,
  supplies: SUPPLIES_CENTS,
};

export interface EntryLineInput {
  accountId: string;
  /** Dollars-with-two-decimals, exactly as typed into `line-debit`. */
  debit?: string;
  /** Dollars-with-two-decimals, exactly as typed into `line-credit`. */
  credit?: string;
}

export interface EntryInput {
  date: string;
  memo: string;
  lines: EntryLineInput[];
}

/** ENTRY_A: Cash debit 1250.10 / Revenue credit 1250.10, dated 2026-03-05. */
export function entryA(chart: Chart, token: string): EntryInput {
  return {
    date: ENTRY_A_DATE,
    memo: `Entry A ${token}`,
    lines: [
      { accountId: chart.cash.id, debit: ENTRY_A_DOLLARS },
      { accountId: chart.revenue.id, credit: ENTRY_A_DOLLARS },
    ],
  };
}

/** ENTRY_B: Rent 420.00 + Supplies 80.10 debit / Cash 500.10 credit, 2026-03-12. */
export function entryB(chart: Chart, token: string): EntryInput {
  return {
    date: ENTRY_B_DATE,
    memo: `Entry B ${token}`,
    lines: [
      { accountId: chart.rent.id, debit: "420.00" },
      { accountId: chart.supplies.id, debit: "80.10" },
      { accountId: chart.cash.id, credit: "500.10" },
    ],
  };
}

/**
 * Exact dollars→cents for building API request bodies. Deliberately string
 * arithmetic: the suite must never reproduce the very float defect it scores.
 */
export function dollarsToCents(dollars: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(dollars.trim());
  if (!m) throw new Error(`not a dollars-with-two-decimals amount: ${dollars}`);
  const frac = (m[3] ?? "").padEnd(2, "0");
  const cents = Number(m[2]) * 100 + Number(frac);
  return m[1] === "-" ? -cents : cents;
}

/** The `lines` payload `POST /api/entries` takes, built from an EntryInput. */
export function apiLines(
  e: EntryInput,
): Array<{ accountId: string; debitCents: number; creditCents: number }> {
  return e.lines.map((l) => ({
    accountId: l.accountId,
    debitCents: l.debit ? dollarsToCents(l.debit) : 0,
    creditCents: l.credit ? dollarsToCents(l.credit) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Pinned JSON shapes
// ---------------------------------------------------------------------------

export interface MeJson {
  id: string;
  email: string;
  name?: string;
  /** M2+ */
  activeBookId?: string | null;
  memberships?: Array<{
    bookId: string;
    bookName: string;
    membershipId: string;
    role: MemberRole;
  }>;
}

export interface AccountJson {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** M2+ */
  balanceCents?: number;
}

export interface EntryLineJson {
  id?: string;
  accountId: string;
  debitCents: number;
  creditCents: number;
}

export interface EntryJson {
  id: string;
  date: string;
  memo: string;
  totalDebitCents: number;
  totalCreditCents: number;
  lines?: EntryLineJson[];
  /** M2+ */
  status?: EntryStatus;
  entryNumber?: number | null;
  postedAt?: string | null;
  reversesEntryId?: string | null;
  reversedByEntryId?: string | null;
}

export interface BookJson {
  id: string;
  name: string;
}

export interface MemberJson {
  id: string;
  userId: string;
  email: string;
  role: MemberRole;
}

export interface PeriodJson {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  totalDebitCents: number;
  totalCreditCents: number;
}

export interface AuditJson {
  id: string;
  action: string;
  actorUserId: string;
  actorEmail: string;
  targetId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Page-level primitives
// ---------------------------------------------------------------------------

// Wait for a create/update form to actually finish submitting before navigating
// away. Clicking submit fires a client-side request and then routes; a
// `page.goto` issued immediately aborts that request in flight, so the record
// is never written (this silently broke every provisioning helper once tests
// stopped inheriting state from each other).
export async function settleAfterSubmit(page: Page, formPath = "/new") {
  await page
    .waitForURL((u) => !u.pathname.endsWith(formPath), { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

// Playwright auto-dismisses native dialogs, which would fail any app that
// implements delete confirmation with window.confirm() — a choice the specs
// permit (they pin an optional confirm control, they do not forbid the dialog).
// Accept them so the assertion tests the outcome, not the dialog strategy.
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => {
    d.accept().catch(() => {});
  });
}

export async function signUp(page: Page, who: Identity) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
}

export async function signIn(
  page: Page,
  who: { email: string; password: string },
) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
}

/**
 * Sign out through the pinned header control. `signOut()` is a background
 * fetch; navigating before it settles cancels it and the cached session cookie
 * keeps the server answering signed-in — so wait for the network first.
 */
export async function signOut(page: Page) {
  await page.getByTestId("sign-out-button").click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForURL("**/auth/sign-in", { timeout: 10_000 }).catch(() => {});
}

/**
 * Provisioning-grade session check: functional (pinned `GET /api/me`), never
 * the header. Using the header as a universal precondition once let a single
 * cosmetic defect zero an entire app; the `user-menu` contract is asserted by
 * the CUJ that owns it (`led-m1-01`) through `expectSignedIn`.
 */
export async function waitForSession(page: Page, context: BrowserContext) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect
    .poll(async () => (await context.request.get("/api/me")).status(), {
      timeout: 20_000,
      message: "session established (pinned GET /api/me)",
    })
    .toBe(200);
  // Best-effort only, and deliberately short: the pinned `/accounts` landing is
  // SCORED by led-m1-01, which re-asserts it with its own budget. Blocking
  // provisioning on it here would spend 20s per persona in every other test of
  // an app whose only defect is where it routes after sign-up.
  await page.waitForURL("**/accounts", { timeout: 5_000 }).catch(() => {});
}

/** M1 header contract: `user-menu` contains the signed-in email. */
export async function expectSignedIn(page: Page, email: string) {
  await expect(page.getByTestId("user-menu")).toContainText(email, {
    timeout: 15_000,
  });
}

// Formatting-insensitive numeric read of an element's text (e.g. "$1,250.10").
// DOM money is only ever compared through this; exact integer equality is
// reserved for the pinned `…Cents` JSON fields.
export async function numericText(locator: {
  textContent(): Promise<string | null>;
}): Promise<number> {
  const text = (await locator.textContent()) ?? "";
  const flat = text.replace(/[,\s]/g, "");
  const match = flat.match(/-?\d+(?:\.\d+)?/);
  if (!match) return NaN;
  const n = Number(match[0]);
  // The sign is not always adjacent to the digits: a negative amount renders
  // as "-$1,250.10", "$-1250.10" or "($1,250.10)".
  const at = match.index ?? 0;
  const lead = flat.slice(0, at).replace(/[^-(]/g, "");
  const negated =
    lead.endsWith("-") ||
    (lead.endsWith("(") && flat.slice(at + match[0].length).startsWith(")"));
  return negated && n > 0 ? -n : n;
}

/**
 * The path an href points at, resolved against the page it was read from, with
 * any trailing slash removed. Entity links are always compared as WHOLE paths:
 * `expect(href).toContain(id)` is satisfied by `/journal/123` when the id under
 * test is `12`, so a link to the WRONG record would pass a substring check.
 */
export function hrefPath(href: string, base: string): string {
  const path = new URL(href, base).pathname;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * A regex matching `id` only as a WHOLE token — bounded on both sides by
 * something that is not an id character. M1 pins ids as UUIDs, but an app that
 * ships sequential integers instead must not be able to satisfy an id
 * assertion by coincidence: `12` is a substring of `1299` and of `123`.
 */
export function idTokenRe(id: string): RegExp {
  return new RegExp(`(^|[^0-9A-Za-z_-])${escapeRe(id)}($|[^0-9A-Za-z_-])`);
}

/** Assert an element's text names `id` as a whole token, never as a substring. */
export async function expectNamesId(
  locator: Locator,
  id: string,
  message: string,
) {
  await expect(locator, message).toHaveText(idTokenRe(id), { timeout: 15_000 });
}

/**
 * Select an option by VALUE, polling until it exists. `line-account` option
 * values are pinned to account ids, which removes the whole flake class that
 * label formatting (`1000 Cash` vs `1000 — Cash`) would introduce; options are
 * often populated by an async fetch after the `<select>` renders, so a single
 * `selectOption` races the data.
 */
export async function selectOptionByValue(select: Locator, value: string) {
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        select.evaluate(
          (el: HTMLSelectElement, v) =>
            Array.from(el.options).some((o) => o.value === v),
          value,
        ),
      { timeout: 15_000, message: `option with value "${value}"` },
    )
    .toBe(true);
  await select.selectOption(value);
}

// ---------------------------------------------------------------------------
// Pinned JSON API reads
// ---------------------------------------------------------------------------

/** Pinned GET /api/me — id/book provenance for a persona's own identity. */
export async function getMe(context: BrowserContext): Promise<MeJson> {
  const resp = await context.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return resp.json();
}

export async function listAccounts(
  context: BrowserContext,
): Promise<AccountJson[]> {
  const resp = await context.request.get("/api/accounts");
  expect(resp.status(), "GET /api/accounts").toBe(200);
  const body = await resp.json();
  expect(Array.isArray(body), "GET /api/accounts returns an array").toBe(true);
  return body;
}

export async function listEntries(
  context: BrowserContext,
): Promise<EntryJson[]> {
  const resp = await context.request.get("/api/entries");
  expect(resp.status(), "GET /api/entries").toBe(200);
  const body = await resp.json();
  expect(Array.isArray(body), "GET /api/entries returns an array").toBe(true);
  return body;
}

export async function entryCount(context: BrowserContext): Promise<number> {
  return (await listEntries(context)).length;
}

export async function getEntry(
  context: BrowserContext,
  entryId: string,
): Promise<EntryJson> {
  const resp = await context.request.get(`/api/entries/${entryId}`);
  expect(resp.status(), `GET /api/entries/${entryId}`).toBe(200);
  return resp.json();
}

/** M2+ */
export async function listBooks(context: BrowserContext): Promise<BookJson[]> {
  const resp = await context.request.get("/api/books");
  expect(resp.status(), "GET /api/books").toBe(200);
  return resp.json();
}

/** M2+ */
export async function listMembers(
  context: BrowserContext,
  bookId: string,
): Promise<MemberJson[]> {
  const resp = await context.request.get(`/api/books/${bookId}/members`);
  expect(resp.status(), `GET /api/books/${bookId}/members`).toBe(200);
  return resp.json();
}

/** M3+ */
export async function listPeriods(
  context: BrowserContext,
): Promise<PeriodJson[]> {
  const resp = await context.request.get("/api/periods");
  expect(resp.status(), "GET /api/periods").toBe(200);
  return resp.json();
}

/** M3+ */
export async function getPeriod(
  context: BrowserContext,
  periodId: string,
): Promise<PeriodJson> {
  const resp = await context.request.get(`/api/periods/${periodId}`);
  expect(resp.status(), `GET /api/periods/${periodId}`).toBe(200);
  return resp.json();
}

/** M3+ — `action` is the pinned `?action=` filter value. */
export async function listAudit(
  context: BrowserContext,
  action?: string,
): Promise<AuditJson[]> {
  const path = action
    ? `/api/audit?action=${encodeURIComponent(action)}`
    : "/api/audit";
  const resp = await context.request.get(path);
  expect(resp.status(), `GET ${path}`).toBe(200);
  return resp.json();
}

/** Find a record id in a pinned list endpoint by matching any string value. */
export async function findIdByValue(
  context: BrowserContext,
  listPath: string,
  needle: string,
): Promise<string | null> {
  const resp = await context.request.get(listPath);
  if (!resp.ok()) return null;
  const items = (await resp.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(items)) return null;
  const hit = items.find((it) =>
    Object.values(it).some((v) => typeof v === "string" && v.includes(needle)),
  );
  return hit && hit.id != null ? String(hit.id) : null;
}

export function findEntryIdByMemo(
  context: BrowserContext,
  memo: string,
): Promise<string | null> {
  return findIdByValue(context, "/api/entries", memo);
}

export function findAccountIdByName(
  context: BrowserContext,
  name: string,
): Promise<string | null> {
  return findIdByValue(context, "/api/accounts", name);
}

/** Index a pinned account list by its `code`. */
export function accountsByCode(
  accounts: AccountJson[],
): Map<string, AccountJson> {
  return new Map(accounts.map((a) => [String(a.code), a]));
}

/** Index a pinned account list by its `id`. */
export function accountsById(
  accounts: AccountJson[],
): Map<string, AccountJson> {
  return new Map(accounts.map((a) => [String(a.id), a]));
}

/**
 * M2+: sum `balanceCents` over the accounts of one normal direction. The
 * `debit` accounts' balances must equal the `credit` accounts' — branch on
 * `type`, never compute debits − credits for every account (that would assert
 * −125010 on Revenue and fail a fully correct app).
 */
export function sumBalances(
  accounts: AccountJson[],
  type: AccountType,
): number {
  return accounts
    .filter((a) => a.type === type)
    .reduce((total, a) => total + Number(a.balanceCents ?? 0), 0);
}

/**
 * A field-for-field snapshot of an entry, for the immutability probes: a
 * status-code-only assertion passes an app that performs the write and then
 * answers 409, so every such probe re-reads and compares this.
 */
export function entryFingerprint(e: EntryJson) {
  return {
    date: e.date,
    memo: e.memo,
    totalDebitCents: e.totalDebitCents,
    totalCreditCents: e.totalCreditCents,
    status: e.status ?? null,
    entryNumber: e.entryNumber ?? null,
    lines: (e.lines ?? [])
      .map((l) => `${l.accountId}:${l.debitCents}:${l.creditCents}`)
      .sort(),
  };
}

/** Every account's `balanceCents` keyed by account id, for before/after diffs. */
export function balanceMap(accounts: AccountJson[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts) out[String(a.id)] = Number(a.balanceCents ?? 0);
  return out;
}

/** A cookie-less request context, for the unauthenticated probes. */
export async function anonRequest(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: test.info().project.use.baseURL,
  });
}

// ---------------------------------------------------------------------------
// Per-test personas
// ---------------------------------------------------------------------------

export interface Persona {
  readonly who: Identity;
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** This persona's own id, from the pinned GET /api/me (memoized). */
  userId(): Promise<string>;
  /** Fresh read of the pinned GET /api/me. */
  me(): Promise<MeJson>;
  /** M2+: the server-side active book id, read fresh (it changes). */
  bookId(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Provisioning helpers — these drive the pinned UI surfaces, exactly as the
// CUJs that own those scenarios do, so provisioning never depends on an
// unpinned route and a provisioning failure points at a real broken flow.
// The `…ViaApi` variants exist for the probes the design pins as HTTP-only.
// ---------------------------------------------------------------------------

/** Open `/accounts/new` through the pinned button and fill the form. */
export async function fillAccountForm(
  page: Page,
  a: { code: string; name: string; type: AccountType },
) {
  await page.goto("/accounts");
  await page.getByTestId("account-new-button").click();
  await expect(page.getByTestId("account-form-code")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("account-form-code").fill(a.code);
  await page.getByTestId("account-form-name").fill(a.name);
  await page.getByTestId("account-form-type").selectOption(a.type);
}

export async function createAccount(
  page: Page,
  a: { code: string; name: string; type: AccountType },
) {
  await fillAccountForm(page, a);
  await page.getByTestId("account-form-submit").click();
  await settleAfterSubmit(page);
}

/** Create an account through the pinned UI and resolve its id from GET /api/accounts. */
export async function createAccountFor(
  actor: Persona,
  a: { code: string; name: string; type: AccountType },
): Promise<string> {
  await createAccount(actor.page, a);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findAccountIdByName(actor.ctx, a.name);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for "${a.name}" from the pinned GET /api/accounts`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

export async function createAccountViaApi(
  actor: Persona,
  a: { code: string; name: string; type: AccountType },
): Promise<string> {
  const resp = await actor.ctx.request.post("/api/accounts", { data: a });
  expect(resp.ok(), `POST /api/accounts ${a.code} → ${resp.status()}`).toBe(
    true,
  );
  const body = (await resp.json()) as AccountJson;
  expect(
    body.id,
    "POST /api/accounts returns the created object's id",
  ).toBeTruthy();
  return String(body.id);
}

/**
 * Create the five reference accounts through the pinned UI and return them
 * keyed by role, with ids read from the pinned GET /api/accounts.
 */
export async function createReferenceChart(
  actor: Persona,
  token: string,
): Promise<Chart> {
  for (const spec of REFERENCE_CHART) {
    await createAccount(actor.page, {
      code: spec.code,
      name: `${spec.label} ${token}`,
      type: spec.type,
    });
  }
  let byCode = new Map<string, AccountJson>();
  await expect
    .poll(
      async () => {
        byCode = accountsByCode(await listAccounts(actor.ctx));
        return REFERENCE_CHART.every((s) => byCode.has(s.code));
      },
      {
        timeout: 20_000,
        message: "the five reference accounts in the pinned GET /api/accounts",
      },
    )
    .toBe(true);
  const chart = {} as Chart;
  for (const spec of REFERENCE_CHART) {
    const row = byCode.get(spec.code) as AccountJson;
    chart[spec.key] = {
      id: String(row.id),
      code: String(row.code),
      name: `${spec.label} ${token}`,
      type: spec.type,
    };
  }
  return chart;
}

/** Open `/journal/new` through the pinned button and fill the entry form. */
export async function fillEntryForm(page: Page, e: EntryInput) {
  await page.goto("/journal");
  await page.getByTestId("entry-new-button").click();
  await expect(page.getByTestId("entry-form-date")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("entry-form-date").fill(e.date);
  await page.getByTestId("entry-form-memo").fill(e.memo);
  for (let i = 0; i < e.lines.length; i++) {
    const line = e.lines[i];
    const row = page.getByTestId("entry-line-row").nth(i);
    await selectOptionByValue(row.getByTestId("line-account"), line.accountId);
    if (line.debit !== undefined) {
      await row.getByTestId("line-debit").fill(line.debit);
    }
    if (line.credit !== undefined) {
      await row.getByTestId("line-credit").fill(line.credit);
    }
  }
}

export async function createEntry(page: Page, e: EntryInput) {
  await fillEntryForm(page, e);
  await page.getByTestId("entry-submit").click();
  await settleAfterSubmit(page);
}

/** Create an entry through the pinned UI and resolve its id from GET /api/entries. */
export async function createEntryFor(
  actor: Persona,
  e: EntryInput,
): Promise<string> {
  await createEntry(actor.page, e);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findEntryIdByMemo(actor.ctx, e.memo);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for "${e.memo}" from the pinned GET /api/entries`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** The JSON body `POST /api/entries` takes, built from an EntryInput. */
export function entryBody(
  e: EntryInput,
  status?: EntryStatus,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    date: e.date,
    memo: e.memo,
    lines: apiLines(e),
  };
  if (status) body.status = status;
  return body;
}

export async function createEntryViaApi(
  actor: Persona,
  e: EntryInput,
  status?: EntryStatus,
): Promise<string> {
  const resp = await actor.ctx.request.post("/api/entries", {
    data: entryBody(e, status),
  });
  expect(resp.ok(), `POST /api/entries "${e.memo}" → ${resp.status()}`).toBe(
    true,
  );
  const body = (await resp.json()) as EntryJson;
  expect(
    body.id,
    "POST /api/entries returns the created object's id",
  ).toBeTruthy();
  return String(body.id);
}

// --- M2: books, members, posting, reversal -------------------------------

/** M2: post a draft through the pinned detail-page control. */
export async function postEntry(actor: Persona, entryId: string) {
  await actor.page.goto(`/journal/${entryId}`);
  await actor.page.getByTestId("entry-post-button").click();
  await expect(actor.page.getByTestId("entry-detail-status")).toHaveText(
    /posted/i,
    { timeout: 15_000 },
  );
}

export async function postEntryViaApi(actor: Persona, entryId: string) {
  const resp = await actor.ctx.request.post(`/api/entries/${entryId}/post`);
  expect(
    resp.ok(),
    `POST /api/entries/${entryId}/post → ${resp.status()}`,
  ).toBe(true);
  return resp;
}

/** M2: reverse a posted entry through the pinned detail-page control. */
export async function reverseEntry(actor: Persona, entryId: string) {
  await actor.page.goto(`/journal/${entryId}`);
  await actor.page.getByTestId("entry-reverse-button").click();
  await actor.page.waitForLoadState("networkidle").catch(() => {});
  await expect
    .poll(
      async () =>
        (await getEntry(actor.ctx, entryId)).reversedByEntryId ?? null,
      {
        timeout: 15_000,
        message: `reversedByEntryId set on ${entryId} after reversing`,
      },
    )
    .toBeTruthy();
}

export async function reverseEntryViaApi(actor: Persona, entryId: string) {
  const resp = await actor.ctx.request.post(`/api/entries/${entryId}/reverse`);
  expect(
    resp.ok(),
    `POST /api/entries/${entryId}/reverse → ${resp.status()}`,
  ).toBe(true);
  return resp;
}

/** Create an entry through the API and post it, returning its id. */
export async function createPostedEntry(
  actor: Persona,
  e: EntryInput,
): Promise<string> {
  const id = await createEntryViaApi(actor, e);
  await postEntryViaApi(actor, id);
  return id;
}

/** M2: the pinned server-side activation endpoint. */
export async function activateBook(actor: Persona, bookId: string) {
  const resp = await actor.ctx.request.post(`/api/books/${bookId}/activate`);
  expect(
    resp.ok(),
    `POST /api/books/${bookId}/activate → ${resp.status()}`,
  ).toBe(true);
  return resp;
}

/**
 * M2: switch the active book through the pinned header switcher, then confirm
 * server-side (the active book is stored per user and must survive reloads).
 * The prompt pins `book-switcher` / `book-switcher-option` without pinning the
 * element kind, so handle both a `<select>` and a menu of clickable options.
 */
export async function switchBook(actor: Persona, bookName: string) {
  // Membership is granted by a DIFFERENT browser context (the owner's), so this
  // persona's page — usually last rendered at sign-up — has never seen the new
  // book and will never refetch on its own. Without this reload the switcher
  // times out looking for an option that exists server-side but not in this
  // DOM, which reads as an app defect when the app is entirely correct.
  await actor.page.reload();
  await actor.page.waitForLoadState("networkidle").catch(() => {});
  const switcher = actor.page.getByTestId("book-switcher").first();
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await switcher.selectOption({ label: bookName });
  } else {
    await switcher.click();
    await actor.page
      .getByTestId("book-switcher-option")
      .filter({ hasText: bookName })
      .first()
      .click();
  }
  await actor.page.waitForLoadState("networkidle").catch(() => {});
  await expect
    .poll(
      async () => {
        const me = await getMe(actor.ctx);
        const hit = (me.memberships ?? []).find((m) => m.bookName === bookName);
        return Boolean(hit && String(me.activeBookId) === String(hit.bookId));
      },
      { timeout: 15_000, message: `active book switched to "${bookName}"` },
    )
    .toBe(true);
}

/** M2: an owner adds an existing user to a book through the pinned form. */
export async function addMember(
  owner: Persona,
  bookId: string,
  email: string,
  role: MemberRole = "bookkeeper",
) {
  await owner.page.goto(`/books/${bookId}/members`);
  await owner.page.getByTestId("member-add-email").fill(email);
  const roleSelect = owner.page.getByTestId("member-add-role");
  if (await roleSelect.count()) {
    await roleSelect.first().selectOption(role);
  }
  await owner.page.getByTestId("member-add-submit").click();
  await expect
    .poll(
      async () =>
        (await listMembers(owner.ctx, bookId)).some(
          (m) => m.email === email && m.role === role,
        ),
      { timeout: 15_000, message: `${email} is a ${role} of ${bookId}` },
    )
    .toBe(true);
}

/** Locate a member row by the pinned `data-user-id`. */
export function memberRow(page: Page, userId: string): Locator {
  return page
    .getByTestId("member-row")
    .filter({ has: page.locator(`[data-user-id="${userId}"]`) })
    .or(page.locator(`[data-testid="member-row"][data-user-id="${userId}"]`))
    .first();
}

// --- M3: periods and audit ------------------------------------------------

export interface PeriodInput {
  name: string;
  startDate: string;
  endDate: string;
}

/** M3: create a period through the pinned `/periods` form; returns its id. */
export async function createPeriod(
  actor: Persona,
  p: PeriodInput,
): Promise<string> {
  await actor.page.goto("/periods");
  await actor.page.getByTestId("period-new-name").fill(p.name);
  await actor.page.getByTestId("period-new-start").fill(p.startDate);
  await actor.page.getByTestId("period-new-end").fill(p.endDate);
  await actor.page.getByTestId("period-new-submit").click();
  await actor.page.waitForLoadState("networkidle").catch(() => {});
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findIdByValue(actor.ctx, "/api/periods", p.name);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for period "${p.name}" from the pinned GET /api/periods`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

export async function createPeriodViaApi(
  actor: Persona,
  p: PeriodInput,
): Promise<string> {
  const resp = await actor.ctx.request.post("/api/periods", { data: p });
  expect(resp.ok(), `POST /api/periods "${p.name}" → ${resp.status()}`).toBe(
    true,
  );
  const body = (await resp.json()) as PeriodJson;
  expect(
    body.id,
    "POST /api/periods returns the created object's id",
  ).toBeTruthy();
  return String(body.id);
}

/** M3: close a period through the pinned detail-page control. */
export async function closePeriod(actor: Persona, periodId: string) {
  await actor.page.goto(`/periods/${periodId}`);
  await actor.page.getByTestId("period-close-button").click();
  await expect(actor.page.getByTestId("period-status")).toHaveText(/closed/i, {
    timeout: 15_000,
  });
}

/** M3: reopen a period through the pinned detail-page control. */
export async function reopenPeriod(actor: Persona, periodId: string) {
  await actor.page.goto(`/periods/${periodId}`);
  await actor.page.getByTestId("period-reopen-button").click();
  await expect(actor.page.getByTestId("period-status")).toHaveText(/open/i, {
    timeout: 15_000,
  });
}

export async function closePeriodViaApi(actor: Persona, periodId: string) {
  const resp = await actor.ctx.request.post(`/api/periods/${periodId}/close`);
  expect(
    resp.ok(),
    `POST /api/periods/${periodId}/close → ${resp.status()}`,
  ).toBe(true);
  return resp;
}

export async function reopenPeriodViaApi(actor: Persona, periodId: string) {
  const resp = await actor.ctx.request.post(`/api/periods/${periodId}/reopen`);
  expect(
    resp.ok(),
    `POST /api/periods/${periodId}/reopen → ${resp.status()}`,
  ).toBe(true);
  return resp;
}

// ---------------------------------------------------------------------------
// The `ledger` fixture: per-test personas and disposable browser contexts.
// ---------------------------------------------------------------------------

/** The world `setupBookWithClerk()` front-loads for the M3 CUJs. */
export interface BookWorld {
  owner: Persona;
  clerk: Persona;
  bookId: string;
  bookName: string;
  chart: Chart;
  entryAId: string;
  entryBId: string;
}

export class Ledger {
  private readonly contexts: BrowserContext[] = [];
  private readonly used = new Map<string, number>();

  constructor(
    private readonly browser: Browser,
    /** Unique per test (file + test id), e.g. `c1-led-m1-04`. */
    readonly scope: string,
  ) {}

  /** The token every account name, memo, book name and period name carries. */
  get token(): string {
    return `${RUN_ID}-${this.scope}`;
  }

  /** A name unique to this test, e.g. `Mar 1754…-c3-led-m3-01`. */
  name(label: string): string {
    return `${label} ${this.token}`;
  }

  /**
   * A per-test identity. Requesting the same role twice in one test yields
   * `owner`/`owner2`, which cannot collide as a substring either: the role sits
   * between hyphens in the email local part.
   */
  identity(role: Role): Identity {
    const n = (this.used.get(role) ?? 0) + 1;
    this.used.set(role, n);
    return identity(n === 1 ? role : `${role}${n}`, this.scope);
  }

  /** A tracked, video-recorded (when CUJ_VIDEO_DIR is set) browser context. */
  async context(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(videoOpts());
    this.contexts.push(ctx);
    return ctx;
  }

  /** A page in a fresh, never-signed-in context (the unauthenticated CUJs). */
  async signedOutPage(): Promise<Page> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    return page;
  }

  /** Sign a brand-new persona up and wait for its session to be live. */
  async persona(role: Role): Promise<Persona> {
    const who = this.identity(role);
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    await signUp(page, who);
    await waitForSession(page, ctx);
    let id: string | null = null;
    return {
      who,
      ctx,
      page,
      async userId() {
        if (id === null) id = String((await getMe(ctx)).id ?? "");
        return id;
      },
      me() {
        return getMe(ctx);
      },
      async bookId() {
        const me = await getMe(ctx);
        expect(
          me.activeBookId,
          "activeBookId from the pinned GET /api/me",
        ).toBeTruthy();
        return String(me.activeBookId);
      },
    };
  }

  owner(): Promise<Persona> {
    return this.persona("owner");
  }

  /** The bookkeeping persona (M2 role `bookkeeper`). Never named `keeper`. */
  clerk(): Promise<Persona> {
    return this.persona("clerk");
  }

  /** A signed-in user with no membership of anyone else's book. */
  outsider(): Promise<Persona> {
    return this.persona("outsider");
  }

  /** The five reference accounts, named with this test's token. */
  referenceChart(actor: Persona): Promise<Chart> {
    return createReferenceChart(actor, this.token);
  }

  entryA(chart: Chart): EntryInput {
    return entryA(chart, this.token);
  }

  entryB(chart: Chart): EntryInput {
    return entryB(chart, this.token);
  }

  /**
   * M3's shared world: an owner with the reference chart, `clerk` added as a
   * `bookkeeper` and switched into the owner's book, and ENTRY_A / ENTRY_B
   * posted. Entries are written and posted through the pinned API so the M3
   * CUJs spend their budget on the scenario rather than on setup.
   */
  async setupBookWithClerk(): Promise<BookWorld> {
    const owner = await this.owner();
    const bookId = await owner.bookId();
    const bookName = personalBookName(owner.who);
    const chart = await this.referenceChart(owner);
    const clerk = await this.clerk();
    await addMember(owner, bookId, clerk.who.email, "bookkeeper");
    await switchBook(clerk, bookName);
    const entryAId = await createPostedEntry(owner, this.entryA(chart));
    const entryBId = await createPostedEntry(owner, this.entryB(chart));
    return { owner, clerk, bookId, bookName, chart, entryAId, entryBId };
  }

  async close(): Promise<void> {
    for (const ctx of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts.length = 0;
  }
}

function scopeFor(testInfo: TestInfo): string {
  const file = (testInfo.file.split(/[\\/]/).pop() ?? "spec")
    .replace(/\.spec\.ts$/, "")
    .replace(/^checkpoint-/, "c");
  const id = (testInfo.title.split(/\s+/)[0] ?? "test").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );
  return `${file}-${id}`;
}

/**
 * `ledger` provisions every persona/record a test needs and disposes of the
 * contexts afterwards — the reason no test has to inherit another's state.
 */
export const test = base.extend<{ ledger: Ledger }>({
  ledger: async ({ browser }, use, testInfo) => {
    const ledger = new Ledger(browser, scopeFor(testInfo));
    await use(ledger);
    await ledger.close();
  },
});
