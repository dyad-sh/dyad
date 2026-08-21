import { describe, expect, it } from "vitest";

import {
  exactDiscoveredTitleGrep,
  parsePreviewTestDiscovery,
} from "./playwright_discovery";

describe("parsePreviewTestDiscovery", () => {
  // Shape copied from real `playwright test --list --reporter=json` output:
  // every serialized suite carries `file`, describe blocks included, so nesting
  // depth is what separates the file suite from a describe.
  it("inherits files, keeps describe titles, and detects declared skips", () => {
    const result = parsePreviewTestDiscovery(
      {
        suites: [
          {
            title: "e2e-tests/auth.spec.ts",
            file: "/apps/demo/e2e-tests/auth.spec.ts",
            specs: [
              {
                title: "signs in",
                line: 4,
                tests: [{ expectedStatus: "passed" }],
              },
            ],
            suites: [
              {
                title: "account",
                file: "/apps/demo/e2e-tests/auth.spec.ts",
                specs: [
                  {
                    title: "signs out",
                    line: 12,
                    tests: [{ expectedStatus: "skipped" }],
                  },
                ],
                suites: [
                  {
                    title: "settings",
                    file: "/apps/demo/e2e-tests/auth.spec.ts",
                    specs: [
                      {
                        title: "renames",
                        line: 20,
                        tests: [{ expectedStatus: "passed" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      "/apps/demo",
    );

    expect(result).toEqual({
      errors: [],
      tests: [
        {
          file: "e2e-tests/auth.spec.ts",
          line: 4,
          title: "signs in",
          fullTitle: "signs in",
          skipped: false,
        },
        {
          file: "e2e-tests/auth.spec.ts",
          line: 12,
          title: "signs out",
          fullTitle: "account signs out",
          skipped: true,
        },
        {
          file: "e2e-tests/auth.spec.ts",
          line: 20,
          title: "renames",
          fullTitle: "account settings renames",
          skipped: false,
        },
      ],
    });
  });

  it("returns report-level discovery errors", () => {
    expect(
      parsePreviewTestDiscovery(
        { errors: [{ message: "duplicate test title" }, {}] },
        "/apps/demo",
      ).errors,
    ).toEqual(["duplicate test title"]);
  });
});

describe("exactDiscoveredTitleGrep", () => {
  it("escapes titles and permits only runner-owned prefixes", () => {
    const grep = new RegExp(
      exactDiscoveredTitleGrep(
        "e2e-tests/nested/editor.spec.ts",
        "account saves (draft)",
      ),
    );

    expect(
      grep.test("chromium nested/editor.spec.ts account saves (draft)"),
    ).toBe(true);
    expect(grep.test("nested/editor.spec.ts account saves (draft)")).toBe(true);
    expect(
      grep.test("e2e-tests/nested/editor.spec.ts account saves (draft)"),
    ).toBe(false);
    expect(grep.test("other.spec.ts account saves (draft)")).toBe(false);
    expect(grep.test("account saves draft")).toBe(false);
    expect(grep.test("account saves (draft) later")).toBe(false);
  });
});
