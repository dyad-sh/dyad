import { describe, expect, it } from "vitest";

import { convertLegacyFixtureToLocalAgent } from "../../testing/fake-llm-server/localAgentHandler";

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
});
