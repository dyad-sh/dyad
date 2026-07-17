import { describe, expect, it, vi } from "vitest";
import { designInterfaceTool } from "@/pro/main/ipc/handlers/local_agent/tools/design_interface";
import { proposeDesignOptionsTool } from "@/pro/main/ipc/handlers/local_agent/tools/propose_design_options";
import { writeDesignBriefTool } from "@/pro/main/ipc/handlers/local_agent/tools/write_design_brief";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

/**
 * The <example> in a tool description is the thing the model imitates most
 * closely, so an example that violates the tool's own schema actively teaches
 * broken output — and it fails at generation time, in front of the user, not in
 * CI. (This caught a pill `cornerRadius: 999` against a `.max(200)` schema.)
 */
function extractExample(description: string): unknown {
  const match = description.match(
    /<example>[\s\S]*?(\{[\s\S]*\n\})\s*<\/example>/,
  );
  if (!match) throw new Error("no <example> JSON block found in description");
  return JSON.parse(match[1]);
}

const TOOLS = [
  { name: "design_interface", tool: designInterfaceTool },
  { name: "propose_design_options", tool: proposeDesignOptionsTool },
  { name: "write_design_brief", tool: writeDesignBriefTool },
];

describe("design tool examples", () => {
  it.each(TOOLS)("$name's example is valid JSON", ({ tool }) => {
    expect(() => extractExample(tool.description)).not.toThrow();
  });

  it.each(TOOLS)("$name's example satisfies its own schema", ({ tool }) => {
    const example = extractExample(tool.description);
    const result = tool.inputSchema.safeParse(example);
    expect(
      result.success ? null : JSON.stringify(result.error.issues, null, 2),
    ).toBeNull();
  });
});

describe("design_interface example", () => {
  const example = extractExample(designInterfaceTool.description) as {
    code: string;
    width: number;
    height: number;
  };

  // The drawing contract: code runs as the body of
  // new Function("Konva", "layer", "width", "height", code) and may only add
  // shapes to `layer`. An example that throws is a bug every mockup inherits.
  it("executes against the real drawing contract without throwing", () => {
    const added: unknown[] = [];
    const layer = { add: (shape: unknown) => added.push(shape) };
    // Minimal Konva stand-in: the example only constructs shapes and reads no
    // Konva behavior, so recording constructor calls is enough to prove the
    // code path runs end to end.
    const shape = (type: string) =>
      function (this: Record<string, unknown>, attrs: Record<string, unknown>) {
        Object.assign(this, { type, ...attrs });
      };
    const Konva = {
      Rect: shape("Rect"),
      Text: shape("Text"),
      Circle: shape("Circle"),
      Line: shape("Line"),
      Group: function (this: Record<string, unknown>) {
        this.type = "Group";
        this.add = (s: unknown) => added.push(s);
      },
    };

    const build = new Function(
      "Konva",
      "layer",
      "width",
      "height",
      example.code,
    );
    expect(() =>
      build(Konva, layer, example.width, example.height),
    ).not.toThrow();
    expect(added.length).toBeGreaterThan(0);
  });

  it("only uses fonts from the roster", async () => {
    const { DESIGN_FONTS } = await import("@/ipc/types/design_fonts");
    const used = [
      ...example.code.matchAll(/fontFamily:\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const font of used) {
      expect(DESIGN_FONTS as readonly string[]).toContain(font);
    }
  });
});
