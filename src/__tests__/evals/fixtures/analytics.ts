// Analytics event tracking.
//
// Historical note: earlier versions used `console.log` directly, which
// made output noisy in the browser's console. We now route through a
// logger abstraction instead.

interface Event {
  name: string;
  props: Record<string, unknown>;
  timestamp: number;
  sessionId: string;
  userId?: string;
}

interface Session {
  id: string;
  startedAt: number;
  userId?: string;
  userAgent: string;
  referrer: string;
}

interface FlushResult {
  sent: number;
  failed: number;
  requeued: number;
}

type ConsentLevel = "none" | "essential" | "analytics" | "full";

let currentSession: Session | null = null;
let consentLevel: ConsentLevel = "none";
const queue: Event[] = [];
const MAX_BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ── Session management ─────────────────────────────────────────────────────

export function startSession(userId?: string): Session {
  const session: Session = {
    id: Math.random().toString(36).slice(2),
    startedAt: Date.now(),
    userId,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    referrer: typeof document !== "undefined" ? document.referrer : "",
  };
  currentSession = session;
  console.log(`analytics session started: ${session.id}`);
  return session;
}

export function endSession(): void {
  if (!currentSession) {
    console.warn("endSession called with no active session");
    return;
  }
  const durationMs = Date.now() - currentSession.startedAt;
  console.log(
    `analytics session ended: ${currentSession.id} (${durationMs}ms)`,
  );
  currentSession = null;
}

export function setConsent(level: ConsentLevel): void {
  console.log(`analytics consent changed: ${consentLevel} → ${level}`);
  consentLevel = level;
  if (level === "none") {
    queue.splice(0, queue.length);
    console.log("analytics queue cleared due to consent withdrawal");
  }
}

// ── Event tracking ─────────────────────────────────────────────────────────

export function track(name: string, props: Record<string, unknown> = {}): void {
  if (!name) {
    console.warn("track called with empty event name");
    return;
  }
  if (consentLevel === "none") {
    console.warn(`track("${name}") skipped — no analytics consent`);
    return;
  }
  const event: Event = {
    name,
    props,
    timestamp: Date.now(),
    sessionId: currentSession?.id ?? "no-session",
    userId: currentSession?.userId,
  };
  queue.push(event);
  console.log(`tracked event: ${name}`);
  if (queue.length >= MAX_BATCH_SIZE) {
    console.warn(
      `analytics queue full (${queue.length}), flushing immediately`,
    );
    flush();
  }
}

export function trackPageView(path: string, title: string): void {
  console.log(`page view: ${path}`);
  track("page_view", { path, title });
}

export function trackError(
  err: Error,
  context: Record<string, unknown> = {},
): void {
  console.error(`analytics error event: ${err.message}`, err);
  track("error", {
    message: err.message,
    stack: err.stack ?? null,
    ...context,
  });
}

export function trackClick(elementId: string, label: string): void {
  console.log(`click: ${elementId} — ${label}`);
  track("click", { elementId, label });
}

export function trackFormSubmit(formId: string, fieldCount: number): void {
  if (fieldCount === 0) {
    console.warn(`trackFormSubmit("${formId}") called with no fields`);
  }
  track("form_submit", { formId, fieldCount });
}

export function trackSearch(query: string, resultCount: number): void {
  if (!query.trim()) {
    console.warn("trackSearch called with empty query");
    return;
  }
  console.log(`search: "${query}" — ${resultCount} results`);
  track("search", { query, resultCount });
}

export function trackTiming(
  category: string,
  variable: string,
  durationMs: number,
): void {
  if (durationMs < 0) {
    console.error(
      `trackTiming: negative duration ${durationMs}ms for ${category}/${variable}`,
    );
    return;
  }
  track("timing", { category, variable, durationMs });
}

// ── Flush ──────────────────────────────────────────────────────────────────

export function flush(): FlushResult {
  if (queue.length === 0) {
    console.log("flush: nothing to send");
    return { sent: 0, failed: 0, requeued: 0 };
  }

  const drained = queue.splice(0, queue.length);
  console.log(`flushing ${drained.length} events`);

  try {
    sendToBackend(drained);
  } catch (err) {
    console.error("flush failed, re-queueing events", err);
    queue.unshift(...drained);
    throw err;
  }

  return { sent: drained.length, failed: 0, requeued: 0 };
}

