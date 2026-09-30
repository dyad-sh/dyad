import type { AppFrameworkType } from "@/lib/framework_constants";
import { filterGuideByFramework } from "./filter_guide_by_framework";

/** Resolve runtime-specific guidance before sending a guide to the model. */
export function renderGuide(
  markdown: string,
  frameworkType: AppFrameworkType | null,
  { enableAppPreviewDomains = false }: { enableAppPreviewDomains?: boolean } = {},
): string {
  return filterGuideByFramework(markdown, frameworkType).replace(
    "[[PREVIEW_COOKIE_GUIDANCE]]",
    enableAppPreviewDomains
      ? "Dyad previews use stable `app-<numeric app ID>.localhost` hostnames and strip cookie `Domain` attributes, so each app keeps its own host-only session."
      : "Dyad previews use `localhost` with shared cookies across ports.",
  );
}
