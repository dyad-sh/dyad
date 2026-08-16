import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";

import {
  AGENTS_SECTION_ICON,
  AGENT_GROUPS,
  agentDestinationsInGroup,
  type AgentDestination,
} from "@/lib/agent_sections";
import {
  activeAgentWorkspaceTabAtom,
  agentWorkspaceTabsAtom,
  lovableWebDevAvatarAtom,
} from "@/atoms/chatAgentAtoms";
import { useAgentOsAgents } from "@/hooks/useAgentOsAgents";
import { LOVABLE_WEB_DEV_AGENT } from "@/lib/lovable_web_dev";
import { openHermesWorkspaceTab } from "@/lib/hermes_workspace_tabs";
import { CodingAgentRows } from "@/components/coding-agents/CodingAgentCards";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { AgentAvatar } from "@/pages/agent-os/AgentOsPage";
import { StatusDot } from "@/pages/agent-os/ui";
import type { Agent } from "@/pages/agent-os/data";

/**
 * The Agents section.
 *
 * Categorisation, not construction. Every entry opens a screen that already
 * existed: the Coding and Configuration rows navigate to their original
 * routes, and a My Agents row opens the agent's chat through the same
 * workspace-tab atoms the Agent OS dashboard has always used, so the chat that
 * appears is the one that was already there.
 *
 * My Agents is read from the registered agents rather than listed here. The
 * section describes what exists; it does not decide it.
 */

export default function AgentsPage() {
  const navigate = useNavigate();
  const { agents } = useAgentOsAgents();
  const [openWorkspaceTabs, setOpenWorkspaceTabs] = useAtom(
    agentWorkspaceTabsAtom,
  );
  const [, setActiveTab] = useAtom(activeAgentWorkspaceTabAtom);
  const webDevAvatar = useAtomValue(lovableWebDevAvatarAtom);

  // The same set the dashboard shows: the built-in Web Dev agent, then every
  // Hermes agent the user has registered.
  const myAgents = useMemo(() => {
    const webDev: Agent = {
      ...LOVABLE_WEB_DEV_AGENT,
      icon: webDevAvatar || "🌐",
    };
    return [webDev, ...agents.filter((agent) => agent.type === "Hermes")];
  }, [agents, webDevAvatar]);

  const openAgent = (agent: Agent) => {
    setOpenWorkspaceTabs((current) =>
      openHermesWorkspaceTab(current, {
        id: agent.id,
        name: agent.name,
        icon: agent.icon || "🪽",
      }),
    );
    setActiveTab(agent.id);
    void navigate({ to: "/agent-os" });
  };

  const openDestination = (destination: AgentDestination) => {
    if (destination.route === "/agent-os") {
      // The dashboard, not whichever agent chat was last open.
      setActiveTab("dashboard");
    }
    void navigate({ to: destination.route });
  };

  const openTabIds = new Set(openWorkspaceTabs.map((tab) => tab.id));

  return (
    /* One screen, like the dashboard: the page does not scroll, and a group
       with more entries than fit scrolls within its own column. */
    <div className="settings-jarvis home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <header className="shrink-0">
          <div className="mb-2 flex items-center gap-2.5">
            <div className="manager-brand-icon">
              <AGENTS_SECTION_ICON className="size-4" />
            </div>
            <span className="manager-brand-label font-jarvis-ui">AGENTS</span>
            <div className="manager-status-dot manager-status-dot--active" />
          </div>
          <h1 className="manager-title font-jarvis-display">
            Every agent, grouped by what it is for
          </h1>
          <p className="manager-subtitle">
            The assistants you use, the coding tools, and where agents are
            connected and configured.
          </p>
        </header>

        {/* The groups sit beside one another rather than stacking, which is
            what made this page taller than the window. */}
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
          {AGENT_GROUPS.map((group) => (
            <section key={group} className="flex min-h-0 flex-col">
              <h2 className="system-group-label shrink-0">{group}</h2>
              <div className="system-grid system-grid--single-column min-h-0 flex-1 overflow-y-auto pr-1">
                {/* The coding agents themselves, in the same row shape as the
                  ones above, from the component that owns their status. */}
                {group === "Coding" && <CodingAgentRows />}

                {group === "My Agents"
                  ? myAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => openAgent(agent)}
                        className="system-card agents-card"
                        data-testid={`agents-open-${agent.id}`}
                      >
                        <AgentAvatar
                          agent={agent}
                          className="size-10 rounded-lg text-base"
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="system-card-title">
                            {agent.name}
                          </span>
                          <span className="system-card-summary">
                            {agent.description}
                          </span>
                        </span>
                        {/* The dashboard's own status treatment, unchanged. */}
                        <span className="agents-card-status-slot">
                          {openTabIds.has(agent.id) && (
                            <span className="system-card-status">Open</span>
                          )}
                          <StatusDot status={agent.status} />
                        </span>
                      </button>
                    ))
                  : agentDestinationsInGroup(group).map((destination) => (
                      <button
                        key={destination.id}
                        type="button"
                        onClick={() => openDestination(destination)}
                        className="system-card agents-card"
                        data-testid={`agents-open-${destination.id}`}
                      >
                        {destination.image ? (
                          <img
                            src={destination.image}
                            alt=""
                            className="size-10 shrink-0 rounded-lg object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="system-card-icon">
                            <destination.icon className="size-4" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 text-left">
                          <span className="system-card-title">
                            {destination.label}
                          </span>
                          <span className="system-card-summary">
                            {destination.summary}
                          </span>
                        </span>
                        <span
                          className="agents-card-status-slot"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
              </div>

              {group === "My Agents" && myAgents.length === 0 && (
                <p className="shrink-0 text-xs text-cyan-100/40">
                  No agents registered yet. Add one under Configuration → Hermes
                  Agents.
                </p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
