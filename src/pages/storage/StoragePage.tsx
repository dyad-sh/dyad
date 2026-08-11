import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Cloud,
  Code2,
  DatabaseZap,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  LayoutTemplate,
  Store,
  ShieldCheck,
} from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";

const storageDestinations = [
  {
    title: "Coding Projects",
    description:
      "Every project you have built with Meta Human OS. Open one to keep coding, or restore one from the cloud.",
    detail: "Built with Build Studio",
    badge: "Projects",
    to: "/apps",
    icon: LayoutGrid,
    badgeIcon: Code2,
  },
  {
    title: "Template Hub",
    description:
      "Official and community templates. Pick the default your new projects start from.",
    detail: "Starting points for a build",
    badge: "Templates",
    to: "/hub",
    icon: Store,
    badgeIcon: LayoutTemplate,
  },
  {
    title: "Local Storage",
    description:
      "Browse the file vault connected to this machine: conversations, notes, media and everything the app writes locally.",
    detail: "Connected file vault",
    badge: "Local",
    to: "/local-storage",
    icon: FolderOpen,
    badgeIcon: ShieldCheck,
  },
  {
    title: "Meta Drive HD",
    description:
      "Browse, upload and organise generated images, videos, documents and other app files.",
    detail: "Vercel Blob cloud storage",
    badge: "Cloud",
    to: "/meta-hd",
    icon: HardDrive,
    badgeIcon: Cloud,
  },
  {
    title: "Vector Store",
    description:
      "Index local files, manage knowledge collections and search your private RAG workspace.",
    detail: "Private semantic knowledge",
    badge: "Local",
    to: "/vector",
    icon: DatabaseZap,
    badgeIcon: ShieldCheck,
  },
] as const;

export default function StoragePage() {
  return (
    <div
      className="agent-os home-jarvis no-app-region-drag relative min-h-full w-full overflow-hidden"
      data-testid="storage-page"
    >
      <ParticleBackground className="z-0" />

      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <HardDrive className="size-4" />
            Storage
          </div>
          <h1 className="font-jarvis-display text-3xl font-semibold tracking-wide text-white">
            Choose a storage workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-100/45">
            Open your coding projects and their templates, your cloud drive, or
            the local vector knowledge used by the app and its agents.
          </p>
        </header>

        <div className="space-y-4">
          {storageDestinations.map(
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
                data-testid={`storage-destination-${badge.toLowerCase()}`}
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
