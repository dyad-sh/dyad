import { describe, expect, it } from "vitest";

import {
  convertLegacyFixtureToLocalAgent,
  extractLocalAgentFixture,
} from "../../testing/fake-llm-server/localAgentHandler";

describe("legacy Build fixture adapter", () => {
  it("converts ordered file and SQL tags into native tool turns", () => {
    const fixture = convertLegacyFixtureToLocalAgent(`Starting
<dyad-write path="src/App.tsx" description="replace app">
export default function App() {}
</dyad-write>
<dyad-rename from="old.ts" to="new.ts"></dyad-rename>
<dyad-execute-sql description="create users">
CREATE TABLE users (id int);
</dyad-execute-sql>
Done`);

    expect(fixture.turns).toEqual([
      {
        text: "Starting",
        toolCalls: [
          {
            name: "write_file",
            args: {
              path: "src/App.tsx",
              content: "export default function App() {}",
              description: "replace app",
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: "rename_file",
            args: { from: "old.ts", to: "new.ts" },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: "execute_sql",
            args: {
              query: "CREATE TABLE users (id int);",
              description: "create users",
            },
          },
        ],
      },
      { text: "Done" },
    ]);
  });

  it("converts search-replace blocks without trimming their match text", () => {
    const fixture =
      convertLegacyFixtureToLocalAgent(`<dyad-search-replace path="src/App.tsx">
<<<<<<< SEARCH
  old text
=======
  new text
>>>>>>> REPLACE
</dyad-search-replace>`);

    expect(fixture.turns).toEqual([
      {
        toolCalls: [
          {
            name: "search_replace",
            args: {
              file_path: "src/App.tsx",
              old_string: "  old text",
              new_string: "  new text",
            },
          },
        ],
      },
    ]);
  });

  it("routes generated fix prompts through native tool fixtures", () => {
    expect(
      extractLocalAgentFixture("Fix error: Error Line 6 error Stack trace"),
    ).toBe("fix-runtime-error");
    expect(
      extractLocalAgentFixture(
        "Fix all of the following errors:\n- First error\n- Second error",
      ),
    ).toBe("fix-all-runtime-errors");
    expect(
      extractLocalAgentFixture(
        "Fix these 2 TypeScript compile-time errors in a concise way.",
      ),
    ).toBe("fix-typescript-errors");
  });
});
