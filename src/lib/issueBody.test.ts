import { describe, expect, it } from "vitest";
import {
  EMPTY_FIELD_RESERVE,
  EMPTY_REPORT_FIELDS,
  ISSUE_URL_CEILING,
  PROSE_BUDGET,
  TITLE_BUDGET,
  applyFieldEdit,
  applyTitleEdit,
  buildBugReportBody,
  buildBugReportFallbackBody,
  buildIssueUrl,
  buildSessionReportBody,
  buildSessionReportFallbackBody,
  formatDiagnosticsSections,
  formatIssueTitle,
  formatScreenshotStatusLine,
  proseLength,
  proseRemaining,
  type ReportFields,
} from "./issueBody";
import { type SystemDebugInfo } from "@/ipc/types";
import { type ModelSelection, type UserSettings } from "@/lib/schemas";
import { type UserBudgetInfo } from "@/ipc/types/system";

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

const common = {
  debugInfo,
  settings: null,
  selectedModel: null,
  userBudget,
  fields: EMPTY_REPORT_FIELDS,
};

describe("formatScreenshotStatusLine", () => {
  it("uses a stable prefix so published issues can be counted", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "Screenshot status: captured",
    );
    expect(formatScreenshotStatusLine({ status: "declined" })).toBe(
      "Screenshot status: declined",
    );
    expect(formatScreenshotStatusLine({ status: "capture-failed" })).toBe(
      "Screenshot status: capture-failed",
    );
  });

  it("tells a maintainer to ask for a screenshot the reporter already has", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "ask them to paste it",
    );
  });

  it("caps the failure reason, the one body input the reporter never sees", () => {
    const line = formatScreenshotStatusLine({
      status: "capture-failed",
      reason: "\u754c".repeat(500),
    });
    expect(new URLSearchParams({ v: line }).toString().length - 2).toBeLessThan(
      400,
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
});

describe("buildBugReportBody", () => {
  it("records the screenshot status under the screenshot section", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "captured" },
    });
    expect(body).toContain(
      "## Screenshot (recommended)\n<!-- Screenshot of the bug -->\nScreenshot status: captured",
    );
  });

  it.each(["captured", "declined", "capture-failed"] as const)(
    "records %s",
    (status) => {
      const body = buildBugReportBody({ ...common, screenshot: { status } });
      expect(body).toContain(`Screenshot status: ${status}`);
    },
  );

  it("keeps the existing report sections", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "declined" },
    });
    expect(body).toContain("## Bug Description (required)");
    expect(body).toContain("## System Information");
    expect(body).toContain("- Dyad Version: 1.2.3");
    expect(body).toContain("## Settings");
    expect(body).toContain("## Logs");
  });
});

describe("buildSessionReportBody", () => {
  it("records the screenshot status", () => {
    const body = buildSessionReportBody({
      ...common,
      sessionId: "v2:abc",
      screenshot: { status: "captured" },
    });
    expect(body).toContain("Screenshot status: captured");
  });

  it("keeps the session ID that makes the report actionable", () => {
    const body = buildSessionReportBody({
      ...common,
      sessionId: "v2:abc",
      screenshot: { status: "declined" },
    });
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Session Schema: v2.0");
    expect(body).toContain("Pro User ID: user-abc");
  });
});

describe("buildBugReportFallbackBody", () => {
  it("still carries the screenshot status", () => {
    const body = buildBugReportFallbackBody({
      screenshot: { status: "captured" },
      fields: EMPTY_REPORT_FIELDS,
    });
    expect(body).toContain("Screenshot status: captured");
    expect(body).toContain("## Bug Description (required)");
  });
});

describe("buildSessionReportFallbackBody", () => {
  it("still carries the session ID and screenshot status", () => {
    const body = buildSessionReportFallbackBody({
      userBudget,
      sessionId: "v2:abc",
      screenshot: { status: "capture-failed", reason: "boom" },
      fields: EMPTY_REPORT_FIELDS,
    });
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: capture-failed (boom)");
  });
});

