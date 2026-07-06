import { describe, expect, it } from "vitest";

import { normalizeRequestSnapshotDetails } from "./normalization";

describe("normalizeRequestSnapshotDetails", () => {
  it("masks request model configuration and tool wording", () => {
    const dump = {
      body: {
        model: "anthropic/claude-opus-4-5",
        thinking: {
          type: "adaptive",
          display: "summarized",
        },
        reasoning: {
          effort: "medium",
        },
        reasoning_effort: "medium",
        output_config: {
          effort: "medium",
        },
        tools: [
          {
            name: "write_file",
            description: "Create or overwrite a file",
            input_schema: {
              type: "object",
              description: "Tool schema wording",
              properties: {
                path: {
                  type: "string",
                  description: "Path wording",
                },
              },
              required: ["path"],
            },
          },
          {
            name: "list_files",
            description: "List files",
            parameters: {
              type: "object",
              properties: {
                glob: {
                  type: "string",
                  description: "Glob wording",
                },
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_replace",
              description: "Detailed instructions",
              parameters: {
                type: "object",
                properties: {
                  old_string: {
                    type: "string",
                    description: "Old wording",
                  },
                },
                required: ["old_string"],
              },
            },
          },
        ],
      },
    };

    normalizeRequestSnapshotDetails(dump);

    expect(dump).toEqual({
      body: {
        model: "[[MODEL]]",
        thinking: "[[THINKING_CONFIG]]",
        reasoning: "[[REASONING_CONFIG]]",
        reasoning_effort: "[[REASONING_CONFIG]]",
        output_config: "[[OUTPUT_CONFIG]]",
        tools: [
          {
            name: "write_file",
            description: "[[TOOL_DESC:write_file]]",
            input_schema: expect.stringMatching(
              /^\[\[TOOL_SCHEMA:[a-f0-9]{12}\]\]$/,
            ),
          },
          {
            name: "list_files",
            description: "[[TOOL_DESC:list_files]]",
            parameters: expect.stringMatching(
              /^\[\[TOOL_SCHEMA:[a-f0-9]{12}\]\]$/,
            ),
          },
          {
            type: "function",
            function: {
              name: "search_replace",
              description: "[[TOOL_DESC:search_replace]]",
              parameters: expect.stringMatching(
                /^\[\[TOOL_SCHEMA:[a-f0-9]{12}\]\]$/,
              ),
            },
          },
        ],
      },
    });
  });

  it("keeps schema hashes stable for wording changes and different for shape changes", () => {
    const dumpWithOriginalWording = {
      body: {
        tools: [
          {
            name: "write_file",
            description: "Original wording",
            input_schema: {
              type: "object",
              description: "Original schema wording",
              properties: {
                path: {
                  type: "string",
                  description: "Original path wording",
                },
              },
              required: ["path"],
            },
          },
        ],
      },
    };
    const dumpWithNewWording = {
      body: {
        tools: [
          {
            name: "write_file",
            description: "New wording",
            input_schema: {
              type: "object",
              description: "New schema wording",
              properties: {
                path: {
                  type: "string",
                  description: "New path wording",
                },
              },
              required: ["path"],
            },
          },
        ],
      },
    };
    const dumpWithNewShape = {
      body: {
        tools: [
          {
            name: "write_file",
            description: "Original wording",
            input_schema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
                content: {
                  type: "string",
                },
              },
              required: ["path", "content"],
            },
          },
        ],
      },
    };

    normalizeRequestSnapshotDetails(dumpWithOriginalWording);
    normalizeRequestSnapshotDetails(dumpWithNewWording);
    normalizeRequestSnapshotDetails(dumpWithNewShape);

    expect(dumpWithNewWording.body.tools[0].input_schema).toBe(
      dumpWithOriginalWording.body.tools[0].input_schema,
    );
    expect(dumpWithNewShape.body.tools[0].input_schema).not.toBe(
      dumpWithOriginalWording.body.tools[0].input_schema,
    );
  });

  it("is idempotent", () => {
    const dump = {
      body: {
        model: "gpt-5.2",
        tools: [
          {
            name: "write_file",
            description: "Create or overwrite a file",
            input_schema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
              },
            },
          },
        ],
      },
    };

    normalizeRequestSnapshotDetails(dump);
    const once = JSON.stringify(dump);
    normalizeRequestSnapshotDetails(dump);

    expect(JSON.stringify(dump)).toBe(once);
  });
});
