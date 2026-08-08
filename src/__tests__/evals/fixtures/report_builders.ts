// report_builders.ts — a grab-bag of reporting functions that were each
// added by a different contributor over time. Many of them repeat the
// same small chunks of logic.

interface Sale {
  id: string;
  sku: string;
  category: string;
  region: string;
  customerId: string;
  unitPrice: number;
  quantity: number;
  currency: string;
  soldAt: string; // ISO date
}

interface Refund {
  saleId: string;
  amount: number;
  currency: string;
  refundedAt: string;
  reason: string;
}

interface Subscription {
  customerId: string;
  plan: string;
  mrr: number;
  currency: string;
  startedAt: string;
  canceledAt: string | null;
}

interface ReportRange {
  from: string; // ISO date, inclusive
  to: string; // ISO date, exclusive
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// ── Sales reports ──────────────────────────────────────────────────────────

export function totalSalesRevenue(sales: Sale[], range: ReportRange): string {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  let sum = 0;
  for (const s of inRange) sum += s.unitPrice * s.quantity;

  const d1 = new Date(range.from);
  const d2 = new Date(range.to);
  const label = `${MONTH_NAMES[d1.getUTCMonth()]} ${d1.getUTCDate()}, ${d1.getUTCFullYear()} – ${MONTH_NAMES[d2.getUTCMonth()]} ${d2.getUTCDate()}, ${d2.getUTCFullYear()}`;

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(sum);

  return `Sales ${label}: ${formatted}`;
}

export function salesByCategory(
  sales: Sale[],
  range: ReportRange,
): Array<{ category: string; revenue: string }> {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  const buckets = new Map<string, number>();
  for (const s of inRange) {
    const current = buckets.get(s.category) ?? 0;
    buckets.set(s.category, current + s.unitPrice * s.quantity);
  }

  const rows: Array<{ category: string; revenue: string }> = [];
  for (const [category, amount] of buckets) {
    rows.push({
      category,
      revenue: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(amount),
    });
  }
  rows.sort((a, b) => (a.category < b.category ? -1 : 1));
  return rows;
}

export function salesByRegion(
  sales: Sale[],
  range: ReportRange,
): Array<{ region: string; revenue: string; units: number }> {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  const revenueByRegion = new Map<string, number>();
  const unitsByRegion = new Map<string, number>();
  for (const s of inRange) {
    revenueByRegion.set(
      s.region,
      (revenueByRegion.get(s.region) ?? 0) + s.unitPrice * s.quantity,
    );
    unitsByRegion.set(
      s.region,
      (unitsByRegion.get(s.region) ?? 0) + s.quantity,
    );
  }

  const rows: Array<{ region: string; revenue: string; units: number }> = [];
  for (const [region, amount] of revenueByRegion) {
    rows.push({
      region,
      revenue: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(amount),
      units: unitsByRegion.get(region) ?? 0,
    });
  }
  rows.sort((a, b) => (a.region < b.region ? -1 : 1));
  return rows;
}

export function topSkusByRevenue(
  sales: Sale[],
  range: ReportRange,
  limit: number,
): Array<{ sku: string; revenue: string }> {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  const buckets = new Map<string, number>();
  for (const s of inRange) {
    buckets.set(s.sku, (buckets.get(s.sku) ?? 0) + s.unitPrice * s.quantity);
  }

  const rows = Array.from(buckets.entries())
    .map(([sku, amount]) => ({ sku, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);

  return rows.map((r) => ({
    sku: r.sku,
    revenue: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(r.amount),
  }));
}

// ── Refund reports ─────────────────────────────────────────────────────────

export function refundsTotal(refunds: Refund[], range: ReportRange): string {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = refunds.filter((r) => {
    const t = Date.parse(r.refundedAt);
    return t >= fromTs && t < toTs;
  });

  let sum = 0;
  for (const r of inRange) sum += r.amount;

  const d1 = new Date(range.from);
  const d2 = new Date(range.to);
  const label = `${MONTH_NAMES[d1.getUTCMonth()]} ${d1.getUTCDate()}, ${d1.getUTCFullYear()} – ${MONTH_NAMES[d2.getUTCMonth()]} ${d2.getUTCDate()}, ${d2.getUTCFullYear()}`;

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(sum);

  return `Refunds ${label}: ${formatted}`;
}

export function refundsByReason(
  refunds: Refund[],
  range: ReportRange,
): Array<{ reason: string; amount: string; count: number }> {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = refunds.filter((r) => {
    const t = Date.parse(r.refundedAt);
    return t >= fromTs && t < toTs;
  });

  const amountByReason = new Map<string, number>();
  const countByReason = new Map<string, number>();
  for (const r of inRange) {
    amountByReason.set(
      r.reason,
      (amountByReason.get(r.reason) ?? 0) + r.amount,
    );
    countByReason.set(r.reason, (countByReason.get(r.reason) ?? 0) + 1);
  }

  const rows: Array<{ reason: string; amount: string; count: number }> = [];
  for (const [reason, amount] of amountByReason) {
    rows.push({
      reason,
      amount: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(amount),
      count: countByReason.get(reason) ?? 0,
    });
  }
  rows.sort((a, b) => (a.reason < b.reason ? -1 : 1));
  return rows;
}

export function refundRate(
  sales: Sale[],
  refunds: Refund[],
  range: ReportRange,
): string {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);

  const salesInRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });
  const refundsInRange = refunds.filter((r) => {
    const t = Date.parse(r.refundedAt);
    return t >= fromTs && t < toTs;
  });

