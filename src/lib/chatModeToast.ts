import type { ChatMode } from "./schemas";

export function getChatModeDisplayName(mode: ChatMode): string {
  switch (mode) {
    case "ask":
      return "Ask";
    case "local-agent":
      return "Agent";
    case "plan":
      return "Plan";
  }
}
