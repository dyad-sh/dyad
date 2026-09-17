// Curbside — checkpoint 2 CUJ suite (design/app-6-curbside.md, M2 CUJ table +
// M2 security probes). 12 CUJs (4 regression + 8 new) + 8 probes.
//
// Conventions (design "Test fixtures & conventions"): every scenario provisions
// its own personas, restaurant, menu items and orders through the `curb`
// fixture — nothing is inherited from a sibling scenario, so a failure can
// never skip (and thereby silently void) another row. Ids come only from pinned
// surfaces (GET /api/me, GET /api/restaurants[/id], GET /api/orders, GET
// /api/merchant/orders, GET /api/courier/deliveries[/available], and the pinned
// data-* attributes); money is read only from the integer `data-cents`
// attribute; every identity, restaurant and dish name is unique to this run
// *and* this scenario.
//
// Every actor probe below is deliberately staged on an edge that is LEGAL from
// the order's current state, so the only possible ground for refusal is the
// actor check; illegal-edge behaviour is probed separately by `curb-m2-s08`.
// Each "was refused / was not offered" assertion carries a positive control in
// the same test, always after the refusal assertions so it cannot mask them —
// except where the probe's own setup already drove the attacked route
// successfully, which is then the in-test positive control.
import type { APIResponse } from "@playwright/test";
import {
  test,
  expect,
  ALL_DISHES,
  CANONICAL_SUBTOTAL_CENTS,
  PRICE_CENTS,
  availableRow,
  canonicalCart,
  claimDelivery,
  courierIdOf,
  courierStatusOf,
  courierTransition,
  customerStatusOf,
  dataCents,
  escapeRe,
  expectCents,
  expectNoIdLeak,
  expectSignedIn,
  expectStatusText,
  findById,
  getMe,
  listAvailableDeliveries,
  listMerchantOrders,
  listMyDeliveries,
  listOrders,
  menuItemRow,
  merchantOrderRow,
  merchantStatusOf,
  merchantTransition,
  myDeliveryRow,
  orderIds,
  orderRow,
  placeOrderFor,
  postClaim,
  postTransition,
  readMenuItems,
  registerCourier,
  signUp,
  walkToReady,
  wingsCart,
  type MerchantStatus,
} from "./fixtures";

// An unauthenticated request must be refused; the design also accepts a
// redirect whose body carries no data, exactly as `curb-m1-s01` does.
const UNAUTHENTICATED = [401, 403, 301, 302, 303, 307, 308];

const expect2xx = (resp: APIResponse, label: string) => {
  expect(resp.status(), label).toBeGreaterThanOrEqual(200);
  expect(resp.status(), label).toBeLessThan(300);
};

const MERCHANT_WALK: MerchantStatus[] = ["accepted", "preparing", "ready"];

