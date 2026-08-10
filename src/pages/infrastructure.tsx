import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Box,
  CircleAlert,
  CircleCheck,
  CircleOff,
  CircleHelp,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import type { DiscoveredServiceDto } from "@/ipc/types/infrastructure";

/**
 * Infrastructure monitor.
 *
 * The infrastructure defines this page; this page does not define the
 * infrastructure. There is deliberately no list of expected services anywhere
 * in this file. Everything rendered comes from what discovery actually found,
 * which is why something installed a minute ago appears here without anyone
 * editing code.
 *
 * Unidentified services are shown exactly like identified ones. Hiding what we
 * cannot name would hide precisely the thing somebody opened this page to
 * find.
 */

const STATUS = {
  healthy: {
    label: "Healthy",
    Icon: CircleCheck,
    className: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  degraded: {
    label: "Degraded",
    Icon: CircleAlert,
    className: "text-amber-300",
    dot: "bg-amber-400",
  },
  offline: {
    label: "Offline",
    Icon: CircleOff,
    className: "text-rose-300",
    dot: "bg-rose-400",
  },
  unknown: {
    label: "Not probed",
    Icon: CircleHelp,
    className: "text-white/40",
    dot: "bg-white/30",
  },
} as const;

function relative(epoch: number | null): string {
  if (!epoch) return "never";
  const seconds = Math.round((Date.now() - epoch) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function ServiceRow({ service }: { service: DiscoveredServiceDto }) {
  const status = STATUS[service.status];

  // What is actually known, in the order it helps: address, then what it runs
  // as. Nothing is invented to fill the line.
  const facts = [
    service.port !== undefined ? `:${service.port}` : null,
    service.containerId ? "container" : null,
    service.processName && service.processName !== service.name
      ? service.processName
      : null,
    service.pid !== undefined ? `pid ${service.pid}` : null,
    service.systemServiceName && service.systemServiceName !== service.name
      ? service.systemServiceName
      : null,
  ].filter(Boolean);

  return (
    <li className="infra-row" data-testid="infra-service">
      <span className={`infra-dot ${status.dot}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="infra-name">{service.name}</span>
        {facts.length > 0 && (
          <span className="infra-facts">{facts.join(" · ")}</span>
        )}
      </span>

      {/* Says where the knowledge came from, so a surprising row can be
          traced back to the strategy that found it. */}
      <span className="infra-sources">{service.sources.join(", ")}</span>

      {service.latencyMs !== undefined && (
        <span className="infra-latency">{service.latencyMs} ms</span>
      )}
      <span className={`infra-status ${status.className}`}>{status.label}</span>
    </li>
  );
}

export default function InfrastructurePage() {
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: ["infrastructure"],
    queryFn: () => ipc.infrastructure.snapshot(),
    // Continuous rather than a one-time scan: the inventory is a live thing.
    refetchInterval: 15_000,
  });

  const rescan = async () => {
    setScanning(true);
    try {
      await ipc.infrastructure.scan();
      await queryClient.invalidateQueries({ queryKey: ["infrastructure"] });
    } finally {
      setScanning(false);
    }
  };

  const data = snapshotQuery.data;

  // Endpoints first, then everything else. Both are shown: a background worker
  // is part of the inventory even though nothing can connect to it.
  // Keyed on the query result rather than on a freshly built array, which
  // would be a new identity every render and defeat the memo entirely.
  const { endpoints, background } = useMemo(() => {
    const all = data?.services ?? [];
    return {
      endpoints: all.filter(
        (service) => service.port !== undefined || service.containerId,
      ),
      background: all.filter(
        (service) => service.port === undefined && !service.containerId,
      ),
    };
  }, [data]);

  const services = data?.services ?? [];

  const [showBackground, setShowBackground] = useState(false);
  const summary = data?.summary;

  return (
    <div className="settings-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="manager-brand-icon">
                <Activity className="size-4" />
              </div>
              <span className="manager-brand-label font-jarvis-ui">
                INFRASTRUCTURE
              </span>
              <div className="manager-status-dot manager-status-dot--active" />
            </div>
            <h1 className="manager-title font-jarvis-display">
              {data?.node.name ?? "This machine"}
            </h1>
            <p className="manager-subtitle">
              Everything running here, found by inspection rather than
              configuration. New services appear on their own.
            </p>
          </div>
          <button
            type="button"
            onClick={rescan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
            data-testid="infra-rescan"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Scan now
          </button>
        </header>

        {summary && (
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Discovered", value: summary.total },
              { label: "Healthy", value: summary.healthy },
              { label: "Degraded", value: summary.degraded },
              { label: "Offline", value: summary.offline },
              { label: "Identified", value: summary.identified },
            ].map((stat) => (
              <div key={stat.label} className="infra-stat">
                <span className="infra-stat-value">{stat.value}</span>
                <span className="infra-stat-label">{stat.label}</span>
              </div>
            ))}
          </section>
        )}

        {snapshotQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Loader2 className="size-4 animate-spin" />
            Reading the machine…
          </div>
        )}

        {data && services.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <Server className="mx-auto mb-3 size-6 text-cyan-300" />
            <p className="text-sm text-[#7aadb8]">
              Nothing discovered yet. Run a scan to inspect this machine.
            </p>
          </div>
        )}

        {endpoints.length > 0 && (
          <section className="infra-card">
            <header className="infra-card-head">
              <Server className="size-4 text-cyan-300" />
              <span>Services</span>
              <span className="ml-auto text-[11px] text-white/35">
                scanned {relative(data?.lastScanAt ?? null)}
              </span>
            </header>
            <ul>
              {endpoints.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </ul>
          </section>
        )}

        {background.length > 0 && (
          <section className="infra-card mt-4">
            <button
              type="button"
              className="infra-card-head w-full"
              onClick={() => setShowBackground((open) => !open)}
            >
              <Box className="size-4 text-cyan-300" />
              <span>
                {showBackground ? "Hide" : "Show"} {background.length}{" "}
                background processes
              </span>
            </button>
            {showBackground && (
              <ul>
                {background.map((service) => (
                  <ServiceRow key={service.id} service={service} />
                ))}
              </ul>
            )}
          </section>
        )}

        {data && data.providers.length > 0 && (
          <section className="infra-card mt-4">
            <header className="infra-card-head">
              <Activity className="size-4 text-cyan-300" />
              <span>Discovery strategies</span>
            </header>
            <ul>
              {data.providers.map((provider) => (
                <li key={provider.source} className="infra-row">
                  <span
                    className={`infra-dot ${
                      provider.available ? "bg-emerald-400" : "bg-white/20"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="infra-name">{provider.label}</span>
                  </span>
                  <span className="infra-sources">
                    {/* Unavailable is normal, not a fault: no Docker on a
                        machine without Docker. */}
                    {provider.available
                      ? `${provider.found} found`
                      : "not available here"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data && data.events.length > 0 && (
          <section className="infra-card mt-4">
            <header className="infra-card-head">
              <Activity className="size-4 text-cyan-300" />
              <span>Recent changes</span>
            </header>
            <ul>
              {data.events.slice(0, 20).map((event, index) => (
                <li key={`${event.at}-${index}`} className="infra-row">
                  <span className="infra-event-time">
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                  <span className="min-w-0 flex-1 infra-name">
                    {event.message}
                  </span>
                  <span className="infra-sources">{event.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
