// Curbside — checkpoint 1 CUJ suite (design/app-6-curbside.md, M1 CUJ table +
// M1 security probes). 10 CUJs + 3 probes.
//
// Conventions (design "Test fixtures & conventions"): every scenario provisions
// its own personas, restaurant, menu items and orders through the `curb`
// fixture — nothing is inherited from a sibling scenario, so a failure can
// never skip (and thereby silently void) another row. Ids come only from pinned
// surfaces (GET /api/me, GET /api/restaurants[/id], GET /api/orders, and the
// pinned data-* attributes); money is read only from the integer `data-cents`
// attribute, never from a formatted string; every identity, restaurant and dish
// name is unique to this run *and* this scenario.
import type { APIResponse } from "@playwright/test";
import {
  test,
  expect,
  ALL_DISHES,
  CANONICAL_SUBTOTAL_CENTS,
  PRICE_CENTS,
  WINGS3_SUBTOTAL_CENTS,
  buildCart,
  canonicalCart,
  cancelOrderViaUi,
  createRestaurant,
  customerStatusOf,
  escapeRe,
  expectCents,
  expectNoIdLeak,
  expectOrderPageDenied,
  expectSignedIn,
  expectStatusText,
  listOrders,
  menuItemRow,
  orderIds,
  orderRow,
  placeOrderFor,
  postCancel,
  postOrder,
  readMenuItems,
  readOrder,
  signIn,
  signOut,
  signUp,
  wingsCart,
} from "./fixtures";

// An unauthenticated request must be refused; the design also accepts a
// redirect whose body carries no data, exactly as the exemplar suites do.
const UNAUTHENTICATED = [401, 403, 301, 302, 303, 307, 308];

const expect2xx = (resp: APIResponse, label: string) => {
  expect(resp.status(), label).toBeGreaterThanOrEqual(200);
  expect(resp.status(), label).toBeLessThan(300);
};

