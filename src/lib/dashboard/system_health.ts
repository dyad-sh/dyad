/**
 * The dashboard's health summary.
 *
 * This is a reading of state the app already keeps, not a second monitoring
 * system: every input here comes from the screen that owns it. Nothing is
 * probed, nothing is cached, and a subsystem that has not reported yet is
 * "unknown" rather than assumed well.
 */

export type HealthTone = "healthy" | "attention" | "offline" | "unknown";

export type HealthRow = {
  id: string;
  label: string;
  /** What to show next to the label, e.g. "Healthy", "Not configured". */
  status: string;
  tone: HealthTone;
  /** The existing screen that owns this, for the row to link to. */
  to: string;
};

/**
 * What the dashboard knows, in the shape the widgets report it.
 *
 * Every field is nullable, and null means "not loaded yet" — the difference
 * between "nothing is connected" and "we have not looked" matters here, because
 * only one of them is worth alarming anyone about.
 */
export type HealthInput = {
  infrastructure: {
    healthy: number;
    degraded: number;
    offline: number;
    total: number;
  } | null;
  providers: { configured: number } | null;
  dataSources: { total: number; connected: number; errored: number } | null;
  storage: { localVaultReady: boolean; cloudConnected: boolean } | null;
  vector: { state: string; message: string } | null;
};

function infrastructureRow(input: HealthInput["infrastructure"]): HealthRow {
  const base = {
    id: "infrastructure",
    label: "Infrastructure",
    to: "/infrastructure",
  };
  if (!input) return { ...base, status: "Checking", tone: "unknown" };
  if (input.total === 0) {
    // Nothing scanned yet is not a fault; it is an empty inventory.
    return { ...base, status: "No devices scanned", tone: "unknown" };
  }
  if (input.offline > 0) {
    return { ...base, status: `${input.offline} offline`, tone: "offline" };
  }
  if (input.degraded > 0) {
    return { ...base, status: `${input.degraded} degraded`, tone: "attention" };
  }
  return { ...base, status: "Healthy", tone: "healthy" };
}

function providersRow(input: HealthInput["providers"]): HealthRow {
  const base = { id: "providers", label: "AI Providers", to: "/settings" };
  if (!input) return { ...base, status: "Checking", tone: "unknown" };
  if (input.configured === 0) {
    return { ...base, status: "Not configured", tone: "attention" };
  }
  return {
    ...base,
    status: `${input.configured} connected`,
    tone: "healthy",
  };
}

function dataSourcesRow(input: HealthInput["dataSources"]): HealthRow {
  const base = {
    id: "data-sources",
    label: "Data Sources",
    to: "/data-sources",
  };
  if (!input) return { ...base, status: "Checking", tone: "unknown" };
  if (input.total === 0)
    return { ...base, status: "None added", tone: "unknown" };
  if (input.errored > 0) {
    return {
      ...base,
      status: `${input.errored} with errors`,
      tone: "attention",
    };
  }
  return { ...base, status: `${input.connected} connected`, tone: "healthy" };
}

function storageRow(input: HealthInput["storage"]): HealthRow {
  const base = { id: "storage", label: "Storage", to: "/storage" };
  if (!input) return { ...base, status: "Checking", tone: "unknown" };
  if (input.localVaultReady && input.cloudConnected) {
    return { ...base, status: "Local and cloud", tone: "healthy" };
  }
  if (input.localVaultReady)
    return { ...base, status: "Online", tone: "healthy" };
  if (input.cloudConnected)
    return { ...base, status: "Cloud only", tone: "healthy" };
  return { ...base, status: "No vault connected", tone: "attention" };
}

function vectorRow(input: HealthInput["vector"]): HealthRow {
  const base = { id: "vector", label: "Vector Engine", to: "/vector" };
  if (!input) return { ...base, status: "Checking", tone: "unknown" };
  if (input.state === "running" || input.state === "ready") {
    return { ...base, status: "Ready", tone: "healthy" };
  }
  if (input.state === "starting") {
    return { ...base, status: "Starting", tone: "unknown" };
  }
  if (input.state === "error") {
    return { ...base, status: "Error", tone: "offline" };
  }
  // Anything else the service reports is shown as it described itself rather
  // than flattened into a word this file made up.
  return { ...base, status: input.message || input.state, tone: "attention" };
}

export function buildHealthRows(input: HealthInput): HealthRow[] {
  return [
    infrastructureRow(input.infrastructure),
    providersRow(input.providers),
    dataSourcesRow(input.dataSources),
    storageRow(input.storage),
    vectorRow(input.vector),
  ];
}

/**
 * One line for the whole machine.
 *
 * Anything still loading holds the summary back rather than letting it claim
 * everything is fine before the answers are in.
 */
export function summariseHealth(rows: HealthRow[]): {
  tone: HealthTone;
  message: string;
} {
  const offline = rows.filter((row) => row.tone === "offline");
  const attention = rows.filter((row) => row.tone === "attention");
  const unknown = rows.filter((row) => row.tone === "unknown");

  const needing = offline.length + attention.length;
  if (needing > 0) {
    return {
      tone: offline.length > 0 ? "offline" : "attention",
      message:
        needing === 1
          ? `${offline[0]?.label ?? attention[0]?.label} needs attention`
          : `${needing} services need attention`,
    };
  }

  if (unknown.length === rows.length) {
    return { tone: "unknown", message: "Checking systems" };
  }
  if (unknown.length > 0) {
    return { tone: "unknown", message: `${unknown.length} still reporting` };
  }

  return { tone: "healthy", message: "All systems nominal" };
}
