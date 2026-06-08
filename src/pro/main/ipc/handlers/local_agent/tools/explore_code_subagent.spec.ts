import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runExploreCodeSubagent } from "./explore_code_subagent";
import type { AgentContext } from "./types";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  readSettings: vi.fn(),
  getModelClient: vi.fn(),
  getMaxTokens: vi.fn(),
  getTemperature: vi.fn(),
  getAiHeaders: vi.fn(),
  getProviderOptions: vi.fn(),
  cancelOrphanedBaseStream: vi.fn(),
  recordCodeExplorerBenchmarkEvent: vi.fn(),
  runRawExploreCode: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: mocks.generateText,
  };
});

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.getModelClient,
}));

vi.mock("@/ipc/utils/token_utils", () => ({
  getMaxTokens: mocks.getMaxTokens,
  getTemperature: mocks.getTemperature,
}));

vi.mock("@/ipc/utils/provider_options", () => ({
  getAiHeaders: mocks.getAiHeaders,
  getProviderOptions: mocks.getProviderOptions,
}));

vi.mock("@/ipc/utils/stream_text_utils", () => ({
  cancelOrphanedBaseStream: mocks.cancelOrphanedBaseStream,
}));

vi.mock("../benchmark_recorder", () => ({
  recordCodeExplorerBenchmarkEvent: mocks.recordCodeExplorerBenchmarkEvent,
  summarizeBenchmarkValue: (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value),
}));

vi.mock("./explore_code_raw", async () => {
  const actual =
    await vi.importActual<typeof import("./explore_code_raw")>(
      "./explore_code_raw",
    );
  return {
    ...actual,
    runRawExploreCode: mocks.runRawExploreCode,
  };
});