test.describe("curbside checkpoint 1", () => {
  test("curb-m1-01 sign-up signs the customer in and lands on /restaurants", async ({
    curb,
  }) => {
    // Signed up inline rather than through `curb.customer()`: this row owns the
    // landing contract, and the fixture's provisioning path is deliberately
    // tolerant about it.
    const { ctx, page } = await curb.guest();
    const who = curb.identity("customer");
    await signUp(page, who);
    await page.waitForURL("**/restaurants", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/restaurants\/?$/);
    await expectSignedIn(page, who.email);
    const me = await ctx.request.get("/api/me");
    expect(me.status(), "GET /api/me for the new session").toBe(200);
    const body = await me.json();
    expect(body.email).toBe(who.email);
    expect(typeof body.id, "the session user id is an opaque string").toBe(
      "string",
    );
    expect(String(body.id).length).toBeGreaterThan(0);
  });

  test("curb-m1-02 sign-out and sign-in round-trip the session", async ({
    curb,
  }) => {
    const customer = await curb.customer();
    await signOut(customer.page);
    await signIn(customer.page, customer.who);
    await expectSignedIn(customer.page, customer.who.email);
    await customer.page.goto("/restaurants");
    await expect(customer.page).toHaveURL(/\/restaurants\/?$/);
    await expectSignedIn(customer.page, customer.who.email);
  });

  test("curb-m1-03 signed-out routes redirect to sign-in and leak no data", async ({
    curb,
  }) => {
    // Provisioned so "contains no restaurant or order data" is not vacuous:
    // there is a restaurant and an order in the database to leak.
    const world = await curb.world();
    const { page } = await curb.guest();
    for (const path of ["/", "/restaurants", "/orders"]) {
      await page.goto(path);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      const html = await page.content();
      expect(html, `${path} must not leak restaurant data`).not.toContain(
        world.restaurantName,
      );
      // Never substring-match a raw id against a whole page: no prompt pins the
      // order id's format, bigserial is a normal choice, and a 1-3 digit id
      // collides with the digits in every Next.js chunk src and flight payload.
      // Match the pinned attribute instead.
      expect(
        await page.locator("[data-order-id]").count(),
        `${path} must not leak order data`,
      ).toBe(0);
    }
  });

  test("curb-m1-04 a merchant creates their own restaurant", async ({
    curb,
  }) => {
    const merchant = await curb.persona("merchant");
    const name = curb.restaurantName("pizza");
    await createRestaurant(merchant.page, {
      name,
      cuisine: "Italian",
      address: "1 Curb Street",
    });
    await merchant.page.goto("/restaurants");
    const row = merchant.page
      .getByTestId("restaurants-list")
      .getByTestId("restaurant-row")
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("restaurant-row-name")).toContainText(name);
    const restaurantId = await row.getAttribute("data-restaurant-id");
    expect(
      restaurantId,
      "restaurant-row carries data-restaurant-id",
    ).toBeTruthy();
  });

  test("curb-m1-05 menu items are created with integer cent prices", async ({
    curb,
  }) => {
    // `curb.kitchen()` creates this scenario's restaurant and adds all three
    // dishes through the pinned /restaurants/[id]/manage form.
    const kitchen = await curb.kitchen();
    await kitchen.merchant.page.goto(`/restaurants/${kitchen.restaurantId}`);
    const menu = kitchen.merchant.page.getByTestId("menu-list");
    await expect(menu).toBeVisible({ timeout: 15_000 });
    await expect(kitchen.merchant.page.getByTestId("menu-item")).toHaveCount(3);
    for (const dish of ALL_DISHES) {
      const row = menuItemRow(
        kitchen.merchant.page,
        kitchen.dish(dish),
      ).first();
      await expect(row).toBeVisible();
      await expect(row.getByTestId("menu-item-name")).toContainText(
        kitchen.dishName(dish),
      );
      await expectCents(
        row.getByTestId("menu-item-price"),
        PRICE_CENTS[dish],
        `${kitchen.dishName(dish)} menu-item-price data-cents`,
      );
    }
    // Same three items on the pinned GET /api/restaurants/[id].
    const items = await readMenuItems(
      kitchen.merchant.ctx,
      kitchen.restaurantId,
    );
    for (const dish of ALL_DISHES) {
      const item = items.find((i) => String(i.id) === kitchen.dish(dish));
      expect(item, `${kitchen.dishName(dish)} in menuItems`).toBeTruthy();
      expect(item!.name).toBe(kitchen.dishName(dish));
      expect(item!.priceCents).toBe(PRICE_CENTS[dish]);
    }
  });

  test("curb-m1-06 the canonical cart subtotals to 1797 cents", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    await buildCart(
      customer.page,
      kitchen.restaurantId,
      canonicalCart(kitchen),
    );
    await expect(customer.page.getByTestId("cart-line")).toHaveCount(2);
    const margherita = customer.page
      .getByTestId("cart-line")
      .filter({ hasText: kitchen.dishName("margherita") })
      .first();
    await expect(margherita.getByTestId("cart-line-name")).toContainText(
      kitchen.dishName("margherita"),
    );
    await expect(margherita.getByTestId("cart-line-qty")).toContainText(
      /(^|\D)1(\D|$)/,
    );
    const soda = customer.page
      .getByTestId("cart-line")
      .filter({ hasText: kitchen.dishName("soda") })
      .first();
    await expect(soda.getByTestId("cart-line-qty")).toContainText(
      /(^|\D)2(\D|$)/,
    );
    await expectCents(
      customer.page.getByTestId("cart-subtotal"),
      CANONICAL_SUBTOTAL_CENTS,
      "cart-subtotal data-cents",
    );
  });

  test("curb-m1-07 placing the canonical cart creates a server-priced order", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    // The id comes from the customer's own GET /api/orders (newest first), and
    // placing must have navigated to that order's own detail page.
    expect((await orderIds(customer.ctx))[0]).toBe(orderId);
    await expect(customer.page).toHaveURL(
      new RegExp(`/orders/${escapeRe(orderId)}/?$`),
    );
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "placed",
    );
    await expect(customer.page.getByTestId("order-line")).toHaveCount(2);
    await expectCents(
      customer.page.getByTestId("order-subtotal"),
      CANONICAL_SUBTOTAL_CENTS,
      "order-subtotal data-cents",
    );
    await expectCents(
      customer.page.getByTestId("order-total"),
      CANONICAL_SUBTOTAL_CENTS,
      "order-total data-cents (M1: total equals subtotal)",
    );
  });

  test("curb-m1-08 the placed order appears in the customer's own list", async ({
    curb,
  }) => {
    const world = await curb.world();
    await world.customer.page.goto("/orders");
    await expect(world.customer.page.getByTestId("orders-list")).toBeVisible({
      timeout: 15_000,
    });
    const row = orderRow(world.customer.page, world.orderId).first();
    await expect(
      row,
      `order-row with data-order-id ${world.orderId}`,
    ).toBeVisible();
    await expectStatusText(row.getByTestId("order-row-status"), "placed");
  });

  test("curb-m1-09 a customer cancels one placed order and the other survives", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const first = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    const second = await placeOrderFor(
      customer,
      kitchen,
      wingsCart(kitchen, 3),
    );
    await customer.page.goto(`/orders/${second}`);
    await expectCents(
      customer.page.getByTestId("order-subtotal"),
      WINGS3_SUBTOTAL_CENTS,
      "3x Wings order-subtotal data-cents",
    );
    await cancelOrderViaUi(customer, second);
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "cancelled",
    );
    await customer.page.reload();
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "cancelled",
    );
    expect(await customerStatusOf(customer.ctx, second)).toBe("cancelled");
    // The first order is untouched.
    await customer.page.goto(`/orders/${first}`);
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "placed",
    );
    expect(await customerStatusOf(customer.ctx, first)).toBe("placed");
  });

  test("curb-m1-10 a second customer sees none of the first customer's orders", async ({
    curb,
  }) => {
    const world = await curb.world();
    // Positive control: the owner's own list demonstrably renders the row.
    await world.customer.page.goto("/orders");
    await expect(
      orderRow(world.customer.page, world.orderId).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Isolation.
    const customer2 = await curb.customer("customer2");
    await customer2.page.goto("/orders");
    const empty = await customer2.page.getByTestId("orders-empty").count();
    const rows = await customer2.page.getByTestId("order-row").count();
    expect(
      empty > 0 || rows === 0,
      "customer2 sees orders-empty or no order rows",
    ).toBeTruthy();
    // Attribute-scoped, not a page substring — see curb-m1-03.
    await expect(orderRow(customer2.page, world.orderId)).toHaveCount(0);
    const resp = await customer2.ctx.request.get("/api/orders");
    expect(resp.status()).toBe(200);
    expect(await listOrders(customer2.ctx)).toHaveLength(0);
  });

  // ---- security probes ----
  test("curb-m1-s01 unauthenticated requests are refused and leak nothing", async ({
    curb,
  }) => {
    const world = await curb.world();
    const anon = await curb.anon();
    const attempts: Array<[string, APIResponse]> = [
      ["GET /api/me", await anon.get("/api/me", { maxRedirects: 0 })],
      ["GET /api/orders", await anon.get("/api/orders", { maxRedirects: 0 })],
      [
        `GET /api/orders/${world.orderId}`,
        await anon.get(`/api/orders/${world.orderId}`, { maxRedirects: 0 }),
      ],
      [
        `POST /api/orders/${world.orderId}/cancel`,
        await anon.post(`/api/orders/${world.orderId}/cancel`, {
          maxRedirects: 0,
        }),
      ],
    ];
    for (const [label, resp] of attempts) {
      expect(UNAUTHENTICATED, `${label} without a session`).toContain(
        resp.status(),
      );
      const body = await resp.text();
      // Field-matched, not substring-matched: a short integer id occurs by luck
      // inside the money integers of a JSON body and inside the chunk hashes of
      // an HTML one, so `.not.toContain(orderId)` here would fail a correct app.
      expectNoIdLeak(
        body,
        world.orderId,
        `${label} must not leak the order id`,
      );
      expect(body, `${label} must not leak the customer email`).not.toContain(
        world.customer.who.email,
      );
    }
    // The unauthenticated cancel changed nothing.
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "placed",
    );
    // Positive control: the owning customer's own cancel works, so the refusals
    // above were the session check rather than a dead endpoint.
    const own = await postCancel(world.customer.ctx, world.orderId);
    expect2xx(own, "the owning customer's own cancel");
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "cancelled",
    );
  });

  test("curb-m1-s02 a signed-in non-owner cannot read or cancel another's order", async ({
    curb,
  }) => {
    const world = await curb.world();
    const marker = world.dishName("margherita");
    const customer2 = await curb.customer("customer2");
    const read = await customer2.ctx.request.get(
      `/api/orders/${world.orderId}`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404], "non-owner GET /api/orders/[id]").toContain(
      read.status(),
    );
    expect(await read.text()).not.toContain(marker);
    const cancel = await postCancel(customer2.ctx, world.orderId);
    expect([401, 403, 404], "non-owner POST cancel").toContain(cancel.status());
    // The HTML page leg: a redirect away or a 401/403/404, and in every case a
    // body that does not render the victim's order.
    await expectOrderPageDenied(customer2.ctx, world.orderId, [marker]);
    // Nothing changed, and the attacker's own list is still empty.
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "placed",
    );
    expect(await listOrders(customer2.ctx)).toHaveLength(0);
    // Positive controls: the same routes serve the owner.
    const own = await world.customer.ctx.request.get(
      `/api/orders/${world.orderId}`,
    );
    expect(own.status(), "the owner's own GET /api/orders/[id]").toBe(200);
    expect(await own.text()).toContain(marker);
    const ownCancel = await postCancel(world.customer.ctx, world.orderId);
    expect2xx(ownCancel, "the owner's own cancel");
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "cancelled",
    );
  });

  test("curb-m1-s03 forged money in the order body is ignored", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const before = await orderIds(customer.ctx);
    const forged = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items: [
        { menuItemId: kitchen.dish("margherita"), quantity: 1, priceCents: 1 },
        { menuItemId: kitchen.dish("soda"), quantity: 2, priceCents: 1 },
      ],
      subtotalCents: 3,
      totalCents: 3,
    });
    if (forged.status() >= 400) {
      expect(forged.status(), "a rejected forged order is a 400").toBe(400);
      expect(
        (await orderIds(customer.ctx)).length,
        "a rejected forged order creates nothing",
      ).toBe(before.length);
    } else {
      const created = (await forged.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      const seen = new Set(before);
      const newId =
        created?.id != null
          ? String(created.id)
          : ((await orderIds(customer.ctx)).find((id) => !seen.has(id)) ?? "");
      expect(newId, "created order id").toBeTruthy();
      const order = await readOrder(customer.ctx, newId);
      expect(order, `GET /api/orders/${newId}`).toBeTruthy();
      expect(
        order!.subtotalCents,
        "the server prices the cart from the menu, ignoring the forged body",
      ).toBe(CANONICAL_SUBTOTAL_CENTS);
      const lines = (order!.lines ?? []) as Array<Record<string, unknown>>;
      const expected: Array<[string, number]> = [
        [kitchen.dish("margherita"), PRICE_CENTS.margherita * 1],
        [kitchen.dish("soda"), PRICE_CENTS.soda * 2],
      ];
      for (const [menuItemId, lineTotalCents] of expected) {
        const line = lines.find((l) => String(l.menuItemId) === menuItemId);
        expect(line, `line for menu item ${menuItemId}`).toBeTruthy();
        expect(line!.lineTotalCents).toBe(lineTotalCents);
      }
    }
    // Positive control: a clean canonical cart with no money fields at all is
    // accepted and priced at 1797 — so the 400 branch above cannot be a create
    // route that refuses everything.
    const clean = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items: [
        { menuItemId: kitchen.dish("margherita"), quantity: 1 },
        { menuItemId: kitchen.dish("soda"), quantity: 2 },
      ],
    });
    expect2xx(clean, "a clean POST /api/orders");
    const cleanBody = (await clean.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    const cleanId = String(cleanBody?.id ?? "");
    expect(cleanId, "the created order's id").toBeTruthy();
    const cleanOrder = await readOrder(customer.ctx, cleanId);
    expect(cleanOrder!.subtotalCents).toBe(CANONICAL_SUBTOTAL_CENTS);
  });
});