test.describe("curbside checkpoint 2", () => {
  // ---- regression rows carried over from milestone 1 ----
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
    expect((await me.json()).email).toBe(who.email);
  });

  test("curb-m1-05 menu items keep their integer cent prices", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    await kitchen.merchant.page.goto(`/restaurants/${kitchen.restaurantId}`);
    await expect(kitchen.merchant.page.getByTestId("menu-list")).toBeVisible({
      timeout: 15_000,
    });
    for (const dish of ALL_DISHES) {
      const row = menuItemRow(
        kitchen.merchant.page,
        kitchen.dish(dish),
      ).first();
      await expect(row).toBeVisible();
      await expectCents(
        row.getByTestId("menu-item-price"),
        PRICE_CENTS[dish],
        `${kitchen.dishName(dish)} menu-item-price data-cents`,
      );
    }
    const items = await readMenuItems(
      kitchen.merchant.ctx,
      kitchen.restaurantId,
    );
    for (const dish of ALL_DISHES) {
      const item = items.find((i) => String(i.id) === kitchen.dish(dish));
      expect(item, `${kitchen.dishName(dish)} in menuItems`).toBeTruthy();
      expect(item!.priceCents).toBe(PRICE_CENTS[dish]);
    }
  });

  test("curb-m1-07 placing the canonical cart still creates a server-priced order", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    // The id comes from the customer's own GET /api/orders, never the URL.
    expect((await orderIds(customer.ctx))[0]).toBe(orderId);
    await expect(customer.page).toHaveURL(
      new RegExp(`/orders/${escapeRe(orderId)}/?$`),
    );
    await expectCents(
      customer.page.getByTestId("order-subtotal"),
      CANONICAL_SUBTOTAL_CENTS,
      "order-subtotal data-cents",
    );
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "placed",
    );
  });

  test("curb-m1-10 a second customer still sees none of the first's orders", async ({
    curb,
  }) => {
    const world = await curb.world();
    // Positive control: the owner's own list demonstrably renders the row.
    await world.customer.page.goto("/orders");
    await expect(
      orderRow(world.customer.page, world.orderId).first(),
    ).toBeVisible({ timeout: 15_000 });
    const customer2 = await curb.customer("customer2");
    await customer2.page.goto("/orders");
    const empty = await customer2.page.getByTestId("orders-empty").count();
    const rows = await customer2.page.getByTestId("order-row").count();
    expect(
      empty > 0 || rows === 0,
      "customer2 sees orders-empty or no order rows",
    ).toBeTruthy();
    // Attribute-scoped, not a page substring — an integer order id collides
    // with the digits Next.js emits in every chunk src and flight payload.
    await expect(orderRow(customer2.page, world.orderId)).toHaveCount(0);
    expect(await listOrders(customer2.ctx)).toHaveLength(0);
  });

  // ---- new milestone 2 rows ----
  test("curb-m2-01 the merchant queue shows the merchant's own order", async ({
    curb,
  }) => {
    const world = await curb.world();
    // The customer's own order total, read from the pinned data-cents integer.
    await world.customer.page.goto(`/orders/${world.orderId}`);
    const customerTotal = await dataCents(
      world.customer.page.getByTestId("order-total"),
    );
    await world.merchant.page.goto("/merchant/orders");
    await expect(
      world.merchant.page.getByTestId("merchant-orders-list"),
    ).toBeVisible({ timeout: 15_000 });
    const row = merchantOrderRow(world.merchant.page, world.orderId).first();
    await expect(
      row,
      `merchant-order-row with data-order-id ${world.orderId}`,
    ).toBeVisible({ timeout: 15_000 });
    await expectCents(
      row.getByTestId("merchant-order-total"),
      customerTotal,
      "merchant-order-total data-cents matches the customer's order-total",
    );
  });

  test("curb-m2-02 the merchant walks the order accepted → preparing → ready", async ({
    curb,
  }) => {
    const world = await curb.world();
    for (const to of MERCHANT_WALK) {
      await merchantTransition(world.merchant, world.orderId, to);
      // Persisted across a reload of the merchant's own queue.
      await world.merchant.page.reload();
      const row = merchantOrderRow(world.merchant.page, world.orderId).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expectStatusText(row.getByTestId("merchant-order-status"), to);
      // The customer sees the same status on their own order detail page.
      await world.customer.page.goto(`/orders/${world.orderId}`);
      await expectStatusText(
        world.customer.page.getByTestId("order-detail-status"),
        to,
      );
      expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
        to,
      );
    }
  });

  test("curb-m2-03 a user registers as a courier", async ({ curb }) => {
    // Signed up and registered inline rather than through `curb.courier()`:
    // this row owns the registration contract.
    const courier = await curb.persona("courier");
    await registerCourier(courier);
    const me = await getMe(courier.ctx);
    expect(
      me.isCourier,
      "GET /api/me reports isCourier after registering",
    ).toBe(true);
    await courier.page.goto("/restaurants");
    await expect(courier.page.getByTestId("nav-courier")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("curb-m2-04 the available pool holds ready orders and not placed ones", async ({
    curb,
  }) => {
    const world = await curb.world();
    // A second order of this scenario's own, deliberately left in `placed`.
    const stillPlaced = await placeOrderFor(
      world.customer,
      world,
      wingsCart(world, 3),
    );
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    await courier.page.goto("/courier");
    await expect(
      availableRow(courier.page, world.orderId).first(),
      `available-row for the ready order ${world.orderId}`,
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      availableRow(courier.page, stillPlaced),
      "a placed order is not an available delivery",
    ).toHaveCount(0);
    expect(await customerStatusOf(world.customer.ctx, stillPlaced)).toBe(
      "placed",
    );
  });

  test("curb-m2-05 a courier claims a ready delivery", async ({ curb }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    await claimDelivery(courier, world.orderId);
    await courier.page.goto("/courier/deliveries");
    await expect(
      myDeliveryRow(courier.page, world.orderId).first(),
      `my-delivery-row for ${world.orderId}`,
    ).toBeVisible({ timeout: 15_000 });
    // It leaves the unclaimed pool.
    await courier.page.goto("/courier");
    await expect(
      availableRow(courier.page, world.orderId),
      "a claimed delivery leaves available-list",
    ).toHaveCount(0);
    // The customer sees the claiming courier's full display name.
    await world.customer.page.goto(`/orders/${world.orderId}`);
    await expect(
      world.customer.page.getByTestId("order-detail-courier"),
    ).toContainText(courier.who.name, { timeout: 15_000 });
  });

  test("curb-m2-06 the claiming courier marks picked_up then delivered", async ({
    curb,
  }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    await claimDelivery(courier, world.orderId);
    for (const to of ["picked_up", "delivered"] as const) {
      await courierTransition(courier, world.orderId, to);
      await courier.page.reload();
      const row = myDeliveryRow(courier.page, world.orderId).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expectStatusText(row.getByTestId("my-delivery-status"), to);
      await world.customer.page.goto(`/orders/${world.orderId}`);
      await expectStatusText(
        world.customer.page.getByTestId("order-detail-status"),
        to,
      );
    }
    // The merchant's own queue row ends at `delivered`.
    await world.merchant.page.goto("/merchant/orders");
    const queueRow = merchantOrderRow(
      world.merchant.page,
      world.orderId,
    ).first();
    await expect(queueRow).toBeVisible({ timeout: 15_000 });
    await expectStatusText(
      queueRow.getByTestId("merchant-order-status"),
      "delivered",
    );
  });

  test("curb-m2-07 a merchant queue never reaches another merchant's order", async ({
    curb,
  }) => {
    const world = await curb.world();
    const noodles = await curb.kitchen({ as: "merchant2" });
    const customer2 = await curb.customer("customer2");
    const otherOrderId = await placeOrderFor(
      customer2,
      noodles,
      wingsCart(noodles, 1),
    );
    await noodles.merchant.page.goto("/merchant/orders");
    // Positive control: merchant2's queue demonstrably renders their own order.
    await expect(
      merchantOrderRow(noodles.merchant.page, otherOrderId).first(),
      `merchant2's own merchant-order-row for ${otherOrderId}`,
    ).toBeVisible({ timeout: 15_000 });
    // Isolation: the Pizza order is nowhere in that queue.
    await expect(
      merchantOrderRow(noodles.merchant.page, world.orderId),
      "merchant2's queue must not contain the other merchant's order",
    ).toHaveCount(0);
    // The page-substring check that used to sit here matched the raw id against
    // a queue that legitimately renders merchant2's OWN order id and money
    // integers. The attribute-scoped assertion above and the API assertion
    // below carry the criterion without that collision.
    expect(
      findById(await listMerchantOrders(noodles.merchant.ctx), world.orderId),
      "GET /api/merchant/orders must not carry another merchant's order",
    ).toBeNull();
  });

  test("curb-m2-08 a plain customer gets neither the merchant nor the courier queue", async ({
    curb,
  }) => {
    // A fresh customer that creates no restaurant and never registers.
    const fresh = await curb.customer();
    const kitchen = await curb.kitchen();
    const courier = await curb.courier();
    const queueIds = [
      "merchant-orders-list",
      "merchant-orders-empty",
      "my-deliveries-list",
      "my-deliveries-empty",
    ];
    for (const path of ["/merchant/orders", "/courier/deliveries"]) {
      await fresh.page.goto(path);
      for (const id of queueIds) {
        await expect(
          fresh.page.getByTestId(id),
          `${path} must not render ${id} for a plain customer`,
        ).toHaveCount(0);
      }
    }
    await fresh.page.goto("/restaurants");
    await expect(
      fresh.page.getByTestId("nav-merchant"),
      "nav-merchant is for merchants only",
    ).toHaveCount(0);
    await expect(
      fresh.page.getByTestId("nav-courier"),
      "nav-courier is for couriers only",
    ).toHaveCount(0);
    // Positive controls: both pages do render for the entitled actor, so the
    // refusals above are the actor check rather than two dead pages.
    await kitchen.merchant.page.goto("/merchant/orders");
    expect(
      (await kitchen.merchant.page
        .getByTestId("merchant-orders-list")
        .count()) +
        (await kitchen.merchant.page
          .getByTestId("merchant-orders-empty")
          .count()),
      "the merchant's own /merchant/orders renders a queue",
    ).toBeGreaterThan(0);
    await expect(kitchen.merchant.page.getByTestId("nav-merchant")).toBeVisible(
      { timeout: 15_000 },
    );
    await courier.page.goto("/courier/deliveries");
    expect(
      (await courier.page.getByTestId("my-deliveries-list").count()) +
        (await courier.page.getByTestId("my-deliveries-empty").count()),
      "the courier's own /courier/deliveries renders a queue",
    ).toBeGreaterThan(0);
    await expect(courier.page.getByTestId("nav-courier")).toBeVisible({
      timeout: 15_000,
    });
  });

  // ---- security probes ----
  test("curb-m2-s01 a plain customer is refused all three actor-scoped lists", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    const courier = await curb.courier();
    // 401 is acceptable only if this context's session is demonstrably live.
    const me = await customer.ctx.request.get("/api/me");
    const allowed = me.status() === 200 ? [401, 403] : [403];
    for (const path of [
      "/api/merchant/orders",
      "/api/courier/deliveries/available",
      "/api/courier/deliveries",
    ]) {
      const resp = await customer.ctx.request.get(path, { maxRedirects: 0 });
      expect(allowed, `${path} for a plain customer`).toContain(resp.status());
      const body = await resp.text();
      // Field-matched, not substring-matched: a short integer id is a substring
      // of the money integers a queue row legitimately carries, so a raw
      // `.not.toContain(orderId)` would fail a correct app by coincidence.
      expectNoIdLeak(body, orderId, `${path} must not leak the order id`);
      expect(body, `${path} must not leak the restaurant name`).not.toContain(
        kitchen.restaurantName,
      );
    }
    // Positive controls: all three endpoints answer their entitled actor.
    const queue = await kitchen.merchant.ctx.request.get(
      "/api/merchant/orders",
    );
    expect(queue.status(), "the owning merchant's own queue").toBe(200);
    // Parsed, not substring-matched: a short integer id occurs inside the
    // money integers in this same body, so a text match could satisfy this
    // positive control even with the order absent.
    expect(
      findById(await listMerchantOrders(kitchen.merchant.ctx), orderId),
      "the owning merchant's queue carries their own order",
    ).not.toBeNull();
    for (const path of [
      "/api/courier/deliveries/available",
      "/api/courier/deliveries",
    ]) {
      const resp = await courier.ctx.request.get(path);
      expect(resp.status(), `${path} for a registered courier`).toBe(200);
    }
  });

  test("curb-m2-s02 a merchant cannot read or drive another merchant's order", async ({
    curb,
  }) => {
    const world = await curb.world();
    const noodles = await curb.kitchen({ as: "merchant2" });
    const customer2 = await curb.customer("customer2");
    const otherOrderId = await placeOrderFor(
      customer2,
      noodles,
      wingsCart(noodles, 1),
    );
    const queue = await noodles.merchant.ctx.request.get(
      "/api/merchant/orders",
      { maxRedirects: 0 },
    );
    expect(queue.status(), "merchant2's own queue").toBe(200);
    // Parse the queue rather than scanning its text: an integer order id is a
    // substring of the lineTotalCents/subtotalCents integers the same response
    // carries, so a raw .toContain / .not.toContain pair here fails a correct
    // app whose ids happen to be short.
    const queueRows = await listMerchantOrders(noodles.merchant.ctx);
    // Demonstrably renders their own order …
    expect(
      findById(queueRows, otherOrderId),
      "merchant2's own order is in their queue",
    ).not.toBeNull();
    // … and still does not reach another merchant's.
    expect(
      findById(queueRows, world.orderId),
      "merchant2's queue must not carry the Pizza order",
    ).toBeNull();
    // A legal edge from `placed` — for the *owning* merchant, not this one.
    const forged = await postTransition(
      noodles.merchant.ctx,
      world.orderId,
      "accepted",
    );
    expect(
      forged.status(),
      "a foreign merchant driving placed → accepted",
    ).toBe(403);
    expect(await merchantStatusOf(world.merchant.ctx, world.orderId)).toBe(
      "placed",
    );
    // Positive control: the owning merchant drives the very same edge.
    const own = await postTransition(
      world.merchant.ctx,
      world.orderId,
      "accepted",
    );
    expect2xx(own, "the owning merchant's own placed → accepted");
    await expect
      .poll(() => merchantStatusOf(world.merchant.ctx, world.orderId), {
        timeout: 15_000,
        message: "the owning merchant's own queue reads accepted",
      })
      .toBe("accepted");
  });

  test("curb-m2-s03 a courier cannot drive a merchant's edge", async ({
    curb,
  }) => {
    const world = await curb.world();
    // Setup drives placed → accepted through the merchant's own queue, so the
    // transition route is known to work: that is this probe's positive control.
    await merchantTransition(world.merchant, world.orderId, "accepted");
    const courier = await curb.courier();
    const resp = await postTransition(courier.ctx, world.orderId, "preparing");
    expect(
      resp.status(),
      "a courier driving the merchant's accepted → preparing",
    ).toBe(403);
    expect(await merchantStatusOf(world.merchant.ctx, world.orderId)).toBe(
      "accepted",
    );
  });

  test("curb-m2-s04 a customer cannot drive the claiming courier's edge", async ({
    curb,
  }) => {
    const world = await curb.world();
    // Setup walks the order and claims it through the pinned surfaces, so both
    // routes are known to work: that is this probe's positive control.
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    await claimDelivery(courier, world.orderId);
    const resp = await postTransition(
      world.customer.ctx,
      world.orderId,
      "picked_up",
    );
    expect(
      resp.status(),
      "the customer driving the courier's ready → picked_up",
    ).toBe(403);
    expect(await courierStatusOf(courier.ctx, world.orderId)).toBe("ready");
  });

  test("curb-m2-s05 a non-claiming courier can neither drive nor read the delivery", async ({
    curb,
  }) => {
    const world = await curb.world();
    const marker = world.dishName("margherita");
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    const courier2 = await curb.courier("courier2");
    // O's id comes from courier2's own available pool, before the claim.
    let pooled: string | null = null;
    await expect
      .poll(
        async () => {
          const row = findById(
            await listAvailableDeliveries(courier2.ctx),
            world.orderId,
          );
          pooled = row ? String(row.id) : null;
          return pooled;
        },
        {
          timeout: 20_000,
          message: `O in courier2's own GET /api/courier/deliveries/available`,
        },
      )
      .toBeTruthy();
    const orderId = pooled as unknown as string;
    await claimDelivery(courier, orderId);
    // A legal edge from `ready` — for the claiming courier, not this one.
    const forged = await postTransition(courier2.ctx, orderId, "picked_up");
    expect(
      forged.status(),
      "a non-claiming courier driving ready → picked_up",
    ).toBe(403);
    expect(await courierStatusOf(courier.ctx, orderId)).toBe("ready");
    const read = await courier2.ctx.request.get(`/api/orders/${orderId}`, {
      maxRedirects: 0,
    });
    expect(
      [403, 404],
      "a non-claiming courier reading the order detail",
    ).toContain(read.status());
    expect(await read.text()).not.toContain(marker);
    expect(
      findById(await listMyDeliveries(courier2.ctx), orderId),
      "courier2's own deliveries must not contain O",
    ).toBeNull();
    // Positive controls: the read route serves the order's own customer, and
    // the *claiming* courier drives the very same edge.
    const own = await world.customer.ctx.request.get(`/api/orders/${orderId}`);
    expect(own.status(), "the customer's own GET /api/orders/[id]").toBe(200);
    expect(await own.text()).toContain(marker);
    const claimed = await postTransition(courier.ctx, orderId, "picked_up");
    expect2xx(claimed, "the claiming courier's own ready → picked_up");
  });

  test("curb-m2-s06 a pool courier cannot read an order before claiming it", async ({
    curb,
  }) => {
    const world = await curb.world();
    const marker = world.dishName("margherita");
    await walkToReady(world.merchant, world.orderId);
    const courier2 = await curb.courier("courier2");
    // Setup: courier2 really is an unclaimed-pool courier that can see O.
    await expect
      .poll(
        async () =>
          Boolean(
            findById(
              await listAvailableDeliveries(courier2.ctx),
              world.orderId,
            ),
          ),
        {
          timeout: 20_000,
          message: `O in courier2's own available pool, unclaimed`,
        },
      )
      .toBe(true);
    const read = await courier2.ctx.request.get(
      `/api/orders/${world.orderId}`,
      { maxRedirects: 0 },
    );
    expect(
      [403, 404],
      "an unclaimed-pool courier reading the order detail",
    ).toContain(read.status());
    // The pool may name the restaurant; the order's lines are readable only
    // after a claim, so the verdict is carried by a line name.
    expect(await read.text()).not.toContain(marker);
    // Positive control: the same route serves the order's own customer.
    const own = await world.customer.ctx.request.get(
      `/api/orders/${world.orderId}`,
    );
    expect(own.status(), "the customer's own GET /api/orders/[id]").toBe(200);
    expect(await own.text()).toContain(marker);
  });

  test("curb-m2-s07 unauthenticated actor surfaces, transitions and claims are refused", async ({
    curb,
  }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    // O's id is read from the owning merchant's own pinned queue.
    const queued = findById(
      await listMerchantOrders(world.merchant.ctx),
      world.orderId,
    );
    expect(
      queued,
      "O in its own merchant's GET /api/merchant/orders",
    ).toBeTruthy();
    const orderId = String(queued!.id);
    const courier = await curb.courier();
    const anon = await curb.anon();
    const attempts: Array<[string, APIResponse]> = [
      [
        "GET /api/merchant/orders",
        await anon.get("/api/merchant/orders", { maxRedirects: 0 }),
      ],
      [
        "GET /api/courier/deliveries/available",
        await anon.get("/api/courier/deliveries/available", {
          maxRedirects: 0,
        }),
      ],
      [
        "GET /api/courier/deliveries",
        await anon.get("/api/courier/deliveries", { maxRedirects: 0 }),
      ],
      [
        `POST /api/orders/${orderId}/transition`,
        await anon.post(`/api/orders/${orderId}/transition`, {
          data: { to: "picked_up" },
          maxRedirects: 0,
        }),
      ],
      [
        `POST /api/deliveries/${orderId}/claim`,
        await anon.post(`/api/deliveries/${orderId}/claim`, {
          maxRedirects: 0,
        }),
      ],
    ];
    for (const [label, resp] of attempts) {
      expect(UNAUTHENTICATED, `${label} without a session`).toContain(
        resp.status(),
      );
      const body = await resp.text();
      // See curb-m2-s01: the id is matched as a field, never as a substring.
      expectNoIdLeak(body, orderId, `${label} must not leak the order id`);
      for (const who of [world.customer.who, world.merchant.who]) {
        expect(body, `${label} must not leak ${who.email}`).not.toContain(
          who.email,
        );
      }
    }
    // Nothing moved: still `ready`, still unclaimed.
    const after = findById(
      await listMerchantOrders(world.merchant.ctx),
      orderId,
    );
    expect(after, "O in its own merchant's queue").toBeTruthy();
    expect(
      String(after!.status),
      "O is untouched by the anonymous writes",
    ).toBe("ready");
    expect(
      after!.courierId ?? null,
      "O is still unclaimed after the anonymous claim",
    ).toBeNull();
    // Positive control, strictly after that re-read: a registered courier's own
    // claim of the same delivery succeeds.
    const claim = await postClaim(courier.ctx, orderId);
    expect2xx(claim, "a registered courier's own claim");
    const courierId = await courier.userId();
    await expect
      .poll(() => courierIdOf(courier.ctx, orderId), {
        timeout: 15_000,
        message: "O carries the claiming courier's id in their own deliveries",
      })
      .toBe(courierId);
  });

  test("curb-m2-s08 the correct merchant is still refused an illegal edge", async ({
    curb,
  }) => {
    const world = await curb.world();
    for (const to of ["ready", "delivered"] as const) {
      const resp = await postTransition(world.merchant.ctx, world.orderId, to);
      expect(
        resp.status(),
        `placed → ${to} is illegal even for the owning merchant`,
      ).toBe(409);
    }
    // No intermediate status was persisted, on either actor's own surface.
    expect(await merchantStatusOf(world.merchant.ctx, world.orderId)).toBe(
      "placed",
    );
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "placed",
    );
    // Positive control: the one edge that *is* legal from `placed` for this
    // actor — without it, a route that answers 409 to everything would pass.
    const legal = await postTransition(
      world.merchant.ctx,
      world.orderId,
      "accepted",
    );
    expect2xx(legal, "the owning merchant's own placed → accepted");
    await expect
      .poll(() => merchantStatusOf(world.merchant.ctx, world.orderId), {
        timeout: 15_000,
        message: "O reads accepted in the owning merchant's own queue",
      })
      .toBe("accepted");
  });
});
