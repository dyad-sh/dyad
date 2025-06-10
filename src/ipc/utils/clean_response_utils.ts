import * as path from "path";

export function cleanResponse(text: string): string {
  return cleanDyadPaths(cleanThinkingByEscapingDyadTags(text));
}

function cleanDyadPaths(text: string): string {
  // The regex finds dyad-write tags and captures the tag name and its attributes.
  return text.replace(/<(dyad-write)([^>]*)>/g, (_match, tagName, attrs) => {
    // Within the attributes, find the path attribute, and lowercase the directory part of its value.
    // This handles both single and double quotes.
    const newAttrs = attrs.replace(
      /path=(["'])(.*?)\1/,
      (_pathAttrMatch: string, quote: string, pathValue: string) => {
        if (!pathValue) {
          return `path=${quote}${quote}`;
        }

        const hasTrailingSlash =
          pathValue.endsWith("/") || pathValue.endsWith("\\");
        if (hasTrailingSlash) {
          return `path=${quote}${pathValue.toLowerCase()}${quote}`;
        }

        const p = pathValue.includes("\\") ? path.win32 : path.posix;
        const dirname = p.dirname(pathValue);
        const filename = p.basename(pathValue);

        if (dirname === "." && !pathValue.includes(p.sep)) {
          // This is just a filename. Preserve case.
          return `path=${quote}${pathValue}${quote}`;
        }

        const newPath = p.join(dirname.toLowerCase(), filename);

        return `path=${quote}${newPath}${quote}`;
      },
    );
    return `<${tagName}${newAttrs}>`;
  });
}

function cleanThinkingByEscapingDyadTags(text: string): string {
  // Extract content inside <think> </think> tags
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;

  return text.replace(thinkRegex, (match, content) => {
    // We are replacing the opening tag with a look-alike character
    // to avoid issues where thinking content includes dyad tags
    // and are mishandled by:
    // 1. FE markdown parser
    // 2. Main process response processor
    const processedContent = content
      .replace(/<dyad/g, "＜dyad")
      .replace(/<\/dyad/g, "＜/dyad");

    // Return the modified think tag with processed content
    return `<think>${processedContent}</think>`;
  });
}
