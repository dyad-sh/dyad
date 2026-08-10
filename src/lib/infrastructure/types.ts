/**
 * What the infrastructure monitor knows about, as data.
 *
 * The governing rule: the infrastructure defines the dashboard, never the
 * reverse. Nothing in this file, in the engine, or in the UI may name a
 * particular service. Product names live in exactly one place, the optional
 * identifier plugins, and if every plugin were deleted the monitor would
 * still find, probe and display everything running. It would simply call
 * things by their port and process name.
 *
 * That is why the model below is deliberately generic and why nearly every
 * field is optional: a service found by scanning ports knows nothing about
 * containers, and one found in Docker may never have been seen listening.
 */

/** Where a candidate came from. One service is often seen by several. */
export type DiscoverySource =
  | "process"
  | "port"
  | "docker"
  | "compose"
  | "systemd"
  | "launchd"
  | "kubernetes"
  | "mdns"
  | "http"
  | "proxy"
  | "agent";

export type ServiceStatus = "healthy" | "degraded" | "offline" | "unknown";

export type ServiceProtocol = "tcp" | "udp" | "http" | "https" | "unix";

/**
 * A service as discovered, before anything tries to recognise it.
 *
 * `name` is always populated, even when nothing is identified: an unnamed row
 * is a row people ignore. An unidentified service is named from what is known
 * about it, such as its process or its port, and is shown rather than hidden.
 */
export type DiscoveredService = {
  id: string;
  nodeId: string;
  name: string;
  /** Identifier's verdict, or a generic kind. Never a hardcoded product list. */
  type: string;
  sources: DiscoverySource[];
  processName?: string;
  pid?: number;
  protocol?: ServiceProtocol;
  host?: string;
  port?: number;
  url?: string;
  containerId?: string;
  containerImage?: string;
  systemServiceName?: string;
  discoveredAt: number;
  lastSeenAt: number;
  status: ServiceStatus;
  /** Round-trip of the last successful probe, in milliseconds. */
  latencyMs?: number;
  /** Which identifier plugin claimed it, if any. Absent means unidentified. */
  identifiedBy?: string;
  /** Free-form extras a provider or identifier chose to record. */
  metadata: Record<string, string>;
};

/**
 * A raw sighting from one provider.
 *
 * Providers report what they saw and nothing more. Deciding that two sightings
 * are the same service is the engine's job, because only the engine sees all
 * of them.
 */
export type ServiceCandidate = {
  source: DiscoverySource;
  processName?: string;
  pid?: number;
  protocol?: ServiceProtocol;
  host?: string;
  port?: number;
  containerId?: string;
  containerImage?: string;
  systemServiceName?: string;
  /** A name the provider is confident about, such as a container's own name. */
  suggestedName?: string;
  metadata?: Record<string, string>;
};

/** A machine the monitor watches. Local today; remote agents later. */
export type MonitoredNode = {
  id: string;
  name: string;
  platform: string;
  /** Absent for the local node; a base URL for a remote agent. */
  agentUrl?: string;
  lastSeenAt: number;
  reachable: boolean;
};

/**
 * A provider finds candidates by one strategy.
 *
 * `available` exists so a provider that cannot run here is skipped quietly
 * rather than failing the scan: Docker missing on a laptop is normal, not an
 * error worth showing anyone.
 */
export type DiscoveryProvider = {
  source: DiscoverySource;
  /** Human label for the diagnostics panel. */
  label: string;
  available: () => Promise<boolean>;
  discover: () => Promise<ServiceCandidate[]>;
};

/** How a service should be checked, chosen from what discovery revealed. */
export type HealthProbe =
  | { kind: "http"; url: string; method: "GET" | "HEAD" }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "docker"; containerId: string }
  | { kind: "process"; pid: number }
  | { kind: "none"; reason: string };

/**
 * Things that happen to the inventory over time.
 *
 * Named as events rather than as a diff so the timeline can be shown to a
 * person: "port 6333 appeared, then a process, then a probe succeeded" is a
 * story, where a changed row is not.
 */
export type DiscoveryEventKind =
  | "NODE_DISCOVERED"
  | "NODE_LOST"
  | "SERVICE_DISCOVERED"
  | "SERVICE_IDENTIFIED"
  | "SERVICE_CHANGED"
  | "SERVICE_HEALTH_CHANGED"
  | "SERVICE_LOST"
  | "SERVICE_RECOVERED";

export type DiscoveryEvent = {
  kind: DiscoveryEventKind;
  at: number;
  nodeId: string;
  serviceId?: string;
  /** One line, already written for a person to read. */
  message: string;
};