describe("reporter-supplied fields", () => {
  it("puts the description under the heading instead of the template hint", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "declined" },
      fields: { ...EMPTY_REPORT_FIELDS, description: "Preview goes blank." },
    });
    expect(body).toContain(
      "## Bug Description (required)\nPreview goes blank.",
    );
    expect(body).not.toContain("<!-- Please describe the issue");
  });

  it("keeps the template hint when the reporter wrote nothing", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "declined" },
    });
    expect(body).toContain("<!-- Please describe the issue");
  });

  it("carries every session field", () => {
    const body = buildSessionReportBody({
      ...common,
      sessionId: "v2:abc",
      screenshot: { status: "declined" },
      fields: {
        title: "t",
        description: "desc here",
        expected: "expected here",
        actual: "actual here",
      },
    });
    expect(body).toContain("desc here");
    expect(body).toContain("expected here");
    expect(body).toContain("actual here");
  });

  it("keeps the reporter's text in the fallback bodies", () => {
    expect(
      buildBugReportFallbackBody({
        screenshot: { status: "declined" },
        fields: { ...EMPTY_REPORT_FIELDS, description: "still here" },
      }),
    ).toContain("still here");
    expect(
      buildSessionReportFallbackBody({
        userBudget,
        sessionId: "v2:abc",
        screenshot: { status: "declined" },
        fields: { ...EMPTY_REPORT_FIELDS, description: "still here" },
      }),
    ).toContain("still here");
  });
});

describe("formatIssueTitle", () => {
  it("prefixes the reporter's title", () => {
    expect(formatIssueTitle("bug", "Preview blank")).toBe(
      "[bug] Preview blank",
    );
    expect(formatIssueTitle("session", "Bad output")).toBe(
      "[session report] Bad output",
    );
  });

  it("falls back to the placeholder when untitled", () => {
    expect(formatIssueTitle("bug", "   ")).toBe("[bug] <WRITE TITLE HERE>");
    expect(formatIssueTitle("session", "")).toBe(
      "[session report] <add title>",
    );
  });
});

describe("prose budget", () => {
  it("shares one budget across the fields rather than one each", () => {
    const fields: ReportFields = {
      title: "",
      description: "a".repeat(PROSE_BUDGET - 10),
      expected: "",
      actual: "",
    };
    expect(proseRemaining(fields)).toBe(10);
    const edited = applyFieldEdit(fields, "expected", "b".repeat(50), "bug");
    expect(edited.fields.expected).toHaveLength(10);
    expect(edited.hitCap).toBe(true);
    expect(proseRemaining(edited.fields)).toBe(0);
  });

  it("lands what fits from a paste and reports that it clipped", () => {
    const result = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "x".repeat(PROSE_BUDGET + 500),
      "bug",
    );
    expect(result.fields.description).toHaveLength(PROSE_BUDGET);
    expect(result.hitCap).toBe(true);
  });

  it("does not flag an edit that fits", () => {
    const result = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "short",
      "bug",
    );
    expect(result.hitCap).toBe(false);
  });

  it("budgets the title separately from the prose", () => {
    const result = applyTitleEdit(
      EMPTY_REPORT_FIELDS,
      "t".repeat(TITLE_BUDGET + 20),
    );
    expect(result.fields.title).toHaveLength(TITLE_BUDGET);
    expect(result.hitCap).toBe(true);
    expect(proseRemaining(result.fields)).toBe(PROSE_BUDGET);
  });
});

