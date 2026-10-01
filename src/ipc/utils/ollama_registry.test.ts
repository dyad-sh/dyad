import { describe, expect, it } from "vitest";
import { createNdjsonParser, parseOlaRemoteTable } from "./ollama_registry";

describe("parseOlaRemoteTable", () => {
  it("parses official and community rows", () => {
    const output = [
      "MODEL                                    UPDATED      CONTEXT         SIZE      ",
      "mannix/phi3-mini-4k:latest               2024/07/02   4K              2.2GB     ",
      "phi3:14b                                 2024/07/30   128K            7.9GB     ",
      "",
    ].join("\n");

    expect(parseOlaRemoteTable(output)).toEqual([
      {
        name: "mannix/phi3-mini-4k:latest",
        updated: "2024/07/02",
        context: "4K",
        size: "2.2GB",
      },
      {
        name: "phi3:14b",
        updated: "2024/07/30",
        context: "128K",
        size: "7.9GB",
      },
    ]);
  });

  it("maps N/A and blank cells to null without shifting columns", () => {
    const output = [
      "MODEL                     UPDATED      CONTEXT         SIZE      ",
      "someone/model:latest      N/A                          1GB       ",
    ].join("\n");

    expect(parseOlaRemoteTable(output)).toEqual([
      {
        name: "someone/model:latest",
        updated: null,
        context: null,
        size: "1GB",
      },
    ]);
  });

  it("keeps a name that overflows the MODEL column intact", () => {
    const output = [
      "MODEL                     UPDATED      CONTEXT         SIZE      ",
      "qwen3.8:27b-mlx           2026/09/25   256K            18GB      ",
      "qwen3.8-flash-next:125b-mlx 2026/09/05   256K            105GB     ",
    ].join("\n");

    expect(parseOlaRemoteTable(output)).toEqual([
      {
        name: "qwen3.8:27b-mlx",
        updated: "2026/09/25",
        context: "256K",
        size: "18GB",
      },
      {
        name: "qwen3.8-flash-next:125b-mlx",
        updated: "2026/09/05",
        context: "256K",
        size: "105GB",
      },
    ]);
  });

  it("returns an empty list when there is no table", () => {
    expect(parseOlaRemoteTable("")).toEqual([]);
    expect(parseOlaRemoteTable("No models found\n")).toEqual([]);
  });
});

describe("createNdjsonParser", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("keeps partial lines until they are completed", () => {
    const parser = createNdjsonParser();
    expect(parser.push(encode('{"status":"pulling manifest"}\n{"sta'))).toEqual(
      [{ status: "pulling manifest" }],
    );
    expect(parser.push(encode('tus":"success"}\n'))).toEqual([
      { status: "success" },
    ]);
    expect(parser.flush()).toEqual([]);
  });

  it("returns an unterminated final line on flush", () => {
    const parser = createNdjsonParser();
    expect(parser.push(encode('{"error":"boom"}'))).toEqual([]);
    expect(parser.flush()).toEqual([{ error: "boom" }]);
  });
});
