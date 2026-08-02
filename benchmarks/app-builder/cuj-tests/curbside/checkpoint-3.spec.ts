// Curbside — checkpoint 3 CUJ suite (design/app-6-curbside.md, M3 CUJ table +
// M3 security probes). 12 CUJs (4 regression + 8 new) + 10 probes.
//
// Conventions (design "Test fixtures & conventions"): every scenario provisions
// its own personas, restaurant, menu items and orders through the `curb`
// fixture — nothing is inherited from a sibling scenario, so a failure can never
// skip (and thereby silently void) another row, and the per-restaurant
// aggregates M3 introduces (`restaurant-average-rating`) are stable because the
// restaurant only ever carries this scenario's own ratings. Ids come only from
// pinned surfaces (GET /api/me, GET /api/restaurants[/id], GET /api/orders,
// GET /api/merchant/orders, GET /api/courier/deliveries[/available], and the
// pinned data-* attributes); money is read only from the integer `data-cents`
// attribute and star counts only from `data-stars` / `data-rating`, never from a
// formatted string.
import type { APIResponse, Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  CANONICAL_SUBTOTAL_CENTS,
  CANONICAL_TAX_CENTS,
  DELIVERY_FEE_CENTS,
  WINGS3_SUBTOTAL_CENTS,
  WINGS3_TAX_CENTS,
  availableRow,
  buildCart,
  canonicalCart,
  cancelOrderViaUi,
  claimDelivery,
  courierIdOf,
  courierStatusOf,
  courierTransition,
  customerStatusOf,
  dataCents,
  deliverOrder,
  escapeRe,
  expectCents,
  expectOrderPageDenied,
  expectRating,
  expectStars,
  expectStatusText,
  findById,
  getMe,
  listAvailableDeliveries,
  listMyDeliveries,
  menuItemRow,
  merchantOrderRow,
  merchantStatusOf,
  merchantTransition,
  myDeliveryRow,
  orderIds,
  placeOrder,
  placeOrderFor,
  postCancel,
  postClaim,
  postOrder,
  postRate,
  rateOrderViaUi,
  readOrder,
  setTip,
  walkToReady,
  wingsCart,
  type MerchantStatus,
  type Persona,
} from "./fixtures";

// The M3 pricing rule, expressed from the pinned fixture constants so no
// assertion ever restates a number the design did not pin.
const TIP_CENTS = 500;
// 1797 + 153 + 299 + 500 = 2749
const CANONICAL_TOTAL_WITH_TIP_CENTS =
  CANONICAL_SUBTOTAL_CENTS +
  CANONICAL_TAX_CENTS +
  DELIVERY_FEE_CENTS +
  TIP_CENTS;
// 2697 + 229 + 299 + 0 = 3225
const WINGS3_TOTAL_CENTS =
  WINGS3_SUBTOTAL_CENTS + WINGS3_TAX_CENTS + DELIVERY_FEE_CENTS;

const expect2xx = (resp: APIResponse, label: string) => {
  expect(resp.status(), label).toBeGreaterThanOrEqual(200);
  expect(resp.status(), label).toBeLessThan(300);
};

