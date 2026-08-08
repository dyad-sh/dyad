import { Route } from "@tanstack/react-router";
import CodingAgentsPage from "../pages/coding-agents";
import HelixAgentPage from "../pages/helix-agent";
import OpenWorkerAgentPage from "../pages/openworker-agent";
import Assembler3DPage from "../pages/assembler3d";
import EngineeringPage from "../pages/engineering";
import { rootRoute } from "./root";

/** Coding agent launcher — pick Build Studio or Helix. */
export const codingAgentsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/coder",
  component: CodingAgentsPage,
});

/** Helix coding agent workspace (embedded Vercel AI Gateway app). */
export const helixAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/coder/helix",
  component: HelixAgentPage,
});

/** OpenWorker agent workspace (embedded local Python agent + its own UI). */
export const openWorkerAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/coder/openworker",
  component: OpenWorkerAgentPage,
});

/** Engineering hangar — the launcher for the design and build tools. */
export const engineeringRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/engineering",
  component: EngineeringPage,
});

/** Assembler 3D — the engineering design workspace. */
export const buildForgeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/assembler3d",
  component: Assembler3DPage,
});