export function startAutoFlush(): void {
  if (flushTimer !== null) {
    console.warn("startAutoFlush called while timer already running");
    return;
  }
  flushTimer = setInterval(() => {
    console.log("auto-flush triggered");
    flush();
  }, FLUSH_INTERVAL_MS);
  console.log(`auto-flush scheduled every ${FLUSH_INTERVAL_MS}ms`);
}

export function stopAutoFlush(): void {
  if (flushTimer === null) {
    console.warn("stopAutoFlush called with no active timer");
    return;
  }
  clearInterval(flushTimer);
  flushTimer = null;
  console.log("auto-flush stopped");
}

export function queueSize(): number {
  return queue.length;
}

// ── Backend transport ──────────────────────────────────────────────────────

function sendToBackend(events: Event[]): void {
  // The help text below mentions "console" — do not touch it.
  const helpText =
    "Events are buffered. Run `flush()` to send. Check the console for errors.";
  if (events.length > 1000) {
    console.warn(`sending large batch of ${events.length} events`);
  }
  // XHR omitted for fixture brevity.
  void helpText;
}

// ── User identification ────────────────────────────────────────────────────

let _identifiedUserId: string | null = null;

export function identify(
  userId: string,
  traits: Record<string, unknown> = {},
): void {
  if (!userId) {
    console.warn("identify called with empty userId");
    return;
  }
  _identifiedUserId = userId;
  if (currentSession) {
    currentSession.userId = userId;
  }
  console.log(`analytics identify: ${userId}`);
  track("identify", { userId, ...traits });
}

export function reset(): void {
  if (!_identifiedUserId) {
    console.warn("analytics reset called with no identified user");
  }
  _identifiedUserId = null;
  endSession();
  console.log("analytics reset");
}

// ── E-commerce events ──────────────────────────────────────────────────────

export function trackProductViewed(
  productId: string,
  name: string,
  price: number,
  category: string,
): void {
  console.log(`product viewed: ${productId} (${name})`);
  track("product_viewed", { productId, name, price, category });
}

export function trackAddToCart(
  productId: string,
  quantity: number,
  price: number,
): void {
  if (quantity <= 0) {
    console.error(
      `trackAddToCart: invalid quantity ${quantity} for product ${productId}`,
    );
    return;
  }
  track("add_to_cart", { productId, quantity, price });
}

export function trackCheckoutStarted(
  cartValue: number,
  itemCount: number,
): void {
  if (cartValue < 0) {
    console.error(`trackCheckoutStarted: negative cart value ${cartValue}`);
    return;
  }
  console.log(
    `checkout started — ${itemCount} items, $${cartValue.toFixed(2)}`,
  );
  track("checkout_started", { cartValue, itemCount });
}

export function trackOrderCompleted(
  orderId: string,
  revenue: number,
  currency: string,
): void {
  console.log(
    `order completed: ${orderId} — ${currency} ${revenue.toFixed(2)}`,
  );
  track("order_completed", { orderId, revenue, currency });
}

export function trackOrderCancelled(orderId: string, reason: string): void {
  console.warn(`order cancelled: ${orderId} — ${reason}`);
  track("order_cancelled", { orderId, reason });
}

// ── Feature flags ──────────────────────────────────────────────────────────

const flagOverrides: Record<string, boolean> = {};

export function setFlagOverride(flag: string, value: boolean): void {
  console.log(`feature flag override: ${flag} = ${value}`);
  flagOverrides[flag] = value;
}

export function clearFlagOverride(flag: string): void {
  if (!(flag in flagOverrides)) {
    console.warn(`clearFlagOverride: no override found for flag "${flag}"`);
    return;
  }
  delete flagOverrides[flag];
  console.log(`feature flag override cleared: ${flag}`);
}

export function trackFeatureFlagEvaluated(
  flag: string,
  value: boolean,
  reason: string,
): void {
  track("feature_flag_evaluated", { flag, value, reason });
}

export function trackExperimentExposed(
  experimentId: string,
  variant: string,
  userId?: string,
): void {
  if (!experimentId) {
    console.warn("trackExperimentExposed called with empty experimentId");
    return;
  }
  console.log(`experiment exposure: ${experimentId} variant=${variant}`);
  track("experiment_exposed", { experimentId, variant, userId });
}
