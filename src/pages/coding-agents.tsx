import { Terminal } from "lucide-react";

import { CodingAgentCards } from "@/components/coding-agents/CodingAgentCards";
import { ParticleBackground } from "@/components/home/ParticleBackground";

/**
 * Coding Agent hangar — pick which coding agent to fly. Uses the shared
 * holo-card style so each agent gets its own focused workspace.
 */
export default function CodingAgentsPage() {
  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <ParticleBackground className="z-0" />
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

        <CodingAgentCards />
      </main>
    </div>
  );
}