describe("runExploreCodeSubagent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({
      enableDyadPro: true,
      providerSettings: {
        auto: {
          apiKey: { value: "dyad-pro-key" },
        },
      },
    });
    mocks.getModelClient.mockResolvedValue({
      modelClient: {
        model: "model-client",
        builtinProviderId: "auto",
      },
    });
    mocks.getMaxTokens.mockResolvedValue(32_000);
    mocks.getTemperature.mockResolvedValue(0);
    mocks.getAiHeaders.mockReturnValue({ "x-test": "header" });
    mocks.getProviderOptions.mockReturnValue({ dyad: "options" });
    mocks.runRawExploreCode.mockResolvedValue({
      query: "ActionManager executeAction toolbar action scene update",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "src/actions/manager.tsx",
          symbols: [
            {
              name: "ActionManager",
              kind: "class",
              line: 1,
              score: 1,
            },
            {
              name: "executeAction",
              kind: "method",
              line: 2,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 5,
              lines: [
                "export class ActionManager {",
                "  executeAction(action: { perform: () => void }) {",
                "    action.perform();",
                "  }",
                "}",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockReturnValue({
      fullStream: createFullStream([
        "## explore_code report\n\n",
        "Task class: component-flow\n",
        "Structured summary:\n```json\n",
        '{"confidence":"high","taskClass":"component-flow","compilerSignal":"strong","primaryFiles":[{"path":"src/App.tsx","range":"1-10","symbols":["App"],"purpose":"entry"}],"secondaryFiles":[],"editTarget":null}',
        "\n```\n",
        "Findings:\n1. src/App.tsx:1-10 - App\n   Fact: App entry.",
      ]),
      textStream: createFullStream([]),
    });
  });

  it("uses dyad/value with only read-only reconnaissance tools", async () => {
    const report = await runExploreCodeSubagent({
      args: { query: "App render flow" },
      ctx: createMockContext(),
    });

    expect(report).toContain("src/App.tsx");
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      { provider: "auto", name: "value" },
      expect.any(Object),
    );

    const options = vi.mocked(streamText).mock.calls[0][0] as any;
    expect(options.model).toBe("model-client");
    expect(options.maxOutputTokens).toBe(4_000);
    expect(Object.keys(options.tools).sort()).toEqual([
      "explore_code",
      "grep",
      "list_files",
      "read_file",
    ]);
    expect(options.prompt).toContain("Return exactly this shape:");
    expect(options.prompt).toContain("Structured summary:");
    expect(options.prompt).toContain("Task class:");
    expect(options.prompt).toContain(
      "Target app: current app. Omit app_name in tool calls.",
    );
    expect(options.system).toContain(
      "Omit app_name when inspecting the current app.",
    );
    expect(options.system).toContain(
      "include explore_code in the first tool batch",
    );
  });

  it("normalizes verbose mutation prompts before compiler-backed exploration", async () => {
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating a booking starting in apps/web and include related workspace packages that participate in booking creation.",
        });
      }),
      textStream: createFullStream([]),
    }));

    await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating a booking starting in apps/web and include related workspace packages that participate in booking creation.",
      },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          query:
            "create booking api form handle handler hook service submit mutation",
        }),
      }),
    );
  });

  it("drops navigation and display filler from value-model mutation compiler queries", async () => {
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "booking create route page component starts submit handler action sends request service",
        });
      }),
      textStream: createFullStream([]),
    }));

    await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating a booking starting in apps/web. Name key files and symbols.",
      },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          query:
            "booking create submit handler request service api form handle hook mutation",
        }),
      }),
    );
  });

  it("drops broad role filler from mutation compiler queries", async () => {
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace booking creation UI hooks actions API clients routes server handlers package services types",
        });
      }),
      textStream: createFullStream([]),
    }));

    await runExploreCodeSubagent({
      args: {
        query:
          "Trace the implementation flow for creating a booking starting in apps/web.",
      },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          query:
            "booking create hook api handler service form handle submit mutation",
        }),
      }),
    );
  });

  it("does not expand toolbar scene update queries with mutation filler", async () => {
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
      }),
      textStream: createFullStream([]),
    }));

    await runExploreCodeSubagent({
      args: {
        query:
          "Trace where a toolbar action is handled and how it reaches the scene update path.",
      },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          query: "toolbar action scene",
        }),
      }),
    );
  });

  it("fails clearly when Dyad Pro is unavailable", async () => {
    mocks.readSettings.mockReturnValue({
      enableDyadPro: false,
      providerSettings: {},
    });

    await expect(
      runExploreCodeSubagent({
        args: { query: "App render flow" },
        ctx: createMockContext(),
      }),
    ).rejects.toThrow(/requires Dyad Pro/);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("synthesizes a report when the tool pass returns observations but no text", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.writeFile(path.join(appPath, "src.ts"), "export const App = 1;\n");
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.list_files.execute({ recursive: false });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: { query: "App render flow" },
        ctx,
      });

      expect(report).toContain("src.ts");
      expect(report).toContain("Compiler signal: not used");
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(mocks.recordCodeExplorerBenchmarkEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "subagent_deterministic_report" }),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns tool failures as observations so provider tool-call history remains valid", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.writeFile(
      path.join(appPath, "availability.ts"),
      "export const availabilityRoute = true;\n",
    );
    mocks.runRawExploreCode.mockRejectedValueOnce(
      new Error("tsconfig project reference escaped the app"),
    );
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        const result = await options.tools.explore_code.execute({
          query: "calendar availability route",
        });
        expect(result).toContain("Tool explore_code failed:");
        await options.tools.list_files.execute({ recursive: false });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: { query: "calendar availability route" },
        ctx,
      });

      expect(report).toContain("availability.ts");
      expect(mocks.recordCodeExplorerBenchmarkEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_call_error",
          toolName: "explore_code",
        }),
      );
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("prioritizes directly read evidence in deterministic reports", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.mkdir(path.join(appPath, "src/actions"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "src/App.tsx"),
      "export const App = 1;\n",
    );
    await fs.writeFile(
      path.join(appPath, "src/actions/toolbar.ts"),
      [
        "const unrelated = true;",
        "export function updateToolbarScene() {",
        "  return true;",
        "}",
        "",
      ].join("\n"),
    );
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.list_files.execute({ recursive: true });
        await options.tools.read_file.execute({
          path: "src/actions/toolbar.ts",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 4,
        });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "toolbar action scene update path including workspace packages",
        },
        ctx,
      });

      expect(report).toContain("Edit target:\nnone");
      expect(report).toContain("Recommended primary action:");
      expect(report).toContain("targeted_gap_search:");
      expect(report).toContain('"path": "src/actions/toolbar.ts"');
      expect(report).toContain('"recommendedPrimaryAction"');
      expect(report).toContain('"action": "targeted_gap_search"');
      expect(report).toContain('"state/store update"');
      expect(report).toContain("search only toolbar, action");
      expect(report).toContain("scoped to src/actions");
      expect(report).toContain("packages");
      expect(report).toContain("literal=true");
      expect(report).toContain("line 2: export function updateToolbarScene()");
      expect(report).not.toContain('"source"');
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("collapses overlapping same-file observations in deterministic reports", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.mkdir(path.join(appPath, "src/actions"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "src/actions/toolbar.ts"),
      [
        "export function updateToolbarScene() {",
        "  dispatchToolbarAction();",
        "}",
        "export function dispatchToolbarAction() {",
        "  return true;",
        "}",
        "",
      ].join("\n"),
    );
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.read_file.execute({
          path: "src/actions/toolbar.ts",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 3,
        });
        await options.tools.read_file.execute({
          path: "src/actions/toolbar.ts",
          start_line_one_indexed: 2,
          end_line_one_indexed_inclusive: 6,
        });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: { query: "toolbar action dispatch update" },
        ctx,
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(
        structuredSummary.primaryFiles.filter(
          (fileRef: { path: string }) =>
            fileRef.path === "src/actions/toolbar.ts",
        ),
      ).toHaveLength(1);
      expect(structuredSummary.primaryFiles[0].range).toBe("1-6");
      expect(report).toContain("Observed coverage:");
      expect(report).toContain("line 1: export function updateToolbarScene()");
      expect(report).not.toContain('"source"');
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("prefers precise compiler-backed refs over broad grep-only ranges", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.mkdir(path.join(appPath, "src/actions"), { recursive: true });
    await fs.mkdir(path.join(appPath, "examples"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
        include: ["src/**/*.ts", "src/**/*.tsx", "examples/**/*.tsx"],
      }),
    );
    await fs.writeFile(
      path.join(appPath, "src/actions/manager.tsx"),
      [
        "export class ActionManager {",
        "  executeAction(action: { perform: () => void }) {",
        "    action.perform();",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "examples/ExampleApp.tsx"),
      Array.from(
        { length: 360 },
        (_, index) => `export const updateScene${index} = "toolbar update";`,
      ).join("\n"),
    );
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query: "ActionManager executeAction toolbar action scene update",
        });
        await options.tools.grep.execute({
          query: "toolbar|updateScene",
          include: "*.tsx",
          count: 400,
        });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query: "ActionManager executeAction toolbar action scene update",
        },
        ctx,
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.compilerSignal).toBe("strong");
      expect(structuredSummary.primaryFiles[0].path).toBe(
        "src/actions/manager.tsx",
      );
      expect(structuredSummary.primaryFiles[0].range).not.toBe("unknown");
      expect(structuredSummary.primaryFiles[0].path).not.toBe(
        "examples/ExampleApp.tsx",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("demotes test files below implementation files when the query is not about tests", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "Trace the flow for creating a booking",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/playwright/booking-limits.e2e.ts",
          symbols: [
            {
              name: "createBookingLimitScenario",
              kind: "function",
              line: 357,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 357,
              endLine: 434,
              lines: ["await bookScenario();"],
            },
          ],
        },
        {
          path: "apps/web/components/booking/actions/bookingActions.test.ts",
          symbols: [
            {
              name: "createMockContext",
              kind: "function",
              line: 15,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 15,
              endLine: 134,
              lines: ["const context = createMockContext();"],
            },
          ],
        },
        {
          path: "apps/web/components/booking/actions/bookingActions.ts",
          symbols: [
            {
              name: "createBooking",
              kind: "function",
              line: 20,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 20,
              endLine: 80,
              lines: ["export async function createBooking() {}"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query: "Trace the flow for creating a booking",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "Trace the flow for creating a booking" },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "apps/web/components/booking/actions/bookingActions.ts",
    );
    const primaryPaths = structuredSummary.primaryFiles.map(
      (file: { path: string }) => file.path,
    );
    expect(primaryPaths).not.toContain(
      "apps/web/components/booking/actions/bookingActions.test.ts",
    );
    expect(primaryPaths).not.toContain(
      "apps/web/playwright/booking-limits.e2e.ts",
    );
  });

  it("prefers exact create-action implementation symbols over generic action UI files", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "Trace the flow for creating a booking starting in apps/web",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/components/booking/actions/bookingActions.ts",
          symbols: [
            {
              name: "BookingActionContext",
              kind: "interface",
              line: 3,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 3,
              endLine: 122,
              lines: ["export interface BookingActionContext {}"],
            },
          ],
        },
        {
          path: "packages/features/bookings/lib/handleNewBooking/createBooking.ts",
          symbols: [
            {
              name: "saveBooking",
              kind: "function",
              line: 10,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 10,
              endLine: 60,
              lines: ["export async function saveBooking() {}"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query: "Trace the flow for creating a booking starting in apps/web",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query: "Trace the flow for creating a booking starting in apps/web",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "packages/features/bookings/lib/handleNewBooking/createBooking.ts",
    );
  });

  it("prefers mutation submission paths over list and success display paths", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "create booking handle handler submit action mutation",
      totalSymbols: 8,
      totalFiles: 8,
      indexedFileCount: 8,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/api-keys/components/ApiKeyDialogForm.tsx",
          symbols: [
            {
              name: "ApiKeyDialogForm",
              kind: "function",
              line: 17,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 17,
              endLine: 136,
              lines: ["export function ApiKeyDialogForm() {}"],
            },
          ],
        },
        {
          path: "apps/web/app/api/auth/signup/handlers/signupHandler.ts",
          symbols: [
            {
              name: "createCustomer",
              kind: "function",
              line: 38,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 38,
              endLine: 157,
              lines: ["await billingService.createCustomer();"],
            },
          ],
        },
        {
          path: "apps/web/components/booking/BookingListItem.tsx",
          symbols: [
            {
              name: "ParsedBooking",
              kind: "type",
              line: 60,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 60,
              endLine: 179,
              lines: ["export function BookingListItem() {}"],
            },
          ],
        },
        {
          path: "apps/web/components/booking/actions/BookingActionsDropdown.tsx",
          symbols: [
            {
              name: "BookingActionsDropdownProps",
              kind: "interface",
              line: 41,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 41,
              endLine: 160,
              lines: ["export function BookingActionsDropdown() {}"],
            },
          ],
        },
        {
          path: "apps/web/app/booking-successful/[uid]/page.tsx",
          symbols: [],
          windows: [
            {
              startLine: 6,
              endLine: 47,
              lines: ["export default function BookingSuccessfulPage() {}"],
            },
          ],
        },
        {
          path: "apps/web/modules/bookings/lib/bookingSheetKeyboardHandler.test.ts",
          symbols: [
            {
              name: "createMockKeyboardEvent",
              kind: "function",
              line: 6,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 6,
              endLine: 107,
              lines: ["function createMockKeyboardEvent() {}"],
            },
          ],
        },
        {
          path: "apps/web/modules/bookings/components/BookEventForm/BookEventForm.tsx",
          symbols: [
            {
              name: "BookEventForm",
              kind: "function",
              line: 20,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 20,
              endLine: 120,
              lines: ["export function BookEventForm() {}"],
            },
          ],
        },
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 130,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 130,
              endLine: 291,
              lines: ["const createBookingMutation = useMutation();"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query: "Trace the flow for creating a booking starting in apps/web",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query: "Trace the flow for creating a booking starting in apps/web",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "apps/web/modules/bookings/hooks/useBookings.ts",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toBe(
      "apps/web/components/booking/BookingListItem.tsx",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(
      "booking-successful",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(
      "ApiKeyDialogForm",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(
      "signup/handlers",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(".test.");
    expect(structuredSummary.primaryFiles[0].path).not.toContain("Dropdown");
  });

  it("answers from high-confidence reports for answer-only investigations", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "create booking api form handle handler hook service submit action mutation",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 136,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 136,
              endLine: 286,
              lines: [
                "const createBookingMutation = useMutation({ mutationFn: createBooking });",
              ],
            },
          ],
        },
        {
          path: "packages/features/bookings/lib/create-booking.ts",
          symbols: [
            {
              name: "createBooking",
              kind: "function",
              line: 5,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 5,
              endLine: 15,
              lines: [
                "export const createBooking = () => fetch('/api/book/event');",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating a booking. Name the key files and symbols.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating a booking. Name the key files and symbols.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "answer_from_report",
    );
  });

  it("keeps strong compiler-backed mutation files above broad route grep hits", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.mkdir(
      path.join(appPath, "apps/web/app/(booking-page-wrapper)/[user]/[type]"),
      { recursive: true },
    );
    await fs.mkdir(path.join(appPath, "apps/web/modules/bookings/hooks"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/features/bookings/lib"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        appPath,
        "apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx",
      ),
      [
        "export default function BookingPage() {",
        '  return <Booker booking="booking" />;',
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "apps/web/modules/bookings/hooks/useBookings.ts"),
      "export const createBookingMutation = useMutation(createBooking);\n",
    );
    await fs.writeFile(
      path.join(appPath, "packages/features/bookings/lib/create-booking.ts"),
      "export const createBooking = () => fetch('/api/book/event');\n",
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "booking create submit handler action request service api form handle hook mutation",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 1,
              lines: [
                "export const createBookingMutation = useMutation(createBooking);",
              ],
            },
          ],
        },
        {
          path: "packages/features/bookings/lib/create-booking.ts",
          symbols: [
            {
              name: "createBooking",
              kind: "function",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 1,
              lines: [
                "export const createBooking = () => fetch('/api/book/event');",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the booking creation flow starting in apps/web: booking creation UI, hooks/actions, API routes, services, mutations, schemas, and persistence. Identify related workspace packages.",
        });
        await options.tools.grep.execute({
          query: "booking",
          include: "apps/web/**/*.tsx",
          count: 20,
        });
        await options.tools.list_files.execute({ recursive: true });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace the booking creation flow starting in apps/web: booking creation UI, hooks/actions, API routes, services, mutations, schemas, and persistence. Identify related workspace packages.",
        },
        ctx,
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.primaryFiles[0].path).toBe(
        "packages/features/bookings/lib/create-booking.ts",
      );
      expect(
        structuredSummary.primaryFiles
          .slice(0, 2)
          .map((file: { path: string }) => file.path),
      ).toContain("apps/web/modules/bookings/hooks/useBookings.ts");
      expect(
        structuredSummary.primaryFiles.map((file: { path: string }) =>
          file.path.includes("(booking-page-wrapper)"),
        ),
      ).not.toContain(true);
      expect(structuredSummary.recommendedPrimaryAction.action).toBe(
        "targeted_gap_search",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not fill mutation primary files with route grep hits when package coverage is missing", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-app-"));
    await fs.mkdir(
      path.join(appPath, "apps/web/app/(booking-page-wrapper)/[user]/[type]"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(appPath, "apps/web/app/(booking-page-wrapper)/booking/[uid]"),
      { recursive: true },
    );
    await fs.mkdir(path.join(appPath, "apps/web/modules/bookings/hooks"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        appPath,
        "apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx",
      ),
      [
        "export default function BookingPage(props: { booking?: { uid: string } }) {",
        "  const rescheduleUid = props.booking?.uid;",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(
        appPath,
        "apps/web/app/(booking-page-wrapper)/booking/[uid]/page.tsx",
      ),
      [
        "export default function ExistingBookingPage() {",
        '  return <OldPage route="booking" />;',
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "apps/web/modules/bookings/hooks/useBookings.ts"),
      "export const createBookingMutation = useMutation(createBooking);\n",
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "create booking mutation handler submit main line numbers api form handle hook",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 1,
              lines: [
                "export const createBookingMutation = useMutation(createBooking);",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating a booking starting in apps/web. Identify key files and symbols, including related workspace packages that participate in the implementation flow.",
        });
        await options.tools.grep.execute({
          query: "booking",
          include: "apps/web/**/*.tsx",
          count: 20,
        });
        await options.tools.list_files.execute({ recursive: true });
      }),
      textStream: createFullStream([]),
    }));
    const ctx = createMockContext();
    ctx.appPath = appPath;

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace the flow for creating a booking starting in apps/web. Identify key files and symbols, including related workspace packages that participate in the implementation flow.",
        },
        ctx,
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.primaryFiles).toEqual([
        expect.objectContaining({
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          range: "1-1",
        }),
      ]);
      expect(structuredSummary.coverage.missing).toContain(
        "workspace/package implementation",
      );
      expect(structuredSummary.recommendedPrimaryAction.action).toBe(
        "targeted_gap_search",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not let sibling app grep hits steer package gap-search scopes", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "create booking api form handle handler hook service submit action mutation",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 1,
              lines: [
                "export const createBookingMutation = useMutation(createBooking);",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating a booking, starting in apps/web and including related workspace packages when they participate.",
        });
        await options.tools.grep.execute({
          query: "booking",
          include: "apps/api/v2/**/*.ts",
          count: 20,
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating a booking, starting in apps/web and including related workspace packages when they participate.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    const searchTargets =
      structuredSummary.recommendedPrimaryAction.searchTargets ?? [];
    expect(searchTargets.join("\n")).toContain("scoped to packages");
    expect(searchTargets.join("\n")).toContain("apps/web/modules");
    expect(searchTargets.join("\n")).not.toContain("apps/api/v2");
    expect(searchTargets.join("\n")).not.toMatch(/\bwhen\b/);
  });

  it("augments workspace package queries with package implementation grep before reporting", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-package-augment-"),
    );
    await fs.mkdir(path.join(appPath, "packages/features/bookings/lib"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/features/bookings/lib/create-booking.ts"),
      [
        "export async function createBooking(input: { eventTypeId: number }) {",
        "  return persistBooking(input);",
        "}",
        "",
        "async function persistBooking(input: { eventTypeId: number }) {",
        "  return input.eventTypeId;",
        "}",
      ].join("\n"),
    );
    await fs.mkdir(
      path.join(appPath, "packages/features/bookings/lib/interfaces"),
      {
        recursive: true,
      },
    );
    await fs.writeFile(
      path.join(
        appPath,
        "packages/features/bookings/lib/interfaces/IBookingCreateService.ts",
      ),
      "export interface IBookingCreateService { createBooking: (...args: any[]) => Promise<any>; }\n",
    );
    await fs.mkdir(
      path.join(appPath, "packages/features/booking-audit/lib/service"),
      {
        recursive: true,
      },
    );
    await fs.writeFile(
      path.join(
        appPath,
        "packages/features/booking-audit/lib/service/BookingAuditTaskConsumer.ts",
      ),
      "export class BookingAuditTaskConsumer { private createBookingAuditRecord() {} }\n",
    );

    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "create booking api form handle handler hook service submit action mutation",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 1,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 136,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 120,
              endLine: 160,
              lines: ["const createBookingMutation = useMutation();"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace creating a booking from apps/web including related workspace packages.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace creating a booking from apps/web including related workspace packages.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );
      expect(primaryPaths).toContain(
        "packages/features/bookings/lib/create-booking.ts",
      );
      const wrapperRef = structuredSummary.primaryFiles.find(
        (file: { path: string }) =>
          file.path === "packages/features/bookings/lib/create-booking.ts",
      );
      expect(wrapperRef).toMatchObject({
        range: "1-81",
        purpose: "source range read directly by the sub-agent",
      });
      expect(report).toContain(
        "line 1: export async function createBooking(input: { eventTypeId: number })",
      );
      const primaryRank = (filePath: string) => {
        const index = primaryPaths.indexOf(filePath);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      };
      expect(
        primaryRank("packages/features/bookings/lib/create-booking.ts"),
      ).toBeLessThan(
        primaryRank(
          "packages/features/bookings/lib/interfaces/IBookingCreateService.ts",
        ),
      );
      expect(
        primaryRank("packages/features/bookings/lib/create-booking.ts"),
      ).toBeLessThan(
        primaryRank(
          "packages/features/booking-audit/lib/service/BookingAuditTaskConsumer.ts",
        ),
      );
      expect(primaryPaths).not.toHaveLength(0);
      expect(primaryPaths[0]).not.toBe(
        "packages/features/bookings/lib/interfaces/IBookingCreateService.ts",
      );
      expect(primaryPaths[0]).not.toBe(
        "packages/features/booking-audit/lib/service/BookingAuditTaskConsumer.ts",
      );
      expect(structuredSummary.coverage.observed).toContain(
        "workspace/package implementation",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("keeps read targets for edit or verification prompts", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "create booking api form handle handler hook service submit action mutation",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 1,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "createBookingMutation",
              kind: "variable",
              line: 136,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 136,
              endLine: 286,
              lines: [
                "const createBookingMutation = useMutation({ mutationFn: createBooking });",
              ],
            },
          ],
        },
        {
          path: "packages/features/bookings/lib/create-booking.ts",
          symbols: [
            {
              name: "createBooking",
              kind: "function",
              line: 5,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 5,
              endLine: 15,
              lines: [
                "export const createBooking = () => fetch('/api/book/event');",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query: "Verify createBookingMutation before changing code.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query: "Verify createBookingMutation before changing code.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "read_edit_target",
    );
    expect(structuredSummary.recommendedPrimaryAction.readTarget.path).toBe(
      "apps/web/modules/bookings/hooks/useBookings.ts",
    );
  });

  it("requires package implementation evidence when the query asks for workspace packages", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "create booking handle handler submit action mutation",
      totalSymbols: 4,
      totalFiles: 4,
      indexedFileCount: 4,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/web/playwright/booking-limits.e2e.ts",
          symbols: [
            {
              name: "createBookingLimitScenario",
              kind: "function",
              line: 357,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 357,
              endLine: 434,
              lines: ["await bookScenario();"],
            },
          ],
        },
        {
          path: "apps/web/components/booking/actions/bookingActions.ts",
          symbols: [
            {
              name: "BookingActionContext",
              kind: "interface",
              line: 3,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 3,
              endLine: 122,
              lines: ["export interface BookingActionContext {}"],
            },
          ],
        },
        {
          path: "apps/web/modules/bookings/hooks/useBookings.ts",
          symbols: [
            {
              name: "useBookings",
              kind: "function",
              line: 21,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 21,
              endLine: 140,
              lines: ["export function useBookings() {}"],
            },
          ],
        },
        {
          path: "apps/web/app/_trpc/query-client.ts",
          symbols: [
            {
              name: "queryClient",
              kind: "variable",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 20,
              lines: ["export const queryClient = {};"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating a booking in apps/web, including related workspace packages.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating a booking in apps/web, including related workspace packages.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.coverage.missing).toContain(
      "workspace/package implementation",
    );
    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "targeted_gap_search",
    );
    expect(
      structuredSummary.recommendedPrimaryAction.searchTargets.join("\n"),
    ).toContain("packages");
  });

  it("prefers export-specific source over generic context and type compiler refs", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "export drawing canvas image download share",
      totalSymbols: 3,
      totalFiles: 3,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/components/App.tsx",
          symbols: [
            {
              name: "ExcalidrawAppStateContext",
              kind: "variable",
              line: 537,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 528,
              endLine: 574,
              lines: [
                "const ExcalidrawAppStateContext = React.createContext();",
              ],
            },
          ],
        },
        {
          path: "packages/excalidraw/types.ts",
          symbols: [
            {
              name: "BinaryFileData",
              kind: "type",
              line: 113,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 109,
              endLine: 145,
              lines: ["export type BinaryFileData = {};"],
            },
          ],
        },
        {
          path: "packages/excalidraw/scene/export.ts",
          symbols: [
            {
              name: "exportToCanvas",
              kind: "function",
              line: 78,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 70,
              endLine: 150,
              lines: ["export async function exportToCanvas() {}"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how exporting a drawing is implemented, including canvas image download/share behavior.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace how exporting a drawing is implemented, including canvas image download/share behavior.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "packages/excalidraw/scene/export.ts",
    );
    expect(structuredSummary.confidence).toBe("high");
  });

  it("prefers route page entries over nested record-detail subcomponents", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail route page",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/src/modules/object-record/record-field-list/record-detail-section/relation/components/RecordDetailRelationRecordsListItem.tsx",
          symbols: [
            {
              name: "RecordDetailRelationRecordsListItem",
              kind: "function",
              line: 73,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 47,
              endLine: 166,
              lines: [
                "export const RecordDetailRelationRecordsListItem = () => null;",
              ],
            },
          ],
        },
        {
          path: "packages/twenty-front/src/pages/object-record/RecordShowPage.tsx",
          symbols: [
            {
              name: "RecordShowPage",
              kind: "function",
              line: 12,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 80,
              lines: ["export const RecordShowPage = () => null;"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered, including route/page entry.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace how a CRM record detail page is loaded and rendered, including route/page entry.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "packages/twenty-front/src/pages/object-record/RecordShowPage.tsx",
    );
  });

  it("does not recommend a misleading edit target when route coverage is missing", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail route page",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 1,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/src/modules/object-record/record-field-list/record-detail-section/relation/components/RecordDetailRelationRecordsListItem.tsx",
          symbols: [
            {
              name: "RecordDetailRelationRecordsListItem",
              kind: "function",
              line: 73,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 47,
              endLine: 166,
              lines: [
                "export const RecordDetailRelationRecordsListItem = () => null;",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered, including route/page entry.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace how a CRM record detail page is loaded and rendered, including route/page entry.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.coverage.missing).toContain("route/page entry");
    expect(structuredSummary.editTarget).toBeNull();
    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "targeted_gap_search",
    );
  });

  it("does not count side-panel pages with record-page imports as record detail route coverage", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-sidepanel-route-gap-"),
    );
    await fs.mkdir(
      path.join(
        appPath,
        "packages/twenty-front/src/modules/side-panel/pages/calendar-event/components",
      ),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        appPath,
        "packages/twenty-front/src/modules/side-panel/pages/calendar-event/components/SidePanelCalendarEventPage.tsx",
      ),
      [
        "import { viewableRecordIdComponentState } from '@/side-panel/pages/record-page/states/viewableRecordIdComponentState';",
        "export const SidePanelCalendarEventPage = () => null;",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail page route loading",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 1,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/src/modules/object-record/record-picker/hooks/useRecordPicker.ts",
          symbols: [
            {
              name: "useRecordPicker",
              kind: "function",
              line: 24,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 20,
              endLine: 80,
              lines: ["export const useRecordPicker = () => null;"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.coverage.missing).toContain("route/page entry");
      expect(structuredSummary.editTarget).toBeNull();
      expect(structuredSummary.recommendedPrimaryAction.action).toBe(
        "targeted_gap_search",
      );
      expect(
        structuredSummary.primaryFiles.map(
          (file: { path: string }) => file.path,
        ),
      ).toContain(
        "packages/twenty-front/src/modules/side-panel/pages/calendar-event/components/SidePanelCalendarEventPage.tsx",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not let support scripts steer record detail route gap reports", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail page route loading",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/scripts/mock-data/generate-record-data.ts",
          symbols: [
            {
              name: "generateRecordData",
              kind: "function",
              line: 5,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 104,
              lines: ["export async function generateRecordData() {}"],
            },
          ],
        },
        {
          path: "packages/twenty-front/src/modules/navigation/states/lastVisitedViewPerObjectMetadataItemState.ts",
          symbols: [
            {
              name: "lastVisitedViewPerObjectMetadataItemState",
              kind: "variable",
              line: 3,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 12,
              lines: [
                "export const lastVisitedViewPerObjectMetadataItemState = {};",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered in packages/twenty-front.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace how a CRM record detail page is loaded and rendered in packages/twenty-front.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    const primaryPaths = structuredSummary.primaryFiles.map(
      (file: { path: string }) => file.path,
    );
    expect(primaryPaths).not.toContain(
      "packages/twenty-front/scripts/mock-data/generate-record-data.ts",
    );
    expect(structuredSummary.coverage.missing).toContain("route/page entry");
    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "targeted_gap_search",
    );
    const searchTargets =
      structuredSummary.recommendedPrimaryAction.searchTargets.join("\n");
    expect(searchTargets).toContain("packages/twenty-front");
    expect(searchTargets).not.toContain("scripts/mock-data");
    expect(searchTargets).not.toMatch(/\bloaded\b/);
    expect(searchTargets).not.toMatch(/\brendered\b/);
  });

  it("prefers login and signup UI over auth hook customization screens", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "auth login signup ui routes components hooks services",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "apps/studio/components/interfaces/Auth/Hooks/CreateHookSheet.tsx",
          symbols: [
            {
              name: "CreateHookSheet",
              kind: "function",
              line: 45,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 45,
              endLine: 68,
              lines: ["export const CreateHookSheet = () => null;"],
            },
          ],
        },
        {
          path: "apps/studio/pages/sign-in.tsx",
          symbols: [
            {
              name: "SignInPage",
              kind: "function",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 80,
              lines: ["export const SignInPage = () => <LoginForm />;"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Find the implementation flow for authentication UI login/signup/auth UI.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Find the implementation flow for authentication UI. Identify login/signup/auth UI files.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "apps/studio/pages/sign-in.tsx",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(
      "/Auth/Hooks/",
    );
  });

  it("prefers post send handlers over post reaction components", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "send post message action api call channels react component",
      totalSymbols: 3,
      totalFiles: 3,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "channels/src/components/post_view/post_reaction/post_reaction.tsx",
          symbols: [
            {
              name: "PostReaction",
              kind: "function",
              line: 16,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 16,
              endLine: 89,
              lines: ["export const PostReaction = () => null;"],
            },
          ],
        },
        {
          path: "channels/src/components/advanced_text_editor/use_submit.tsx",
          symbols: [
            {
              name: "useSubmit",
              kind: "function",
              line: 151,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 151,
              endLine: 240,
              lines: ["export function useSubmit() { return createPost(); }"],
            },
          ],
        },
        {
          path: "channels/src/actions/post_actions.ts",
          symbols: [
            {
              name: "createPost",
              kind: "function",
              line: 140,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 140,
              endLine: 190,
              lines: ["export function createPost() {}"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for sending a post/message from UI action to API call in channels.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for sending a post/message from UI action to API call.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.taskClass).toBe("mutation-action");
    expect(structuredSummary.primaryFiles[0].path).toBe(
      "channels/src/components/advanced_text_editor/use_submit.tsx",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain("reaction");
  });

  it("prioritizes requested app UI files over CLI files for UI-to-API tasks", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "create invoice dashboard persistence api submit handler trpc",
      totalSymbols: 3,
      totalFiles: 3,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/cli/src/commands/invoices/index.ts",
          symbols: [
            {
              name: "createInvoicesCommand",
              kind: "function",
              line: 31,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 11,
              endLine: 111,
              lines: ["export function createInvoicesCommand() {}"],
            },
          ],
        },
        {
          path: "apps/dashboard/src/components/notification-center/notification-item.tsx",
          symbols: [
            {
              name: "NotificationItem",
              kind: "function",
              line: 33,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 33,
              endLine: 46,
              lines: ["export const NotificationItem = () => null;"],
            },
          ],
        },
        {
          path: "apps/dashboard/src/components/invoice/form.tsx",
          symbols: [
            {
              name: "InvoiceForm",
              kind: "function",
              line: 1,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 120,
              lines: [
                "export function InvoiceForm() { return createInvoice(); }",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace the flow for creating an invoice from dashboard UI to persistence/API call. Start in apps/dashboard.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace the flow for creating an invoice from dashboard UI to persistence/API call. Start in apps/dashboard.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "apps/dashboard/src/components/invoice/form.tsx",
    );
    expect(structuredSummary.primaryFiles[0].path).not.toContain(
      "packages/cli",
    );
  });

  it("prefers toolbar action registry files over generic App and type refs", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene update handler state render",
      totalSymbols: 3,
      totalFiles: 3,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/components/App.tsx",
          symbols: [
            {
              name: "AppContext",
              kind: "variable",
              line: 498,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 498,
              endLine: 617,
              lines: ["export const AppContext = createContext(null);"],
            },
          ],
        },
        {
          path: "packages/excalidraw/types.ts",
          symbols: [
            {
              name: "AppState",
              kind: "type",
              line: 64,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 64,
              endLine: 183,
              lines: ["export type AppState = {};"],
            },
          ],
        },
        {
          path: "packages/excalidraw/actions/actionCanvas.tsx",
          symbols: [
            {
              name: "actionToggleEraserTool",
              kind: "variable",
              line: 498,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 498,
              endLine: 570,
              lines: [
                "export const actionToggleEraserTool = register({ label: 'toolBar.eraser', perform() {} });",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace where a toolbar action is handled and how it reaches the scene update path.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.primaryFiles[0].path).toBe(
      "packages/excalidraw/actions/actionCanvas.tsx",
    );
    expect(structuredSummary.taskClass).toBe("component-flow");
    expect(structuredSummary.primaryFiles[0].path).not.toBe(
      "packages/excalidraw/components/App.tsx",
    );
  });

  it("augments toolbar reports with production action refs instead of examples", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-gap-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/excalidraw/scene"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "examples/demo"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionToggleEraserTool = register({",
        "  name: 'toggleEraserTool',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'eraser' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/scene/Scene.ts"),
      [
        "export class Scene {",
        "  replaceAllElements() {",
        "    this.triggerUpdate();",
        "  }",
        "  triggerUpdate() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "examples/demo/ExampleApp.tsx"),
      [
        "export const updateScene = () => null;",
        "export const canvasActions = {};",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/components/App.tsx",
          symbols: [
            {
              name: "AppContext",
              kind: "variable",
              line: 502,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 498,
              endLine: 617,
              lines: ["export const AppContext = createContext(null);"],
            },
          ],
        },
        {
          path: "packages/excalidraw/types.ts",
          symbols: [
            {
              name: "AppState",
              kind: "type",
              line: 64,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 64,
              endLine: 183,
              lines: ["export type AppState = {};"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
        await options.tools.grep.execute({
          query: "toolbar|action|updateScene",
          include_pattern: "**/*.{ts,tsx}",
          limit: 40,
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );
      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );

      expect(primaryPaths[0]).toBe(
        "packages/excalidraw/actions/actionCanvas.tsx",
      );
      expect(primaryPaths).not.toContain("examples/demo/ExampleApp.tsx");
      expect(structuredSummary.coverage.observed).toContain("action/dispatch");
      expect(structuredSummary.coverage.missing).not.toContain(
        "action/dispatch",
      );
      expect(structuredSummary.coverage.observed).toContain(
        "render/output sink",
      );
      expect(structuredSummary.coverage.missing).not.toContain(
        "render/output sink",
      );
      expect(primaryPaths).toContain("packages/excalidraw/scene/Scene.ts");
      expect(report).toContain("line 2: export const actionToggleEraserTool");
      expect(report).toContain("line 2: replaceAllElements()");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("uses post-stream gap augmentation when the model returns a stale toolbar report", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-stale-report-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/excalidraw/scene"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionToggleLaserTool = register({",
        "  name: 'toggleLaserTool',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'laser' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/scene/Scene.ts"),
      [
        "export class Scene {",
        "  replaceAllElements() {",
        "    this.triggerUpdate();",
        "  }",
        "  triggerUpdate() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/components/App.tsx",
          symbols: [
            {
              name: "AppContext",
              kind: "variable",
              line: 502,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 498,
              endLine: 617,
              lines: ["export const AppContext = createContext(null);"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: (async function* () {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
        yield {
          type: "text-delta",
          text: [
            "## explore_code report",
            "",
            "Task class: component-flow",
            "Structured summary:",
            "```json",
            JSON.stringify({
              confidence: "low",
              taskClass: "component-flow",
              compilerSignal: "strong",
              primaryFiles: [
                {
                  path: "packages/excalidraw/components/App.tsx",
                  range: "498-617",
                  purpose: "stale model report",
                },
              ],
              secondaryFiles: [],
              editTarget: null,
              coverage: {
                observed: ["component/UI handler"],
                missing: ["action/dispatch", "render/output sink"],
              },
              recommendedPrimaryAction: {
                action: "targeted_gap_search",
                reason: "stale",
                searchTargets: ["render/output sink"],
              },
            }),
            "```",
          ].join("\n"),
        };
      })(),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );
      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );

      expect(primaryPaths).toContain(
        "packages/excalidraw/actions/actionCanvas.tsx",
      );
      expect(primaryPaths).toContain("packages/excalidraw/scene/Scene.ts");
      expect(structuredSummary.coverage.observed).toContain("action/dispatch");
      expect(structuredSummary.coverage.observed).toContain(
        "render/output sink",
      );
      expect(structuredSummary.coverage.missing).not.toContain(
        "render/output sink",
      );
      expect(report).toContain("line 2: replaceAllElements()");
      expect(mocks.recordCodeExplorerBenchmarkEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "subagent_deterministic_report" }),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not treat scene/update comments as render sink implementation coverage", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-comment-sink-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/element/src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionTogglePointerTool = register({",
        "  name: 'togglePointerTool',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'selection' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/element/src/Scene.ts"),
      [
        "export class Scene {",
        "  /** Random integer regenerated each scene update. */",
        "  versionNonce = 1;",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/element/src/zindex.ts"),
      [
        "export function moveElementsToFront(scene: { replaceAllElements: (elements: unknown[]) => void }, updatedElements: unknown[]) {",
        "  scene.replaceAllElements(updatedElements);",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene update",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/actions/actionCanvas.tsx",
          symbols: [
            {
              name: "actionTogglePointerTool",
              kind: "variable",
              line: 2,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 8,
              lines: ["export const actionTogglePointerTool = register({"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
        await options.tools.grep.execute({
          query: "toolbar|scene update",
          include_pattern: "**/*.{ts,tsx}",
          limit: 40,
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.coverage.observed).toContain("action/dispatch");
      expect(structuredSummary.coverage.observed).not.toContain(
        "render/output sink",
      );
      expect(structuredSummary.coverage.missing).toContain(
        "render/output sink",
      );
      expect(structuredSummary.recommendedPrimaryAction.action).toBe(
        "targeted_gap_search",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not treat app-shell updateScene callers as package render sink coverage", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-app-shell-sink-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "excalidraw-app/collab"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionToggleHandTool = register({",
        "  name: 'toggleHandTool',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'hand' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "excalidraw-app/collab/Portal.tsx"),
      [
        "export class Portal {",
        "  applyRemoteScene(api: { updateScene: (scene: unknown) => void }) {",
        "    api.updateScene({ elements: [] });",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene update",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/actions/actionCanvas.tsx",
          symbols: [
            {
              name: "actionToggleHandTool",
              kind: "variable",
              line: 2,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 8,
              lines: ["export const actionToggleHandTool = register({"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
        await options.tools.grep.execute({
          query: "toolbar|updateScene",
          include_pattern: "**/*.{ts,tsx}",
          limit: 40,
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.coverage.observed).not.toContain(
        "render/output sink",
      );
      expect(structuredSummary.coverage.missing).toContain(
        "render/output sink",
      );
      expect(structuredSummary.recommendedPrimaryAction.action).toBe(
        "targeted_gap_search",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not treat action replacement helpers as render sink ownership", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-action-sink-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/element/src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionGroup.tsx"),
      [
        "import { register } from './register';",
        "import { replaceAllElementsInFrame } from '@excalidraw/element';",
        "export const actionGroup = register({",
        "  name: 'group',",
        "  perform(elements, appState) {",
        "    return { elements: replaceAllElementsInFrame(elements) };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/element/src/Scene.ts"),
      [
        "export class Scene {",
        "  replaceAllElements(elements: unknown[]) {",
        "    this.triggerUpdate();",
        "  }",
        "  triggerUpdate() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene update",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/actions/actionGroup.tsx",
          symbols: [
            {
              name: "actionGroup",
              kind: "variable",
              line: 3,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 9,
              lines: [
                "import { replaceAllElementsInFrame } from '@excalidraw/element';",
                "export const actionGroup = register({",
                "  perform(elements, appState) {",
                "    return { elements: replaceAllElementsInFrame(elements) };",
                "  },",
                "});",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );
      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );

      expect(primaryPaths).toContain(
        "packages/excalidraw/actions/actionGroup.tsx",
      );
      expect(primaryPaths).toContain("packages/element/src/Scene.ts");
      expect(primaryPaths).not.toContain("packages/element/src/zindex.ts");
      expect(structuredSummary.coverage.observed).toContain("action/dispatch");
      expect(structuredSummary.coverage.observed).toContain(
        "render/output sink",
      );
      expect(structuredSummary.coverage.missing).not.toContain(
        "render/output sink",
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not treat updateScene API callers as render sink ownership", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-api-caller-sink-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/excalidraw/data"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/excalidraw"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/element/src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionToggleLaserTool = register({",
        "  name: 'toggleLaserTool',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'laser' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/data/library.ts"),
      [
        "export function restoreLibrary(optsRef: { current: { excalidrawAPI: { updateScene: (scene: unknown) => void } } }) {",
        "  optsRef.current.excalidrawAPI.updateScene({ elements: [] });",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/types.ts"),
      [
        "export type ExcalidrawAPI = {",
        "  updateScene: (scene: unknown) => void;",
        "};",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/element/src/Scene.ts"),
      [
        "export class Scene {",
        "  replaceAllElements(elements: unknown[]) {",
        "    this.triggerUpdate();",
        "  }",
        "  triggerUpdate() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene update",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/actions/actionCanvas.tsx",
          symbols: [
            {
              name: "actionToggleLaserTool",
              kind: "variable",
              line: 2,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 8,
              lines: ["export const actionToggleLaserTool = register({"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );
      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );

      expect(primaryPaths).toContain(
        "packages/excalidraw/actions/actionCanvas.tsx",
      );
      expect(primaryPaths).toContain("packages/element/src/Scene.ts");
      expect(structuredSummary.coverage.observed).toContain(
        "render/output sink",
      );
      expect(report).toContain("line 2: replaceAllElements");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("augments toolbar reports with action dispatch bridge refs", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-toolbar-bridge-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/actions"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/excalidraw/components"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "packages/element/src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/actionCanvas.tsx"),
      [
        "import { register } from './register';",
        "export const actionEraser = register({",
        "  name: 'eraser',",
        "  label: 'toolBar.eraser',",
        "  perform(elements, appState) {",
        "    return { appState: { ...appState, activeTool: { type: 'eraser' } } };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/actions/manager.tsx"),
      [
        "export class ActionManager {",
        "  renderAction(name: string) {",
        "    return this.executeAction(name);",
        "  }",
        "  executeAction(name: string) {",
        "    return name;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/components/App.tsx"),
      [
        "import { ActionManager } from '../actions/manager';",
        "export class App {",
        "  actionManager = new ActionManager();",
        "  syncActionResult(actionResult: { elements?: unknown[] }) {",
        "    if (actionResult.elements) {",
        "      this.scene.replaceAllElements(actionResult.elements);",
        "    }",
        "  }",
        "  scene = { replaceAllElements: (_elements: unknown[]) => null };",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appPath, "packages/element/src/Scene.ts"),
      [
        "export class Scene {",
        "  replaceAllElements(elements: unknown[]) {",
        "    this.triggerUpdate();",
        "  }",
        "  triggerUpdate() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "toolbar action scene dispatch",
      totalSymbols: 1,
      totalFiles: 1,
      indexedFileCount: 4,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/actions/actionCanvas.tsx",
          symbols: [
            {
              name: "actionEraser",
              kind: "variable",
              line: 2,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 1,
              endLine: 9,
              lines: [
                "export const actionEraser = register({",
                "  label: 'toolBar.eraser',",
                "  perform(elements, appState) {",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace where a toolbar action is handled and how it reaches the scene update path.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );
      const primaryPaths = structuredSummary.primaryFiles.map(
        (file: { path: string }) => file.path,
      );

      expect(primaryPaths).toContain("packages/excalidraw/actions/manager.tsx");
      expect(primaryPaths).toContain("packages/excalidraw/components/App.tsx");
      expect(primaryPaths).toContain("packages/element/src/Scene.ts");
      expect(report).toContain("syncActionResult");
      expect(report).toContain("renderAction");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not count generated or story files as route-flow coverage", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail page route loading state",
      totalSymbols: 3,
      totalFiles: 3,
      indexedFileCount: 3,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/src/generated-metadata/graphql.ts",
          symbols: [
            {
              name: "ApplicationTokenPair",
              kind: "type",
              line: 392,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 388,
              endLine: 400,
              lines: ["export type ApplicationTokenPair = {};"],
            },
          ],
        },
        {
          path: "packages/twenty-front/src/modules/page-layout/widgets/components/__stories__/WidgetRenderer.stories.tsx",
          symbols: [
            {
              name: "createPageLayoutWithWidget",
              kind: "function",
              line: 130,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 130,
              endLine: 165,
              lines: ["export const createPageLayoutWithWidget = () => null;"],
            },
          ],
        },
        {
          path: "packages/twenty-front/src/modules/object-record/record-picker/multiple-record-picker/hooks/useMultipleRecordPickerPerformSearch.ts",
          symbols: [
            {
              name: "useMultipleRecordPickerPerformSearch",
              kind: "variable",
              line: 24,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 20,
              endLine: 139,
              lines: [
                "export const useMultipleRecordPickerPerformSearch = () => null;",
              ],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
        });
      }),
      textStream: createFullStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query:
          "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
      },
      ctx: createMockContext(),
    });
    const structuredSummary = JSON.parse(
      /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
    );

    expect(structuredSummary.taskClass).toBe("route-flow");
    expect(structuredSummary.confidence).not.toBe("high");
    expect(structuredSummary.coverage.missing).toContain("route/page entry");
    expect(structuredSummary.editTarget).toBeNull();
    expect(structuredSummary.recommendedPrimaryAction.action).toBe(
      "targeted_gap_search",
    );
  });

  it("augments low-confidence export reports with scoped export implementation grep", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-export-gap-"),
    );
    await fs.mkdir(path.join(appPath, "packages/excalidraw/scene"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "packages/excalidraw/scene/export.ts"),
      [
        "export const exportToCanvas = async () => {",
        "  return document.createElement('canvas');",
        "};",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query:
        "export implemented buttons commands service hook data trigger logic",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/excalidraw/components/App.tsx",
          symbols: [
            {
              name: "ExcalidrawAppStateContext",
              kind: "variable",
              line: 537,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 528,
              endLine: 574,
              lines: [
                "const ExcalidrawAppStateContext = React.createContext();",
              ],
            },
          ],
        },
        {
          path: "packages/excalidraw/types.ts",
          symbols: [
            {
              name: "BinaryFileData",
              kind: "type",
              line: 113,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 109,
              endLine: 145,
              lines: ["export type BinaryFileData = {};"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how exporting a drawing is implemented. Identify main files and symbols.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace how exporting a drawing is implemented. Identify main files and symbols.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.primaryFiles[0].path).toBe(
        "packages/excalidraw/scene/export.ts",
      );
      expect(report).toContain("line 1: export const exportToCanvas");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("augments route-flow reports with scoped page and route entry grep", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-code-route-gap-"),
    );
    await fs.mkdir(
      path.join(appPath, "packages/twenty-front/src/pages/object-record"),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        appPath,
        "packages/twenty-front/src/pages/object-record/RecordShowPage.tsx",
      ),
      [
        "export const RecordShowPage = () => {",
        "  return <RecordDetailContainer />;",
        "};",
        "",
      ].join("\n"),
    );
    mocks.runRawExploreCode.mockResolvedValueOnce({
      query: "crm record detail page twenty route entry hook query loading",
      totalSymbols: 2,
      totalFiles: 2,
      indexedFileCount: 2,
      indexMs: 1,
      searchMs: 1,
      notes: [],
      files: [
        {
          path: "packages/twenty-front/src/generated-metadata/graphql.ts",
          symbols: [
            {
              name: "Scalars",
              kind: "type",
              line: 8,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 4,
              endLine: 123,
              lines: ["export type Scalars = { ID: string };"],
            },
          ],
        },
        {
          path: "packages/twenty-front/src/modules/object-record/hooks/useUpdateManyRecords.ts",
          symbols: [
            {
              name: "UseUpdateManyRecordsProps",
              kind: "type",
              line: 27,
              score: 1,
            },
          ],
          windows: [
            {
              startLine: 23,
              endLine: 142,
              lines: ["export const useUpdateManyRecords = () => null;"],
            },
          ],
        },
      ],
    });
    mocks.generateText.mockImplementationOnce((options: any) => ({
      fullStream: createToolOnlyStream(async () => {
        await options.tools.explore_code.execute({
          query:
            "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
        });
      }),
      textStream: createFullStream([]),
    }));

    try {
      const report = await runExploreCodeSubagent({
        args: {
          query:
            "Trace how a CRM record detail page is loaded and rendered starting in packages/twenty-front.",
        },
        ctx: { ...createMockContext(), appPath },
      });
      const structuredSummary = JSON.parse(
        /```json\n([\s\S]+?)\n```/.exec(report)?.[1] ?? "{}",
      );

      expect(structuredSummary.primaryFiles[0].path).toBe(
        "packages/twenty-front/src/pages/object-record/RecordShowPage.tsx",
      );
      expect(report).toContain("line 1: export const RecordShowPage");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});

function createFullStream(chunks: string[]): AsyncIterable<any> {
  return (async function* () {
    for (const chunk of chunks) {
      yield { type: "text-delta", text: chunk };
    }
  })();
}

function createToolOnlyStream(
  runTool: () => Promise<void>,
): AsyncIterable<any> {
  let done = false;
  const iterator: AsyncIterable<any> & AsyncIterator<any> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (!done) {
        done = true;
        await runTool();
      }
      return { done: true, value: undefined };
    },
  };
  return iterator;
}

function createMockContext(): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/tmp/app",
    referencedApps: new Map(),
    chatId: 2,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 3,
    isSharedModulesChanged: false,
    chatSummary: undefined,
    todos: [],
    dyadRequestId: "request-id",
    fileEditTracker: {},
    isDyadPro: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}
