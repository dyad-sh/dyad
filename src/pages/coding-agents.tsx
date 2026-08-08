import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Code2,
  KeyRound,
  Orbit,
  Terminal,
} from "lucide-react";

import { useHelix } from "@/hooks/useHelix";
import { useOpenWorker } from "@/hooks/useOpenWorker";
import { cn } from "@/lib/utils";

/**
 * Coding Agent hangar — pick which coding agent to fly. Uses the shared
 * holo-card style so each agent gets its own focused workspace.
 */
export default function CodingAgentsPage() {
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
    <div className="settings-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 max-w-2xl">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="manager-brand-icon">
              <Terminal className="size-4" />
            </div>
            <span className="manager-brand-label font-jarvis-ui">
              CODING AGENTS
            </span>
            <div className="manager-status-dot manager-status-dot--active" />
          </div>
          <h1 className="manager-title font-jarvis-display">
            Choose your coding agent
          </h1>
          <p className="manager-subtitle">
            Two specialists, one mission. The Build Studio is the native
            app-building agent; Helix is the Vercel AI Gateway agent with
            sandboxed execution and live preview.
          </p>
        </header>

        <section className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Native build studio */}
          <Link
            to="/coder/studio"
            className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
            data-testid="coding-agent-card-studio"
          >
            <div className="relative z-10">
              <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.25)]">
                <Code2 className="size-5" />
              </div>
              <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
                Build Studio
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
                The native Meta Human OS coder. Chat-driven app building with
                live preview, versioning, and one-click publishing.
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
                <div className="grid size-12 place-items-center rounded-2xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-300 shadow-[0_0_18px_rgba(0,255,170,0.22)]">
                  <Orbit className="size-5" />
                </div>
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
                GPT-5.3 Codex through the Vercel AI Gateway with secure sandbox
                execution, file explorer, and live preview.
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
                <div className="grid size-12 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-300 shadow-[0_0_18px_rgba(167,139,250,0.22)]">
                  <Briefcase className="size-5" />
                </div>
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
                Gets everyday work done — documents, spreadsheets and reports —
                with 25+ tool connectors, running locally inside Meta Human OS.
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
      </main>
    </div>
  );
}
