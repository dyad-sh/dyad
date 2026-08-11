import { Link } from "@tanstack/react-router";
import { ArrowRight, Brain, Library, Network, Sparkles } from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";

/**
 * Memory — what the app knows, in one place.
 *
 * The Knowledge Core and the Knowledge Base were two rail entries for two
 * halves of the same idea. They are unchanged; this is where they now live.
 */

const memoryDestinations = [
  {
    title: "Knowledge Core",
    description:
      "What the app has learned and remembers: the connected graph of facts, entities and their relationships.",
    detail: "Structured memory",
    badge: "Core",
    to: "/knowledge-core",
    icon: Network,
    badgeIcon: Sparkles,
  },
  {
    title: "Knowledge Base",
    description:
      "Documents and sources you have given it to read, and the collections they are grouped into.",
    detail: "Documents and sources",
    badge: "Sources",
    to: "/knowledge-base",
    icon: Library,
    badgeIcon: Brain,
  },
] as const;

export default function MemoryPage() {
  return (
    <div
      className="agent-os home-jarvis no-app-region-drag relative min-h-full w-full overflow-y-auto"
      data-testid="memory-page"
    >
      <ParticleBackground className="z-0" />

      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <Brain className="size-4" />
            Memory
          </div>
          <h1 className="font-jarvis-display text-3xl font-semibold tracking-wide text-white">
            What Meta Human OS knows
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-100/45">
            The knowledge it has built for itself, and the sources you have
            given it to read.
          </p>
        </header>

        <div className="space-y-4">
          {memoryDestinations.map(
            ({
              title,
              description,
              detail,
              badge,
              to,
              icon: Icon,
              badgeIcon: BadgeIcon,
            }) => (
              <Link
                key={to}
                to={to}
                className="group flex w-full flex-col gap-5 rounded-2xl border border-cyan-400/15 bg-[rgba(5,16,31,0.72)] p-5 text-left outline-none transition-colors hover:border-cyan-400/35 hover:bg-cyan-500/8 focus-visible:ring-2 focus-visible:ring-cyan-400/60 sm:flex-row sm:items-center"
                data-testid={`memory-destination-${badge.toLowerCase()}`}
              >
                <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-500/8 text-cyan-200">
                  <Icon className="size-7" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-white">
                      {title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/15 bg-cyan-500/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-100/60">
                      <BadgeIcon className="size-3" />
                      {badge}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-cyan-100/45">
                    {description}
                  </span>
                  <span className="mt-2 block text-xs font-medium text-cyan-300/70">
                    {detail}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-cyan-200/70 transition-colors group-hover:text-cyan-100">
                  Open
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ),
          )}
        </div>
      </main>
    </div>
  );
}
