import { normalizePath } from "../../../shared/normalizePath";
import log from "electron-log";
import { SqlQuery } from "../../lib/schemas";

const logger = log.scope("joy_tag_parser");

export function getJoyWriteTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const joyWriteRegex = /<joy-write([^>]*)>([\s\S]*?)<\/joy-write>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = joyWriteRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    let content = match[2].trim();

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = pathMatch[1];
      const description = descriptionMatch?.[1];

      const contentLines = content.split("\n");
      if (contentLines[0]?.startsWith("```")) {
        contentLines.shift();
      }
      if (contentLines[contentLines.length - 1]?.startsWith("```")) {
        contentLines.pop();
      }
      content = contentLines.join("\n");

      tags.push({ path: normalizePath(path), content, description });
    } else {
      logger.warn(
        "Found <joy-write> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}

export function getJoyRenameTags(fullResponse: string): {
  from: string;
  to: string;
}[] {
  const joyRenameRegex =
    /<joy-rename from="([^"]+)" to="([^"]+)"[^>]*>([\s\S]*?)<\/joy-rename>/g;
  let match;
  const tags: { from: string; to: string }[] = [];
  while ((match = joyRenameRegex.exec(fullResponse)) !== null) {
    tags.push({
      from: normalizePath(match[1]),
      to: normalizePath(match[2]),
    });
  }
  return tags;
}

export function getJoyDeleteTags(fullResponse: string): string[] {
  const joyDeleteRegex =
    /<joy-delete path="([^"]+)"[^>]*>([\s\S]*?)<\/joy-delete>/g;
  let match;
  const paths: string[] = [];
  while ((match = joyDeleteRegex.exec(fullResponse)) !== null) {
    paths.push(normalizePath(match[1]));
  }
  return paths;
}

export function getJoyAddDependencyTags(fullResponse: string): string[] {
  const joyAddDependencyRegex =
    /<joy-add-dependency packages="([^"]+)">[^<]*<\/joy-add-dependency>/g;
  let match;
  const packages: string[] = [];
  while ((match = joyAddDependencyRegex.exec(fullResponse)) !== null) {
    packages.push(...match[1].split(" "));
  }
  return packages;
}

export function getJoyChatSummaryTag(fullResponse: string): string | null {
  const joyChatSummaryRegex =
    /<joy-chat-summary>([\s\S]*?)<\/joy-chat-summary>/g;
  const match = joyChatSummaryRegex.exec(fullResponse);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

export function getJoyExecuteSqlTags(fullResponse: string): SqlQuery[] {
  const joyExecuteSqlRegex =
    /<joy-execute-sql([^>]*)>([\s\S]*?)<\/joy-execute-sql>/g;
  const descriptionRegex = /description="([^"]+)"/;
  let match;
  const queries: { content: string; description?: string }[] = [];

  while ((match = joyExecuteSqlRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = match[2].trim();
    const descriptionMatch = descriptionRegex.exec(attributesString);
    const description = descriptionMatch?.[1];

    // Handle markdown code blocks if present
    const contentLines = content.split("\n");
    if (contentLines[0]?.startsWith("```")) {
      contentLines.shift();
    }
    if (contentLines[contentLines.length - 1]?.startsWith("```")) {
      contentLines.pop();
    }
    content = contentLines.join("\n");

    queries.push({ content, description });
  }

  return queries;
}

export function getJoyCommandTags(fullResponse: string): string[] {
  const joyCommandRegex =
    /<joy-command type="([^"]+)"[^>]*><\/joy-command>/g;
  let match;
  const commands: string[] = [];

  while ((match = joyCommandRegex.exec(fullResponse)) !== null) {
    commands.push(match[1]);
  }

  return commands;
}

export function getJoySearchReplaceTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const joySearchReplaceRegex =
    /<joy-search-replace([^>]*)>([\s\S]*?)<\/joy-search-replace>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = joySearchReplaceRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = match[2].trim();

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = pathMatch[1];
      const description = descriptionMatch?.[1];

      // Handle markdown code fences if present
      const contentLines = content.split("\n");
      if (contentLines[0]?.startsWith("```")) {
        contentLines.shift();
      }
      if (contentLines[contentLines.length - 1]?.startsWith("```")) {
        contentLines.pop();
      }
      content = contentLines.join("\n");

      tags.push({ path: normalizePath(path), content, description });
    } else {
      logger.warn(
        "Found <joy-search-replace> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}