  let salesSum = 0;
  for (const s of salesInRange) salesSum += s.unitPrice * s.quantity;
  let refundSum = 0;
  for (const r of refundsInRange) refundSum += r.amount;

  if (salesSum === 0) return "0.0%";
  const pct = (refundSum / salesSum) * 100;
  return `${pct.toFixed(1)}%`;
}

// ── Subscription reports ───────────────────────────────────────────────────

export function activeMrr(subs: Subscription[], asOf: string): string {
  const asOfTs = Date.parse(asOf);
  let sum = 0;
  for (const sub of subs) {
    const started = Date.parse(sub.startedAt);
    const canceled = sub.canceledAt ? Date.parse(sub.canceledAt) : null;
    if (started > asOfTs) continue;
    if (canceled !== null && canceled <= asOfTs) continue;
    sum += sub.mrr;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(sum);
}

export function mrrByPlan(
  subs: Subscription[],
  asOf: string,
): Array<{ plan: string; mrr: string; subscribers: number }> {
  const asOfTs = Date.parse(asOf);

  const mrrTotals = new Map<string, number>();
  const countByPlan = new Map<string, number>();
  for (const sub of subs) {
    const started = Date.parse(sub.startedAt);
    const canceled = sub.canceledAt ? Date.parse(sub.canceledAt) : null;
    if (started > asOfTs) continue;
    if (canceled !== null && canceled <= asOfTs) continue;
    mrrTotals.set(sub.plan, (mrrTotals.get(sub.plan) ?? 0) + sub.mrr);
    countByPlan.set(sub.plan, (countByPlan.get(sub.plan) ?? 0) + 1);
  }

  const rows: Array<{ plan: string; mrr: string; subscribers: number }> = [];
  for (const [plan, amount] of mrrTotals) {
    rows.push({
      plan,
      mrr: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(amount),
      subscribers: countByPlan.get(plan) ?? 0,
    });
  }
  rows.sort((a, b) => (a.plan < b.plan ? -1 : 1));
  return rows;
}

export function churnRate(subs: Subscription[], range: ReportRange): string {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);

  let activeAtStart = 0;
  let canceledInRange = 0;
  for (const sub of subs) {
    const started = Date.parse(sub.startedAt);
    const canceled = sub.canceledAt ? Date.parse(sub.canceledAt) : null;
    const wasActiveAtStart =
      started < fromTs && (canceled === null || canceled >= fromTs);
    if (wasActiveAtStart) activeAtStart++;
    if (canceled !== null && canceled >= fromTs && canceled < toTs) {
      canceledInRange++;
    }
  }

  if (activeAtStart === 0) return "0.0%";
  const pct = (canceledInRange / activeAtStart) * 100;
  return `${pct.toFixed(1)}%`;
}

// ── Customer reports ───────────────────────────────────────────────────────

export function topCustomersByRevenue(
  sales: Sale[],
  range: ReportRange,
  limit: number,
): Array<{ customerId: string; revenue: string }> {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  const buckets = new Map<string, number>();
  for (const s of inRange) {
    buckets.set(
      s.customerId,
      (buckets.get(s.customerId) ?? 0) + s.unitPrice * s.quantity,
    );
  }

  const rows = Array.from(buckets.entries())
    .map(([customerId, amount]) => ({ customerId, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);

  return rows.map((r) => ({
    customerId: r.customerId,
    revenue: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(r.amount),
  }));
}

export function averageSaleValue(sales: Sale[], range: ReportRange): string {
  const fromTs = Date.parse(range.from);
  const toTs = Date.parse(range.to);
  const inRange = sales.filter((s) => {
    const t = Date.parse(s.soldAt);
    return t >= fromTs && t < toTs;
  });

  if (inRange.length === 0) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(0);
  }

  let sum = 0;
  for (const s of inRange) sum += s.unitPrice * s.quantity;
  const avg = sum / inRange.length;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(avg);
}

// ── Combined overview ──────────────────────────────────────────────────────

export function overviewHeader(range: ReportRange): string {
  const d1 = new Date(range.from);
  const d2 = new Date(range.to);
  const label = `${MONTH_NAMES[d1.getUTCMonth()]} ${d1.getUTCDate()}, ${d1.getUTCFullYear()} – ${MONTH_NAMES[d2.getUTCMonth()]} ${d2.getUTCDate()}, ${d2.getUTCFullYear()}`;
  return `Overview for ${label}`;
}
