import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, KeyRound } from "lucide-react";

import buildStudioIcon from "@/assets/agents/build-studio.png";
import helixIcon from "@/assets/agents/helix.png";
import openWorkerIcon from "@/assets/agents/open-worker.png";

import { useHelix } from "@/hooks/useHelix";
import { useOpenWorker } from "@/hooks/useOpenWorker";
import { cn } from "@/lib/utils";

/**
 * What each coding agent is, once.
 *
 * The full cards and the compact rows read the same entries, so the two
 * renderings cannot describe the same agent differently.
 */
export const CODING_AGENTS = [
  {
    id: "studio",
    title: "Build Studio",
    description:
      "The native Meta Human OS coder. Chat-driven app building with live preview, versioning, and one-click publishing.",
    route: "/coder/studio",
    image: buildStudioIcon,
    testId: "coding-agent-card-studio",
  },
  {
    id: "helix",
    title: "Helix",
    description:
      "GPT-5.3 Codex through the Vercel AI Gateway with secure sandbox execution, file explorer, and live preview.",
    route: "/coder/helix",
    image: helixIcon,
    testId: "coding-agent-card-helix",
  },
  {
    id: "openworker",
    title: "OpenWorker",
    description:
      "Gets everyday work done — documents, spreadsheets and reports — with 25+ tool connectors, running locally inside Meta Human OS.",
    route: "/coder/openworker",
    image: openWorkerIcon,
    testId: "coding-agent-card-openworker",
  },
] as const;

type CodingAgentState = "running" | "starting" | "offline";

export type CodingAgentStatus = {
  state: CodingAgentState;
  label: string;
  /** The one-line caveat the cards show, or null when there is nothing to say. */
  note: string | null;
};

/** Live status for each agent, from the hooks that already own it. */
export function useCodingAgentStatuses(): Record<string, CodingAgentStatus> {
  const { status } = useHelix();
  const { status: openWorkerStatus } = useOpenWorker();

  const state = (running: boolean, starting: boolean): CodingAgentState =>
    running ? "running" : starting ? "starting" : "offline";
  const label = (value: CodingAgentState) =>
    value === "running"
      ? "Running"
      : value === "starting"
        ? "Starting"
        : "Offline";

  const helixState = state(
    status?.state === "running",
    status?.state === "starting",
  );
  const openWorkerState = state(
    openWorkerStatus?.state === "running",
    openWorkerStatus?.state === "starting",
  );
  const openWorkerReady = Boolean(
    openWorkerStatus?.appFound &&
    openWorkerStatus?.venvReady &&
    openWorkerStatus?.guiBuilt,
  );

  return {
    // Build Studio is in-process: there is nothing to be offline.
    studio: { state: "running", label: "Ready", note: null },
    helix: {
      state: helixState,
      label: label(helixState),
      note: status?.hasGatewayKey
        ? "Gateway token configured"
        : "Gateway token required — set it in Settings",
    },
    openworker: {
      state: openWorkerState,
      label: label(openWorkerState),
      note: openWorkerReady
        ? "Installed and ready"
        : "One-time setup needed — open to see the steps",
    },
  };
}

const STATE_DOT: Record<CodingAgentState, string> = {
  running: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  starting: "animate-pulse bg-cyan-400",
  offline: "bg-slate-500",
};

/**
 * The compact rows, for the Agents section.
 *
 * Same size and shape as the My Agents rows above them, so the section reads
 * as one list rather than two different treatments stacked.
 */
export function CodingAgentRows() {
  const statuses = useCodingAgentStatuses();

  return (
    <>
      {CODING_AGENTS.map((agent) => {
        const status = statuses[agent.id];
        return (
          <Link
            key={agent.id}
            to={agent.route}
            className="system-card"
            data-testid={`agents-open-${agent.id}`}
          >
            <img
              src={agent.image}
              alt=""
              className="size-8 shrink-0 rounded-lg object-cover"
              draggable={false}
            />
            <span className="min-w-0 flex-1 text-left">
              <span className="system-card-title">{agent.title}</span>
              <span className="system-card-summary">
                {status.note ?? agent.description}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="system-card-status">{status.label}</span>
              <span
                className={cn("size-1.5 rounded-full", STATE_DOT[status.state])}
                aria-hidden
              />
            </span>
          </Link>
        );
      })}
    </>
  );
}

