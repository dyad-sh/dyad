import {
  parseFilesFromMessage,
  processChatMessagesWithVersionedFiles,
} from "@/ipc/utils/versioned_codebase_context";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { CodebaseFile } from "@/utils/codebase";
import crypto from "node:crypto";

// Mock git_utils
vi.mock("@/ipc/utils/git_utils", () => ({
  getFileAtCommit: vi.fn(),
}));

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("parseFilesFromMessage", () => {
  describe("dyad-read tags", () => {
    it("should parse a single dyad-read tag", () => {
      const input = '<dyad-read path="src/components/Button.tsx"></dyad-read>';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should parse multiple dyad-read tags", () => {
      const input = `
        <dyad-read path="src/components/Button.tsx"></dyad-read>
        <dyad-read path="src/utils/helpers.ts"></dyad-read>
        <dyad-read path="src/styles/main.css"></dyad-read>
      `;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/utils/helpers.ts",
        "src/styles/main.css",
      ]);
    });

    it("should trim whitespace from file paths in dyad-read tags", () => {
      const input =
        '<dyad-read path="  src/components/Button.tsx  "></dyad-read>';
      const result = parseFilesFromMessage(input);
      expect(result).toEqual(["src/components/Button.tsx"]);
    });

    it("should skip empty path attributes", () => {
      const input = `
        <dyad-read path="src/components/Button.tsx"></dyad-read>
        <dyad-read path=""></dyad-read>
        <dyad-read path="src/utils/helpers.ts"></dyad-read>
      `;
      const result = parseFilesFromMessage(input);
      expect(result).toEqual([
        "src/components/Button.tsx",
        "src/utils/helpers.ts",
      ]);
    });

    it("should handle file paths with special characters", () => {
      const input =
        '<dyad-read path="src/components/@special/Button-v2.tsx"></dyad-read>';
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
<dyad-read path="src/config/app.ts"></dyad-read>

<dyad-code-search-result>
src/components/Button.tsx
src/components/Input.tsx
</dyad-code-search-result>

<dyad-read path="src/utils/helpers.ts"></dyad-read>
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
<dyad-read path="src/components/Button.tsx"></dyad-read>
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

<dyad-read path="src/components/Header.tsx"></dyad-read>

I also searched for related files:

<dyad-code-search-result>
src/components/Header.tsx
src/components/Footer.tsx
src/styles/layout.css
</dyad-code-search-result>

Let me also check the config:

<dyad-read path="src/config/site.ts"></dyad-read>

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
      const input =
        '<dyad-read path="src/components/Generic<T>.tsx"></dyad-read>';
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
      const input = `<dyad-read path="${longPath}"></dyad-read>`;
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

describe("processChatMessagesWithVersionedFiles", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  // Helper to compute SHA-256 hash
  const hashContent = (content: string): string => {
    return crypto.createHash("sha256").update(content).digest("hex");
  };

  describe("basic functionality", () => {
    it("should process files parameter and create fileIdToContent and fileReferences", async () => {
      const files: CodebaseFile[] = [
        {
          path: "src/components/Button.tsx",
          content: "export const Button = () => <button>Click</button>;",
        },
        {
          path: "src/utils/helpers.ts",
          content: "export const add = (a: number, b: number) => a + b;",
        },
      ];

      const chatMessages: ModelMessage[] = [];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      // Check fileIdToContent contains hashed content
      const buttonHash = hashContent(files[0].content);
      const helperHash = hashContent(files[1].content);

      expect(result.fileIdToContent[buttonHash]).toBe(files[0].content);
      expect(result.fileIdToContent[helperHash]).toBe(files[1].content);

      // Check fileReferences
      expect(result.fileReferences).toHaveLength(2);
      expect(result.fileReferences[0]).toEqual({
        path: "src/components/Button.tsx",
        fileId: buttonHash,
      });
      expect(result.fileReferences[1]).toEqual({
        path: "src/utils/helpers.ts",
        fileId: helperHash,
      });

      // messageIndexToFilePathToFileId should be empty
      expect(result.messageIndexToFilePathToFileId).toEqual({});
    });

    it("should handle empty files array", async () => {
      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(result.fileIdToContent).toEqual({});
      expect(result.fileReferences).toEqual([]);
      expect(result.messageIndexToFilePathToFileId).toEqual({});
    });
  });

  describe("processing assistant messages", () => {
    it("should process assistant messages with sourceCommitHash", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const fileContent = "const oldVersion = 'content';";
      mockGetFileAtCommit.mockResolvedValue(fileContent);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content:
            'I found this file: <dyad-read path="src/old.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "abc123",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      // Verify getFileAtCommit was called correctly
      expect(mockGetFileAtCommit).toHaveBeenCalledWith({
        path: appPath,
        filePath: "src/old.ts",
        commitHash: "abc123",
      });

      // Check fileIdToContent
      const fileHash = hashContent(fileContent);
      expect(result.fileIdToContent[fileHash]).toBe(fileContent);

      // Check messageIndexToFilePathToFileId
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({
        "src/old.ts": fileHash,
      });
    });

    it("should process messages with array content type", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const fileContent = "const arrayContent = 'test';";
      mockGetFileAtCommit.mockResolvedValue(fileContent);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: 'Here is the file: <dyad-read path="src/array.ts"></dyad-read>',
            },
            {
              type: "text",
              text: "Additional text",
            },
          ],
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "def456",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalledWith({
        path: appPath,
        filePath: "src/array.ts",
        commitHash: "def456",
      });

      const fileHash = hashContent(fileContent);
      expect(result.fileIdToContent[fileHash]).toBe(fileContent);
      expect(result.messageIndexToFilePathToFileId[0]["src/array.ts"]).toBe(
        fileHash,
      );
    });

    it("should skip user messages", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "user",
          content:
            'Check this: <dyad-read path="src/user-file.ts"></dyad-read>',
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      // getFileAtCommit should not be called for user messages
      expect(mockGetFileAtCommit).not.toHaveBeenCalled();
      expect(result.messageIndexToFilePathToFileId).toEqual({});
    });

    it("should skip assistant messages without sourceCommitHash", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: 'File here: <dyad-read path="src/no-commit.ts"></dyad-read>',
          // No providerOptions
        },
        {
          role: "assistant",
          content:
            'Another file: <dyad-read path="src/no-commit2.ts"></dyad-read>',
          providerOptions: {
            // dyad-engine not set
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).not.toHaveBeenCalled();
      expect(result.messageIndexToFilePathToFileId).toEqual({});
    });

    it("should skip messages with non-text content", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: [],
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "abc123",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).not.toHaveBeenCalled();
      expect(result.messageIndexToFilePathToFileId).toEqual({});
    });
  });

  describe("parsing multiple file paths", () => {
    it("should process multiple files from dyad-code-search-result", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const file1Content = "file1 content";
      const file2Content = "file2 content";

      mockGetFileAtCommit
        .mockResolvedValueOnce(file1Content)
        .mockResolvedValueOnce(file2Content);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: `<dyad-code-search-result>
src/file1.ts
src/file2.ts
</dyad-code-search-result>`,
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalledTimes(2);
      expect(mockGetFileAtCommit).toHaveBeenCalledWith({
        path: appPath,
        filePath: "src/file1.ts",
        commitHash: "commit1",
      });
      expect(mockGetFileAtCommit).toHaveBeenCalledWith({
        path: appPath,
        filePath: "src/file2.ts",
        commitHash: "commit1",
      });

      const file1Hash = hashContent(file1Content);
      const file2Hash = hashContent(file2Content);

      expect(result.fileIdToContent[file1Hash]).toBe(file1Content);
      expect(result.fileIdToContent[file2Hash]).toBe(file2Content);

      expect(result.messageIndexToFilePathToFileId[0]).toEqual({
        "src/file1.ts": file1Hash,
        "src/file2.ts": file2Hash,
      });
    });

    it("should process mixed dyad-read and dyad-code-search-result tags", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      mockGetFileAtCommit
        .mockResolvedValueOnce("file1")
        .mockResolvedValueOnce("file2")
        .mockResolvedValueOnce("file3");

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: `
<dyad-read path="src/file1.ts"></dyad-read>

<dyad-code-search-result>
src/file2.ts
src/file3.ts
</dyad-code-search-result>
`,
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "hash1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalledTimes(3);
      expect(Object.keys(result.messageIndexToFilePathToFileId[0])).toEqual([
        "src/file1.ts",
        "src/file2.ts",
        "src/file3.ts",
      ]);
    });
  });

  describe("error handling", () => {
    it("should handle file not found (returns null)", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      // Simulate file not found
      mockGetFileAtCommit.mockResolvedValue(null);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content:
            'Missing file: <dyad-read path="src/missing.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalled();

      // File should not be in results
      expect(result.fileIdToContent).toEqual({});
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({});
    });

    it("should handle getFileAtCommit throwing an error", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      // Simulate error
      mockGetFileAtCommit.mockRejectedValue(new Error("Git error"));

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: 'Error file: <dyad-read path="src/error.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      // Should not throw - errors are caught and logged
      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalled();
      expect(result.fileIdToContent).toEqual({});
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({});
    });

    it("should process some files successfully and skip others that error", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const successContent = "success file";

      mockGetFileAtCommit
        .mockResolvedValueOnce(successContent)
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce(null);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: `<dyad-code-search-result>
src/success.ts
src/error.ts
src/missing.ts
</dyad-code-search-result>`,
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalledTimes(3);

      // Only the successful file should be in results
      const successHash = hashContent(successContent);
      expect(result.fileIdToContent[successHash]).toBe(successContent);
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({
        "src/success.ts": successHash,
      });
    });
  });

  describe("multiple messages", () => {
    it("should process multiple messages with different commits", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const file1AtCommit1 = "file1 at commit1";
      const file1AtCommit2 = "file1 at commit2 - different content";

      mockGetFileAtCommit
        .mockResolvedValueOnce(file1AtCommit1)
        .mockResolvedValueOnce(file1AtCommit2);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "user",
          content: "Show me file1",
        },
        {
          role: "assistant",
          content: 'Here it is: <dyad-read path="src/file1.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
        {
          role: "user",
          content: "Show me it again",
        },
        {
          role: "assistant",
          content:
            'Here it is again: <dyad-read path="src/file1.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit2",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      expect(mockGetFileAtCommit).toHaveBeenCalledTimes(2);
      expect(mockGetFileAtCommit).toHaveBeenNthCalledWith(1, {
        path: appPath,
        filePath: "src/file1.ts",
        commitHash: "commit1",
      });
      expect(mockGetFileAtCommit).toHaveBeenNthCalledWith(2, {
        path: appPath,
        filePath: "src/file1.ts",
        commitHash: "commit2",
      });

      const hash1 = hashContent(file1AtCommit1);
      const hash2 = hashContent(file1AtCommit2);

      // Both versions should be in fileIdToContent
      expect(result.fileIdToContent[hash1]).toBe(file1AtCommit1);
      expect(result.fileIdToContent[hash2]).toBe(file1AtCommit2);

      // Message index 1 (first assistant message)
      expect(result.messageIndexToFilePathToFileId[1]).toEqual({
        "src/file1.ts": hash1,
      });

      // Message index 3 (second assistant message)
      expect(result.messageIndexToFilePathToFileId[3]).toEqual({
        "src/file1.ts": hash2,
      });
    });
  });

  describe("integration with files parameter", () => {
    it("should combine files parameter with versioned files from messages", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const versionedContent = "old version from git";
      mockGetFileAtCommit.mockResolvedValue(versionedContent);

      const files: CodebaseFile[] = [
        {
          path: "src/current.ts",
          content: "current version",
        },
      ];

      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: 'Old version: <dyad-read path="src/old.ts"></dyad-read>',
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "abc123",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      const currentHash = hashContent("current version");
      const oldHash = hashContent(versionedContent);

      // Both should be present
      expect(result.fileIdToContent[currentHash]).toBe("current version");
      expect(result.fileIdToContent[oldHash]).toBe(versionedContent);

      // fileReferences should only include files from the files parameter
      expect(result.fileReferences).toHaveLength(1);
      expect(result.fileReferences[0].path).toBe("src/current.ts");

      // messageIndexToFilePathToFileId should have the versioned file
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({
        "src/old.ts": oldHash,
      });
    });
  });

  describe("content hashing", () => {
    it("should deduplicate identical content with same hash", async () => {
      const { getFileAtCommit } = await import("@/ipc/utils/git_utils");
      const mockGetFileAtCommit = vi.mocked(getFileAtCommit);

      const sameContent = "identical content";

      // Both files have the same content
      mockGetFileAtCommit
        .mockResolvedValueOnce(sameContent)
        .mockResolvedValueOnce(sameContent);

      const files: CodebaseFile[] = [];
      const chatMessages: ModelMessage[] = [
        {
          role: "assistant",
          content: `<dyad-code-search-result>
src/file1.ts
src/file2.ts
</dyad-code-search-result>`,
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: "commit1",
            },
          },
        },
      ];
      const appPath = "/test/app";

      const result = await processChatMessagesWithVersionedFiles({
        files,
        chatMessages,
        appPath,
      });

      const hash = hashContent(sameContent);

      // fileIdToContent should only have one entry for the hash
      expect(Object.keys(result.fileIdToContent)).toHaveLength(1);
      expect(result.fileIdToContent[hash]).toBe(sameContent);

      // Both files should point to the same hash
      expect(result.messageIndexToFilePathToFileId[0]).toEqual({
        "src/file1.ts": hash,
        "src/file2.ts": hash,
      });
    });
  });
});
