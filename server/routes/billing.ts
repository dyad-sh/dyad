/**
 * Stripe billing routes for ProteaAI web server.
 *
 * POST /billing/create-checkout-session  — start a Stripe Checkout
 * POST /billing/create-portal-session    — open Stripe Customer Portal
 * POST /billing/webhook                  — Stripe webhook handler
 * GET  /billing/subscription             — current subscription status
 */

import { Router } from "express";
import Stripe from "stripe";
import { db } from "../../src/db";
import { subscriptions, users } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getCurrentUser } from "../../src/ipc/context/user-context";

export const billingRouter = Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";

// Only initialise Stripe if a key is configured (prevents crash on startup)
let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-03-31.basil" });
}

function requireStripe(res: { status: (n: number) => { json: (d: unknown) => void } }): Stripe | null {
  if (!stripe) {
    res.status(503).json({ ok: false, error: "Billing not configured" });
    return null;
  }
  return stripe;
}

// ── GET /billing/subscription ─────────────────────────────────────────────────

billingRouter.get("/subscription", requireAuth, async (_req, res) => {
  try {
    const { userId } = getCurrentUser()!;
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    res.json({ ok: true, data: sub ?? { plan: "free", status: "active" } });
  } catch (err) {
    console.error("[billing/subscription]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch subscription" });
  }
});

// ── POST /billing/create-checkout-session ─────────────────────────────────────

billingRouter.post("/create-checkout-session", requireAuth, async (req, res) => {
  const s = requireStripe(res as any);
  if (!s) return;

  try {
    const { userId, email } = getCurrentUser()!;
    const baseUrl = (req.body as { baseUrl?: string }).baseUrl ??
      process.env.APP_BASE_URL ??
      "http://localhost:3001";

    // Reuse existing Stripe customer if possible
    let stripeCustomerId: string | undefined;
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    if (sub?.stripeCustomerId) {
      stripeCustomerId = sub.stripeCustomerId;
    } else {
      const customer = await s.customers.create({ email, metadata: { userId } });
      stripeCustomerId = customer.id;
    }

    const session = await s.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/billing?success=true`,
      cancel_url: `${baseUrl}/billing?canceled=true`,
      metadata: { userId },
    });

    res.json({ ok: true, data: { url: session.url } });
  } catch (err) {
    console.error("[billing/create-checkout-session]", err);
    res.status(500).json({ ok: false, error: "Failed to create checkout session" });
  }
});

// ── POST /billing/create-portal-session ──────────────────────────────────────

billingRouter.post("/create-portal-session", requireAuth, async (req, res) => {
  const s = requireStripe(res as any);
  if (!s) return;

  try {
    const { userId } = getCurrentUser()!;
    const baseUrl = (req.body as { baseUrl?: string }).baseUrl ??
      process.env.APP_BASE_URL ??
      "http://localhost:3001";

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub?.stripeCustomerId) {
      res.status(404).json({ ok: false, error: "No subscription found" });
      return;
    }

    const session = await s.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${baseUrl}/billing`,
    });

    res.json({ ok: true, data: { url: session.url } });
  } catch (err) {
    console.error("[billing/create-portal-session]", err);
    res.status(500).json({ ok: false, error: "Failed to create portal session" });
  }
});

// ── POST /billing/webhook ─────────────────────────────────────────────────────
// Must be registered with raw body (before express.json() parses it)

billingRouter.post(
  "/webhook",
  async (req, res) => {
    const s = requireStripe(res as any);
    if (!s) return;

    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      // req.body is a raw Buffer when this route is registered with express.raw()
      event = s.webhooks.constructEvent(req.body as Buffer, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("[billing/webhook] signature verification failed:", err);
      res.status(400).json({ ok: false, error: "Invalid signature" });
      return;
    }

    try {
      await handleStripeEvent(s, event);
      res.json({ ok: true });
    } catch (err) {
      console.error("[billing/webhook] handler error:", err);
      res.status(500).json({ ok: false, error: "Webhook handler failed" });
    }
  },
);

async function handleStripeEvent(s: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId || !session.subscription) break;

      const stripeSub = await s.subscriptions.retrieve(
        session.subscription as string,
      );

      await db
        .insert(subscriptions)
        .values({
          id: stripeSub.id,
          userId,
          stripeCustomerId: session.customer as string,
          status: "active",
          plan: "pro",
          currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            id: stripeSub.id,
            stripeCustomerId: session.customer as string,
            status: "active",
            plan: "pro",
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            updatedAt: new Date(),
          },
        });
      break;
    }

    case "customer.subscription.updated": {
      const stripeSub = event.data.object as Stripe.Subscription;
      const userId = stripeSub.metadata?.userId;
      if (!userId) break;

      const isActive =
        stripeSub.status === "active" || stripeSub.status === "trialing";

      await db
        .update(subscriptions)
        .set({
          status: stripeSub.status as typeof subscriptions.$inferSelect["status"],
          plan: isActive ? "pro" : "free",
          currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
      break;
    }

    case "customer.subscription.deleted": {
      const stripeSub = event.data.object as Stripe.Subscription;
      const userId = stripeSub.metadata?.userId;
      if (!userId) break;

      await db
        .update(subscriptions)
        .set({
          status: "canceled",
          plan: "free",
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
      break;
    }

    default:
      // Unhandled event type — ignore
      break;
  }
}
