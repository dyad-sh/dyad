import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Briefcase,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useOpenWorker } from "@/hooks/useOpenWorker";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STATE_META = {
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
    dot: "bg-rose-400",
  },
} as const;

function StatePill({ state }: { state: keyof typeof STATE_META }) {
  const meta = STATE_META[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        meta.cls,
      )}
      data-testid="openworker-state"
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/**
 * A setup step the user has to perform once. OpenWorker brings its own Python
 * environment, so the app can describe the command but should not run package
 * installs on the user's behalf.
 */
function SetupStep({
  done,
  title,
  command,
  where,
}: {
  done: boolean;
  title: string;
  command: string;
  where: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px]",
          done
            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
            : "border-white/20 bg-white/5 text-white/40",
        )}
        aria-hidden
      >
        {done ? "✓" : ""}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-white/80">{title}</p>
        {!done && (
          <>
            <code className="mt-1 block overflow-x-auto rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-cyan-200">
              {command}
            </code>
            <p className="mt-1 text-xs text-white/40">in {where}</p>
          </>
        )}
      </div>
    </li>
  );
}

export default function OpenWorkerAgentPage() {
  const { status, start, stop, isStartPending, isStopPending } =
    useOpenWorker();
  const state = status?.state ?? "stopped";
  const ready = status?.appFound && status?.venvReady && status?.guiBuilt;

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-transparent">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <Link
          to="/coder"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/60 transition hover:border-cyan-400/40 hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Agents
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Briefcase className="size-4 shrink-0 text-cyan-300" />
          <span className="truncate text-sm font-semibold">OpenWorker</span>
        </div>
        <StatePill state={state} />

        <div className="ml-auto flex items-center gap-2">
          {state === "running" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  void run(async () => {
                    await stop();
                    await start();
                  })
                }
                disabled={isStartPending || isStopPending}
              >
                <RotateCcw className="size-3.5" />
                Restart
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void run(stop)}
                disabled={isStopPending}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void run(start)}
              disabled={isStartPending || !ready}
              data-testid="openworker-start"
            >
              {isStartPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Start
            </Button>
          )}
        </div>
      </header>

      {status && !status.hasModelKey && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">
          <KeyRound className="size-3.5 shrink-0" />
          OpenWorker needs an Anthropic or OpenAI key to run tasks. Add one in
          Settings and it will be passed to the agent automatically.
        </div>
      )}

      {status?.error && (
        <div className="flex shrink-0 items-start gap-2 border-b border-rose-400/20 bg-rose-500/10 px-5 py-2 text-xs text-rose-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{status.error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {state === "running" && status?.url ? (
          <iframe
            src={status.url}
            title="OpenWorker"
            className="size-full border-0"
            data-testid="openworker-iframe"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl">
              <h2 className="text-base font-semibold text-white/90">
                OpenWorker
              </h2>
              <p className="mt-1 text-sm text-white/55">
                An agent that produces real deliverables — documents,
                spreadsheets, reports — running locally as part of Meta Human OS
                rather than as a separate app.
              </p>

              {!ready && (
                <>
                  <p className="mt-4 text-xs font-medium tracking-wide text-white/40 uppercase">
                    One-time setup
                  </p>
                  <ol className="mt-2 space-y-3">
                    <SetupStep
                      done={Boolean(status?.appFound)}
                      title="Get the OpenWorker source"
                      command="git clone https://github.com/andrewyng/openworker.git openworker"
                      where="the Meta Human OS folder"
                    />
                    <SetupStep
                      done={Boolean(status?.venvReady)}
                      title="Create its Python environment"
                      command="bash packaging/setup_dev_env.sh"
                      where="openworker/"
                    />
                    <SetupStep
                      done={Boolean(status?.guiBuilt)}
                      title="Build its interface"
                      command="npm install && npm run build"
                      where="openworker/surfaces/gui/"
                    />
                  </ol>
                </>
              )}

              {ready && state !== "starting" && (
                <p className="mt-4 text-sm text-white/50">
                  Press Start to bring the agent online.
                </p>
              )}

              {state === "starting" && (
                <p className="mt-4 flex items-center gap-2 text-sm text-cyan-200">
                  <Loader2 className="size-4 animate-spin" />
                  Starting the agent server…
                </p>
              )}

              {status && status.recentOutput.length > 0 && (
                <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-white/50">
                  {status.recentOutput.join("\n")}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
