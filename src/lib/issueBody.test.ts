import { describe, expect, it } from "vitest";
import {
  ISSUE_TITLE,
  ISSUE_URL_CEILING,
  MIN_DESCRIPTION_LENGTH,
  PROSE_BUDGET,
  SCREENSHOT_REASON_LIMIT,
  applyDescriptionEdit,
  buildIssueBody,
  buildIssueUrl,
  describesSomething,
  formatDiagnosticsSections,
  formatScreenshotStatusLine,
} from "./issueBody";
import { type SystemDebugInfo } from "@/ipc/types";
import { type UserBudgetInfo } from "@/ipc/types/system";
import { type ModelSelection, type UserSettings } from "@/lib/schemas";

const debugInfo: SystemDebugInfo = {
  nodeVersion: "20.0.0",
  pnpmVersion: "9.0.0",
  nodePath: "/usr/bin/node",
  telemetryId: "telemetry-id",
  telemetryConsent: "opted_in",
  telemetryUrl: "https://example.test",
  dyadVersion: "1.2.3",
  platform: "linux",
  architecture: "x64",
  logs: "some logs",
  updaterLogs: null,
  selectedLanguageModel: "auto",
};

const userBudget: UserBudgetInfo = {
  usedCredits: 1,
  totalCredits: 10,
  budgetResetDate: new Date(0),
  redactedUserId: "user-abc",
  isTrial: false,
};

const diagnostics = {
  debugInfo,
  settings: null,
  selectedModel: null,
  userBudget,
};

const encoded = (v: string) => new URLSearchParams({ v }).toString().length - 2;

describe("formatScreenshotStatusLine", () => {
  it("uses a stable prefix so published issues can be counted", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "Screenshot status: captured",
    );
    expect(formatScreenshotStatusLine({ status: "declined" })).toBe(
      "Screenshot status: declined",
    );
  });

  it("names a bare capture failure without inventing a reason", () => {
    expect(formatScreenshotStatusLine({ status: "capture-failed" })).toBe(
      "Screenshot status: capture-failed",
    );
  });

  it("tells a maintainer to ask for a screenshot the reporter already has", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "ask them to paste it",
    );
  });

  it("includes the failure reason when capture failed", () => {
    expect(
      formatScreenshotStatusLine({
        status: "capture-failed",
        reason: "No focused window to capture",
      }),
    ).toBe("Screenshot status: capture-failed (No focused window to capture)");
  });

  it("caps the failure reason, the one body input the reporter never sees", () => {
    const line = formatScreenshotStatusLine({
      status: "capture-failed",
      reason: "\u754c".repeat(500),
    });
    expect(encoded(line)).toBeLessThan(400);
  });
});

describe("describesSomething", () => {
  it("accepts a short but real description", () => {
    expect(describesSomething("it crashed")).toBe(true);
  });

  it("rejects blank, whitespace and a couple of characters", () => {
    expect(describesSomething("")).toBe(false);
    expect(describesSomething("   ")).toBe(false);
    expect(describesSomething("asdf")).toBe(false);
  });

  it("measures after trimming", () => {
    expect(describesSomething(" ".repeat(20))).toBe(false);
    expect(
      describesSomething(`  ${"a".repeat(MIN_DESCRIPTION_LENGTH)}  `),
    ).toBe(true);
  });

  it.each([
    ["Chinese", "\u9884\u89c8\u4e00\u7247\u7a7a\u767d"],
    ["Korean", "\uc571\uc774 \uc790\uafb8 \uaebc\uc838\uc694"],
    ["Japanese", "\u30d7\u30ec\u30d3\u30e5\u30fc\u304c\u7a7a\u767d"],
    // All-hiragana and all-katakana, so neither leans on the CJK range.
    ["all-hiragana", "\u3046\u3054\u304b\u306a\u3044"],
    ["all-katakana", "\u30d5\u30ea\u30fc\u30ba"],
    [
      "half-width katakana",
      "\uff71\uff8c\uff9f\uff98\uff89\uff86\uff70\uff8b\uff9e",
    ],
    ["CJK extension A", "\u3400\u3401\u3402\u3403"],
    ["CJK extension B", "\u{20000}\u{20001}\u{20002}\u{20003}"],
  ])("accepts a real %s report", (_name, text) => {
    expect(describesSomething(text)).toBe(true);
  });

  it("accepts a Japanese report containing a prolonged sound mark", () => {
    // The mark is worth nothing alone but is part of real words.
    expect(
      describesSomething("\u30b3\u30fc\u30d2\u30fc\u304c\u51fa\u306a\u3044"),
    ).toBe(true);
  });

  it.each([
    // Marks that live inside the kana blocks but mean nothing on their own.
    ["middle dots", "\u30fb\u30fb\u30fb\u30fb"],
    ["prolonged sound marks", "\u30fc\u30fc\u30fc\u30fc"],
    ["half-width prolonged marks", "\uff70\uff70\uff70\uff70"],
    ["combining sound marks", "\u3099\u3099\u3099\u3099"],
    ["iteration marks", "\u309d\u309d\u309d\u309d"],
    ["CJK punctuation", "\u3002\u3002\u3002\u3002"],
    ["unassigned Hangul", "\ud7a4\ud7a4\ud7a4\ud7a4"],
  ])("still turns away %s", (_name, text) => {
    expect(describesSomething(text)).toBe(false);
  });

  it("needs more than three dense characters", () => {
    // Pins the weight: at 2 a three-character report would fail, at 4 it
    // would pass, and neither is what the minimum is meant to mean.
    expect(describesSomething("\u4e00\u4e8c\u4e09")).toBe(false);
    expect(describesSomething("\u4e00\u4e8c\u4e09\u56db")).toBe(true);
  });
});

