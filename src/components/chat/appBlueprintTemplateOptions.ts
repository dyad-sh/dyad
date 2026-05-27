import type { Template } from "@/shared/templates";

export function getAppBlueprintTemplateOptions(
  templates: Template[] | undefined,
  currentTemplateId: string,
): Template[] {
  return (templates ?? []).filter(
    (template) => template.isOfficial || template.id === currentTemplateId,
  );
}
