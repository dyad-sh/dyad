// Shared Curbside suite helpers (design/app-6-curbside.md, "Test fixtures &
// conventions"). Imported by all three checkpoint suites.
//
// Independence contract: the checkpoint suites are NOT serial. Every scenario
// provisions the exact world it needs through the `curb` fixture exported here
// — its own personas, restaurant, menu items and orders — and asserts only its
// own records, so a failure can never skip (and thereby silently void) a
// sibling scenario. `Curb` owns every browser context and every raw API context
// it opens and disposes of them in fixture teardown, so videos flush and
// Postgres connections do not leak even when a test fails mid-flight.
//
// Scenario scoping: identities, restaurant names and dish names all carry the
// RUN_ID *and* the scenario id (the first token of the test title, e.g.
// `curb-m2-05`). That is what makes a per-restaurant aggregate such as
// `restaurant-average-rating` stable, and what keeps a sibling's identically
// priced `Margherita` from satisfying — or tripping — a "body contains no X"
// assertion.
//
// Ids come only from pinned surfaces: the acting persona's own `GET /api/me`,
// the `id` fields of the pinned list endpoints (`/api/restaurants`,
// `/api/restaurants/[id]`, `/api/orders`, `/api/merchant/orders`,
// `/api/courier/deliveries/available`, `/api/courier/deliveries`) and the
// pinned `data-restaurant-id` / `data-menu-item-id` / `data-order-id`
// attributes. Nothing is ever scraped from a URL or guessed.
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { videoOpts } from "../video-context";

export { expect };

// Unique per process (each `npx playwright test curbside/checkpoint-N` run gets
// its own), so the three checkpoints — which score against one database with no
// reset between milestones — never collide on an identity or a record name, and
// rows the model created while building are harmless.
const MODEL_SLUG = (process.env.MODEL_SLUG || process.env.CUJ_MODEL || "local")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
export const RUN_ID = `${Date.now()}-${MODEL_SLUG || "local"}`;
export const PASSWORD = "Passw0rd!Curb1";

export type Role =
  | "customer"
  | "customer2"
  | "merchant"
  | "merchant2"
  | "courier"
  | "courier2"
  | "outsider";

export type Status =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "picked_up"
  | "delivered"
  | "cancelled";

/** Statuses a merchant drives from their own queue (M2). */
export type MerchantStatus = "accepted" | "preparing" | "ready";
/** Statuses the claiming courier drives from their deliveries list (M2). */
export type CourierStatus = "picked_up" | "delivered";

export type Dish = "margherita" | "soda" | "wings";
export type RestaurantKind = "pizza" | "noodles";

export const ALL_DISHES: Dish[] = ["margherita", "soda", "wings"];

// Pinned menu prices — every money assertion in the design is derived from
// these. The canonical cart (1× Margherita + 2× Soda = 1797) is the only
// fixture that discriminates half-up rounding from truncation (8.5% of 1797 is
// exactly 152.745), so it must not be "simplified".
export const PRICE_CENTS: Record<Dish, number> = {
  margherita: 1299,
  soda: 249,
  wings: 899,
};

export const CANONICAL_SUBTOTAL_CENTS = 1797;
export const CANONICAL_TAX_CENTS = 153; // half-up of 152.745; truncation gives 152
export const WINGS3_SUBTOTAL_CENTS = 2697;
export const WINGS3_TAX_CENTS = 229; // half-up of 229.245
export const DELIVERY_FEE_CENTS = 299;

export interface Identity {
  name: string;
  email: string;
  password: string;
}

export interface Me {
  id: string;
  email: string;
  name?: string;
  isMerchant?: boolean;
  isCourier?: boolean;
  restaurantIds?: string[];
}

export interface CartLine {
  menuItemId: string;
  quantity: number;
}

const rand = () =>
  Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);

/** A token unique to this run (and, with a label, readable in failure output). */
export function uniq(label?: string): string {
  const token = `${RUN_ID}-${rand()}`;
  return label ? `${label} ${token}` : token;
}

/** Escape a fixture-supplied string for use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const titleCase = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/**
 * Design-pinned identity shape: `curb-${RUN_ID}-<scenarioId>-<role>@example.com`
 * with display name `Curb <Role> <scenarioId>`. The scenario suffix is what
 * makes a full-name assertion (`Curb Courier curb-m2-05`) unambiguous, and what
 * keeps no display name from being a substring of another across the
 * customer/customer2, merchant/merchant2 and courier/courier2 pairs.
 */