describe("applyDescriptionEdit", () => {
  // The budget is counted in encoded characters, which is the unit the URL
  // limit is measured in: a CJK character costs 9, an emoji 12, a newline 3.
  it.each([
    ["ASCII", "d"],
    ["CJK", "\u754c"],
    ["Cyrillic", "\u0449"],
    ["emoji", "\ud83d\ude42"],
    ["newline", "\n"],
  ])("caps %s by encoded size", (_name, unit) => {
    const { value } = applyDescriptionEdit("", unit.repeat(2_000));
    expect(encoded(value)).toBeLessThanOrEqual(PROSE_BUDGET);
    expect(applyDescriptionEdit(value, value + unit).value).toBe(value);
  });

  it("lands what fits from a paste and reports that it clipped", () => {
    const result = applyDescriptionEdit("", "x".repeat(PROSE_BUDGET + 500));
    expect(result.value).toHaveLength(PROSE_BUDGET);
    expect(result.hitCap).toBe(true);
  });

  it("does not flag an edit that fits", () => {
    expect(applyDescriptionEdit("", "short").hitCap).toBe(false);
  });

  it("trims the insertion, not the far end of a full field", () => {
    const full = applyDescriptionEdit("", "a".repeat(PROSE_BUDGET)).value;
    const spliced = "a".repeat(10) + "X" + "a".repeat(PROSE_BUDGET - 10);
    const result = applyDescriptionEdit(full, spliced);
    expect(result.value).toBe(full);
    expect(result.hitCap).toBe(true);
  });

  it("lands what fits from a paste into the middle of a part-full field", () => {
    const start = applyDescriptionEdit(
      "",
      "a".repeat(PROSE_BUDGET - 100),
    ).value;
    const head = "a".repeat(50);
    const tail = "a".repeat(PROSE_BUDGET - 150);
    const result = applyDescriptionEdit(start, head + "P".repeat(400) + tail);
    expect(result.value).toBe(head + "P".repeat(100) + tail);
    expect(result.value).toHaveLength(PROSE_BUDGET);
  });

  it("still allows deleting from a full field", () => {
    const full = applyDescriptionEdit("", "a".repeat(PROSE_BUDGET)).value;
    const result = applyDescriptionEdit(full, "a".repeat(PROSE_BUDGET - 5));
    expect(result.value).toHaveLength(PROSE_BUDGET - 5);
    expect(result.hitCap).toBe(false);
  });

  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

  it.each([9, 10, 11])(
    "never splits a surrogate pair with the cap %i characters in",
    (offset) => {
      const { value } = applyDescriptionEdit(
        "",
        "a".repeat(offset) + "\ud83d\ude42".repeat(300),
      );
      expect(value).not.toMatch(LONE_SURROGATE);
      expect(
        Array.from(value.slice(offset)).every((c) => c === "\ud83d\ude42"),
      ).toBe(true);
    },
  );

  it("never splits a surrogate pair when an edit lands mid-pair", () => {
    const full = applyDescriptionEdit(
      "",
      "a".repeat(9) + "\ud83d\ude42".repeat(300),
    ).value;
    const spliced = full.slice(0, 13) + "\ud83d\ude43" + full.slice(13);
    const result = applyDescriptionEdit(full, spliced);
    expect(result.value).not.toMatch(LONE_SURROGATE);
    expect(encoded(result.value)).toBeLessThanOrEqual(PROSE_BUDGET);
  });
});