describe("encoded budget", () => {
  // The ceiling is measured on the percent-encoded URL, so the budget has to
  // be too: a CJK character costs 9 encoded characters, an emoji 12, and a
  // newline or quote 3. Counting typed characters would let these through at
  // three to nine times the size.
  it.each([
    ["CJK", "\u754c"],
    ["Cyrillic", "\u0449"],
    ["emoji", "\ud83d\ude42"],
    ["newline", "\n"],
  ])("caps %s prose by encoded size", (_name, unit) => {
    const { fields } = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      unit.repeat(2_000),
      "bug",
    );
    // A whole code point may not fit the last few units, so the remainder is
    // small rather than exactly zero. What must hold is that it fits.
    expect(
      new URLSearchParams({ v: fields.description }).toString().length - 2,
    ).toBeLessThanOrEqual(PROSE_BUDGET);
    // And that there is genuinely no room for one more.
    expect(
      applyFieldEdit(fields, "description", fields.description + unit, "bug")
        .fields.description,
    ).toBe(fields.description);
  });

  // The budget has to run out mid-pair for this to bite. A homogeneous emoji
  // input cannot do it: 2000 is 8 mod 12, outside the 9-11 window where half a
  // pair fits and a whole one does not, so an ASCII prefix sets the offset.
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

  it.each([9, 10, 11])(
    "never splits a surrogate pair with the cap %i characters in",
    (offset) => {
      const { fields } = applyFieldEdit(
        EMPTY_REPORT_FIELDS,
        "description",
        "a".repeat(offset) + "\ud83d\ude42".repeat(300),
        "bug",
      );

      expect(fields.description).not.toMatch(LONE_SURROGATE);
      expect(
        Array.from(fields.description.slice(offset)).every(
          (c) => c === "\ud83d\ude42",
        ),
      ).toBe(true);
    },
  );

  it("never splits a surrogate pair when an edit lands mid-pair", () => {
    const full = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(9) + "\ud83d\ude42".repeat(300),
      "bug",
    ).fields;
    // Inserted, not swapped: the value has to exceed the budget or applyEdit
    // returns early and splitEdit never runs. This pins the end-to-end
    // property -- no half a pair reaches the field -- rather than splitEdit's
    // own code-point stepping, which is defensive: head and tail are slices of
    // one string and rejoin into whole pairs, and the clamp inside never cuts
    // mid-pair, so a UTF-16 split there produces the same output.
    const spliced =
      full.description.slice(0, 13) +
      "\ud83d\ude43" +
      full.description.slice(13);

    const result = applyFieldEdit(full, "description", spliced, "bug");

    expect(result.fields.description).not.toMatch(LONE_SURROGATE);
    expect(
      new URLSearchParams({ v: result.fields.description }).toString().length -
        2,
    ).toBeLessThanOrEqual(PROSE_BUDGET);
  });

  it("trims the insertion, not the far end of a full field", () => {
    const full = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(PROSE_BUDGET),
      "bug",
    ).fields;
    const spliced = "a".repeat(10) + "X" + "a".repeat(PROSE_BUDGET - 10);

    const result = applyFieldEdit(full, "description", spliced, "bug");

    // There is no room, so nothing lands -- but the text the reporter already
    // had is untouched rather than losing a character off the far end.
    expect(result.fields.description).toBe(full.description);
    expect(result.hitCap).toBe(true);
  });

  it("lands what fits from a paste into the middle of a part-full field", () => {
    const start = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(PROSE_BUDGET - 100),
      "bug",
    ).fields;
    const head = "a".repeat(50);
    const tail = "a".repeat(PROSE_BUDGET - 150);
    const pasted = "P".repeat(400);

    const result = applyFieldEdit(
      start,
      "description",
      head + pasted + tail,
      "bug",
    );

    // The 100 units of room are filled from the pasted run, and every
    // character that was already there survives.
    expect(result.fields.description).toBe(head + "P".repeat(100) + tail);
    expect(result.fields.description).toHaveLength(PROSE_BUDGET);
    expect(result.hitCap).toBe(true);
  });

  it("keeps existing text when a paste replaces a selection", () => {
    const start = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "keep-me " + "b".repeat(PROSE_BUDGET - 200),
      "bug",
    ).fields;
    const result = applyFieldEdit(
      start,
      "description",
      start.description + "\u754c".repeat(200),
      "bug",
    );

    expect(result.fields.description.startsWith("keep-me ")).toBe(true);
    expect(
      new URLSearchParams({ v: result.fields.description }).toString().length -
        2,
    ).toBeLessThanOrEqual(PROSE_BUDGET);
  });

  it("still allows deleting from a full field", () => {
    const full = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(PROSE_BUDGET),
      "bug",
    ).fields;
    const result = applyFieldEdit(
      full,
      "description",
      "a".repeat(PROSE_BUDGET - 5),
      "bug",
    );
    expect(result.fields.description).toHaveLength(PROSE_BUDGET - 5);
    expect(result.hitCap).toBe(false);
  });
});

