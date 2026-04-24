/**
 * Widget / Scheduler / Macro → ToolDefinition Adapters
 *
 * Surfaces the new extension subsystems as agent-callable tools so the swarm
 * can pin live UI cards, schedule recurring jobs, and define new macro
 * "tools" composed of existing tools.
 */

import { z } from "zod";
import { getWidgetSystem, type WidgetId } from "@/lib/widget_system";
import { getSchedulerService, type ScheduleId } from "@/lib/scheduler_service";
import { getToolMacroStore, type MacroId } from "@/lib/tool_macro";
import type { ToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// WIDGET TOOLS
// ---------------------------------------------------------------------------

const widgetCreateTool: ToolDefinition = {
  name: "widget_create",
  description:
    "Pin a live widget (card / chart / list / iframe / custom) to a container (default: dashboard). Use to surface ongoing agent work or status to the user.",
  inputSchema: z.object({
    kind: z.enum(["card", "chart", "list", "iframe", "custom"]),
    title: z.string(),
    component: z.string().nullable().optional(),
    props: z.record(z.unknown()).optional(),
    container: z.string().optional().default("dashboard"),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `widget_create(${args.kind}: ${args.title})`,
  execute: async (args) => {
    const sys = getWidgetSystem();
    await sys.initialize();
    const widget = sys.create({
      kind: args.kind,
      title: args.title,
      component: args.component ?? null,
      props: args.props,
      container: args.container,
      ownerId: "agent",
      ownerKind: "agent",
    });
    return JSON.stringify({ id: widget.id, container: widget.container });
  },
};

const widgetListTool: ToolDefinition = {
  name: "widget_list",
  description: "List widgets, optionally filtered by container.",
  inputSchema: z.object({ container: z.string().optional() }),
  defaultConsent: "always",
  execute: async (args) => {
    const sys = getWidgetSystem();
    await sys.initialize();
    return JSON.stringify(sys.list(args.container));
  },
};

const widgetRemoveTool: ToolDefinition = {
  name: "widget_remove",
  description: "Remove a widget by id.",
  inputSchema: z.object({ id: z.string() }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `widget_remove(${args.id})`,
  execute: async (args) => {
    const sys = getWidgetSystem();
    await sys.initialize();
    sys.remove(args.id as WidgetId);
    return JSON.stringify({ ok: true });
  },
};

// ---------------------------------------------------------------------------
// SCHEDULER TOOLS
// ---------------------------------------------------------------------------

const scheduleCreateTool: ToolDefinition = {
  name: "schedule_create",
  description:
    "Schedule a tool invocation to run on a cron (5-field: minute hour day month dow). Survives restart. Returns schedule id.",
  inputSchema: z.object({
    name: z.string(),
    cron: z.string().describe("Standard 5-field cron expression, e.g. '0 9 * * 1' for Mondays at 9am"),
    toolName: z.string(),
    args: z.record(z.unknown()).optional().default({}),
    enabled: z.boolean().optional().default(true),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) =>
    `schedule_create(${args.name}, cron='${args.cron}', tool=${args.toolName})`,
  execute: async (args) => {
    const sys = getSchedulerService();
    await sys.initialize();
    const sched = sys.create({
      name: args.name,
      cron: args.cron,
      action: { toolName: args.toolName, args: args.args ?? {} },
      ownerId: "agent",
      ownerKind: "agent",
      enabled: args.enabled,
    });
    return JSON.stringify({ id: sched.id, nextRunAt: sched.nextRunAt });
  },
};

const scheduleListTool: ToolDefinition = {
  name: "schedule_list",
  description: "List all scheduled jobs.",
  inputSchema: z.object({}),
  defaultConsent: "always",
  execute: async () => {
    const sys = getSchedulerService();
    await sys.initialize();
    return JSON.stringify(sys.list());
  },
};

const scheduleRemoveTool: ToolDefinition = {
  name: "schedule_remove",
  description: "Delete a scheduled job by id.",
  inputSchema: z.object({ id: z.string() }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `schedule_remove(${args.id})`,
  execute: async (args) => {
    const sys = getSchedulerService();
    await sys.initialize();
    sys.remove(args.id as ScheduleId);
    return JSON.stringify({ ok: true });
  },
};

// ---------------------------------------------------------------------------
// MACRO TOOLS
// ---------------------------------------------------------------------------

const macroCreateTool: ToolDefinition = {
  name: "macro_create",
  description:
    "Define a new named macro: an ordered sequence of tool invocations. Subsequent steps can reference earlier outputs via {{step1}}, {{step2}}, etc. Macros become available as `macro_<name>` tools.",
  inputSchema: z.object({
    name: z.string(),
    description: z.string().optional(),
    steps: z
      .array(
        z.object({
          toolName: z.string(),
          args: z.record(z.unknown()),
        }),
      )
      .min(1),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `macro_create(${args.name}, ${args.steps.length} steps)`,
  execute: async (args) => {
    const store = getToolMacroStore();
    await store.initialize();
    const macro = store.create({
      name: args.name,
      description: args.description,
      steps: args.steps,
      ownerId: "agent",
    });
    return JSON.stringify({ id: macro.id, name: macro.name });
  },
};

const macroListTool: ToolDefinition = {
  name: "macro_list",
  description: "List all defined tool macros.",
  inputSchema: z.object({}),
  defaultConsent: "always",
  execute: async () => {
    const store = getToolMacroStore();
    await store.initialize();
    return JSON.stringify(store.list());
  },
};

const macroRemoveTool: ToolDefinition = {
  name: "macro_remove",
  description: "Delete a macro by id.",
  inputSchema: z.object({ id: z.string() }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `macro_remove(${args.id})`,
  execute: async (args) => {
    const store = getToolMacroStore();
    await store.initialize();
    store.remove(args.id as MacroId);
    return JSON.stringify({ ok: true });
  },
};

export const EXTENSION_SUBSYSTEM_TOOLS: readonly ToolDefinition[] = [
  widgetCreateTool,
  widgetListTool,
  widgetRemoveTool,
  scheduleCreateTool,
  scheduleListTool,
  scheduleRemoveTool,
  macroCreateTool,
  macroListTool,
  macroRemoveTool,
];

export function getExtensionSubsystemToolNames(): string[] {
  return EXTENSION_SUBSYSTEM_TOOLS.map((t) => t.name);
}