export function identity(role: Role, scenarioId: string): Identity {
  return {
    name: `Curb ${titleCase(role)} ${scenarioId}`,
    email: `curb-${RUN_ID}-${scenarioId}-${role}@example.com`,
    password: PASSWORD,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Playwright auto-dismisses native dialogs, which would fail any app that
// implements a confirm step with window.confirm() — a choice the specs permit
// (they pin no confirm control, they do not forbid the dialog). Accept them so
// assertions test the outcome, not the dialog strategy.
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

/** Sign out through the pinned header control. */
export async function signOut(page: Page) {
  await page.getByTestId("sign-out-button").click();
  // signOut() is a background fetch; navigating before it settles cancels it
  // and the cached session cookie keeps the server answering signed-in.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForURL("**/auth/sign-in", { timeout: 10_000 }).catch(() => {});
}

/** The pinned header contract: `user-menu` carries the signed-in email. */
export async function expectSignedIn(page: Page, email: string) {
  await expect(page.getByTestId("user-menu")).toContainText(email, {
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Pinned API reads
// ---------------------------------------------------------------------------

/** Tolerant list unwrap: a pinned array, or the array-valued fields of a wrapper. */
function toRows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === "object") {
    return Object.values(body as Record<string, unknown>).flatMap((v) =>
      Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [],
    );
  }
  return [];
}

/** Non-asserting GET of a pinned list endpoint; `[]` when the caller is refused. */
export async function readList(
  ctx: BrowserContext,
  path: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await ctx.request.get(path);
  if (!resp.ok()) return [];
  return toRows(await resp.json().catch(() => null));
}

/** The row of a pinned list whose `id` equals `id` (null when absent). */
export function findById(
  rows: Array<Record<string, unknown>>,
  id: string,
): Record<string, unknown> | null {
  return rows.find((r) => String(r.id) === String(id)) ?? null;
}

/** Pinned `GET /api/me` — the only provenance for a persona's own user id. */
export async function getMe(ctx: BrowserContext): Promise<Me> {
  const resp = await ctx.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return (await resp.json()) as Me;
}

/** Non-asserting variant, for polling a session/actor-type change. */
export async function readMe(ctx: BrowserContext): Promise<Me | null> {
  const resp = await ctx.request.get("/api/me");
  if (!resp.ok()) return null;
  return (await resp.json().catch(() => null)) as Me | null;
}

/** Customer's own orders, newest first (pinned `GET /api/orders`). */
export function listOrders(ctx: BrowserContext) {
  return readList(ctx, "/api/orders");
}

export async function orderIds(ctx: BrowserContext): Promise<string[]> {
  return (await listOrders(ctx)).map((o) => String(o.id));
}

/** Customer's own `GET /api/orders/[id]`; null unless the read is allowed. */
export async function readOrder(
  ctx: BrowserContext,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  const resp = await ctx.request.get(`/api/orders/${orderId}`);
  if (!resp.ok()) return null;
  return (await resp.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

/** Merchant's own queue (pinned `GET /api/merchant/orders`). */
export function listMerchantOrders(ctx: BrowserContext) {
  return readList(ctx, "/api/merchant/orders");
}

/** Courier's unclaimed pool (pinned `GET /api/courier/deliveries/available`). */
export function listAvailableDeliveries(ctx: BrowserContext) {
  return readList(ctx, "/api/courier/deliveries/available");
}

/** Courier's own claimed deliveries (pinned `GET /api/courier/deliveries`). */
export function listMyDeliveries(ctx: BrowserContext) {
  return readList(ctx, "/api/courier/deliveries");
}

/**
 * "The invariant still holds" re-reads, each through the re-reading actor's own
 * pinned surface. A merchant or a courier may legitimately be denied
 * `GET /api/orders/[id]`, so an invariant verified there would fail exactly the
 * implementations these probes are meant to reward.
 */
export async function customerStatusOf(
  ctx: BrowserContext,
  orderId: string,
): Promise<string | null> {
  const order = await readOrder(ctx, orderId);
  return order ? String(order.status) : null;
}

export async function merchantStatusOf(
  ctx: BrowserContext,
  orderId: string,
): Promise<string | null> {
  const row = findById(await listMerchantOrders(ctx), orderId);
  return row ? String(row.status) : null;
}

export async function courierStatusOf(
  ctx: BrowserContext,
  orderId: string,
): Promise<string | null> {
  const row = findById(await listMyDeliveries(ctx), orderId);
  return row ? String(row.status) : null;
}

/** The `courierId` a delivery carries in the claiming courier's own list. */
export async function courierIdOf(
  ctx: BrowserContext,
  orderId: string,
): Promise<string | null> {
  const row = findById(await listMyDeliveries(ctx), orderId);
  if (!row) return null;
  return row.courierId == null ? null : String(row.courierId);
}

// ---------------------------------------------------------------------------
// Pinned write endpoints, called raw (probes drive these directly)
// ---------------------------------------------------------------------------

export function postOrder(
  ctx: BrowserContext | APIRequestContext,
  body: Record<string, unknown>,
): Promise<APIResponse> {
  const request = "request" in ctx ? ctx.request : ctx;
  return request.post("/api/orders", { data: body, maxRedirects: 0 });
}

export function postTransition(
  ctx: BrowserContext | APIRequestContext,
  orderId: string,
  to: Status,
): Promise<APIResponse> {
  const request = "request" in ctx ? ctx.request : ctx;
  return request.post(`/api/orders/${orderId}/transition`, {
    data: { to },
    maxRedirects: 0,
  });
}

export function postCancel(
  ctx: BrowserContext | APIRequestContext,
  orderId: string,
): Promise<APIResponse> {
  const request = "request" in ctx ? ctx.request : ctx;
  return request.post(`/api/orders/${orderId}/cancel`, { maxRedirects: 0 });
}

export function postClaim(
  ctx: BrowserContext | APIRequestContext,
  orderId: string,
): Promise<APIResponse> {
  const request = "request" in ctx ? ctx.request : ctx;
  return request.post(`/api/deliveries/${orderId}/claim`, { maxRedirects: 0 });
}

export function postRate(
  ctx: BrowserContext | APIRequestContext,
  orderId: string,
  stars: number,
): Promise<APIResponse> {
  const request = "request" in ctx ? ctx.request : ctx;
  return request.post(`/api/orders/${orderId}/rate`, {
    data: { stars },
    maxRedirects: 0,
  });
}

/** A raw HTML page fetch that follows redirects, for page-leg probes. */
export async function fetchPage(
  ctx: BrowserContext | APIRequestContext,
  path: string,
): Promise<{ status: number; url: string; body: string }> {
  const request = "request" in ctx ? ctx.request : ctx;
  const resp = await request.get(path);
  return { status: resp.status(), url: resp.url(), body: await resp.text() };
}

/** Every scalar in a parsed JSON tree, stringified — for exact-value matching. */
function jsonScalars(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) jsonScalars(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      jsonScalars(v, out);
    }
  } else if (value !== null && value !== undefined) {
    out.push(String(value));
  }
  return out;
}

/**
 * "This refusal body does not expose record `id`" — decided by a FIELD match,
 * never by a substring.
 *
 * A raw `expect(body).not.toContain(id)` is decided by coincidence here. No
 * prompt pins the id format, `bigserial` is a normal choice, and a 1–3 digit id
 * is a substring of the money integers a conformant JSON body legitimately
 * carries (`"subtotalCents":1299` contains "12", "29" and "129") and of the
 * chunk hashes and flight payload of every Next.js HTML body. A completely
 * correct app would fail. So:
 *
 *  - a JSON body must carry no *value* equal to the id anywhere in its tree;
 *  - anything else (an HTML page, an empty redirect body) must carry no
 *    `data-order-id="<id>"` attribute — the one surface the design pins for a
 *    rendered order. Scoped to that attribute deliberately: matching every
 *    `data-…-id` would compare the order id against restaurant and menu-item
 *    ids drawn from independent sequences, so a correct page that renders an
 *    unrelated record whose id happens to collide would fail.
 *
 * Both are exact comparisons, so the verdict is the leak itself.
 */
export function expectNoIdLeak(body: string, id: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const attrs = Array.from(
      body.matchAll(/data-order-id="([^"]*)"/g),
      (m) => m[1],
    );
    expect(attrs, label).not.toContain(String(id));
    return;
  }
  expect(jsonScalars(parsed), label).not.toContain(String(id));
}

/**
 * A signed-in non-owner (or an unentitled actor) fetching an order's HTML page:
 * the page must not render the order. The prompts never pin *how* a page route
 * refuses — `notFound()`, `redirect('/orders')` and a `forbidden-message` body
 * are all conformant — so the verdict is carried by the body never containing
 * the victim's pinned data, exactly as the design specifies.
 */
export async function expectOrderPageDenied(
  ctx: BrowserContext | APIRequestContext,
  orderId: string,
  needles: string[],
) {
  const res = await fetchPage(ctx, `/orders/${orderId}`);
  for (const needle of needles) {
    expect(
      res.body,
      `HTML of /orders/${orderId} must not expose "${needle}"`,
    ).not.toContain(needle);
  }
  const redirectedAway = new URL(res.url).pathname !== `/orders/${orderId}`;
  const forbidden = res.body.includes("forbidden-message");
  expect(
    [401, 403, 404].includes(res.status) || redirectedAway || forbidden,
    `GET /orders/${orderId} must refuse: 401/403/404, a redirect away, or forbidden-message (got ${res.status} at ${res.url})`,
  ).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Pinned DOM surfaces
// ---------------------------------------------------------------------------

function rowBy(page: Page, testId: string, attr: string, id: string): Locator {
  return page.locator(`[data-testid="${testId}"][${attr}="${id}"]`);
}

export const restaurantRow = (page: Page, restaurantId: string) =>
  rowBy(page, "restaurant-row", "data-restaurant-id", restaurantId);

export const menuItemRow = (page: Page, menuItemId: string) =>
  rowBy(page, "menu-item", "data-menu-item-id", menuItemId);

export const orderRow = (page: Page, orderId: string) =>
  rowBy(page, "order-row", "data-order-id", orderId);

export const merchantOrderRow = (page: Page, orderId: string) =>
  rowBy(page, "merchant-order-row", "data-order-id", orderId);

export const availableRow = (page: Page, orderId: string) =>
  rowBy(page, "available-row", "data-order-id", orderId);

export const myDeliveryRow = (page: Page, orderId: string) =>
  rowBy(page, "my-delivery-row", "data-order-id", orderId);

/**
 * Status text tolerant of rendering: `picked_up` may appear as `picked_up`,
 * `picked up` or `Picked Up`. The exact strings are asserted against the API,
 * which the prompts do pin exactly.
 */
export function statusPattern(status: Status): RegExp {
  return new RegExp(status.split("_").join("[\\s_-]*"), "i");
}

export function expectStatusText(locator: Locator, status: Status) {
  return expect(locator.first()).toContainText(statusPattern(status), {
    timeout: 15_000,
  });
}

/** Money is read only from the pinned integer `data-cents` attribute. */
export function expectCents(locator: Locator, cents: number, label?: string) {
  return expect(
    locator.first(),
    label ?? `data-cents is exactly ${cents}`,
  ).toHaveAttribute("data-cents", String(cents), { timeout: 15_000 });
}

export async function dataCents(locator: Locator): Promise<number> {
  const raw = await locator.first().getAttribute("data-cents");
  expect(raw, "pinned data-cents attribute").toBeTruthy();
  return Number(raw);
}

/** M3: `order-rating` carries the star count in `data-stars`. */
export function expectStars(locator: Locator, stars: number) {
  return expect(
    locator.first(),
    `data-stars is exactly ${stars}`,
  ).toHaveAttribute("data-stars", String(stars), { timeout: 15_000 });
}

/** M3: `restaurant-average-rating` carries a one-decimal `data-rating`. */
export function expectRating(page: Page, rating: string) {
  return expect(
    page.getByTestId("restaurant-average-rating").first(),
    `data-rating is exactly ${rating}`,
  ).toHaveAttribute("data-rating", rating, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Provisioning through the pinned UI
// ---------------------------------------------------------------------------

// Wait for a create/update form to actually finish submitting before navigating
// away. Clicking submit fires a client-side request and then routes; a
// `page.goto` issued immediately aborts that request in flight, so the record
// is never written (this silently broke every provisioning helper of the
// exemplar suites once tests stopped inheriting state from each other).
export async function settleAfterSubmit(page: Page, formPath = "/new") {
  await page
    .waitForURL((u) => !u.pathname.endsWith(formPath), { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

// Wait for a pinned write to come back before navigating away. Never asserts —
// the caller's own expectation stays the verdict; this only removes the race.
function settle(page: Page, method: string, urlPart: string) {
  return page
    .waitForResponse(
      (r) => r.request().method() === method && r.url().includes(urlPart),
      { timeout: 10_000 },
    )
    .catch(() => null);
}

export async function createRestaurant(
  page: Page,
  r: { name: string; cuisine?: string; address?: string },
) {
  await page.goto("/restaurants");
  await page.getByTestId("restaurant-new-button").click();
  await page.getByTestId("restaurant-form-name").fill(r.name);
  await page
    .getByTestId("restaurant-form-cuisine")
    .fill(r.cuisine ?? "Italian");
  await page
    .getByTestId("restaurant-form-address")
    .fill(r.address ?? "1 Curb Street");
  await page.getByTestId("restaurant-form-submit").click();
  await settleAfterSubmit(page);
}

/** Restaurant id from the pinned `GET /api/restaurants`. */
export async function findRestaurantId(
  ctx: BrowserContext,
  name: string,
): Promise<string | null> {
  const hit = (await readList(ctx, "/api/restaurants")).find((r) =>
    Object.values(r).some((v) => typeof v === "string" && v.includes(name)),
  );
  return hit && hit.id != null ? String(hit.id) : null;
}

export async function createRestaurantFor(
  merchant: Persona,
  name: string,
  opts: { cuisine?: string; address?: string } = {},
): Promise<string> {
  await createRestaurant(merchant.page, { name, ...opts });
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findRestaurantId(merchant.ctx, name);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for "${name}" from the pinned GET /api/restaurants`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** Menu items of a restaurant, from the pinned `GET /api/restaurants/[id]`. */
export async function readMenuItems(
  ctx: BrowserContext,
  restaurantId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await ctx.request.get(`/api/restaurants/${restaurantId}`);
  if (!resp.ok()) return [];
  const body = (await resp.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return Array.isArray(body?.menuItems)
    ? (body!.menuItems as Array<Record<string, unknown>>)
    : [];
}

export async function addMenuItem(
  page: Page,
  restaurantId: string,
  item: { name: string; description?: string; priceCents: number },
) {
  await page.goto(`/restaurants/${restaurantId}/manage`);
  await page.getByTestId("menu-item-form-name").fill(item.name);
  const description = page.getByTestId("menu-item-form-description");
  if (await description.count()) {
    await description.first().fill(item.description ?? `${item.name} plate`);
  }
  await page
    .getByTestId("menu-item-form-price-cents")
    .fill(String(item.priceCents));
  const posted = settle(page, "POST", "menu-items");
  await page.getByTestId("menu-item-form-submit").click();
  await posted;
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Set a quantity on a pinned `menu-item` row and add it to the cart. */
export async function addToCart(page: Page, line: CartLine) {
  const row = menuItemRow(page, line.menuItemId).first();
  await expect(row, `menu-item row ${line.menuItemId}`).toBeVisible({
    timeout: 15_000,
  });
  const qty = row.getByTestId("menu-item-qty");
  if (await qty.count()) await qty.first().fill(String(line.quantity));
  await row.getByTestId("menu-item-add").first().click();
}

/** Open a restaurant page and build a cart from pinned menu item ids. */
export async function buildCart(
  page: Page,
  restaurantId: string,
  lines: CartLine[],
) {
  await page.goto(`/restaurants/${restaurantId}`);
  for (const line of lines) await addToCart(page, line);
  await expect(page.getByTestId("cart-line")).toHaveCount(lines.length, {
    timeout: 15_000,
  });
}

/** M3: the customer-supplied tip on the checkout. */
export async function setTip(page: Page, tipCents: number) {
  await page.getByTestId("checkout-tip-cents").first().fill(String(tipCents));
}

/**
 * Place the cart currently on screen. Placing navigates to `/orders/[id]`;
 * clicking and then navigating without waiting would abort the write in flight.
 */
export async function placeOrder(page: Page) {
  await page.getByTestId("place-order-button").first().click();
  await page
    .waitForURL(/\/orders\/[^/?#]+$/, { timeout: 20_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * Build the cart, place it, and return the new order's id from the placing
 * customer's own pinned `GET /api/orders` — never from the URL.
 */
export async function placeOrderFor(
  customer: Persona,
  kitchen: Kitchen,
  lines: CartLine[] = canonicalCart(kitchen),
  opts: { tipCents?: number } = {},
): Promise<string> {
  const before = new Set(await orderIds(customer.ctx));
  await buildCart(customer.page, kitchen.restaurantId, lines);
  if (opts.tipCents !== undefined) await setTip(customer.page, opts.tipCents);
  await placeOrder(customer.page);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = (await orderIds(customer.ctx)).find((o) => !before.has(o)) ?? null;
        return id;
      },
      {
        timeout: 20_000,
        message: `new order id from ${customer.who.email}'s own GET /api/orders`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** Cancel through the pinned `order-cancel-button` on the customer's own detail page. */
export async function cancelOrderViaUi(customer: Persona, orderId: string) {
  await customer.page.goto(`/orders/${orderId}`);
  const posted = settle(customer.page, "POST", `/orders/${orderId}/cancel`);
  await customer.page.getByTestId("order-cancel-button").first().click();
  await posted;
  await customer.page.waitForLoadState("networkidle").catch(() => {});
}

/** M3: rate through the pinned `order-rate-stars` / `order-rate-submit` pair. */
export async function rateOrderViaUi(
  customer: Persona,
  orderId: string,
  stars: number,
) {
  await customer.page.goto(`/orders/${orderId}`);
  const input = customer.page.getByTestId("order-rate-stars").first();
  await expect(input, "pinned order-rate-stars control").toBeVisible({
    timeout: 15_000,
  });
  const tag = await input.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await input.selectOption(String(stars));
  } else {
    await input.fill(String(stars));
  }
  const posted = settle(customer.page, "POST", `/orders/${orderId}/rate`);
  await customer.page.getByTestId("order-rate-submit").first().click();
  await posted;
  await customer.page.waitForLoadState("networkidle").catch(() => {});
}

// ---------------------------------------------------------------------------
// M2: actor types, the lifecycle and claims — all through pinned surfaces
// ---------------------------------------------------------------------------

/** `/courier` is open to everybody; that is where a non-courier registers. */
export async function registerCourier(persona: Persona) {
  await persona.page.goto("/courier");
  await persona.page.getByTestId("courier-register-button").first().click();
  await expect
    .poll(async () => (await readMe(persona.ctx))?.isCourier === true, {
      timeout: 15_000,
      message: `courier registration persisted for ${persona.who.email}`,
    })
    .toBe(true);
}

/** Merchant drives one of its own edges from the pinned queue row. */
export async function merchantTransition(
  merchant: Persona,
  orderId: string,
  to: MerchantStatus,
) {
  await merchant.page.goto("/merchant/orders");
  const row = merchantOrderRow(merchant.page, orderId).first();
  await expect(row, `merchant-order-row for ${orderId}`).toBeVisible({
    timeout: 15_000,
  });
  const posted = settle(merchant.page, "POST", `/orders/${orderId}/transition`);
  await row.getByTestId(`transition-${to}`).first().click();
  await posted;
  await expect
    .poll(() => merchantStatusOf(merchant.ctx, orderId), {
      timeout: 15_000,
      message: `order ${orderId} reaches ${to} in its merchant's own queue`,
    })
    .toBe(to);
}

/** Merchant walks a `placed` order all the way to `ready`. */
export async function walkToReady(merchant: Persona, orderId: string) {
  await merchantTransition(merchant, orderId, "accepted");
  await merchantTransition(merchant, orderId, "preparing");
  await merchantTransition(merchant, orderId, "ready");
}

/** Courier claims a `ready`, unclaimed delivery from the pinned pool row. */
export async function claimDelivery(courier: Persona, orderId: string) {
  await courier.page.goto("/courier");
  const row = availableRow(courier.page, orderId).first();
  await expect(row, `available-row for ${orderId}`).toBeVisible({
    timeout: 15_000,
  });
  const posted = settle(courier.page, "POST", `/deliveries/${orderId}/claim`);
  await row.getByTestId("claim-button").first().click();
  await posted;
  await expect
    .poll(async () => findById(await listMyDeliveries(courier.ctx), orderId), {
      timeout: 15_000,
      message: `claim landed: ${orderId} is in ${courier.who.email}'s own GET /api/courier/deliveries`,
    })
    .not.toBeNull();
}

/** The claiming courier drives one of its own edges from `/courier/deliveries`. */
export async function courierTransition(
  courier: Persona,
  orderId: string,
  to: CourierStatus,
) {
  await courier.page.goto("/courier/deliveries");
  const row = myDeliveryRow(courier.page, orderId).first();
  await expect(row, `my-delivery-row for ${orderId}`).toBeVisible({
    timeout: 15_000,
  });
  const posted = settle(courier.page, "POST", `/orders/${orderId}/transition`);
  await row.getByTestId(`transition-${to}`).first().click();
  await posted;
  await expect
    .poll(() => courierStatusOf(courier.ctx, orderId), {
      timeout: 15_000,
      message: `order ${orderId} reaches ${to} in its claiming courier's own deliveries`,
    })
    .toBe(to);
}

/** The full lifecycle: merchant to `ready`, courier claims, then `delivered`. */
export async function deliverOrder(
  merchant: Persona,
  courier: Persona,
  orderId: string,
) {
  await walkToReady(merchant, orderId);
  await claimDelivery(courier, orderId);
  await courierTransition(courier, orderId, "picked_up");
  await courierTransition(courier, orderId, "delivered");
}

// ---------------------------------------------------------------------------
// Per-scenario world
// ---------------------------------------------------------------------------

export interface Persona {
  readonly who: Identity;
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** This persona's own id, from the pinned GET /api/me (memoized). */
  userId(): Promise<string>;
}

/** A merchant plus the restaurant they created and the menu they stocked. */
export interface Kitchen {
  merchant: Persona;
  restaurantId: string;
  restaurantName: string;
  /** Menu item ids by dish, from the pinned GET /api/restaurants/[id]. */
  menu: Partial<Record<Dish, string>>;
  /** Id of a dish this kitchen stocks; fails the test if it does not. */
  dish(dish: Dish): string;
  /** This scenario's display name for a dish, e.g. `Margherita <RUN_ID>-<id>`. */
  dishName(dish: Dish): string;
}

/** The "canonical world": a kitchen, a customer, and one placed canonical order. */
export interface World extends Kitchen {
  customer: Persona;
  orderId: string;
}

/** 1× Margherita + 2× Soda = 1797 cents. Do not "simplify" this cart. */
export function canonicalCart(kitchen: Kitchen): CartLine[] {
  return [
    { menuItemId: kitchen.dish("margherita"), quantity: 1 },
    { menuItemId: kitchen.dish("soda"), quantity: 2 },
  ];
}

/** 3× Wings = 2697 cents (tax 229.245, which rounds the same either way). */
export function wingsCart(kitchen: Kitchen, quantity = 3): CartLine[] {
  return [{ menuItemId: kitchen.dish("wings"), quantity }];
}

export class Curb {
  private readonly contexts: BrowserContext[] = [];
  private readonly apis: APIRequestContext[] = [];

  constructor(
    private readonly browser: Browser,
    /** The scenario id — the first token of the test title, e.g. `curb-m2-05`. */
    readonly scenarioId: string,
    private readonly baseURL: string | undefined,
  ) {}

  /** This scenario's identity for a role (unique per run *and* per scenario). */
  identity(role: Role): Identity {
    return identity(role, this.scenarioId);
  }

  /** `Pizza <RUN_ID>-<scenarioId>` / `Noodles <RUN_ID>-<scenarioId>`. */
  restaurantName(kind: RestaurantKind = "pizza"): string {
    return `${kind === "pizza" ? "Pizza" : "Noodles"} ${RUN_ID}-${this.scenarioId}`;
  }

  /** `Margherita <RUN_ID>-<scenarioId>` etc. — the pinned body-assertion marker. */
  dishName(dish: Dish): string {
    return `${titleCase(dish)} ${RUN_ID}-${this.scenarioId}`;
  }

  /** A tracked, video-recorded (when CUJ_VIDEO_DIR is set) browser context. */
  async context(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(videoOpts());
    this.contexts.push(ctx);
    return ctx;
  }

  /** A signed-out context and page, for redirect and unauthenticated-page legs. */
  async guest(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    return { ctx, page };
  }

  /** A raw request context carrying no cookies at all. */
  async anon(): Promise<APIRequestContext> {
    const api = await pwRequest.newContext({ baseURL: this.baseURL });
    this.apis.push(api);
    return api;
  }

  /**
   * Sign up a brand-new persona for this scenario.
   *
   * Deliberately tolerant about the landing route: it confirms the session
   * FUNCTIONALLY through the pinned `GET /api/me` and falls back to navigating
   * to `/restaurants`. The `/restaurants` landing contract is scored where the
   * design pins it (`curb-m1-01`, which signs up inline); asserting it in every
   * provisioning call would let one routing defect zero the whole app.
   */
  async persona(role: Role): Promise<Persona> {
    const who = this.identity(role);
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    await signUp(page, who);
    await page
      .waitForURL("**/restaurants", { timeout: 15_000 })
      .catch(() => {});
    await expect
      .poll(async () => (await ctx.request.get("/api/me")).status(), {
        timeout: 15_000,
        message: `sign-up created a live session for ${who.email}`,
      })
      .toBe(200);
    if (!/\/restaurants\/?$/.test(page.url())) {
      await page.goto("/restaurants");
    }
    let id: string | null = null;
    return {
      who,
      ctx,
      page,
      async userId() {
        if (id === null) id = String((await getMe(ctx)).id);
        return id;
      },
    };
  }

  /** A plain customer (every signed-in user is one). */
  customer(role: "customer" | "customer2" = "customer"): Promise<Persona> {
    return this.persona(role);
  }

  /** M2+: a signed-up persona that has registered as a courier. */
  async courier(role: "courier" | "courier2" = "courier"): Promise<Persona> {
    const persona = await this.persona(role);
    await registerCourier(persona);
    return persona;
  }

  /**
   * A merchant of this scenario plus their restaurant and menu. Defaults to
   * `merchant` + `Pizza …` stocked with all three dishes; `merchant2` gets
   * `Noodles …` with one item, whose name shares no word with any other
   * fixture name so body assertions stay unambiguous.
   */
  async kitchen(
    opts: { as?: "merchant" | "merchant2"; dishes?: Dish[] } = {},
  ): Promise<Kitchen> {
    const as = opts.as ?? "merchant";
    const kind: RestaurantKind = as === "merchant2" ? "noodles" : "pizza";
    const dishes = opts.dishes ?? (kind === "pizza" ? ALL_DISHES : ["wings"]);
    const merchant = await this.persona(as);
    const restaurantName = this.restaurantName(kind);
    const restaurantId = await createRestaurantFor(merchant, restaurantName, {
      cuisine: kind === "pizza" ? "Italian" : "Thai",
      address: `${this.scenarioId} Curb Street`,
    });
    for (const dish of dishes) {
      await addMenuItem(merchant.page, restaurantId, {
        name: this.dishName(dish),
        priceCents: PRICE_CENTS[dish],
      });
    }
    const menu: Partial<Record<Dish, string>> = {};
    await expect
      .poll(
        async () => {
          const items = await readMenuItems(merchant.ctx, restaurantId);
          for (const dish of dishes) {
            const wanted = this.dishName(dish);
            const hit = items.find((i) => String(i.name) === wanted);
            if (hit?.id != null) menu[dish] = String(hit.id);
          }
          return dishes.every((d) => Boolean(menu[d]));
        },
        {
          timeout: 20_000,
          message: `menu item ids for ${restaurantName} from the pinned GET /api/restaurants/[id]`,
        },
      )
      .toBe(true);
    const dishName = (dish: Dish) => this.dishName(dish);
    return {
      merchant,
      restaurantId,
      restaurantName,
      menu,
      dish(dish: Dish) {
        const id = menu[dish];
        expect(id, `menu item id for ${dishName(dish)}`).toBeTruthy();
        return String(id);
      },
      dishName,
    };
  }

  /**
   * The canonical world: this scenario's merchant + `Pizza …` + its three menu
   * items + this scenario's customer and one placed canonical order.
   */
  async world(
    opts: {
      as?: "customer" | "customer2";
      lines?: (kitchen: Kitchen) => CartLine[];
      tipCents?: number;
    } = {},
  ): Promise<World> {
    const kitchen = await this.kitchen();
    const customer = await this.customer(opts.as ?? "customer");
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      (opts.lines ?? canonicalCart)(kitchen),
      { tipCents: opts.tipCents },
    );
    return { ...kitchen, customer, orderId };
  }

  async close(): Promise<void> {
    for (const api of this.apis) await api.dispose().catch(() => {});
    this.apis.length = 0;
    for (const ctx of this.contexts) await ctx.close().catch(() => {});
    this.contexts.length = 0;
  }
}

/** The scenario id is the first token of the test title, e.g. `curb-m1-s02`. */
function scenarioIdOf(testInfo: TestInfo): string {
  return (testInfo.title.split(/\s+/)[0] ?? "curb").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );
}

/**
 * `curb` provisions every persona and record a scenario needs and disposes of
 * its contexts afterwards — the reason no scenario has to inherit another's
 * state, and the reason none can be voided by another's failure.
 */
export const test = base.extend<{ curb: Curb }>({
  curb: async ({ browser }, use, testInfo) => {
    const curb = new Curb(
      browser,
      scenarioIdOf(testInfo),
      testInfo.project.use.baseURL,
    );
    await use(curb);
    await curb.close();
  },
});