describe("session form reserve", () => {
  // The session form requires expected and actual. Without a reserve, one
  // field can take the whole shared budget and leave the others untypeable,
  // and the gate then demands text the reporter cannot enter.
  it("keeps room for the fields a filled description would starve", () => {
    const filled = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(PROSE_BUDGET * 2),
      "session",
    ).fields;

    for (const field of ["expected", "actual"] as const) {
      const typed = applyFieldEdit(filled, field, "it should work", "session");
      expect(typed.fields[field]).toBe("it should work");
    }
  });

  it("gives the bug form the whole budget, since it shows one prose field", () => {
    const filled = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "a".repeat(PROSE_BUDGET * 2),
      "bug",
    ).fields;
    expect(proseRemaining(filled)).toBe(0);
    expect(filled.description).toHaveLength(PROSE_BUDGET);
  });

  it("releases only the part of a reserve a field has already spent", () => {
    let fields = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "expected",
      "e".repeat(EMPTY_FIELD_RESERVE),
      "session",
    ).fields;
    fields = applyFieldEdit(
      fields,
      "actual",
      "a".repeat(EMPTY_FIELD_RESERVE),
      "session",
    ).fields;
    fields = applyFieldEdit(
      fields,
      "description",
      "d".repeat(PROSE_BUDGET),
      "session",
    ).fields;

    // Both other fields are at their reserve, so nothing is held back.
    expect(proseRemaining(fields)).toBe(0);
  });

  it("keeps a field fillable after it is cleared to be reworded", () => {
    // The reserve has to survive edit order: filling a field releases its
    // reserve to the others, and clearing it again must not leave it with
    // less room than one CJK character.
    let fields = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "d".repeat(PROSE_BUDGET * 2),
      "session",
    ).fields;
    fields = applyFieldEdit(fields, "expected", "ok", "session").fields;
    fields = applyFieldEdit(
      fields,
      "actual",
      "a".repeat(PROSE_BUDGET),
      "session",
    ).fields;

    fields = { ...fields, expected: "" };

    const reworded = applyFieldEdit(
      fields,
      "expected",
      "\u754c".repeat(20),
      "session",
    );
    expect((reworded.fields.expected ?? "").length).toBeGreaterThan(0);
    expect(proseLength(reworded.fields)).toBeLessThanOrEqual(PROSE_BUDGET);
  });

  it("guarantees every rendered field can reach the reserve, in any order", () => {
    const orders: (readonly ("description" | "expected" | "actual")[])[] = [
      ["description", "expected", "actual"],
      ["actual", "description", "expected"],
      ["expected", "actual", "description"],
    ];
    for (const order of orders) {
      let fields = EMPTY_REPORT_FIELDS;
      for (const field of order) {
        fields = applyFieldEdit(
          fields,
          field,
          "z".repeat(PROSE_BUDGET * 2),
          "session",
        ).fields;
      }
      for (const field of order) {
        expect((fields[field] ?? "").length).toBeGreaterThanOrEqual(
          EMPTY_FIELD_RESERVE,
        );
      }
      expect(proseLength(fields)).toBeLessThanOrEqual(PROSE_BUDGET);
    }
  });

  it("never lets the reserve push the total over the budget", () => {
    let fields = applyFieldEdit(
      EMPTY_REPORT_FIELDS,
      "description",
      "d".repeat(PROSE_BUDGET * 2),
      "session",
    ).fields;
    fields = applyFieldEdit(
      fields,
      "expected",
      "e".repeat(PROSE_BUDGET),
      "session",
    ).fields;
    fields = applyFieldEdit(
      fields,
      "actual",
      "a".repeat(PROSE_BUDGET),
      "session",
    ).fields;
    expect(proseLength(fields)).toBeLessThanOrEqual(PROSE_BUDGET);
  });
});

