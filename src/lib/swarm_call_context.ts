/**
 * Swarm Call Context (side-channel)
 *
 * The local agent's `AgentContext` interface is shared by 20+ tools and is
 * heavily app-sandbox-oriented (appPath, supabaseProjectId, XML streaming).
 * Rather than thread swarm-specific identity through every tool signature,
 * the swarm runtime sets a thread-local-ish "current call" context here
 * before each tool invocation, and swarm orchestration tools read it.
 *
 * Because Node.js runs the executor on a single event-loop thread, a simple
 * module-level variable is sufficient. The runtime guards with try/finally.
 */

import type { AgentNodeId, SwarmId } from "@/lib/agent_swarm";

export interface SwarmCallContext {
  swarmId: SwarmId;
  callerAgentId: AgentNodeId;
  callerAgentName: string;
  callerRole: string;
}

let current: SwarmCallContext | null = null;

export function setSwarmCallContext(ctx: SwarmCallContext | null): void {
  current = ctx;
}

export function getSwarmCallContext(): SwarmCallContext | null {
  return current;
}

export function requireSwarmCallContext(): SwarmCallContext {
  if (!current) {
    throw new Error(
      "This tool can only be used inside a swarm agent execution context",
    );
  }
  return current;
}
