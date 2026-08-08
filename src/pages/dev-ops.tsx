import { useSetAtom } from "jotai";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Github, GitFork, Plug, Triangle } from "lucide-react";

import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { useGithubAccount } from "@/hooks/useGithubAccount";
import { useVercelAccount } from "@/hooks/useVercelAccount";
import { cn } from "@/lib/utils";

function PluginCard({
  connected,
  description,
  icon: Icon,
  label,
  to,
}: {
  connected: boolean;
  description: string;
  icon: typeof Github;
  label: string;
  to: "/github" | "/vercel";
}) {
  return (
    <article className="rounded-xl border border-cyan-400/15 bg-[rgba(8,18,36,0.72)] p-5 shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-11 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/8 text-cyan-200">
          <Icon className="size-5" />
        </span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
            connected
              ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
              : "border-amber-400/25 bg-amber-400/8 text-amber-300",
          )}
        >
          {connected ? "Connected" : "Setup required"}
        </span>
      </div>
      <h2 className="mt-5 text-lg font-semibold text-cyan-50">{label}</h2>
      <p className="mt-1 min-h-10 text-sm leading-5 text-cyan-100/45">
        {description}
      </p>
      {connected && (
        <Link
          to={to}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/25 bg-cyan-400/8 px-3 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-400/14"
        >
          Manage {label}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </article>
  );
}

export default function DevOpsPage() {
  const setActiveSettingsTab = useSetAtom(activeSettingsTabAtom);
  const github = useGithubAccount();
  const vercel = useVercelAccount();

  return (
    <div
      className="home-jarvis relative min-h-full w-full overflow-hidden"
      data-testid="dev-ops-page"
    >
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-cyan-400/80">
            <GitFork className="size-4" />
            <span className="font-jarvis-ui text-xs uppercase tracking-[0.2em]">
              Dev Ops
            </span>
          </div>
          <h1 className="font-jarvis-display text-3xl font-semibold tracking-wide text-cyan-50 sm:text-4xl">
            Developer Services
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-100/50">
            Manage GitHub repositories and files, and create, rename or remove
            Vercel projects from one workspace.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <PluginCard
            connected={github.isConnected}
            description="Create and delete repositories, browse folders, and create, edit or remove files."
            icon={Github}
            label="GitHub"
            to="/github"
          />
          <PluginCard
            connected={vercel.isConnected}
            description="Browse, create, rename and delete projects, then open them in the Vercel dashboard."
            icon={Triangle}
            label="Vercel"
            to="/vercel"
          />
        </section>

        {(!github.isConnected || !vercel.isConnected) && (
          <Link
            to="/settings"
            onClick={() => setActiveSettingsTab("plugins")}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/20 bg-slate-950/35 px-3 text-sm text-cyan-100/70 transition-colors hover:border-cyan-400/35 hover:text-cyan-50"
          >
            <Plug className="size-4" />
            Configure plugins
          </Link>
        )}
      </main>
    </div>
  );
}