describe("updater log section", () => {
  // formatUpdaterLogsForIssueBody leaves the important text at a different end
  // depending on which branch it takes, so each branch is pinned separately.
  // Getting this wrong is invisible in a size assertion: the URL still fits,
  // it just no longer says what went wrong.
  const squirrelTail = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `2026-08-30 12:${String(i).padStart(2, "0")}:00 [info] checking for update ${i}\r\n`,
    ).join("");

  function updaterSectionOf(updaterLogs: string): string {
    const body = buildBugReportBody({
      ...common,
      debugInfo: { ...debugInfo, updaterLogs },
      screenshot: { status: "declined" },
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

  it("keeps the error section when it is appended after the Squirrel tail", () => {
    // The assembled branch: a short error section lands at the very end,
    // after the truncated marker and the Squirrel tail.
    const section = updaterSectionOf(
      "Last updater error (this session):\n" +
        "ERR_CONNECTION_REFUSED at https://update.dyad.sh\n" +
        "\n\nSquirrelSetup.log (tail):\n" +
        squirrelTail(40),
    );

    expect(section).toContain("Last updater error (this session):");
    expect(section).toContain("ERR_CONNECTION_REFUSED");
  });

  it("keeps the error identity when the section overflows only once encoded", () => {
    // The assembled branch is gated on the error section's RAW length, while
    // the clamp is measured in encoded characters. A CRLF- and paren-heavy
    // .NET error lands in the window between the two, where tail-clamping
    // would eat the header and the exception type off the front.
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

  it("keeps the most recent lines when there is no error section at all", () => {
    // The common case: Squirrel logs with no in-session updater error. The
    // newest line is the one that matters.
    const section = updaterSectionOf(
      squirrelTail(40) +
        "2026-08-30 13:00:00 [error] Update failed: EPERM cannot rename app-0.9.1\r\n",
    );

    expect(section).toContain("EPERM cannot rename app-0.9.1");
  });
});

describe("formatDiagnosticsSections", () => {
  // The disclosure and the body render this same string, so a field added to
  // the report cannot go missing from the preview.
  it("carries every diagnostic the body sends", () => {
    const preview = formatDiagnosticsSections({
      debugInfo,
      settings: null,
      selectedModel: null,
      userBudget,
    });
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "declined" },
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
      debugInfo: noisy,
      settings: null,
      selectedModel: null,
      userBudget,
    });
    const body = buildBugReportBody({
      ...common,
      debugInfo: noisy,
      screenshot: { status: "declined" },
    });
    expect(body).toContain(preview);
  });
});

describe("log budgets", () => {
  // Logs were the last budget still cut by raw character count, which is the
  // worst content to measure that way: newlines, braces, quotes and colons
  // cost 3 encoded characters each, and a non-ASCII path costs 9.
  it.each([
    ["ASCII", "[info] chat_stream chunk len=512\n"],
    ["CJK path", "[info] \u8bfb\u53d6 /Users/\u5f00\u53d1/app/src/index.ts\n"],
    ["JSON-ish", '{"level":"error","msg":"boom"}\n'],
  ])("keeps a %s log tail under the ceiling", (_name, line) => {
    const url = buildIssueUrl({
      title: formatIssueTitle("bug", "t".repeat(TITLE_BUDGET)),
      labels: ["bug", "pro"],
      body: buildBugReportBody({
        ...common,
        debugInfo: {
          ...debugInfo,
          logs: line.repeat(500),
          updaterLogs: line.repeat(200),
        },
        screenshot: { status: "captured" },
        fields: applyFieldEdit(
          EMPTY_REPORT_FIELDS,
          "description",
          "d".repeat(PROSE_BUDGET),
          "bug",
        ).fields,
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it("holds the updater section to its own encoded budget", () => {
    // formatUpdaterLogsForIssueBody caps its output in RAW characters, so a
    // dense non-ASCII tail leaves it nine times over the encoded budget. This
    // pins the clamp itself: without it the section is unbounded in the unit
    // the ceiling is measured in.
    const body = buildBugReportBody({
      ...common,
      debugInfo: { ...debugInfo, updaterLogs: "\u754c".repeat(3_000) },
      screenshot: { status: "declined" },
    });
    const section = body.slice(body.indexOf("## Auto-Updater Logs"));

    expect(
      new URLSearchParams({ v: section }).toString().length - 2,
    ).toBeLessThan(800);
  });

  it("keeps a dense non-ASCII updater log under the ceiling", () => {
    // The other ceiling cases use log lines that are only ~10% non-ASCII, so
    // the raw cap alone keeps them under and they cannot see the clamp go.
    const url = buildIssueUrl({
      title: formatIssueTitle("bug", "t".repeat(TITLE_BUDGET)),
      labels: ["bug", "pro"],
      body: buildBugReportBody({
        ...common,
        debugInfo: {
          ...debugInfo,
          logs: "\u754c".repeat(3_000),
          updaterLogs: "\u754c".repeat(3_000),
        },
        screenshot: { status: "captured" },
        fields: applyFieldEdit(
          EMPTY_REPORT_FIELDS,
          "description",
          "d".repeat(PROSE_BUDGET),
          "bug",
        ).fields,
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it("keeps the end of the log, where the failure is", () => {
    const body = buildBugReportBody({
      ...common,
      debugInfo: {
        ...debugInfo,
        logs: "old\n".repeat(2_000) + "THE-LAST-LINE",
      },
      screenshot: { status: "declined" },
    });
    expect(body).toContain("THE-LAST-LINE");
  });
});

describe("issue URL budget", () => {
  // GitHub answers 500 past ~6,860 characters and 414 past ~8,500, so the
  // worst case the form can produce has to stay under the ceiling by
  // construction -- nothing downstream truncates.
  //
  // The fixture has to be a realistic body, not a minimal one. `settings: null`
  // collapses the whole Settings block to a single line and a short nodePath
  // or model name hides another hundred characters, which together understate
  // a real report by roughly 250 -- on a margin of a few hundred.
  const worstCaseDebugInfo: SystemDebugInfo = {
    ...debugInfo,
    // A Windows path under a Cyrillic user name: 9 encoded characters each.
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

  const worstCaseSettings = {
    selectedModel: {
      provider: "openrouter",
      name: "anthropic/claude-sonnet-4-5-20250929-extended-thinking",
    },
    selectedChatMode: "local-agent-with-extended-tools",
    autoApproveChanges: true,
    enableDyadPro: true,
    runtimeMode2: "local-node-with-sandbox",
    releaseChannel: "beta",
  } as unknown as UserSettings;

  const worstCaseModel = {
    provider: "openrouter",
    name: "anthropic/claude-sonnet-4-5-20250929-extended-thinking",
    effortLevel: "maximum",
  } as unknown as ModelSelection;

  /** Everything the report carries except the reporter's own prose. */
  const worstCaseCommon = {
    ...common,
    debugInfo: worstCaseDebugInfo,
    settings: worstCaseSettings,
    selectedModel: worstCaseModel,
  };
  /** Filled through applyFieldEdit, which is the only way prose gets in. */
  function maxedFields(unit: string): ReportFields {
    const titled = applyTitleEdit(EMPTY_REPORT_FIELDS, unit.repeat(400)).fields;
    return applyFieldEdit(titled, "description", unit.repeat(4_000), "bug")
      .fields;
  }

  const worstCaseFields = maxedFields("d");

  it.each([
    ["ASCII", "d"],
    ["CJK", "\u754c"],
    ["Cyrillic", "\u0449"],
    ["emoji", "\ud83d\ude42"],
    ["pasted JSON", '{"k": "v"},\n'],
  ])("keeps a maxed-out %s bug report under the ceiling", (_name, unit) => {
    const fields = maxedFields(unit);
    const url = buildIssueUrl({
      title: formatIssueTitle("bug", fields.title),
      labels: ["bug", "pro"],
      body: buildBugReportBody({
        ...worstCaseCommon,
        // The longest screenshot status line: a failure carries its reason.
        screenshot: {
          status: "capture-failed",
          reason: "No focused window to capture (window is minimised)",
        },
        fields,
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it("keeps a maxed-out bug report under the ceiling", () => {
    const url = buildIssueUrl({
      title: formatIssueTitle("bug", worstCaseFields.title),
      labels: ["bug", "pro"],
      body: buildBugReportBody({
        ...worstCaseCommon,
        screenshot: { status: "captured" },
        fields: worstCaseFields,
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });

  it("keeps a maxed-out session report under the ceiling", () => {
    const url = buildIssueUrl({
      title: formatIssueTitle("session", worstCaseFields.title),
      labels: ["support", "pro"],
      body: buildSessionReportBody({
        ...worstCaseCommon,
        screenshot: {
          status: "capture-failed",
          reason: "No focused window to capture (window is minimised)",
        },
        sessionId: "v2:0199c3f1-2a5b-7c8d-9e0f-1a2b3c4d5e6f",
        fields: {
          title: worstCaseFields.title,
          description: "d".repeat(PROSE_BUDGET - 400),
          expected: "e".repeat(200),
          actual: "a".repeat(200),
        },
      }),
    });
    expect(url.length).toBeLessThan(ISSUE_URL_CEILING);
  });
});
