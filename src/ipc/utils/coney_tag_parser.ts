import { normalizePath } from "../../../shared/normalizePath";
import { unescapeXmlAttr, unescapeXmlContent } from "../../../shared/xmlEscape";
import log from "electron-log";
import { SqlQuery } from "../../lib/schemas";

const logger = log.scope("coney_tag_parser");

export function getConeyWriteTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const coneyWriteRegex = /<coney-write([^>]*)>([\s\S]*?)<\/coney-write>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = coneyWriteRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    let content = unescapeXmlContent(match[2].trim());

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = unescapeXmlAttr(pathMatch[1]);
      const description = descriptionMatch?.[1]
        ? unescapeXmlAttr(descriptionMatch[1])
        : undefined;

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
        "Found <coney-write> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}

export function getConeyRenameTags(fullResponse: string): {
  from: string;
  to: string;
}[] {
  const coneyRenameRegex =
    /<coney-rename from="([^"]+)" to="([^"]+)"[^>]*>([\s\S]*?)<\/coney-rename>/g;
  let match;
  const tags: { from: string; to: string }[] = [];
  while ((match = coneyRenameRegex.exec(fullResponse)) !== null) {
    tags.push({
      from: normalizePath(unescapeXmlAttr(match[1])),
      to: normalizePath(unescapeXmlAttr(match[2])),
    });
  }
  return tags;
}

export function getConeyDeleteTags(fullResponse: string): string[] {
  const coneyDeleteRegex =
    /<coney-delete path="([^"]+)"[^>]*>([\s\S]*?)<\/coney-delete>/g;
  let match;
  const paths: string[] = [];
  while ((match = coneyDeleteRegex.exec(fullResponse)) !== null) {
    paths.push(normalizePath(unescapeXmlAttr(match[1])));
  }
  return paths;
}

export function getConeyAddDependencyTags(fullResponse: string): string[] {
  const coneyAddDependencyRegex =
    /<coney-add-dependency packages="([^"]+)">[^<]*<\/coney-add-dependency>/g;
  let match;
  const packages: string[] = [];
  while ((match = coneyAddDependencyRegex.exec(fullResponse)) !== null) {
    packages.push(...unescapeXmlAttr(match[1]).split(" "));
  }
  return packages;
}

export function getConeyChatSummaryTag(fullResponse: string): string | null {
  const coneyChatSummaryRegex =
    /<coney-chat-summary>([\s\S]*?)<\/coney-chat-summary>/g;
  const match = coneyChatSummaryRegex.exec(fullResponse);
  if (match && match[1]) {
    return unescapeXmlContent(match[1].trim());
  }
  return null;
}

export function getConeyExecuteSqlTags(fullResponse: string): SqlQuery[] {
  const coneyExecuteSqlRegex =
    /<coney-execute-sql([^>]*)>([\s\S]*?)<\/coney-execute-sql>/g;
  const descriptionRegex = /description="([^"]+)"/;
  let match;
  const queries: { content: string; description?: string }[] = [];

  while ((match = coneyExecuteSqlRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = unescapeXmlContent(match[2].trim());
    const descriptionMatch = descriptionRegex.exec(attributesString);
    const description = descriptionMatch?.[1]
      ? unescapeXmlAttr(descriptionMatch[1])
      : undefined;

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

export function getConeyCommandTags(fullResponse: string): string[] {
  const coneyCommandRegex =
    /<coney-command type="([^"]+)"[^>]*><\/coney-command>/g;
  let match;
  const commands: string[] = [];

  while ((match = coneyCommandRegex.exec(fullResponse)) !== null) {
    commands.push(unescapeXmlAttr(match[1]));
  }

  return commands;
}

export function getConeySearchReplaceTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const coneySearchReplaceRegex =
    /<coney-search-replace([^>]*)>([\s\S]*?)<\/coney-search-replace>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = coneySearchReplaceRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = unescapeXmlContent(match[2].trim());

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = unescapeXmlAttr(pathMatch[1]);
      const description = descriptionMatch?.[1]
        ? unescapeXmlAttr(descriptionMatch[1])
        : undefined;

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
        "Found <coney-search-replace> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}