/**
 * The coding agent cards.
 *
 * Lifted out of the Coding Agents page unchanged so the Agents section can
 * show the same three cards, with the same live status, instead of a second
 * set that looks right on the day it is written and drifts afterwards.
 */
export function CodingAgentCards() {
  const { status } = useHelix();
  const { status: openWorkerStatus } = useOpenWorker();

  const helixRunning = status?.state === "running";
  const helixStarting = status?.state === "starting";
  const openWorkerRunning = openWorkerStatus?.state === "running";
  const openWorkerStarting = openWorkerStatus?.state === "starting";
  const openWorkerReady = Boolean(
    openWorkerStatus?.appFound &&
    openWorkerStatus?.venvReady &&
    openWorkerStatus?.guiBuilt,
  );
  const helixHasKey = status?.hasGatewayKey ?? false;

  return (
    <section className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {/* Native build studio */}
      <Link
        to="/coder/studio"
        className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
        data-testid="coding-agent-card-studio"
      >
        <div className="relative z-10">
          <img
            src={CODING_AGENTS[0].image}
            alt=""
            className="mb-5 size-14 rounded-2xl border border-cyan-400/25 object-cover shadow-[0_0_18px_rgba(0,229,255,0.25)]"
            draggable={false}
          />
          <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
            Build Studio
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
            {CODING_AGENTS[0].description}
          </p>
        </div>
        <div className="relative z-10 mt-6 flex items-center gap-2 text-sm font-medium text-cyan-300">
          Open agent
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </div>
      </Link>

      {/* Helix (Vercel AI Gateway) */}
      <Link
        to="/coder/helix"
        className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
        data-testid="coding-agent-card-helix"
      >
        <div className="relative z-10">
          <div className="mb-5 flex items-start justify-between">
            <img
              src={CODING_AGENTS[1].image}
              alt=""
              className="size-14 rounded-2xl border border-emerald-400/25 object-cover shadow-[0_0_18px_rgba(0,255,170,0.22)]"
              draggable={false}
            />
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                helixRunning
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : helixStarting
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                    : "border-white/15 bg-white/5 text-white/45",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  helixRunning
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                    : helixStarting
                      ? "animate-pulse bg-cyan-400"
                      : "bg-slate-500",
                )}
              />
              {helixRunning
                ? "Running"
                : helixStarting
                  ? "Starting"
                  : "Offline"}
            </span>
          </div>
          <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
            Helix
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
            {CODING_AGENTS[1].description}
          </p>
          {!helixHasKey && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
              <KeyRound className="size-3" />
              Gateway token required — set it in Settings
            </p>
          )}
          {helixHasKey && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-300/80">
              <CheckCircle2 className="size-3" />
              Gateway token configured
            </p>
          )}
        </div>
        <div className="relative z-10 mt-6 flex items-center gap-2 text-sm font-medium text-emerald-300">
          Open agent
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </div>
      </Link>

      {/* OpenWorker (local Python agent, hosted here rather than standalone) */}
      <Link
        to="/coder/openworker"
        className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
        data-testid="coding-agent-card-openworker"
      >
        <div className="relative z-10">
          <div className="mb-5 flex items-start justify-between">
            <img
              src={CODING_AGENTS[2].image}
              alt=""
              className="size-14 rounded-2xl border border-violet-400/25 object-cover shadow-[0_0_18px_rgba(167,139,250,0.22)]"
              draggable={false}
            />
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                openWorkerRunning
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : openWorkerStarting
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                    : "border-white/15 bg-white/5 text-white/45",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  openWorkerRunning
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                    : openWorkerStarting
                      ? "animate-pulse bg-cyan-400"
                      : "bg-slate-500",
                )}
              />
              {openWorkerRunning
                ? "Running"
                : openWorkerStarting
                  ? "Starting"
                  : "Offline"}
            </span>
          </div>
          <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
            OpenWorker
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
            {CODING_AGENTS[2].description}
          </p>
          {!openWorkerReady && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
              <KeyRound className="size-3" />
              One-time setup needed — open to see the steps
            </p>
          )}
          {openWorkerReady && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-300/80">
              <CheckCircle2 className="size-3" />
              Installed and ready
            </p>
          )}
        </div>
        <div className="relative z-10 mt-6 flex items-center gap-2 text-sm font-medium text-violet-300">
          Open agent
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </div>
      </Link>
    </section>
  );
}
