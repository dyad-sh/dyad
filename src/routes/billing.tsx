import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Subscription {
  plan: "free" | "pro";
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

async function fetchSubscription(token: string): Promise<Subscription> {
  const res = await fetch("/billing/subscription", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.data ?? { plan: "free", status: "active" };
}

async function createCheckout(token: string): Promise<string> {
  const res = await fetch("/billing/create-checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ baseUrl: window.location.origin }),
  });
  const json = await res.json();
  return json.data?.url;
}

async function createPortal(token: string): Promise<string> {
  const res = await fetch("/billing/create-portal-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ baseUrl: window.location.origin }),
  });
  const json = await res.json();
  return json.data?.url;
}

function BillingPage() {
  const { token, user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Show feedback from Stripe redirects
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setMessage("Subscription activated! Welcome to Pro.");
    } else if (params.get("canceled") === "true") {
      setMessage("Checkout canceled. No changes were made.");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchSubscription(token)
      .then(setSubscription)
      .finally(() => setLoading(false));
  }, [token]);

  const handleUpgrade = async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const url = await createCheckout(token);
      if (url) window.location.href = url;
    } catch {
      setMessage("Failed to start checkout. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const url = await createPortal(token);
      if (url) window.location.href = url;
    } catch {
      setMessage("Failed to open billing portal. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const isPro = subscription?.plan === "pro" && subscription?.status === "active";

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-12">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your ProteaAI subscription
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          {message}
        </div>
      )}

      {/* Current plan */}
      <div className="rounded-lg border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-xl font-semibold capitalize">
              {loading ? "—" : (subscription?.plan ?? "Free")}
            </p>
          </div>
          <Badge variant={isPro ? "default" : "secondary"}>
            {loading ? "…" : isPro ? "Active" : "Free"}
          </Badge>
        </div>

        {subscription?.currentPeriodEnd && (
          <p className="text-sm text-muted-foreground">
            {subscription.cancelAtPeriodEnd
              ? `Cancels on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
              : `Renews on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
          </p>
        )}

        {!isPro ? (
          <Button onClick={handleUpgrade} disabled={actionLoading || loading}>
            {actionLoading ? "Redirecting…" : "Upgrade to Pro"}
          </Button>
        ) : (
          <Button variant="outline" onClick={handleManage} disabled={actionLoading}>
            {actionLoading ? "Redirecting…" : "Manage subscription"}
          </Button>
        )}
      </div>

      {/* Plan comparison */}
      <div className="grid grid-cols-2 gap-4">
        {/* Free */}
        <div className="rounded-lg border border-border p-5 space-y-3">
          <p className="font-semibold">Free</p>
          <p className="text-2xl font-bold">$0<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>✓ Unlimited build mode</li>
            <li>✓ 5 agent messages / day</li>
            <li>✓ GitHub, Supabase integration</li>
            <li>✗ Turbo edits</li>
            <li>✗ Smart context</li>
            <li>✗ Web search</li>
          </ul>
        </div>

        {/* Pro */}
        <div className="rounded-lg border-2 border-primary p-5 space-y-3">
          <p className="font-semibold">Pro</p>
          <p className="text-2xl font-bold">$20<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
          <ul className="space-y-1 text-sm">
            <li>✓ Everything in Free</li>
            <li>✓ Unlimited agent messages</li>
            <li>✓ Turbo edits</li>
            <li>✓ Smart context</li>
            <li>✓ Web search</li>
            <li>✓ Priority support</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing",
  component: () => (
    <AuthGuard>
      <BillingPage />
    </AuthGuard>
  ),
});
