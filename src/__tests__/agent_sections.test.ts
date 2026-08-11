import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_DESTINATIONS,
  AGENT_GROUPS,
  agentDestinationsInGroup,
  findAgentDestination,
} from "@/lib/agent_sections";
import { screenForPath } from "@/lib/workspace_screens";

/**
 * The Agents section is categorisation, so the tests assert exactly that: the
 * groups exist, and every destination still points at the route it had before.
 *
 * The interesting assertion is the one about My Agents. Those rows come from
 * the agents the user registered, and the temptation when reorganising is to
 * write today's three names into the navigation. That would look identical on
 * the day it was written and be wrong forever after.
 */

const declaredRoutePaths = (): Set<string> => {
  const dir = path.join(process.cwd(), "src", "routes");
  const paths = new Set<string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      for (const match of fs
        .readFileSync(full, "utf8")
        .matchAll(/path:\s*"([^"]+)"/g)) {
        paths.add(match[1]);
      }
    }
  };
  walk(dir);
  return paths;
};

describe("Agents section", () => {
  it("keeps every destination on the route it already had", () => {
    // Reorganising must not strand a screen. If a route is renamed, this fails
    // rather than the entry quietly opening nothing.
    const routes = declaredRoutePaths();
    for (const destination of AGENT_DESTINATIONS) {
      expect(
        routes.has(destination.route),
        `"${destination.label}" points at ${destination.route}, which no route declares`,
      ).toBe(true);
    }
  });

  it("leaves Coding to the component that owns those cards", () => {
    // Build Studio, Helix and OpenWorker render from CodingAgentCards, with
    // their real status. A static entry here would be a second description of
    // the same three agents, correct only until one of them changes.
    expect(agentDestinationsInGroup("Coding" as never)).toEqual([]);
    const page = fs.readFileSync(
      path.join(process.cwd(), "src", "pages", "agents.tsx"),
      "utf8",
    );
    expect(page).toContain("CodingAgentRows");
  });

  it("keeps Hermes Agents under Configuration", () => {
    expect(agentDestinationsInGroup("Configuration").map((d) => d.id)).toEqual([
      "hermes-agents",
    ]);
  });

  it("does not hard-code My Agents", () => {
    // The registered agents are data. A fixed entry here would be a copy of
    // that data, wrong the moment an agent is renamed, added or removed.
    expect(agentDestinationsInGroup("My Agents" as never)).toEqual([]);
    const labels = AGENT_DESTINATIONS.map((d) => d.label.toLowerCase());
    for (const name of [
      "brainiac",
      "emc2",
      "web dev",
      "helix",
      "openworker",
      "build studio",
    ]) {
      expect(
        labels,
        `"${name}" is a live agent, not a navigation entry`,
      ).not.toContain(name);
    }
  });

  it("lists the groups in the order the section presents them", () => {
    expect(AGENT_GROUPS).toEqual(["My Agents", "Coding", "Configuration"]);
  });

  it("gives every destination a distinct id and summary", () => {
    const ids = AGENT_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const summaries = AGENT_DESTINATIONS.map((d) => d.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    for (const id of ids) {
      expect(findAgentDestination(id)).toBeDefined();
    }
  });

  it("opens a titled tab for the section itself", () => {
    // A route with no workspace screen opens an untitled tab.
    expect(screenForPath("/agents")?.title).toBe("Agents");
  });
});
