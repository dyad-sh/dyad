import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { ComponentSelection } from "@/ipc/types/chat";
import { readTextFileLines } from "@/ipc/utils/bounded_text_file";
import { safeJoin } from "@/ipc/utils/path_utils";

const LINES_BEFORE_SELECTION = 1;
const LINES_AFTER_SELECTION = 3;
const MAX_SOURCE_LINE_CHARS = 1_500;

function truncateLine(line: string): string {
  if (line.length <= MAX_SOURCE_LINE_CHARS) return line;
  return `${line.slice(0, MAX_SOURCE_LINE_CHARS)}... [truncated]`;
}

function formatComponent(
  component: ComponentSelection,
  sourceLines: string[] | undefined,
  firstSourceLine: number,
): string {
  const metadata = [
    `Component: ${JSON.stringify(component.name)}`,
    `File: ${JSON.stringify(component.relativePath)}`,
    `Selected line: ${component.lineNumber}`,
    "Source excerpt:",
  ];

  if (!sourceLines) {
    return [...metadata, "  [source excerpt unavailable]"].join("\n");
  }

  const excerpt = sourceLines.map((line, index) => {
    const lineNumber = firstSourceLine + index;
    const marker = lineNumber === component.lineNumber ? ">" : " ";
    return `${marker} ${String(lineNumber).padStart(5, " ")} | ${truncateLine(line)}`;
  });

  return [...metadata, ...(excerpt.length ? excerpt : ["  [empty file]"])].join(
    "\n",
  );
}

export async function buildSelectedComponentContext(
  appPath: string,
  components: readonly ComponentSelection[],
): Promise<string> {
  if (components.length === 0) return "";

  const formattedComponents = await Promise.all(
    components.map(async (component) => {
      const filePath = safeJoin(appPath, component.relativePath);
      const firstSourceLine = Math.max(
        1,
        component.lineNumber - LINES_BEFORE_SELECTION,
      );
      try {
        const { content } = await readTextFileLines({
          rootPath: appPath,
          filePath,
          displayPath: component.relativePath,
          startLine: firstSourceLine,
          endLineInclusive: component.lineNumber + LINES_AFTER_SELECTION,
        });
        return formatComponent(
          component,
          content.split(/\r?\n/),
          firstSourceLine,
        );
      } catch (error) {
        if (isDyadError(error) && error.kind === DyadErrorKind.NotFound) {
          return formatComponent(component, undefined, firstSourceLine);
        }
        throw error;
      }
    }),
  );

  return `\n\nSelected components:\n\n${formattedComponents.join("\n\n")}`;
}
