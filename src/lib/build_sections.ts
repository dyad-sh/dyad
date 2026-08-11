import { Box, CircuitBoard, Cog, Factory, type LucideIcon } from "lucide-react";

/**
 * Build: the physical-engineering section, as data.
 *
 * Three disciplines, and a registry of the tools that belong to each. The
 * registry is the point. Adding a tool later means one entry here and it
 * appears on its category page; it does not mean another icon in the rail,
 * which is the scarce space.
 *
 * Only tools that exist are listed. A category with nothing in it says so.
 * Naming a tool that does not exist would make the section look finished and
 * send people to a dead end, which is worse than an honest empty page.
 *
 * Software, apps, coding agents and web development are deliberately absent:
 * they live elsewhere in the app and Build is for physical things.
 */

export type BuildCategoryId = "electronics" | "mechanical" | "fabrication";

export type BuildCategory = {
  id: BuildCategoryId;
  label: string;
  /** Shown under the category title. */
  summary: string;
  icon: LucideIcon;
  route: string;
};

/** Order in the icon rail and in the section. */
export const BUILD_CATEGORIES: BuildCategory[] = [
  {
    id: "electronics",
    label: "Electronics",
    summary: "Design, analyse and build electronic systems.",
    icon: CircuitBoard,
    route: "/build/electronics",
  },
  {
    id: "mechanical",
    label: "Mechanical",
    summary: "Design mechanical assemblies, structures and machines.",
    icon: Cog,
    route: "/build/mechanical",
  },
  {
    id: "fabrication",
    label: "Fabrication",
    summary: "Turn a design into a made thing.",
    icon: Factory,
    route: "/build/fabrication",
  },
];

export type BuildTool = {
  id: string;
  title: string;
  description: string;
  category: BuildCategoryId;
  icon: LucideIcon;
  /** The route it already had. */
  route: string;
  testId: string;
};

/**
 * Every Build tool that exists today.
 *
 * Assembler is the whole list. It was the only thing on the Engineering page,
 * it keeps its route and its screen, and it sits under Mechanical because that
 * is what it is: a 3D assembly workspace.
 */
export const BUILD_TOOLS: BuildTool[] = [
  {
    id: "assembler",
    title: "Assembler",
    description:
      "A 3D workspace for drones, vessels, robots and embedded systems. Place parts, array and align them, and let weight, cost and power follow the build.",
    category: "mechanical",
    icon: Box,
    route: "/assembler3d",
    testId: "engineering-card-assembler",
  },
];

export function buildToolsInCategory(category: BuildCategoryId): BuildTool[] {
  return BUILD_TOOLS.filter((tool) => tool.category === category);
}

export function findBuildCategory(
  id: string | null | undefined,
): BuildCategory | undefined {
  return BUILD_CATEGORIES.find((category) => category.id === id);
}
