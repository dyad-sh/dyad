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
      warn: vi.fn(),
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
  streamText: vi.fn(),
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
    streamText: mocks.streamText,
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
    mocks.runRawExploreCode.mockResolvedValue(buildRawExploreResult());
    mocks.streamText.mockImplementation(() => ({
      fullStream: createTextStream([]),
      textStream: createTextStream([]),
    }));
  });

  it("runs one conversation that forces explore_code first and accepts a candidate-ID report", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        expect(options.prepareStep()).toEqual({
          activeTools: ["explore_code"],
          toolChoice: { type: "tool", toolName: "explore_code" },
        });
        const result = await options.tools.explore_code.execute({
          query: "widget save flow",
        });
        expect(result).toContain("Observed candidate IDs:");
        expect(result).toContain("[c1 ");
        expect(result).toContain(
          'exact source lines: "export async function saveWidget(input: WidgetInput) {"',
        );
        // With evidence observed and nothing forced, the model is free to act.
        expect(options.prepareStep()).toBeUndefined();
        const accepted = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
            },
          ],
        });
        expect(accepted).toBe("Report accepted.");
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "edit" },
      ctx: createMockContext(),
    });

    const options = vi.mocked(streamText).mock.calls[0][0] as any;
    expect(Object.keys(options.tools).sort()).toEqual([
      "explore_code",
      "grep",
      "list_files",
      "read_file",
      "submit_report",
    ]);
    // Streamed once: no separate nudge stream in the redesign.
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    // edit intent + ranged flow derives read_targets at high confidence.
    expect(report).toContain("Confidence: high | Action: read_targets");
    expect(report).toContain(
      "src/widget/saveWidget.ts:1-4 (handler) - saveWidget handles the submitted value.",
    );
    // The quote is excerpted from observed source; the model never supplied it.
    expect(report).toContain(
      "> export async function saveWidget(input: WidgetInput) {",
    );
    expect(report).toContain('"path":"src/widget/saveWidget.ts"');
  });

  it("uses a domain-neutral system prompt with no benchmark vocabulary", async () => {
    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });
    const options = vi.mocked(streamText).mock.calls[0][0] as any;
    const system: string = options.system;
    expect(system).toContain("code reconnaissance sub-agent");
    expect(system).toContain("observed candidate IDs");
    expect(system).toContain(
      "the system derives the recommended next action and confidence",
    );
    for (const noun of [
      "reservation",
      "busy times",
      "request or transport boundary",
      "management, listing, or settings surfaces",
    ]) {
      expect(system).not.toContain(noun);
    }
  });

  it("answers from the report for explain intent with verified flow", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget persists the input.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: high | Action: answer_from_report");
    expect(report).toContain("Missing: none");
  });

  it("downgrades confidence to medium when missing coverage remains", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget persists the input.",
            },
          ],
          missingCoverage: ["where the saved widget is rendered"],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: medium | Action: answer_from_report");
    expect(report).toContain("where the saved widget is rendered");
  });

  it("drops unknown candidate IDs and falls back instead of rendering fabricated paths", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        const result = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c999"],
          flow: [
            {
              candidateId: "c999",
              role: "handler",
              fact: "made up",
            },
          ],
        });
        expect(result).toContain("did not match observed evidence");
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("## explore_code report");
    expect(report).not.toContain("c999");
    expect(report).not.toContain("made up");
    // Falls back to the real observed candidate.
    expect(report).toContain("src/widget/saveWidget.ts");
  });

  it("keeps the last accepted report when the stream fails after submit_report", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: (async function* () {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
            },
          ],
        });
        throw new Error("provider tool-call protocol error");
        yield { type: "text-delta", text: "unreachable" };
      })(),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "edit" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: read_targets");
    expect(report).toContain("saveWidget handles the submitted value.");
    expect(report).toContain(
      "> export async function saveWidget(input: WidgetInput) {",
    );
  });

  it("falls back to a deterministic report when the model never calls submit_report", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(report).toContain("## explore_code report");
    expect(report).toContain("Confidence: low");
    expect(report).toContain("src/widget/saveWidget.ts");
  });

  it("renders skip_explore_result when the model finds nothing relevant", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: [],
          flow: [],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: skip_explore_result");
    expect(report).toContain("explorer found nothing relevant");
  });

  it("derives targeted_gap_search and renders executable search targets", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [],
          missingCoverage: ["where saveWidget is invoked"],
          searchSuggestions: [
            { identifier: "saveWidget", scope: "src/**/*.{ts,tsx}" },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: targeted_gap_search");
    expect(report).toContain(
      'Search targets:\nquery="saveWidget" include="src/**/*.{ts,tsx}" literal=true',
    );
  });

  it("drops non-executable search suggestions", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [],
          missingCoverage: ["where saveWidget is invoked"],
          searchSuggestions: [
            { identifier: "saveWidget", scope: "somewhere in the app" },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).not.toContain("somewhere in the app");
    expect(report).not.toContain("Search targets:");
  });

  it("bounces an explain trace with no implementation-site evidence, but only once", async () => {
    mocks.runRawExploreCode.mockResolvedValue(
      buildSupportOnlyRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        const firstSubmit = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "test",
              fact: "covers the widget save flow.",
            },
          ],
        });
        expect(firstSubmit).toContain("no implementation-site evidence");
        const secondSubmit = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "test",
              fact: "covers the widget save flow.",
            },
          ],
        });
        expect(secondSubmit).toBe("Report accepted.");
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("## explore_code report");
  });

  it("renders each flow path at most once outside the JSON block", async () => {
    mocks.runRawExploreCode.mockResolvedValue(
      buildSameFileMultiRangeRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
            },
            {
              candidateId: "c2",
              role: "validation",
              fact: "saveWidgetValidation validates input.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    const beforeJson = report.split("```json")[0];
    const occurrences =
      beforeJson.match(/src\/widget\/saveWidget\.ts:1-4/g) ?? [];
    // The second range on the same file is rendered as "same file:...".
    expect(occurrences.length).toBe(1);
    expect(beforeJson).toContain("same file:20-23");
  });

  it("caps accumulated raw observations from a single tool call", async () => {
    mocks.runRawExploreCode.mockResolvedValue(buildLargeRawExploreResult());
    let observedResult = "";
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        observedResult = await options.tools.explore_code.execute({
          query: "widget save flow",
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(observedResult.length).toBeLessThanOrEqual(12_010);
    expect(observedResult).toContain("[TRUNCATED]");
  });

  it("caps sub-agent read-only tool calls at the shared step budget", async () => {
    const results: string[] = [];
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        for (let index = 0; index < 13; index++) {
          results.push(
            await options.tools.explore_code.execute({
              query: `widget save flow ${index}`,
            }),
          );
        }
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(results[11]).not.toContain("budget exhausted");
    expect(results[12]).toContain("budget exhausted");
  });

  it("keeps rendered reports within the character budget", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report.length).toBeLessThanOrEqual(2_500);
  });

  it("forces submit_report on the final allowed step when nothing is accepted", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        for (let index = 0; index < 11; index++) {
          await options.tools.explore_code.execute({
            query: `widget save flow ${index}`,
          });
        }
        expect(options.prepareStep()).toEqual({
          activeTools: ["submit_report"],
          toolChoice: { type: "tool", toolName: "submit_report" },
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });
  });

  it("omits stale tsconfig paths from nested compiler exploration", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
          tsconfig_path: "webapp/tsconfig.json",
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.not.objectContaining({
          tsconfig_path: "webapp/tsconfig.json",
        }),
      }),
    );
  });

  it("locks nested compiler exploration to the parent tsconfig", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "explore-subagent-tsconfig-"),
    );
    await fs.mkdir(path.join(appPath, "primary"), { recursive: true });
    await fs.mkdir(path.join(appPath, "nested"), { recursive: true });
    await fs.writeFile(path.join(appPath, "primary/tsconfig.json"), "{}");
    await fs.writeFile(path.join(appPath, "nested/tsconfig.json"), "{}");

    try {
      mocks.streamText.mockImplementationOnce((options: any) => ({
        fullStream: createToolStream(async () => {
          await options.tools.explore_code.execute({
            query: "widget save flow",
            tsconfig_path: "nested/tsconfig.json",
          });
          await options.tools.submit_report.execute({
            primaryCandidateIds: ["c1"],
            flow: [
              {
                candidateId: "c1",
                role: "handler",
                fact: "saveWidget validates input.",
              },
            ],
          });
        }),
        textStream: createTextStream([]),
      }));

      await runExploreCodeSubagent({
        args: {
          query: "widget save flow",
          intent: "explain",
          tsconfig_path: "primary/tsconfig.json",
        },
        ctx: createMockContext(appPath),
      });

      expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            tsconfig_path: "primary/tsconfig.json",
          }),
        }),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("widens nested compiler exploration defaults for explain traces", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          max_files: 8,
          max_depth: 3,
        }),
      }),
    );
  });

  it("preserves explicit nested compiler exploration limits", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
          max_files: 2,
          max_depth: 1,
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
            },
          ],
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          max_files: 2,
          max_depth: 1,
        }),
      }),
    );
  });

  it("fails clearly when Dyad Pro is unavailable", async () => {
    mocks.readSettings.mockReturnValue({ enableDyadPro: false });
    await expect(
      runExploreCodeSubagent({
        args: { query: "widget save flow", intent: "locate" },
        ctx: createMockContext(),
      }),
    ).rejects.toThrow(/Dyad Pro/);
  });

  it("keeps benchmark-derived domain literals out of production explorer code", async () => {
    const productionFiles = [
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts",
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent_candidates.ts",
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent_report.ts",
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent_prompts.ts",
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code.ts",
    ];
    const forbidden = [
      "scene",
      "channel",
      "invoice",
      "excalidraw",
      "mattermost",
      "onboarding",
      "tours",
      "reservation",
      "busy times",
    ];

    for (const filePath of productionFiles) {
      const source = await fs.readFile(
        path.join(process.cwd(), filePath),
        "utf8",
      );
      for (const literal of forbidden) {
        expect(
          source.toLowerCase(),
          `${filePath} contains ${literal}`,
        ).not.toContain(literal);
      }
    }
  });
});

function createMockContext(appPath = "/tmp/app"): AgentContext {
  return {
    appId: 1,
    chatId: 2,
    appPath,
    readOnly: true,
    planModeOnly: false,
    selectedComponent: null,
    dyadRequestId: "request-1",
    abortSignal: undefined,
    accumulatedAiMessages: [],
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn(async () => true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
    onWarningMessage: vi.fn(),
    localAgentSettings: {
      selectedModel: { provider: "auto", name: "value" },
    },
    mcpToolConsent: new Map(),
    availableMcpTools: [],
    nitroEnabled: false,
  } as unknown as AgentContext;
}

function buildRawExploreResult() {
  return {
    query: "widget save flow",
    totalSymbols: 1,
    totalFiles: 1,
    indexedFileCount: 1,
    indexMs: 1,
    searchMs: 1,
    truncated: false,
    notes: [],
    files: [
      {
        path: "src/widget/saveWidget.ts",
        symbols: [{ name: "saveWidget", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 4,
            lines: [
              "export async function saveWidget(input: WidgetInput) {",
              "  validateWidget(input);",
              "  return api.widgets.save(input);",
              "}",
            ],
          },
        ],
      },
    ],
  };
}

function buildSupportOnlyRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    files: [
      {
        path: "src/__tests__/saveWidget.test.ts",
        symbols: [{ name: "saveWidgetTest", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 3,
            lines: [
              "export function saveWidgetTest(input: WidgetInput) {",
              "  expect(saveWidget(input)).toBeDefined();",
              "}",
            ],
          },
        ],
      },
    ],
  };
}

function buildSameFileMultiRangeRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    totalSymbols: 2,
    files: [
      {
        path: "src/widget/saveWidget.ts",
        symbols: [
          { name: "saveWidget", kind: "function", line: 1 },
          { name: "saveWidgetValidation", kind: "function", line: 20 },
        ],
        windows: [
          {
            startLine: 1,
            endLine: 4,
            lines: [
              "export async function saveWidget(input: WidgetInput) {",
              "  validateWidget(input);",
              "  return api.widgets.save(input);",
              "}",
            ],
          },
          {
            startLine: 20,
            endLine: 23,
            lines: [
              "export function saveWidgetValidation(input: WidgetInput) {",
              "  validateWidget(input);",
              "  return input;",
              "}",
            ],
          },
        ],
      },
    ],
  };
}

function buildLargeRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    files: [
      {
        path: "src/widget/largeWidget.ts",
        symbols: [{ name: "largeWidget", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 2000,
            lines: Array.from(
              { length: 2000 },
              (_value, index) =>
                `export const largeWidgetLine${index} = "${"x".repeat(80)}";`,
            ),
          },
        ],
      },
    ],
  };
}

function createToolStream(runTools: () => Promise<void>) {
  return (async function* () {
    await runTools();
    yield { type: "text-delta", text: "done" };
  })();
}

function createTextStream(chunks: string[]) {
  return (async function* () {
    for (const text of chunks) {
      yield { type: "text-delta", text };
    }
  })();
}
