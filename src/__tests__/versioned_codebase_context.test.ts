import { parseFilesFromMessage } from "@/ipc/utils/versioned_codebase_context";
import { describe, it, expect } from "vitest";

describe("parseFilesFromMessage", () => {
  describe("dyad-read tags", () => {
    it("should parse a single dyad-read tag with self-closing syntax", () => {
      const input = '<dyad-read path="src/components/Button.tsx" />';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should parse a single dyad-read tag with closing tag syntax", () => {
      const input = '<dyad-read path="src/components/Button.tsx"></dyad-read>';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should parse multiple dyad-read tags", () => {
      const input = `
        <dyad-read path="src/components/Button.tsx" />
        <dyad-read path="src/utils/helpers.ts" />
        <dyad-read path="src/styles/main.css" />
      `;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/utils/helpers.ts",
        "src/styles/main.css",
      ]);
    });

    it("should trim whitespace from file paths in dyad-read tags", () => {
      const input = '<dyad-read path="  src/components/Button.tsx  " />';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should skip empty path attributes", () => {
      const input = `
        <dyad-read path="src/components/Button.tsx" />
        <dyad-read path="" />
        <dyad-read path="src/utils/helpers.ts" />
      `;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should handle file paths with special characters", () => {
      const input =
        '<dyad-read path="src/components/@special/Button-v2.tsx" />';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/@special/Button-v2.tsx"]);
    });
  });

  describe("dyad-code-search-result tags", () => {
    it("should parse a single file from dyad-code-search-result", () => {
      const input = `<dyad-code-search-result>
src/components/Button.tsx
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should parse multiple files from dyad-code-search-result", () => {
      const input = `<dyad-code-search-result>
src/components/Button.tsx
src/components/Input.tsx
src/utils/helpers.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should trim whitespace from each line", () => {
      const input = `<dyad-code-search-result>
  src/components/Button.tsx  
    src/components/Input.tsx    
src/utils/helpers.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should skip empty lines in dyad-code-search-result", () => {
      const input = `<dyad-code-search-result>
src/components/Button.tsx

src/components/Input.tsx


src/utils/helpers.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should skip lines that look like tags (starting with < or >)", () => {
      const input = `<dyad-code-search-result>
src/components/Button.tsx
<some-tag>
src/components/Input.tsx
>some-line
src/utils/helpers.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should handle multiple dyad-code-search-result tags", () => {
      const input = `<dyad-code-search-result>
src/components/Button.tsx
src/components/Input.tsx
</dyad-code-search-result>

Some text in between

<dyad-code-search-result>
src/utils/helpers.ts
src/styles/main.css
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
        "src/styles/main.css",
      ]);
    });
  });

  describe("mixed tags", () => {
    it("should parse both dyad-read and dyad-code-search-result tags", () => {
      const input = `
<dyad-read path="src/config/app.ts" />

<dyad-code-search-result>
src/components/Button.tsx
src/components/Input.tsx
</dyad-code-search-result>

<dyad-read path="src/utils/helpers.ts" />
`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/config/app.ts",
        "src/components/Button.tsx",
        "src/components/Input.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should deduplicate file paths", () => {
      const input = `
<dyad-read path="src/components/Button.tsx" />
<dyad-read path="src/components/Button.tsx"></dyad-read>

<dyad-code-search-result>
src/components/Button.tsx
src/utils/helpers.ts
</dyad-code-search-result>
`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should handle complex real-world example", () => {
      const input = `
Here's what I found:

<dyad-read path="src/components/Header.tsx" />

I also searched for related files:

<dyad-code-search-result>
src/components/Header.tsx
src/components/Footer.tsx
src/styles/layout.css
</dyad-code-search-result>

Let me also check the config:

<dyad-read path="src/config/site.ts" />

And finally:

<dyad-code-search-result>
src/utils/navigation.ts
src/utils/theme.ts
</dyad-code-search-result>
`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
        "src/styles/layout.css",
        "src/config/site.ts",
        "src/utils/navigation.ts",
        "src/utils/theme.ts",
      ]);
    });
  });

  describe("edge cases", () => {
    it("should return empty array for empty string", () => {
      const input = "";
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([]);
    });

    it("should return empty array when no tags present", () => {
      const input = "This is just some regular text without any tags.";
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([]);
    });

    it("should handle malformed tags gracefully", () => {
      const input = `
<dyad-read path="src/file1.ts"
<dyad-code-search-result>
src/file2.ts
`;
      const result = parseFilesFromMessage(input);
      // Should not match unclosed tags
      expect(result).toEqual([]);
    });

    it("should handle nested angle brackets in file paths", () => {
      const input = '<dyad-read path="src/components/Generic<T>.tsx" />';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Generic<T>.tsx"]);
    });

    it("should preserve file path case sensitivity", () => {
      const input = `<dyad-code-search-result>
src/Components/Button.tsx
src/components/button.tsx
SRC/COMPONENTS/BUTTON.TSX
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/Components/Button.tsx",
        "src/components/button.tsx",
        "SRC/COMPONENTS/BUTTON.TSX",
      ]);
    });

    it("should handle very long file paths", () => {
      const longPath =
        "src/very/deeply/nested/directory/structure/with/many/levels/components/Button.tsx";
      const input = `<dyad-read path="${longPath}" />`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([longPath]);
    });

    it("should handle file paths with dots", () => {
      const input = `<dyad-code-search-result>
./src/components/Button.tsx
../utils/helpers.ts
../../config/app.config.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "./src/components/Button.tsx",
        "../utils/helpers.ts",
        "../../config/app.config.ts",
      ]);
    });

    it("should handle absolute paths", () => {
      const input = `<dyad-code-search-result>
/absolute/path/to/file.tsx
/another/absolute/path.ts
</dyad-code-search-result>`;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "/absolute/path/to/file.tsx",
        "/another/absolute/path.ts",
      ]);
    });
  });
});
