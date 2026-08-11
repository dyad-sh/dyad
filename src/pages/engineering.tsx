import { Link } from "@tanstack/react-router";
import { ArrowRight, Box, DraftingCompass } from "lucide-react";
import { ParticleBackground } from "@/components/home/ParticleBackground";

/**
 * Engineering hangar — the design and build tools, gathered.
 *
 * Assembler is the only one today. It gets a hub of its own rather than a
 * direct sidebar link because the next engineering tool should be able to
 * arrive without another top-level icon: the sidebar is the scarce space, and
 * a category that grows is cheaper to extend here than there.
 */

const APPS = [
  {
    to: "/assembler3d" as const,
    title: "Assembler",
    testId: "engineering-card-assembler",
    Icon: Box,
    description:
      "A 3D workspace for drones, vessels, robots and embedded systems. Place parts, array and align them, and let weight, cost and power follow the build.",
    accent: {
      icon: "border-cyan-400/25 bg-cyan-500/10 text-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.25)]",
      action: "text-cyan-300",
    },
  },
];

export default function EngineeringPage() {
  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 max-w-2xl">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="manager-brand-icon">
              <DraftingCompass className="size-4" />
            </div>
            <span className="manager-brand-label font-jarvis-ui">
              ENGINEERING
            </span>
            <div className="manager-status-dot manager-status-dot--active" />
          </div>
          <h1 className="manager-title font-jarvis-display">
            Design machines, not slide decks.
          </h1>
          <p className="manager-subtitle">
            Tools for designing physical things: mechanical assemblies,
            airframes, hulls and the electronics that go in them.
          </p>
        </header>

        <section className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map(({ to, title, description, testId, Icon, accent }) => (
            <Link
              key={to}
              to={to}
              className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
              data-testid={testId}
            >
              <div className="relative z-10">
                <div
                  className={`mb-5 grid size-12 place-items-center rounded-2xl border ${accent.icon}`}
                >
                  <Icon className="size-5" />
                </div>
                <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
                  {title}
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
                  {description}
                </p>
              </div>
              <div
                className={`relative z-10 mt-6 flex items-center gap-2 text-sm font-medium ${accent.action}`}
              >
                Open
                <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
