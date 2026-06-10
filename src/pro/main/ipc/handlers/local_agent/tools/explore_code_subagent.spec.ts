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

describe("runExploreCodeSubagent V2", () => {
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

  it("exposes one reconnaissance conversation with submit_report and inline candidate IDs", async () => {
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
          'exact quote options to copy: "export async function saveWidget(input: WidgetInput) {"',
        );
        expect(result).toContain('"return api.widgets.save(input);"');
        expect(options.prepareStep()).toBeUndefined();
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect save handler before editing",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "high",
        });
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
    expect(options.system).toContain("prefer the execution path");
    expect(options.system).toContain("request or transport boundary");
    expect(options.system).toContain("displayed/returned result");
    expect(options.system).toContain(
      "management, listing, or settings surfaces",
    );
    expect(options.system).toContain(
      "do not defer already-found exact symbols as searchTargets without observing their source",
    );
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(report).toContain("Action: read_targets");
    expect(report).toContain(
      "src/widget/saveWidget.ts:1-4 (handler) - saveWidget handles the submitted value.",
    );
    expect(report).toContain(
      "> export async function saveWidget(input: WidgetInput) {",
    );
    expect(report).toContain('"path":"src/widget/saveWidget.ts"');
  });

  it("drops unknown candidate IDs and falls back instead of rendering fabricated paths", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c999"],
          readTargets: [
            {
              candidateId: "c999",
              purpose: "fabricated target",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c999",
              role: "handler",
              fact: "made up",
              quote: "made up",
            },
          ],
          missingCoverage: ["no valid observed candidate"],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "high",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("## explore_code report");
    expect(report).not.toContain("c999");
    expect(report).not.toContain("fabricated target");
  });

  it("does not upgrade complete locate reports that ask for target reads", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect save handler before answering",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: read_targets");
    expect(report).toContain("Read targets:");
    const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
    expect(JSON.parse(jsonText!)).toMatchObject({
      action: "read_targets",
    });
    expect(JSON.parse(jsonText!)).not.toHaveProperty("readTargets");
  });

  it("keeps the last validated report when the stream fails after submit_report", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: (async function* () {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect save handler before editing",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
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

    expect(report).toContain("Confidence: medium");
    expect(report).toContain("Action: read_targets");
    expect(report).toContain("saveWidget handles the submitted value.");
    expect(report).toContain(
      "> export async function saveWidget(input: WidgetInput) {",
    );
  });

  it("rejects unverified quotes and downgrades confidence without rewriting facts", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "unverified fact must not render",
              quote: "not present in any observed tool result",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: low");
    expect(report).toContain("Flow:\nnone");
    expect(report).not.toContain("unverified fact must not render");
  });

  it("downgrades answer_from_report when no verified flow survives", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify the handler directly",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "unverified fact must not render",
              quote: "not present in any observed tool result",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: low");
    expect(report).toContain("Action: read_targets");
    expect(report).toContain("Flow:\nnone");
    expect(report).toContain(
      "src/widget/saveWidget.ts:1-4 - verify the handler directly",
    );
  });

  it("keeps answer_from_report for locate intent when unresolved coverage remains", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect exact save action before answering",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Exact save action name was not confirmed."],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: medium");
    expect(report).toContain("Action: answer_from_report");
    expect(report).not.toContain(
      "Missing: Exact save action name was not confirmed.",
    );
    expect(report).toContain("Missing: none");
    expect(report).toContain(
      "src/widget/saveWidget.ts:1-4 (handler) - saveWidget handles the submitted value.",
    );
  });

  it("downgrades low-confidence answer_from_report to bounded follow-up", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify low-confidence handler finding",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Caller was not confirmed."],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "low",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: low");
    expect(report).toContain("Action: read_targets");
    expect(report).toContain("Missing: Caller was not confirmed.");
    expect(report).toContain("flow 1 - verify low-confidence handler finding");
  });

  it("preserves sparse explain reports instead of judging coverage", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify sparse trace before answering",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query: "Trace how widget save flow is computed and surfaced",
        intent: "explain",
      },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: medium");
    expect(report).toContain("Action: answer_from_report");
    expect(report).not.toContain("Read targets:");
    expect(report).not.toContain("flow 1 - verify sparse trace before answering");
  });

  it("keeps answer_from_report when selected evidence covers the query", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "jump to the verified save flow",
              required: false,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates before saving.",
              quote: "  validateWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: {
        query: "Trace widget save validation flow",
        intent: "explain",
      },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: answer_from_report");
    expect(report).toContain("Missing: none");
    expect(report).toContain("saveWidget validates before saving.");
  });

  it("does not force continuation for locate reports with verified flow and residual missing coverage", async () => {
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        const firstResult = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify observed handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
        expect(firstResult).toContain("Report accepted");
        expect(options.prepareStep()).toBeUndefined();
      }),
    );

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Missing: Need exact caller of saveWidget.");
    expect(report).toContain("saveWidget handles the submitted value.");
  });

  it("continues explain reports when selected flow still names missing coverage", async () => {
    mocks.runRawExploreCode
      .mockResolvedValueOnce(buildRawExploreResult())
      .mockResolvedValueOnce(buildLateRelevantRawExploreResult());
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        const firstResult = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify observed handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
        expect(firstResult).toContain("needs revision");
        expect(firstResult).toContain("Need exact caller of saveWidget.");
        expect(options.prepareStep()).toBeUndefined();

        await options.tools.explore_code.execute({
          query: "exact caller of saveWidget",
        });
        expect(options.prepareStep()).toEqual({
          activeTools: ["submit_report"],
          toolChoice: { type: "tool", toolName: "submit_report" },
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
            {
              candidateId: "c2",
              role: "caller",
              fact: "callerWidget invokes saveWidget directly.",
              quote: "return saveWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
    );

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: answer_from_report");
    expect(report).toContain("Missing: none");
    expect(report).toContain("callerWidget invokes saveWidget directly.");
    expect(report).not.toContain("Need exact caller of saveWidget.");
  });

  it("requires flow quotes to belong to the selected candidate", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce(
      buildTwoFileRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget calls the audit logger.",
              quote: "auditWidgetSave(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: low");
    expect(report).toContain("Flow:\nnone");
    expect(report).not.toContain("saveWidget calls the audit logger");
    expect(report).not.toContain("auditWidgetSave(input);");
  });

  it("continues after a validation gap and uses the revised submitted report", async () => {
    mocks.cancelOrphanedBaseStream.mockImplementationOnce(
      (streamResult: any) => {
        expect(streamResult.fullStreamAccessed).toBe(true);
      },
    );
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
        });
        const firstResult = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "first report is not grounded.",
              quote: "not present in observed evidence",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
        expect(firstResult).toContain("needs revision");
        expect(firstResult).toContain("exact quote options");
        expect(firstResult).toContain(
          "export async function saveWidget(input: WidgetInput) {",
        );
        expect(options.prepareStep()).toEqual({
          activeTools: ["submit_report"],
          toolChoice: { type: "tool", toolName: "submit_report" },
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
              quote: "validateWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
    );

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(report).toContain("saveWidget validates input");
    expect(report).not.toContain("first report is not grounded");
  });

  it("does not start a second revision stream when the stream stops after a revision request", async () => {
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
        });
        const result = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect save handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget calls the audit logger.",
              quote: "auditWidgetSave(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
        expect(result).toContain("needs revision");
      }),
    );

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(report).toContain("Action: read_targets");
    expect(report).toContain("Flow:\nnone");
  });

  it("prioritizes recent observed candidates in submit_report nudge prompts", async () => {
    mocks.runRawExploreCode
      .mockResolvedValueOnce(buildManyFileRawExploreResult())
      .mockResolvedValueOnce(buildLateRelevantRawExploreResult());
    mocks.streamText
      .mockImplementationOnce((options: any) =>
        createStreamResult(async () => {
          await options.tools.explore_code.execute({
            query: "widget save flow",
          });
          await options.tools.explore_code.execute({
            query: "exact caller of saveWidget",
          });
        }),
      )
      .mockImplementationOnce((options: any) => {
        const lateIndex = options.prompt.indexOf("src/widget/callerWidget.ts");
        const earlyIndex = options.prompt.indexOf("src/widget/flowStep1.ts");
        expect(lateIndex).toBeGreaterThanOrEqual(0);
        expect(earlyIndex).toBeGreaterThanOrEqual(0);
        expect(lateIndex).toBeLessThan(earlyIndex);
        return createStreamResult(async () => {
          await options.tools.read_file.execute({
            path: "src/widget/callerWidget.ts",
            start_line_one_indexed: 1,
            end_line_one_indexed_inclusive: 4,
          });
          await options.tools.submit_report.execute({
            primaryCandidateIds: ["c6"],
            readTargets: [],
            flow: [
              {
                candidateId: "c6",
                role: "caller",
                fact: "callerWidget invokes saveWidget directly.",
                quote: "return saveWidget(input);",
              },
            ],
            missingCoverage: [],
            recommendedPrimaryAction: "answer_from_report",
            confidence: "medium",
          });
        });
      });

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("callerWidget invokes saveWidget directly.");
  });

  it("forces a corrected submit_report when continuation rounds are exhausted", async () => {
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "targeted_gap_search",
          searchTargets: [
            'query="saveWidget" include="src/widget/**/*.{ts,tsx}" literal=true',
          ],
          confidence: "medium",
        });
        expect(options.prepareStep()).toBeUndefined();
        await options.tools.read_file.execute({
          path: "src/widget/saveWidget.ts",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 4,
        });
        const secondResult = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Still need exact caller of saveWidget."],
          recommendedPrimaryAction: "targeted_gap_search",
          searchTargets: [
            'query="saveWidget" include="src/widget/**/*.{ts,tsx}" literal=true',
          ],
          confidence: "medium",
        });
        expect(secondResult).toContain("0 continuation round(s) remaining");
        expect(secondResult).toContain("Call submit_report again now");
        expect(secondResult).toContain("targeted_gap_search");
        expect(options.prepareStep()).toEqual({
          activeTools: ["submit_report"],
          toolChoice: { type: "tool", toolName: "submit_report" },
        });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "targeted_gap_search",
          searchTargets: [
            'query="saveWidget" include="src/widget/**/*.{ts,tsx}" literal=true',
          ],
          confidence: "medium",
        });
      }),
    );

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("saveWidget handles the submitted value");
    expect(report).not.toContain("Still need exact caller");
  });

  it("prioritizes quote corrections over residual missing coverage when verified flow survived", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce(
      buildTwoFileRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) =>
      createStreamResult(async () => {
        await options.tools.explore_code.execute({
          query: "widget save flow",
        });
        const result = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
            {
              candidateId: "c2",
              role: "audit",
              fact: "audit evidence uses the wrong quote.",
              quote: "not present in observed evidence",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });

        expect(result).toContain("Quote was not found");
      }),
    );

    await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });
  });

  it("rejects quotes longer than two lines", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates and saves.",
              quote: [
                "export async function saveWidget(input: WidgetInput) {",
                "  validateWidget(input);",
                "  return api.widgets.save(input);",
              ].join("\n"),
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Flow:\nnone");
    expect(report).not.toContain("saveWidget validates and saves.");
    expect(report).not.toContain("return api.widgets.save(input);");
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
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
              quote: "validateWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
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
            readTargets: [],
            flow: [
              {
                candidateId: "c1",
                role: "handler",
                fact: "saveWidget validates input.",
                quote: "validateWidget(input);",
              },
            ],
            missingCoverage: [],
            recommendedPrimaryAction: "answer_from_report",
            confidence: "medium",
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
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
              quote: "validateWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
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
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
              quote: "validateWidget(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
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

  it("renders each flow path at most once outside the JSON block", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget validates input.",
              quote: "validateWidget(input);",
            },
            {
              candidateId: "c1",
              role: "persistence",
              fact: "saveWidget persists input.",
              quote: "return api.widgets.save(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "high",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });
    const beforeJson = report.split("```json")[0];

    expect(beforeJson.match(/src\/widget\/saveWidget\.ts/g) ?? []).toHaveLength(
      1,
    );
    expect(report).toContain("saveWidget validates input");
    expect(report).not.toContain("saveWidget persists input");
  });

  it("downgrades answer_from_report for edit/debug intent instead of upgrading actions", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "edit the handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "return api.widgets.save(input);",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "high",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "fix widget save flow", intent: "edit" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: read_targets");
    expect(report).toContain("Read targets:");
  });

  it("falls back to deterministic observed evidence when the model never calls submit_report", async () => {
    mocks.streamText
      .mockImplementationOnce((options: any) => ({
        fullStream: createToolStream(async () => {
          const result = await options.tools.explore_code.execute({
            query: "widget save flow",
          });
          expect(result).toContain("Observed candidate IDs:");
        }),
        textStream: createTextStream([]),
      }))
      .mockImplementationOnce((options: any) => {
        expect(options.activeTools).toEqual(["submit_report"]);
        expect(options.toolChoice).toEqual({
          type: "tool",
          toolName: "submit_report",
        });
        expect(options.prompt).toContain(
          "Observed candidate IDs from prior tool results:",
        );
        expect(options.prompt).toContain(
          "export async function saveWidget(input: WidgetInput) {",
        );
        expect(options.prompt).toContain(
          'exact quote options to copy: "export async function saveWidget(input: WidgetInput) {"',
        );
        return {
          fullStream: createTextStream(["still no tool call"]),
          textStream: createTextStream([]),
        };
      });

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(report).toContain("Confidence: low");
    expect(report).toContain("src/widget/saveWidget.ts");
    expect(report).toContain('"paths":[{"path":"src/widget/saveWidget.ts"');
  });

  it("uses observed evidence when the submit_report nudge succeeds", async () => {
    mocks.streamText
      .mockImplementationOnce((options: any) => ({
        fullStream: createToolStream(async () => {
          const result = await options.tools.explore_code.execute({
            query: "widget save flow",
          });
          expect(result).toContain("Observed candidate IDs:");
        }),
        textStream: createTextStream([]),
      }))
      .mockImplementationOnce((options: any) => {
        expect(options.prompt).toContain(
          "Observed candidate IDs from prior tool results:",
        );
        expect(options.prompt).toContain(
          'exact quote options to copy: "export async function saveWidget(input: WidgetInput) {"',
        );
        return {
          fullStream: createToolStream(async () => {
            await options.tools.submit_report.execute({
              primaryCandidateIds: ["c1"],
              readTargets: [],
              flow: [
                {
                  candidateId: "c1",
                  role: "handler",
                  fact: "saveWidget validates input.",
                  quote: "validateWidget(input);",
                },
              ],
              missingCoverage: [],
              recommendedPrimaryAction: "answer_from_report",
              confidence: "medium",
            });
          }),
          textStream: createTextStream([]),
        };
      });

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(report).toContain("Action: answer_from_report");
    expect(report).toContain("saveWidget validates input.");
  });

  it("renders skip_explore_result as a real empty outcome", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.submit_report.execute({
          primaryCandidateIds: [],
          readTargets: [],
          flow: [],
          missingCoverage: ["no matching implementation evidence"],
          recommendedPrimaryAction: "skip_explore_result",
          confidence: "low",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "unrelated dependency question", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: skip_explore_result");
    expect(report).toContain(
      "Missing: explorer found nothing relevant; proceed without it",
    );
    expect(report).toContain('"paths":[]');
  });

  it("requests revision when skip_explore_result includes observed evidence", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        const result = await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify observed handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["no other entry point confirmed"],
          recommendedPrimaryAction: "skip_explore_result",
          confidence: "medium",
        });
        expect(result).toContain("needs revision");
        expect(result).toContain("skip_explore_result is only valid");
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: low");
    expect(report).toContain("Action: skip_explore_result");
    expect(report).toContain("saveWidget handles the submitted value.");
    expect(report).not.toContain("Read targets:");
  });

  it("validates candidate IDs that were observed before ranking overlap dedupe", async () => {
    mocks.runRawExploreCode
      .mockResolvedValueOnce(buildRawExploreResult())
      .mockResolvedValueOnce(buildOverlappingRawExploreResult());
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify the original observed handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Confidence: medium");
    expect(report).toContain("Action: read_targets");
    expect(report).toContain("saveWidget handles the submitted value.");
    expect(report).toContain(
      "src/widget/saveWidget.ts:1-4 (handler) - saveWidget handles the submitted value.",
    );
  });

  it("keeps separate flow links from different ranges in the same file", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce(
      buildSameFileMultiRangeRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "entry",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
            {
              candidateId: "c2",
              role: "validation",
              fact: "saveWidgetValidation validates input before save.",
              quote:
                "export function saveWidgetValidation(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });

    expect(report).toContain("saveWidget handles the submitted value.");
    expect(report).toContain(
      "saveWidgetValidation validates input before save.",
    );
  });

  it("renders targeted gap search targets outside the JSON machine block", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "targeted_gap_search",
          searchTargets: [
            'query="saveWidget" include="src/widget/**/*.{ts,tsx}" literal=true',
          ],
          confidence: "medium",
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
      'Search targets:\nquery="saveWidget" include="src/widget/**/*.{ts,tsx}" literal=true',
    );
    expect(
      report.split("```json")[0].match(/src\/widget\/saveWidget\.ts/g),
    ).toHaveLength(1);
    const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
    expect(JSON.parse(jsonText!)).toMatchObject({
      action: "targeted_gap_search",
      confidence: "medium",
    });
    expect(JSON.parse(jsonText!)).not.toHaveProperty("searchTargets");
  });

  it("drops non-executable search target scopes and downgrades to a usable action", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "verify observed save handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: ["Need exact caller of saveWidget."],
          recommendedPrimaryAction: "targeted_gap_search",
          searchTargets: [
            'query="saveWidget" include="flow 1" literal=true',
            'query="saveWidget" include="nearby file" literal=true',
          ],
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report).toContain("Action: read_targets");
    expect(report).not.toContain("Search targets:");
    expect(report).toContain("Read targets:");
    const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
    expect(JSON.parse(jsonText!)).toMatchObject({
      action: "read_targets",
      confidence: "medium",
      paths: [{ path: "src/widget/saveWidget.ts", range: "1-4" }],
    });
  });

  it("renders compacted machine paths once outside the JSON block", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce(
      buildSixFileRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2", "c3", "c4", "c5"],
          readTargets: [],
          flow: ["c1", "c2", "c3", "c4", "c5", "c6"].map(
            (candidateId, index) => ({
              candidateId,
              role: "flow",
              fact: `Candidate ${index + 1} participates in the widget save flow.`,
              quote: `export const widgetFlowStep${index + 1} = true;`,
            }),
          ),
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "explain" },
      ctx: createMockContext(),
    });
    const beforeJson = report.split("```json")[0];

    for (let index = 1; index <= 6; index++) {
      expect(
        beforeJson.match(new RegExp(`src/widget/flowStep${index}\\.ts`, "g")) ??
          [],
      ).toHaveLength(1);
    }
    expect(
      JSON.parse(/```json\n([\s\S]+?)\n```/.exec(report)![1]).paths,
    ).toHaveLength(6);
  });

  it("caps accumulated raw observations across tool calls", async () => {
    mocks.runRawExploreCode.mockResolvedValue(buildLargeRawExploreResult());
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.explore_code.execute({ query: "large evidence" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [],
          flow: [],
          missingCoverage: [],
          recommendedPrimaryAction: "answer_from_report",
          confidence: "low",
        });
      }),
      textStream: createTextStream([]),
    }));

    await runExploreCodeSubagent({
      args: { query: "large evidence", intent: "locate" },
      ctx: createMockContext(),
    });

    const finishEvent = mocks.recordCodeExplorerBenchmarkEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "subagent_finish");
    expect(finishEvent.rawObservationChars).toBeLessThanOrEqual(60_000);
  });

  it("caps sub-agent read-only tool calls at the shared step budget", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        let finalToolResult = "";
        for (let index = 0; index < 13; index++) {
          finalToolResult = await options.tools.explore_code.execute({
            query: `widget save flow ${index}`,
          });
        }
        expect(finalToolResult).toContain("tool budget exhausted");
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1"],
          readTargets: [
            {
              candidateId: "c1",
              purpose: "inspect first observed handler",
              required: true,
            },
          ],
          flow: [
            {
              candidateId: "c1",
              role: "handler",
              fact: "saveWidget handles the submitted value.",
              quote: "export async function saveWidget(input: WidgetInput) {",
            },
          ],
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "widget save flow", intent: "edit" },
      ctx: createMockContext(),
    });

    expect(mocks.runRawExploreCode).toHaveBeenCalledTimes(12);
    expect(report).toContain("Action: read_targets");
  });

  it("keeps rendered reports within the V2 character budget", async () => {
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.submit_report.execute({
          primaryCandidateIds: [],
          readTargets: [],
          flow: [],
          missingCoverage: ["no matching implementation evidence"],
          recommendedPrimaryAction: "skip_explore_result",
          confidence: "low",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "long query ".repeat(400), intent: "locate" },
      ctx: createMockContext(),
    });

    expect(report.length).toBeLessThanOrEqual(2_500);
    const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
    expect(jsonText).toBeTruthy();
    expect(JSON.parse(jsonText!)).toMatchObject({
      action: "skip_explore_result",
      confidence: "low",
      paths: [],
    });
  });

  it("compacts verbose accepted reports without truncation markers", async () => {
    mocks.runRawExploreCode.mockResolvedValueOnce(
      buildManyFileRawExploreResult(),
    );
    mocks.streamText.mockImplementationOnce((options: any) => ({
      fullStream: createToolStream(async () => {
        await options.tools.explore_code.execute({ query: "widget save flow" });
        await options.tools.submit_report.execute({
          primaryCandidateIds: ["c1", "c2", "c3", "c4", "c5"],
          readTargets: ["c1", "c2", "c3", "c4", "c5"].map((candidateId) => ({
            candidateId,
            purpose:
              "inspect this deliberately wordy target purpose before relying on the reported implementation details",
            required: true,
          })),
          flow: ["c1", "c2", "c3", "c4", "c5"].map((candidateId, index) => ({
            candidateId,
            role: "deliberately verbose implementation role label",
            fact: `Candidate ${index + 1} has a deliberately verbose fact explaining how this part participates in the overall widget save flow and why the caller should trust it.`,
            quote: `export const widgetFlowStep${index + 1} = true;`,
          })),
          missingCoverage: [],
          recommendedPrimaryAction: "read_targets",
          confidence: "medium",
        });
      }),
      textStream: createTextStream([]),
    }));

    const report = await runExploreCodeSubagent({
      args: { query: "long query ".repeat(80), intent: "edit" },
      ctx: createMockContext(),
    });

    expect(report.length).toBeLessThanOrEqual(2_500);
    expect(report).not.toContain("[TRUNCATED");
    expect(report).toContain("Missing: none");
    expect(report).toContain("Read targets:");
    expect(report).toContain("```json");
    const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
    expect(JSON.parse(jsonText!)).not.toHaveProperty("readTargets");
  });

  it("fails clearly when Dyad Pro is unavailable", async () => {
    mocks.readSettings.mockReturnValue({
      enableDyadPro: false,
      providerSettings: {},
    });

    await expect(
      runExploreCodeSubagent({
        args: { query: "widget save flow", intent: "locate" },
        ctx: createMockContext(),
      }),
    ).rejects.toThrow(/requires Dyad Pro/);
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("keeps benchmark-derived domain literals out of production explorer code", async () => {
    const productionFiles = [
      "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts",
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

function buildTwoFileRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    totalSymbols: 2,
    totalFiles: 2,
    files: [
      ...buildRawExploreResult().files,
      {
        path: "src/widget/auditWidget.ts",
        symbols: [{ name: "auditWidgetSave", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 3,
            lines: [
              "export function auditWidgetSave(input: WidgetInput) {",
              "  auditWidgetSave(input);",
              "}",
            ],
          },
        ],
      },
    ],
  };
}

function buildOverlappingRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    files: [
      {
        path: "src/widget/saveWidget.ts",
        symbols: [{ name: "widgetSaveFlow", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 6,
            lines: [
              "export async function widgetSaveFlow(input: WidgetInput) {",
              "  const widgetSaveFlowMarker = true;",
              "  validateWidget(input);",
              "  return api.widgets.save(input);",
              "}",
              "export const widgetSaveFlowComplete = true;",
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

function buildManyFileRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    totalSymbols: 5,
    totalFiles: 5,
    files: Array.from({ length: 5 }, (_value, index) => ({
      path: `src/widget/flowStep${index + 1}.ts`,
      symbols: [
        {
          name: `widgetFlowStep${index + 1}`,
          kind: "const",
          line: 1,
        },
      ],
      windows: [
        {
          startLine: 1,
          endLine: 3,
          lines: [
            `export const widgetFlowStep${index + 1} = true;`,
            `export function runWidgetFlowStep${index + 1}() {`,
            "  return true;",
          ],
        },
      ],
    })),
  };
}

function buildSixFileRawExploreResult() {
  const result = buildManyFileRawExploreResult();
  return {
    ...result,
    totalSymbols: 6,
    totalFiles: 6,
    files: [
      ...result.files,
      {
        path: "src/widget/flowStep6.ts",
        symbols: [
          {
            name: "widgetFlowStep6",
            kind: "const",
            line: 1,
          },
        ],
        windows: [
          {
            startLine: 1,
            endLine: 3,
            lines: [
              "export const widgetFlowStep6 = true;",
              "export function runWidgetFlowStep6() {",
              "  return true;",
            ],
          },
        ],
      },
    ],
  };
}

function buildLateRelevantRawExploreResult() {
  return {
    ...buildRawExploreResult(),
    query: "exact caller of saveWidget",
    totalSymbols: 1,
    totalFiles: 1,
    files: [
      {
        path: "src/widget/callerWidget.ts",
        symbols: [{ name: "callerWidget", kind: "function", line: 1 }],
        windows: [
          {
            startLine: 1,
            endLine: 4,
            lines: [
              "export function callerWidget(input: WidgetInput) {",
              "  return saveWidget(input);",
              "}",
            ],
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

function createStreamResult(runTools: () => Promise<void>) {
  return {
    fullStreamAccessed: false,
    get fullStream() {
      this.fullStreamAccessed = true;
      return createToolStream(runTools);
    },
    textStream: createTextStream([]),
  };
}

function createTextStream(chunks: string[]) {
  return (async function* () {
    for (const text of chunks) {
      yield { type: "text-delta", text };
    }
  })();
}
