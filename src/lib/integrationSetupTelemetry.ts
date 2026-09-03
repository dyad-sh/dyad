import type { PostHog } from "posthog-js";

type IntegrationProvider = "neon" | "supabase";
type IntegrationSetupEvent = {
  provider: IntegrationProvider;
  requestId: string;
};

const trackedSetupStarts = new Set<string>();

export function captureIntegrationSetupStart(
  posthog: Pick<PostHog, "capture">,
  event: IntegrationSetupEvent,
): void {
  const key = `${event.requestId}:${event.provider}`;
  if (trackedSetupStarts.has(key)) return;

  trackedSetupStarts.add(key);
  posthog.capture("integration-setup:start", event);
}

export function captureIntegrationSetupComplete(
  posthog: Pick<PostHog, "capture">,
  event: IntegrationSetupEvent,
): void {
  // Tool-locked providers can be completed directly from Configure without
  // the chat card's provider handoff, so guarantee a matching start first.
  captureIntegrationSetupStart(posthog, event);
  posthog.capture("integration-setup:complete", event);
}
