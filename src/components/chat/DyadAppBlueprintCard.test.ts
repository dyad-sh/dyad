import { describe, expect, it } from "vitest";
import type { Template } from "@/shared/templates";
import { getAppBlueprintTemplateOptions } from "./appBlueprintTemplateOptions";

const templates: Template[] = [
  {
    id: "react",
    title: "React.js Template",
    description: "Official React template",
    imageUrl: "react.png",
    isOfficial: true,
  },
  {
    id: "dyad-sh/community-template",
    title: "Community Template",
    description: "Community template",
    imageUrl: "community.png",
    isOfficial: false,
  },
  {
    id: "dyad-sh/selected-community-template",
    title: "Selected Community Template",
    description: "Selected community template",
    imageUrl: "selected-community.png",
    isOfficial: false,
  },
];

describe("getAppBlueprintTemplateOptions", () => {
  it("hides community templates when the current template is official", () => {
    expect(
      getAppBlueprintTemplateOptions(templates, "react").map(
        (template) => template.id,
      ),
    ).toEqual(["react"]);
  });

  it("keeps the current community template visible", () => {
    expect(
      getAppBlueprintTemplateOptions(
        templates,
        "dyad-sh/selected-community-template",
      ).map((template) => template.id),
    ).toEqual(["react", "dyad-sh/selected-community-template"]);
  });
});