describe("buildIssueBody", () => {
  it("puts the description under its heading", () => {
    const body = buildIssueBody({
      description: "Preview goes blank.",
      screenshot: { status: "declined" },
      diagnostics,
      sessionId: null,
    });
    expect(body).toContain("## What happened (required)\nPreview goes blank.");
    expect(body).toContain("Screenshot status: declined");
  });

  it("includes system information only when it is shared", () => {
    const shared = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics,
      sessionId: null,
    });
    expect(shared).toContain("- Dyad Version: 1.2.3");
    expect(shared).toContain("## Logs");

    const withheld = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: null,
      sessionId: null,
    });
    expect(withheld).toContain(
      "## System Information\nNot included by the reporter.",
    );
    expect(withheld).not.toContain("- Dyad Version");
    expect(withheld).not.toContain("## Logs");
  });

  it("references an uploaded session only when there is one", () => {
    const withSession = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: null,
      sessionId: "v2:abc",
      redactedUserId: "user-abc",
    });
    expect(withSession).toContain("Session ID: v2:abc");
    expect(withSession).toContain("Session Schema: v2.0");
    expect(withSession).toContain("Pro User ID: user-abc");

    const without = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: null,
      sessionId: null,
    });
    expect(without).not.toContain("Session ID");
  });
});

describe("formatDiagnosticsSections", () => {
  // The disclosure and the body render this same string, so a field added to
  // the report cannot go missing from the preview.
  it("carries every diagnostic the body sends", () => {
    const preview = formatDiagnosticsSections(diagnostics);
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics,
      sessionId: null,
    });
    for (const line of preview.split("\n").filter((l) => l.trim())) {
      expect(body).toContain(line);
    }
    expect(preview).toContain("Node Path:");
    expect(preview).toContain("Pro User ID: user-abc");
    expect(preview).toContain("## Settings");
    expect(preview).toContain("## Logs");
  });

  it("uses the same clamped log tail the body sends", () => {
    const noisy = { ...debugInfo, logs: "\u754c/src/index.ts\n".repeat(400) };
    const preview = formatDiagnosticsSections({
      ...diagnostics,
      debugInfo: noisy,
    });
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: { ...diagnostics, debugInfo: noisy },
      sessionId: null,
    });
    expect(body).toContain(preview);
  });
});

describe("updater log section", () => {
  // formatUpdaterLogsForIssueBody leaves the important text at a different end
  // depending on which branch it takes, so each branch is pinned separately.
  const squirrelTail = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `2026-08-30 12:${String(i).padStart(2, "0")}:00 [info] checking for update ${i}\r\n`,
    ).join("");

  function updaterSectionOf(updaterLogs: string): string {
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: { ...diagnostics, debugInfo: { ...debugInfo, updaterLogs } },
      sessionId: null,
    });
    return body.slice(body.indexOf("## Auto-Updater Logs"));
  }

  it("keeps a long error section, which leads its own output", () => {
    const section = updaterSectionOf(
      "Last updater error (this session):\n" +
        "System.Net.WebException: The remote server returned an error: (403) Forbidden.\n" +
        Array.from(
          { length: 30 },
          (_, i) => `   at Squirrel.UpdateManager.Frame${i}(String url)\n`,
        ).join(""),
    );
    expect(section).toContain("Last updater error (this session):");
    expect(section).toContain("System.Net.WebException");
  });

  it("keeps the error identity when the section overflows only once encoded", () => {
    const section = updaterSectionOf(
      "Last updater error (this session):\r\n" +
        "System.Net.WebException: The remote server returned an error: (403) Forbidden.\r\n" +
        Array.from(
          { length: 4 },
          (_, i) =>
            `   at Squirrel.UpdateManager.<CheckForUpdate>d__${i}.MoveNext() in C:\\proj\\Squirrel\\UpdateManager.cs:line ${i}\r\n`,
        ).join("") +
        "\n\nSquirrelSetup.log (tail):\n" +
        squirrelTail(40),
    );
    expect(section).toContain("Last updater error (this session):");
    expect(section).toContain("System.Net.WebException");
  });

  it("keeps the error section when it is appended after the Squirrel tail", () => {
    const section = updaterSectionOf(
      "Last updater error (this session):\n" +
        "ERR_CONNECTION_REFUSED at https://update.dyad.sh\n" +
        "\n\nSquirrelSetup.log (tail):\n" +
        squirrelTail(40),
    );
    expect(section).toContain("Last updater error (this session):");
    expect(section).toContain("ERR_CONNECTION_REFUSED");
  });

  it("keeps the most recent lines when there is no error section at all", () => {
    const section = updaterSectionOf(
      squirrelTail(40) +
        "2026-08-30 13:00:00 [error] Update failed: EPERM cannot rename app-0.9.1\r\n",
    );
    expect(section).toContain("EPERM cannot rename app-0.9.1");
  });
});

