/**
 * Utility for prettifying server dump data for snapshot comparisons.
 */

import {
  BUILD_SYSTEM_POSTFIX,
  BUILD_SYSTEM_PREFIX,
} from "@/prompts/system_prompt";

export interface PrettifyDumpOptions {
  onlyLastMessage?: boolean;
}

/**
 * Prettifies a dump of messages for snapshot comparison.
 * Normalizes line endings, removes flaky content like package.json,
 * and formats the output for readability.
 */
export function prettifyDump(
  allMessages: {
    role: string;
    content: string | Array<{}>;
  }[],
  { onlyLastMessage = false }: PrettifyDumpOptions = {},
): string {
  const messages = onlyLastMessage ? allMessages.slice(-1) : allMessages;

  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? JSON.stringify(message.content)
        : message.content
            .replace(BUILD_SYSTEM_PREFIX, "\n${BUILD_SYSTEM_PREFIX}")
            .replace(BUILD_SYSTEM_POSTFIX, "${BUILD_SYSTEM_POSTFIX}")
            // Normalize line endings to always use \n
            .replace(/\r\n/g, "\n")
            // We remove package.json because it's flaky.
            // Depending on whether pnpm install is run, it will be modified,
            // and the contents and timestamp (thus affecting order) will be affected.
            .replace(
              /\n<coney-file path="package\.json">[\s\S]*?<\/coney-file>\n/g,
              "",
            );
      return `===\nrole: ${message.role}\nmessage: ${content}`;
    })
    .join("\n\n");
}
