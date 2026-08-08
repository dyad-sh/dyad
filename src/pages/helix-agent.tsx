import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Loader2,
  Orbit,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useHelix } from "@/hooks/useHelix";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";

function StatePill({
  state,
}: {
  state: "stopped" | "starting" | "running" | "error";
}) {
  const meta = {
    stopped: {
      label: "Offline",
      cls: "border-white/15 bg-white/5 text-white/50",
      dot: "bg-slate-500",
    },
    starting: {
      label: "Starting",
      cls: "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
      dot: "animate-pulse bg-cyan-400",
    },
    running: {
      label: "Running",
      cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
    },
    error: {
      label: "Error",
      cls: "border-rose-400/30 bg-rose-500/10 text-rose-300",
      dot: "bg-rose-500",
    },
  }[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        meta.cls,
      )}
      data-testid="helix-state-pill"
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/**
 * Helix coding agent workspace: manages the embedded Next.js dev server
 * (in <repo>/aios) and renders its UI inline once it's up.
 */
export default function HelixAgentPage() {
  const { status, isLoading, start, isStartPending, stop, isStopPending } =
    useHelix();
  const goToSettings = useScrollAndNavigateTo("/settings");

  const state = status?.state ?? "stopped";
  const busy = isStartPending || isStopPending;

  const handleStart = async () => {
    try {
      await start();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStop = async () => {
    try {
      await stop();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRestart = async () => {
    try {
      await stop();
      await start();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="agent-os no-app-region-drag relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="helix-agent-page"
    >
      {/* Control bar */}
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-cyan-400/10 bg-[rgba(4,10,22,0.55)] px-4 py-3 backdrop-blur-xl">
        <Link
          to="/coder"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/60 transition hover:border-cyan-400/40 hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Agents
        </Link>
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-400 text-[#04101f] shadow-[0_0_18px_rgba(0,255,170,0.4)]">
          <Orbit className="size-4.5" />
        </div>
        <div className="leading-tight">
          <h1 className="font-jarvis-display text-base font-semibold text-white">
            Helix
          </h1>
          <p className="font-jarvis-ui text-[10px] uppercase tracking-[0.18em] text-cyan-300/50">
            Vercel AI Gateway · Sandbox
          </p>
        </div>
        <StatePill state={state} />
        {!status?.hasGatewayKey && (
          <button
            type="button"
            onClick={() => goToSettings(SECTION_IDS.helix)}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200 transition hover:border-amber-400/50"
          >
            <KeyRound className="size-3" />
            Gateway token missing — configure
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {status?.url && state === "running" && (
            <Button
              size="sm"
              variant="outline"
              as="a"
              href={status.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5" />
              Open in browser
            </Button>
          )}
          {state === "running" || state === "starting" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestart}
                disabled={busy}
              >
                <RotateCcw className="size-3.5" />
                Restart
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-300 hover:text-rose-200"
                onClick={handleStop}
                disabled={busy}
                data-testid="helix-stop"
              >
                {isStopPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Square className="size-3.5" />
                )}
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={busy || isLoading || !status?.appFound}
              data-testid="helix-start"
            >
              {isStartPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Launch Helix
            </Button>
          )}
        </div>
      </header>

      {/* Workspace */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {state === "running" && status?.url ? (
          <iframe
            src={status.url}
            title="Helix coding agent"
            className="size-full border-0 bg-[#0a0a0f]"
            data-testid="helix-iframe"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-xl rounded-2xl border border-cyan-400/12 bg-[rgba(8,20,40,0.5)] p-8 text-center backdrop-blur-xl">
              {state === "starting" ? (
                <>
                  <Loader2 className="mx-auto size-10 animate-spin text-cyan-300" />
                  <h2 className="mt-4 font-jarvis-display text-lg font-semibold text-white">
                    Spinning up Helix…
                  </h2>
                  <p className="mt-1 text-sm text-white/45">
                    Booting the Next.js dev server on port {status?.port}. This
                    can take up to a minute on first launch.
                  </p>
                </>
              ) : state === "error" ? (
                <>
                  <TriangleAlert className="mx-auto size-10 text-rose-400" />
                  <h2 className="mt-4 font-jarvis-display text-lg font-semibold text-white">
                    Helix failed to start
                  </h2>
                  {status?.error && (
                    <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      {status.error}
                    </p>
                  )}
                  <Button
                    className="mt-4"
                    onClick={handleStart}
                    disabled={busy}
                  >
                    <RotateCcw className="size-4" />
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-400 text-[#04101f] shadow-[0_0_28px_rgba(0,255,170,0.4)]">
                    <Orbit className="size-8" />
                  </div>
                  <h2 className="mt-4 font-jarvis-display text-xl font-semibold text-white">
                    Helix Coding Agent
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                    Chat-driven code generation with GPT-5.3 Codex via the
                    Vercel AI Gateway, secure sandbox execution, live preview,
                    file explorer, and command logs.
                  </p>
                  {!status?.appFound && !isLoading && (
                    <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      The Helix app folder was not found. Copy the helix (aios)
                      folder to{" "}
                      <code className="break-all font-mono">
                        {status?.managedDir ?? "the app data folder"}
                      </code>
                      .
                    </p>
                  )}
                  <Button
                    size="lg"
                    className="mt-5"
                    onClick={handleStart}
                    disabled={busy || isLoading || !status?.appFound}
                    data-testid="helix-launch"
                  >
                    {isStartPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Launch Helix
                  </Button>
                  {!status?.hasGatewayKey && (
                    <p className="mt-3 text-[11px] text-amber-200/80">
                      Tip: add your Vercel AI Gateway token in Settings → Chat
                      Agent first, or generations will fail.
                    </p>
                  )}
                </>
              )}

              {(state === "error" || state === "starting") &&
                (status?.recentOutput?.length ?? 0) > 0 && (
                  <pre className="mt-5 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-cyan-400/15 bg-black/40 p-3 text-left font-mono text-[11px] leading-relaxed text-white/60">
                    {status?.recentOutput.join("\n")}
                  </pre>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