describe("diagnostics field caps", () => {
  // A custom model id and a node path are user-controlled and otherwise
  // unbounded, and the model name reaches the body twice.
  it("caps a long custom model id wherever it appears", () => {
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: {
        ...diagnostics,
        debugInfo: {
          ...debugInfo,
          selectedLanguageModel: "m".repeat(4_000),
          nodePath: "/" + "p".repeat(4_000),
        },
      },
      sessionId: null,
    });

    for (const line of body.split("\n")) {
      if (line.startsWith("- Model:") || line.startsWith("- Node Path:")) {
        expect(encoded(line)).toBeLessThan(200);
      }
    }
  });

  it("keeps the ceiling when every diagnostics field is absurd", () => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: {
          debugInfo: {
            ...debugInfo,
            selectedLanguageModel: "\u754c".repeat(2_000),
            nodePath: "\u754c".repeat(2_000),
            logs: "log line\n".repeat(2_000),
            updaterLogs: "updater line\n".repeat(2_000),
          },
          settings: {
            selectedModel: {
              provider: "\u754c".repeat(500),
              name: "\u754c".repeat(500),
            },
            selectedChatMode: "build",
            autoApproveChanges: true,
            enableDyadPro: true,
            runtimeMode2: "local-node",
            releaseChannel: "stable",
          } as unknown as UserSettings,
          selectedModel: {
            provider: "\u754c".repeat(500),
            name: "\u754c".repeat(500),
            effortLevel: "medium",
          } as unknown as ModelSelection,
          userBudget,
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
      }),
    });

    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });
});