/** M3 pins a 400 *with* a JSON `{ "error": "<message>" }` body on bad writes. */
async function expectJsonError(resp: APIResponse, label: string) {
  expect(resp.status(), `${label} is rejected with 400`).toBe(400);
  const body = (await resp.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  expect(typeof body?.error, `${label} answers a JSON error body`).toBe(
    "string",
  );
}

/**
 * The id of the order a POST created: from the pinned created object, falling
 * back to the single new id in the *posting* customer's own list. Never scraped
 * from a URL.
 */
async function createdOrderId(
  resp: APIResponse,
  customer: Persona,
  before: string[],
): Promise<string> {
  const body = (await resp.json().catch(() => null)) as { id?: unknown } | null;
  if (body?.id != null) return String(body.id);
  const seen = new Set(before);
  const found =
    (await orderIds(customer.ctx)).find((id) => !seen.has(id)) ?? "";
  expect(
    found,
    "the created order's id from the customer's own GET /api/orders",
  ).toBeTruthy();
  return found;
}

/**
 * The id of the order just placed through the UI, from the placing customer's
 * own pinned `GET /api/orders`. Used where a scenario has to assert the checkout
 * *before* placing, so `placeOrderFor` (which builds the cart itself) cannot be
 * used.
 */
async function newOrderIdAfterPlacing(
  customer: Persona,
  before: Set<string>,
): Promise<string> {
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

/** The five pinned order-detail amounts, plus the exact M3 identity. */
async function expectOrderBreakdown(
  page: Page,
  want: {
    subtotal: number;
    tax: number;
    fee: number;
    tip: number;
    total: number;
  },
) {
  await expectCents(
    page.getByTestId("order-subtotal"),
    want.subtotal,
    "order-subtotal data-cents",
  );
  await expectCents(
    page.getByTestId("order-tax"),
    want.tax,
    "order-tax data-cents (8.5% of the subtotal, rounded half-up)",
  );
  await expectCents(
    page.getByTestId("order-delivery-fee"),
    want.fee,
    "order-delivery-fee data-cents",
  );
  await expectCents(
    page.getByTestId("order-tip"),
    want.tip,
    "order-tip data-cents",
  );
  await expectCents(
    page.getByTestId("order-total"),
    want.total,
    "order-total data-cents",
  );
  // The identity is re-derived from the pinned integer attributes themselves,
  // so it is the rendered breakdown that has to add up — not the constants.
  const [subtotal, tax, fee, tip, total] = await Promise.all([
    dataCents(page.getByTestId("order-subtotal")),
    dataCents(page.getByTestId("order-tax")),
    dataCents(page.getByTestId("order-delivery-fee")),
    dataCents(page.getByTestId("order-tip")),
    dataCents(page.getByTestId("order-total")),
  ]);
  expect(
    subtotal + tax + fee + tip,
    "subtotal + tax + fee + tip === total, exactly, in integer cents",
  ).toBe(total);
}

/**
 * The restaurant's pinned `data-rating`, or null while the page shows no
 * average at all. Non-asserting: `curb-m3-s06` needs "unchanged, or still
 * absent" as one observation.
 */
async function readAverageRating(
  page: Page,
  restaurantId: string,
): Promise<string | null> {
  await page.goto(`/restaurants/${restaurantId}`);
  const el = page.getByTestId("restaurant-average-rating").first();
  if ((await page.getByTestId("restaurant-average-rating").count()) === 0) {
    return null;
  }
  return el.getAttribute("data-rating");
}

/** True when a pinned numeric input refused the value that was typed into it. */
async function inputRejected(input: Locator, typed: string): Promise<boolean> {
  if ((await input.count()) === 0) return false;
  const el = input.first();
  const value = await el.inputValue().catch(() => null);
  if (value !== null && value !== typed) return true;
  return el
    .evaluate((node) => {
      const field = node as HTMLInputElement;
      return (
        typeof field.checkValidity === "function" && !field.checkValidity()
      );
    })
    .catch(() => false);
}

/**
 * Try to place whatever cart is on screen and report whether the app refused.
 * The design accepts either a message in `cart-error` or a refusal before the
 * submission can happen at all (an absent or disabled `place-order-button`), so
 * both count; navigating to a new order's detail page is the one outcome that
 * is definitely *not* a refusal.
 */
async function tryPlace(
  page: Page,
): Promise<{ refused: boolean; why: string }> {
  const button = page.getByTestId("place-order-button").first();
  if ((await page.getByTestId("place-order-button").count()) === 0) {
    return { refused: true, why: "no place-order-button is rendered" };
  }
  if (!(await button.isEnabled().catch(() => false))) {
    return { refused: true, why: "place-order-button is not actionable" };
  }
  await button.click().catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  if (/\/orders\/[^/?#]+$/.test(new URL(page.url()).pathname)) {
    return {
      refused: false,
      why: `it placed an order and went to ${page.url()}`,
    };
  }
  const errored =
    (await page.getByTestId("cart-error").count()) > 0 &&
    (await page
      .getByTestId("cart-error")
      .first()
      .isVisible()
      .catch(() => false));
  return errored
    ? { refused: true, why: "cart-error carries the refusal" }
    : {
        refused: false,
        why: "the submission neither showed cart-error nor was blocked",
      };
}

test.describe("curbside checkpoint 3", () => {
  // ---- regression rows carried over from M1/M2 ----
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
    await expectCents(
      customer.page.getByTestId("order-subtotal"),
      CANONICAL_SUBTOTAL_CENTS,
      "order-subtotal data-cents",
    );
  });

  test("curb-m2-02 the merchant still walks an order accepted → preparing → ready", async ({
    curb,
  }) => {
    const world = await curb.world();
    for (const to of ["accepted", "preparing", "ready"] as MerchantStatus[]) {
      await merchantTransition(world.merchant, world.orderId, to);
      // Persistence across a reload is the whole point of this row: a status
      // held only in client state would satisfy the click but not this.
      await world.merchant.page.goto("/merchant/orders");
      await world.merchant.page.reload();
      await expectStatusText(
        merchantOrderRow(world.merchant.page, world.orderId).getByTestId(
          "merchant-order-status",
        ),
        to,
      );
      expect(await merchantStatusOf(world.merchant.ctx, world.orderId)).toBe(
        to,
      );
    }
  });

  test("curb-m2-05 a courier still claims a ready delivery out of the pool", async ({
    curb,
  }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    await claimDelivery(courier, world.orderId);
    await courier.page.goto("/courier/deliveries");
    await expect(
      myDeliveryRow(courier.page, world.orderId).first(),
      `my-delivery-row with data-order-id ${world.orderId}`,
    ).toBeVisible({ timeout: 15_000 });
    // …and it leaves the unclaimed pool.
    await courier.page.goto("/courier");
    await courier.page.reload();
    await expect(
      availableRow(courier.page, world.orderId),
      "a claimed delivery is no longer in available-list",
    ).toHaveCount(0);
    expect(
      findById(await listAvailableDeliveries(courier.ctx), world.orderId),
    ).toBeNull();
  });

  test("curb-m2-06 the claiming courier still marks picked_up then delivered", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await walkToReady(world.merchant, world.orderId);
    await claimDelivery(courier, world.orderId);
    await courierTransition(courier, world.orderId, "picked_up");
    await courierTransition(courier, world.orderId, "delivered");
    await courier.page.goto("/courier/deliveries");
    await expectStatusText(
      myDeliveryRow(courier.page, world.orderId).getByTestId(
        "my-delivery-status",
      ),
      "delivered",
    );
    // The customer's own detail page projects the same order as delivered.
    await world.customer.page.goto(`/orders/${world.orderId}`);
    await expectStatusText(
      world.customer.page.getByTestId("order-detail-status"),
      "delivered",
    );
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "delivered",
    );
  });

  // ---- new M3 rows ----
  test("curb-m3-01 the checkout and the order agree on the exact breakdown", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const before = new Set(await orderIds(customer.ctx));
    await buildCart(
      customer.page,
      kitchen.restaurantId,
      canonicalCart(kitchen),
    );
    await setTip(customer.page, TIP_CENTS);
    // Before placing: the checkout shows the same breakdown the order will.
    await expectCents(
      customer.page.getByTestId("cart-subtotal"),
      CANONICAL_SUBTOTAL_CENTS,
      "cart-subtotal data-cents",
    );
    await expectCents(
      customer.page.getByTestId("cart-tax"),
      CANONICAL_TAX_CENTS,
      "cart-tax data-cents (8.5% of 1797 is 152.745 — half-up is 153, truncation 152)",
    );
    await expectCents(
      customer.page.getByTestId("cart-delivery-fee"),
      DELIVERY_FEE_CENTS,
      "cart-delivery-fee data-cents",
    );
    await expectCents(
      customer.page.getByTestId("cart-total"),
      CANONICAL_TOTAL_WITH_TIP_CENTS,
      "cart-total data-cents includes the tip currently entered",
    );
    await placeOrder(customer.page);
    const orderId = await newOrderIdAfterPlacing(customer, before);
    await customer.page.goto(`/orders/${orderId}`);
    await expectOrderBreakdown(customer.page, {
      subtotal: CANONICAL_SUBTOTAL_CENTS,
      tax: CANONICAL_TAX_CENTS,
      fee: DELIVERY_FEE_CENTS,
      tip: TIP_CENTS,
      total: CANONICAL_TOTAL_WITH_TIP_CENTS,
    });
  });

  test("curb-m3-02 a 3× Wings order prices to 2697/229/299/0/3225", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      wingsCart(kitchen, 3),
      {
        tipCents: 0,
      },
    );
    await customer.page.goto(`/orders/${orderId}`);
    await expectOrderBreakdown(customer.page, {
      subtotal: WINGS3_SUBTOTAL_CENTS,
      tax: WINGS3_TAX_CENTS,
      fee: DELIVERY_FEE_CENTS,
      tip: 0,
      total: WINGS3_TOTAL_CENTS,
    });
  });

  test("curb-m3-03 a placed order cancels and an accepted one is refused", async ({
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
    // The second is still `placed`, so cancelling it is allowed.
    await cancelOrderViaUi(customer, second);
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "cancelled",
    );
    expect(await customerStatusOf(customer.ctx, second)).toBe("cancelled");
    // The merchant accepts the first; cancelling it must now be refused on the
    // server, with the refusal reported in the pinned error element.
    await merchantTransition(kitchen.merchant, first, "accepted");
    await cancelOrderViaUi(customer, first);
    await expect(
      customer.page.getByTestId("order-cancel-error"),
      "order-cancel-error reports the server's refusal",
    ).toBeVisible({ timeout: 15_000 });
    await customer.page.reload();
    await expectStatusText(
      customer.page.getByTestId("order-detail-status"),
      "accepted",
    );
    expect(await customerStatusOf(customer.ctx, first)).toBe("accepted");
  });

  test("curb-m3-04 the customer rates a delivered order five stars", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await deliverOrder(world.merchant, courier, world.orderId);
    await rateOrderViaUi(world.customer, world.orderId, 5);
    await expectStars(world.customer.page.getByTestId("order-rating"), 5);
    await world.customer.page.reload();
    await expectStars(world.customer.page.getByTestId("order-rating"), 5);
    const order = await readOrder(world.customer.ctx, world.orderId);
    expect(order, `GET /api/orders/${world.orderId}`).toBeTruthy();
    expect(order!.ratingStars, "ratingStars on the pinned order object").toBe(
      5,
    );
  });

  test("curb-m3-05 a second rating on the same order is refused", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await deliverOrder(world.merchant, courier, world.orderId);
    await rateOrderViaUi(world.customer, world.orderId, 5);
    await expectStars(world.customer.page.getByTestId("order-rating"), 5);
    // Second submission, three stars this time.
    await rateOrderViaUi(world.customer, world.orderId, 3);
    await expect(
      world.customer.page.getByTestId("order-rate-error"),
      "order-rate-error reports the refused re-rating",
    ).toBeVisible({ timeout: 15_000 });
    await world.customer.page.reload();
    await expectStars(world.customer.page.getByTestId("order-rating"), 5);
    const order = await readOrder(world.customer.ctx, world.orderId);
    expect(order!.ratingStars, "the original rating stands").toBe(5);
  });

  test("curb-m3-06 a restaurant averages its ratings to one decimal", async ({
    curb,
  }) => {
    // Both ratings are placed on this scenario's own restaurant, which is why
    // the exact average is stable: those are the only two ratings it can carry.
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const courier = await curb.courier();
    const first = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    await deliverOrder(kitchen.merchant, courier, first);
    await rateOrderViaUi(customer, first, 5);
    await expectStars(customer.page.getByTestId("order-rating"), 5);
    const customer2 = await curb.customer("customer2");
    const second = await placeOrderFor(
      customer2,
      kitchen,
      wingsCart(kitchen, 3),
    );
    await deliverOrder(kitchen.merchant, courier, second);
    await rateOrderViaUi(customer2, second, 3);
    await expectStars(customer2.page.getByTestId("order-rating"), 3);
    await customer.page.goto(`/restaurants/${kitchen.restaurantId}`);
    await expectRating(customer.page, "4.0");
  });

  test("curb-m3-07 the checkout refuses a zero quantity, an empty cart and a negative tip", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const before = (await orderIds(customer.ctx)).length;

    // (1) quantity 0. The input is read back *before* the add click, so an app
    // that merely resets the field after adding cannot be mistaken for one that
    // rejected the value.
    await customer.page.goto(`/restaurants/${kitchen.restaurantId}`);
    const margherita = menuItemRow(
      customer.page,
      kitchen.dish("margherita"),
    ).first();
    await expect(margherita, "the Margherita menu-item row").toBeVisible({
      timeout: 15_000,
    });
    const qtyInput = margherita.getByTestId("menu-item-qty");
    let zeroAttempt: { refused: boolean; why: string };
    if ((await qtyInput.count()) === 0) {
      zeroAttempt = {
        refused: false,
        why: "no menu-item-qty input is rendered",
      };
    } else {
      await qtyInput.first().fill("0");
      if (await inputRejected(qtyInput, "0")) {
        zeroAttempt = {
          refused: true,
          why: "menu-item-qty rejected the value",
        };
      } else {
        await margherita.getByTestId("menu-item-add").first().click();
        zeroAttempt = await tryPlace(customer.page);
      }
    }
    expect(
      zeroAttempt.refused,
      `a zero-quantity cart must be refused (${zeroAttempt.why})`,
    ).toBeTruthy();
    expect(
      (await orderIds(customer.ctx)).length,
      "the zero-quantity attempt created nothing",
    ).toBe(before);

    // (2) an empty cart, on a freshly opened restaurant page.
    await customer.page.goto(`/restaurants/${kitchen.restaurantId}`);
    const emptyMarker = await customer.page.getByTestId("cart-empty").count();
    const lines = await customer.page.getByTestId("cart-line").count();
    expect(
      emptyMarker > 0 || lines === 0,
      "a freshly opened restaurant page shows cart-empty or no cart lines",
    ).toBeTruthy();
    const emptyAttempt = await tryPlace(customer.page);
    expect(
      emptyAttempt.refused,
      `an empty cart must not be placeable (${emptyAttempt.why})`,
    ).toBeTruthy();
    expect(
      (await orderIds(customer.ctx)).length,
      "the empty-cart attempt created nothing",
    ).toBe(before);

    // (3) the canonical cart with a negative tip.
    await buildCart(
      customer.page,
      kitchen.restaurantId,
      canonicalCart(kitchen),
    );
    await setTip(customer.page, -100);
    const tipRefused = await inputRejected(
      customer.page.getByTestId("checkout-tip-cents"),
      "-100",
    );
    const tipAttempt = tipRefused
      ? { refused: true, why: "checkout-tip-cents rejected the value" }
      : await tryPlace(customer.page);
    expect(
      tipAttempt.refused,
      `a negative tip must be refused (${tipAttempt.why})`,
    ).toBeTruthy();
    expect(
      (await orderIds(customer.ctx)).length,
      "the negative-tip attempt created nothing",
    ).toBe(before);

    // Positive control: the same checkout places the canonical cart with tip 0,
    // so the three refusals are validation firing rather than a checkout that
    // never places anything.
    const orderId = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
      { tipCents: 0 },
    );
    expect(
      (await orderIds(customer.ctx)).length,
      "the clean checkout adds exactly one order",
    ).toBe(before + 1);
    const order = await readOrder(customer.ctx, orderId);
    expect(order!.subtotalCents).toBe(CANONICAL_SUBTOTAL_CENTS);
  });

  test("curb-m3-08 a claimed delivery is invisible to a second courier", async ({
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
    await walkToReady(kitchen.merchant, first);
    await walkToReady(kitchen.merchant, second);
    const courier = await curb.courier();
    await claimDelivery(courier, first);
    await courierTransition(courier, first, "picked_up");
    const courier2 = await curb.courier("courier2");
    await courier2.page.goto("/courier");
    // Positive control: the pool demonstrably renders for courier2 — the second
    // order is still `ready` and unclaimed.
    await expect(
      availableRow(courier2.page, second).first(),
      `available-row with data-order-id ${second} for courier2`,
    ).toBeVisible({ timeout: 15_000 });
    // Isolation: the claimed order is in neither of courier2's surfaces.
    await expect(
      availableRow(courier2.page, first),
      "a claimed delivery is not in another courier's available-list",
    ).toHaveCount(0);
    await courier2.page.goto("/courier/deliveries");
    await expect(
      myDeliveryRow(courier2.page, first),
      "a delivery claimed by somebody else is not in courier2's my-deliveries-list",
    ).toHaveCount(0);
    expect(findById(await listMyDeliveries(courier2.ctx), first)).toBeNull();
  });

  // ---- security probes ----
  test("curb-m3-s01 a second sequential claim is refused and the first courier keeps the delivery", async ({
    curb,
  }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    const courier2 = await curb.courier("courier2");
    // Both couriers really can see O in their own pools — that is where the id
    // courier2 attacks with comes from, and it makes the 409 below meaningful.
    expect(
      findById(await listAvailableDeliveries(courier.ctx), world.orderId),
      "courier sees O in the available pool before claiming",
    ).not.toBeNull();
    expect(
      findById(await listAvailableDeliveries(courier2.ctx), world.orderId),
      "courier2 sees O in the available pool before the first claim",
    ).not.toBeNull();
    // The successful first claim is this probe's in-test positive control.
    const first = await postClaim(courier.ctx, world.orderId);
    expect2xx(first, "the first courier's claim");
    const second = await postClaim(courier2.ctx, world.orderId);
    expect(
      second.status(),
      "a claim on an already-claimed delivery is a 409",
    ).toBe(409);
    const courierId = String((await getMe(courier.ctx)).id);
    expect(
      await courierIdOf(courier.ctx, world.orderId),
      "O still belongs to the first courier in that courier's own deliveries",
    ).toBe(courierId);
    expect(
      findById(await listMyDeliveries(courier2.ctx), world.orderId),
      "courier2's own deliveries never contain O",
    ).toBeNull();
    expect(
      await courierStatusOf(courier.ctx, world.orderId),
      "the refused claim changed no status",
    ).toBe("ready");
  });

  test("curb-m3-s02 six concurrent claims produce exactly one winner", async ({
    curb,
  }) => {
    // This probe's own `ready`, unclaimed order on its own restaurant.
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const courier = await curb.courier();
    const courier2 = await curb.courier("courier2");
    const responses = await Promise.all([
      postClaim(courier.ctx, world.orderId),
      postClaim(courier.ctx, world.orderId),
      postClaim(courier.ctx, world.orderId),
      postClaim(courier2.ctx, world.orderId),
      postClaim(courier2.ctx, world.orderId),
      postClaim(courier2.ctx, world.orderId),
    ]);
    const statuses = responses.map((r) => r.status());
    expect(
      statuses.filter((s) => s >= 200 && s < 300).length,
      `exactly one of six simultaneous claims may succeed (got ${statuses.join(", ")})`,
    ).toBe(1);
    expect(
      statuses.filter((s) => s >= 400).length,
      `the other five are refused (got ${statuses.join(", ")})`,
    ).toBe(5);
    // The invariant regardless of who won: exactly one courier owns O, and the
    // stored courierId is that courier's own id.
    const mine = findById(await listMyDeliveries(courier.ctx), world.orderId);
    const theirs = findById(
      await listMyDeliveries(courier2.ctx),
      world.orderId,
    );
    const owners = [mine, theirs].filter(Boolean);
    expect(
      owners.length,
      "exactly one of the two couriers lists the contested delivery",
    ).toBe(1);
    const winner = mine ? courier : courier2;
    expect(
      String(owners[0]!.courierId),
      "the winner's delivery carries the winner's own /api/me id",
    ).toBe(String((await getMe(winner.ctx)).id));
  });

  test("curb-m3-s03 cancelling an accepted order is refused by the status rule", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const accepted = await placeOrderFor(
      customer,
      kitchen,
      canonicalCart(kitchen),
    );
    const stillPlaced = await placeOrderFor(
      customer,
      kitchen,
      wingsCart(kitchen, 3),
    );
    await merchantTransition(kitchen.merchant, accepted, "accepted");
    const resp = await postCancel(customer.ctx, accepted);
    expect(resp.status(), "cancelling an accepted order").toBe(409);
    expect(
      await customerStatusOf(customer.ctx, accepted),
      "the customer's own re-read still says accepted",
    ).toBe("accepted");
    expect(
      await merchantStatusOf(kitchen.merchant.ctx, accepted),
      "the merchant's own queue still says accepted",
    ).toBe("accepted");
    // Positive control: the same route, the same customer, an order that is
    // still `placed` — so the 409 was the status rule, not a dead cancel route.
    const allowed = await postCancel(customer.ctx, stillPlaced);
    expect2xx(allowed, "cancelling an order that is still placed");
    expect(await customerStatusOf(customer.ctx, stillPlaced)).toBe("cancelled");
  });

  test("curb-m3-s04 a second customer cannot cancel somebody else's order", async ({
    curb,
  }) => {
    const world = await curb.world();
    const customer2 = await curb.customer("customer2");
    const resp = await postCancel(customer2.ctx, world.orderId);
    expect([403, 404], "a non-owner's cancel").toContain(resp.status());
    expect(
      await customerStatusOf(world.customer.ctx, world.orderId),
      "the owner re-reads the order and it is still placed",
    ).toBe("placed");
    // Positive control: the same route on the same order, called by its owner.
    const own = await postCancel(world.customer.ctx, world.orderId);
    expect2xx(own, "the owning customer's own cancel");
    expect(await customerStatusOf(world.customer.ctx, world.orderId)).toBe(
      "cancelled",
    );
  });

  test("curb-m3-s05 the order endpoint validates its body and prices the cart itself", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const items = [
      { menuItemId: kitchen.dish("margherita"), quantity: 1 },
      { menuItemId: kitchen.dish("soda"), quantity: 2 },
    ];
    const before = await orderIds(customer.ctx);
    // Each post carries this probe's own valid restaurantId, so nothing but the
    // rule under test can be the ground for a 400.
    const negativeTip = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items,
      tipCents: -100,
    });
    await expectJsonError(negativeTip, "a negative tip");
    const zeroQuantity = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items: [{ menuItemId: kitchen.dish("margherita"), quantity: 0 }],
    });
    await expectJsonError(zeroQuantity, "a zero quantity");
    const emptyCart = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items: [],
    });
    await expectJsonError(emptyCart, "an empty cart");
    expect(
      (await orderIds(customer.ctx)).length,
      "none of the three rejected posts created an order",
    ).toBe(before.length);

    // Forged money: either 400, or created with server-computed values and only
    // the tip honoured.
    const forgedBefore = await orderIds(customer.ctx);
    const forged = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items,
      tipCents: TIP_CENTS,
      taxCents: 0,
      deliveryFeeCents: 0,
      subtotalCents: 1,
      totalCents: 1,
    });
    if (forged.status() >= 400) {
      expect(forged.status(), "a rejected forged-money order is a 400").toBe(
        400,
      );
      expect(
        (await orderIds(customer.ctx)).length,
        "a rejected forged-money order creates nothing",
      ).toBe(forgedBefore.length);
    } else {
      const forgedId = await createdOrderId(forged, customer, forgedBefore);
      const order = await readOrder(customer.ctx, forgedId);
      expect(order, `GET /api/orders/${forgedId}`).toBeTruthy();
      expect(order!.subtotalCents, "the server prices the cart").toBe(
        CANONICAL_SUBTOTAL_CENTS,
      );
      expect(order!.taxCents).toBe(CANONICAL_TAX_CENTS);
      expect(order!.deliveryFeeCents).toBe(DELIVERY_FEE_CENTS);
      expect(
        order!.tipCents,
        "the tip is the one money field a client may set",
      ).toBe(TIP_CENTS);
      expect(order!.totalCents).toBe(CANONICAL_TOTAL_WITH_TIP_CENTS);
      expect(
        Number(order!.subtotalCents) +
          Number(order!.taxCents) +
          Number(order!.deliveryFeeCents) +
          Number(order!.tipCents),
        "subtotal + tax + fee + tip === total",
      ).toBe(Number(order!.totalCents));
    }

    // Positive control: a clean post with no forged money fields at all — so no
    // 400 above can be a create route that refuses everything.
    const cleanBefore = await orderIds(customer.ctx);
    const clean = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items,
      tipCents: TIP_CENTS,
    });
    expect2xx(clean, "a clean POST /api/orders");
    const cleanId = await createdOrderId(clean, customer, cleanBefore);
    const cleanOrder = await readOrder(customer.ctx, cleanId);
    expect(cleanOrder, `GET /api/orders/${cleanId}`).toBeTruthy();
    expect(cleanOrder!.subtotalCents).toBe(CANONICAL_SUBTOTAL_CENTS);
    expect(cleanOrder!.taxCents).toBe(CANONICAL_TAX_CENTS);
    expect(cleanOrder!.deliveryFeeCents).toBe(DELIVERY_FEE_CENTS);
    expect(cleanOrder!.tipCents).toBe(TIP_CENTS);
    expect(cleanOrder!.totalCents).toBe(CANONICAL_TOTAL_WITH_TIP_CENTS);
  });

  test("curb-m3-s06 an order that is not delivered cannot be rated", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await walkToReady(world.merchant, world.orderId);
    await claimDelivery(courier, world.orderId);
    await courierTransition(courier, world.orderId, "picked_up");
    const ratingBefore = await readAverageRating(
      world.customer.page,
      world.restaurantId,
    );
    const resp = await postRate(world.customer.ctx, world.orderId, 5);
    expect(resp.status(), "rating an order that is not delivered").toBe(409);
    const order = await readOrder(world.customer.ctx, world.orderId);
    expect(order, `GET /api/orders/${world.orderId}`).toBeTruthy();
    expect(
      order!.ratingStars ?? null,
      "the refused rating was not stored",
    ).toBeNull();
    expect(
      await readAverageRating(world.customer.page, world.restaurantId),
      "the restaurant's average rating is unchanged by the refused rating",
    ).toBe(ratingBefore);
    // Positive control: the only thing that changes is the status the rule keys
    // on — the claiming courier delivers, and the identical rate call succeeds.
    await courierTransition(courier, world.orderId, "delivered");
    const allowed = await postRate(world.customer.ctx, world.orderId, 5);
    expect2xx(allowed, "rating the same order once it is delivered");
    const rated = await readOrder(world.customer.ctx, world.orderId);
    expect(rated!.ratingStars).toBe(5);
  });

  test("curb-m3-s07 a second customer cannot rate somebody else's delivered order", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await deliverOrder(world.merchant, courier, world.orderId);
    const customer2 = await curb.customer("customer2");
    const resp = await postRate(customer2.ctx, world.orderId, 1);
    expect(resp.status(), "rating somebody else's order").toBe(403);
    const order = await readOrder(world.customer.ctx, world.orderId);
    expect(order, `GET /api/orders/${world.orderId}`).toBeTruthy();
    expect(
      order!.ratingStars ?? null,
      "the outsider's stars were not stored",
    ).toBeNull();
    // Positive control: the owner rates the same order through the pinned UI.
    await rateOrderViaUi(world.customer, world.orderId, 5);
    await expectStars(world.customer.page.getByTestId("order-rating"), 5);
    const rated = await readOrder(world.customer.ctx, world.orderId);
    expect(rated!.ratingStars).toBe(5);
  });

  test("curb-m3-s08 re-rating a rated order leaves the original rating in place", async ({
    curb,
  }) => {
    const world = await curb.world();
    const courier = await curb.courier();
    await deliverOrder(world.merchant, courier, world.orderId);
    // The setup rating is this probe's in-test positive control.
    const setup = await postRate(world.customer.ctx, world.orderId, 5);
    expect2xx(setup, "the owner's first rating");
    const resp = await postRate(world.customer.ctx, world.orderId, 1);
    expect(resp.status(), "rating an already-rated order").toBe(409);
    const order = await readOrder(world.customer.ctx, world.orderId);
    expect(order!.ratingStars, "the original rating stands").toBe(5);
    // This probe's restaurant carries only this one rating.
    await world.customer.page.goto(`/restaurants/${world.restaurantId}`);
    await expectRating(world.customer.page, "5.0");
  });

  test("curb-m3-s09 the order page renders for its customer and for nobody else", async ({
    curb,
  }) => {
    const world = await curb.world();
    await walkToReady(world.merchant, world.orderId);
    const marker = world.dishName("margherita");
    // An unclaimed-pool courier: it really does see O in the available pool and
    // has not claimed it, so only the "claimed it" rule can refuse the page.
    const courier2 = await curb.courier("courier2");
    expect(
      findById(await listAvailableDeliveries(courier2.ctx), world.orderId),
      "courier2 sees O in the unclaimed pool",
    ).not.toBeNull();
    const customer2 = await curb.customer("customer2");
    const kitchen2 = await curb.kitchen({ as: "merchant2" });
    const outsiders: Array<[string, Persona]> = [
      ["the unclaimed-pool courier", courier2],
      ["a second customer", customer2],
      ["another restaurant's merchant", kitchen2.merchant],
    ];
    for (const [label, persona] of outsiders) {
      // expectOrderPageDenied carries the verdict: the body never contains the
      // victim's pinned data, and the page refuses (4xx, a redirect away, or
      // forbidden-message). The label rides along in the failure output.
      await test.step(`${label} may not read /orders/${world.orderId}`, () =>
        expectOrderPageDenied(persona.ctx, world.orderId, [
          marker,
          world.customer.who.email,
        ]));
    }
    // Positive control: the owning customer's own page does render the order.
    await world.customer.page.goto(`/orders/${world.orderId}`);
    await expectStatusText(
      world.customer.page.getByTestId("order-detail-status"),
      "ready",
    );
    expect(
      await world.customer.page.content(),
      "the owner's own order page renders the order's lines",
    ).toContain(marker);
  });

  test("curb-m3-s10 forged ownership fields on a new order are ignored", async ({
    curb,
  }) => {
    const kitchen = await curb.kitchen();
    const customer = await curb.customer();
    const customer2 = await curb.customer("customer2");
    const courier = await curb.courier();
    const customer2Id = String((await getMe(customer2.ctx)).id);
    const courierId = String((await getMe(courier.ctx)).id);
    const items = [
      { menuItemId: kitchen.dish("margherita"), quantity: 1 },
      { menuItemId: kitchen.dish("soda"), quantity: 2 },
    ];
    const before = await orderIds(customer.ctx);
    const forged = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items,
      status: "delivered",
      courierId,
      customerId: customer2Id,
      totalCents: 1,
    });
    if (forged.status() >= 400) {
      expect(forged.status(), "a rejected forged order is a 400").toBe(400);
      expect(
        (await orderIds(customer.ctx)).length,
        "a rejected forged order creates nothing",
      ).toBe(before.length);
    } else {
      const forgedId = await createdOrderId(forged, customer, before);
      const order = await readOrder(customer.ctx, forgedId);
      expect(order, `GET /api/orders/${forgedId}`).toBeTruthy();
      expect(order!.status, "a new order is always placed").toBe("placed");
      expect(
        order!.courierId ?? null,
        "courierId is set only by a claim, never from the body",
      ).toBeNull();
      expect(
        order!.subtotalCents,
        "the server prices the cart from the menu",
      ).toBe(CANONICAL_SUBTOTAL_CENTS);
      expect(
        Number(order!.totalCents),
        "the forged total is not stored",
      ).not.toBe(1);
      expect(
        Number(order!.subtotalCents) +
          Number(order!.taxCents) +
          Number(order!.deliveryFeeCents) +
          Number(order!.tipCents),
        "subtotal + tax + fee + tip === total",
      ).toBe(Number(order!.totalCents));
      // The order belongs to the poster, not to the forged customerId, and the
      // named courier was never assigned to it.
      expect(
        await orderIds(customer.ctx),
        "the order belongs to the customer who posted it",
      ).toContain(forgedId);
      expect(
        await orderIds(customer2.ctx),
        "the forged customerId did not take ownership",
      ).not.toContain(forgedId);
      expect(
        findById(await listMyDeliveries(courier.ctx), forgedId),
        "the forged courierId did not assign the delivery",
      ).toBeNull();
    }
    // Positive control: a clean post with only the fields that count.
    const cleanBefore = await orderIds(customer.ctx);
    const clean = await postOrder(customer.ctx, {
      restaurantId: kitchen.restaurantId,
      items,
    });
    expect2xx(clean, "a clean POST /api/orders");
    const cleanId = await createdOrderId(clean, customer, cleanBefore);
    const cleanOrder = await readOrder(customer.ctx, cleanId);
    expect(cleanOrder, `GET /api/orders/${cleanId}`).toBeTruthy();
    expect(cleanOrder!.subtotalCents).toBe(CANONICAL_SUBTOTAL_CENTS);
  });
});