describe("issue URL budget", () => {
  // GitHub answers 500 past ~6,860 characters and 414 past ~8,500, so the
  // worst case the form can produce has to stay under the ceiling by
  // construction -- nothing downstream truncates.
  //
  // The fixture is a realistic body, not a minimal one: settings: null
  // collapses the whole Settings block to a single line and a short node path
  // or model name hides another hundred characters.
  const worstCaseDebugInfo: SystemDebugInfo = {
    ...debugInfo,
    nodePath:
      "C:\\Users\\\u0410\u043b\u0435\u043a\u0441\u0430\u043d\u0434\u0440\\AppData\\Local\\dyad\\resources\\node\\node.exe",
    selectedLanguageModel:
      "openrouter:anthropic/claude-sonnet-4-5-20250929-extended-thinking",
    logs: "[2026-08-29 14:22:07.318] [info] (chat_stream) chunk len=512\n".repeat(
      200,
    ),
    updaterLogs:
      "[2026-08-29 14:20:01.002] [info] (updater) checking for update\n".repeat(
        100,
      ),
  };

  const worstCaseDiagnostics = {
    debugInfo: worstCaseDebugInfo,
    settings: {
      selectedModel: {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4-5-20250929-extended-thinking",
      },
      selectedChatMode: "local-agent-with-extended-tools",
      autoApproveChanges: true,
      enableDyadPro: true,
      runtimeMode2: "local-node-with-sandbox",
      releaseChannel: "beta",
    } as unknown as UserSettings,
    selectedModel: {
      provider: "openrouter",
      name: "anthropic/claude-sonnet-4-5-20250929-extended-thinking",
      effortLevel: "maximum",
    } as unknown as ModelSelection,
    userBudget,
  };

  it.each([
    ["ASCII", "d"],
    ["CJK", "\u754c"],
    ["Cyrillic", "\u0449"],
    ["emoji", "\ud83d\ude42"],
    ["pasted JSON", '{"k": "v"},\n'],
  ])("keeps a maxed-out %s report under the ceiling", (_name, unit) => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", unit.repeat(4_000)).value,
        screenshot: {
          // A reason is whatever the OS threw, so the budget has to hold at
          // the clamp rather than at the messages we happen to ship.
          status: "capture-failed",
          reason: "\u754c".repeat(SCREENSHOT_REASON_LIMIT),
        },
        diagnostics: worstCaseDiagnostics,
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it.each([
    ["ASCII", "[2026-08-29 14:22:07.318] [info] chunk len=512\n"],
    ["CJK path", "[info] \u8bfb\u53d6 /Users/\u5f00\u53d1/app/src/index.ts\n"],
    ["JSON-ish", '{"level":"error","msg":"boom"}\n'],
  ])("keeps a %s log tail under the ceiling", (_name, line) => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: {
          ...worstCaseDiagnostics,
          debugInfo: {
            ...worstCaseDebugInfo,
            logs: line.repeat(500),
            updaterLogs: line.repeat(200),
          },
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  // One oversized field at a time: a field added later without a cap shows up
  // here rather than as a GitHub 500 on a reporter's machine. All of them at
  // once is not a state any machine can be in.
  const absurd = "\u754c".repeat(400);
  it.each([
    ["dyadVersion", { dyadVersion: absurd }],
    ["platform", { platform: absurd }],
    ["architecture", { architecture: absurd }],
    ["nodeVersion", { nodeVersion: absurd }],
    ["pnpmVersion", { pnpmVersion: absurd }],
    ["nodePath", { nodePath: absurd }],
    ["telemetryId", { telemetryId: absurd }],
    ["selectedLanguageModel", { selectedLanguageModel: absurd }],
  ])("keeps an oversized %s under the ceiling", (_name, override) => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: {
          ...worstCaseDiagnostics,
          debugInfo: { ...worstCaseDebugInfo, ...override },
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it.each([
    ["chat mode", { selectedChatMode: absurd }],
    ["runtime mode", { runtimeMode2: absurd }],
    ["release channel", { releaseChannel: absurd }],
  ])("keeps an oversized %s under the ceiling", (_name, override) => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: {
          ...worstCaseDiagnostics,
          settings: {
            ...worstCaseDiagnostics.settings,
            ...override,
          } as unknown as UserSettings,
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it.each([["effort level", { effortLevel: absurd }]])(
    "keeps an oversized %s under the ceiling",
    (_name, override) => {
      const url = buildIssueUrl({
        title: ISSUE_TITLE,
        labels: ["bug", "pro"],
        body: buildIssueBody({
          description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
          screenshot: { status: "captured" },
          diagnostics: {
            ...worstCaseDiagnostics,
            selectedModel: {
              ...worstCaseDiagnostics.selectedModel,
              ...override,
            } as unknown as ModelSelection,
          },
          sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
          redactedUserId: "user-abc",
        }),
      });
      expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
    },
  );

  it("keeps an oversized diagnostics pro user id under the ceiling", () => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: {
          ...worstCaseDiagnostics,
          userBudget: { redactedUserId: absurd } as UserBudgetInfo,
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it.each([
    ["session id", { sessionId: absurd }],
    ["pro user id", { redactedUserId: absurd }],
  ])("keeps an oversized %s under the ceiling", (_name, override) => {
    const url = buildIssueUrl({
      title: ISSUE_TITLE,
      labels: ["bug", "pro"],
      body: buildIssueBody({
        description: applyDescriptionEdit("", "d".repeat(PROSE_BUDGET)).value,
        screenshot: { status: "captured" },
        diagnostics: worstCaseDiagnostics,
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        redactedUserId: "user-abc",
        ...override,
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it("holds the updater section to its own encoded budget", () => {
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: {
        ...diagnostics,
        debugInfo: { ...debugInfo, updaterLogs: "\u754c".repeat(3_000) },
      },
      sessionId: null,
    });
    const section = body.slice(body.indexOf("## Auto-Updater Logs"));
    expect(encoded(section)).toBeLessThan(800);
  });

  it("keeps the end of the log, where the failure is", () => {
    const body = buildIssueBody({
      description: "it crashed",
      screenshot: { status: "declined" },
      diagnostics: {
        ...diagnostics,
        debugInfo: {
          ...debugInfo,
          logs: "old\n".repeat(2_000) + "THE-LAST-LINE",
        },
      },
      sessionId: null,
    });
    expect(body).toContain("THE-LAST-LINE");
  });
});
