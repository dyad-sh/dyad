import { getLanguage } from "@/utils/get_language";

const CUSTOM_TAG_NAMES = [
  "dyad-write",
  "dyad-rename",
  "dyad-delete",
  "dyad-add-dependency",
  "dyad-execute-sql",
  "dyad-add-integration",
  "dyad-output",
  "dyad-problem-report",
  "dyad-chat-summary",
  "dyad-edit",
  "dyad-codebase-context",
  "think",
  "dyad-command",
] as const;

type SupportedTag = (typeof CUSTOM_TAG_NAMES)[number];

type ContentPiece =
  | {
      type: "markdown";
      content: string;
    }
  | {
      type: "customTag";
      tagInfo: {
        tag: SupportedTag;
        attributes: Record<string, string>;
        content: string;
      };
    };

type CustomTagInfo = Extract<ContentPiece, { type: "customTag" }>["tagInfo"];

export function formatDyadContentToMarkdown(content: string): string {
  if (!content) return "";

  const contentPieces = parseCustomTags(content);

  let result = "";

  contentPieces.forEach((piece) => {
    if (piece.type === "markdown") {
      result += piece.content;
      return;
    }

    result += convertCustomTagToMarkdown(piece.tagInfo);
  });

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function formatDyadContentForEditing(content: string): string {
  return formatDyadContent(content, "plain").replace(/\n{3,}/g, "\n\n").trim();
}

function formatDyadContent(content: string, codeStyle: "fenced" | "plain"): string {
  if (!content) return "";

  const contentPieces = parseCustomTags(content);

  let result = "";

  contentPieces.forEach((piece) => {
    if (piece.type === "markdown") {
      result += piece.content;
      return;
    }

    result += convertCustomTagToText(piece.tagInfo, codeStyle);
  });

  return result;
}

function convertCustomTagToMarkdown(
  tagInfo: CustomTagInfo,
): string {
  return convertCustomTagToText(tagInfo, "fenced");
}

function convertCustomTagToText(
  tagInfo: CustomTagInfo,
  codeStyle: "fenced" | "plain",
): string {
  const { tag, attributes, content } = tagInfo;
  const blockContent = trimFenceContent(content);

  switch (tag) {
    case "think":
      return `### Thinking\n\n${content}\n\n`;

    case "dyad-write": {
      const writePath = attributes.path || "file";
      const writeDescription = attributes.description || "";
      const language = getLanguage(writePath);

      let result =
        codeStyle === "plain"
          ? `Create or Update: ${writePath}\n\n`
          : `### Create or Update \`${writePath}\`\n\n`;
      if (writeDescription && writeDescription !== writePath) {
        result += `${writeDescription}\n\n`;
      }
      result +=
        codeStyle === "plain"
          ? `\n\n`
          : `\`\`\`${language}\n${blockContent}\n\`\`\`\n\n`;
      return result;
    }

    case "dyad-edit": {
      const editPath = attributes.path || "file";
      const editDescription = attributes.description || "";
      const language = getLanguage(editPath);

      let result =
        codeStyle === "plain"
          ? `Edit: ${editPath}\n\n`
          : `### Edit \`${editPath}\`\n\n`;
      if (editDescription && editDescription !== editPath) {
        result += `${editDescription}\n\n`;
      }
      result +=
        codeStyle === "plain"
          ? `\n\n`
          : `\`\`\`${language}\n${blockContent}\n\`\`\`\n\n`;
      return result;
    }

    case "dyad-rename":
      return `### Rename\n\n\`${attributes.from || ""}\` -> \`${attributes.to || ""}\`\n\n`;

    case "dyad-delete":
      return `### Delete\n\n\`${attributes.path || ""}\`\n\n`;

    case "dyad-add-dependency": {
      const packages = attributes.packages || "";
      return `### Install Dependencies\n\n\`\`\`bash\nnpm install ${packages}\n\`\`\`\n\n`;
    }

    case "dyad-execute-sql": {
      const sqlDescription = attributes.description || "";
      let result = "### Execute SQL\n\n";
      if (sqlDescription) {
        result += `${sqlDescription}\n\n`;
      }
      result +=
        codeStyle === "plain"
          ? `${blockContent}\n\n`
          : `\`\`\`sql\n${blockContent}\n\`\`\`\n\n`;
      return result;
    }

    case "dyad-add-integration":
      return "### Add Database Integration\n\n";

    case "dyad-codebase-context": {
      const files = attributes.files || "";
      let result = "### Codebase Context\n\n";
      if (files) {
        result += `Files: ${files}\n\n`;
      }
      result +=
        codeStyle === "plain"
          ? `${blockContent}\n\n`
          : `\`\`\`\n${blockContent}\n\`\`\`\n\n`;
      return result;
    }

    case "dyad-output": {
      const outputType = attributes.type || "info";
      const message = attributes.message || "";

      let result = `**${outputType.toUpperCase()}**`;
      if (message) {
        result += `: ${message}`;
      }
      if (content) {
        result += `\n\n${content}`;
      }
      return `${result}\n\n`;
    }

    case "dyad-problem-report": {
      const summary = attributes.summary || "";
      let result = "### Problem Report\n\n";
      if (summary) {
        result += `**Summary:** ${summary}\n\n`;
      }
      if (content) {
        result += content;
      }
      return `${result}\n\n`;
    }

    case "dyad-chat-summary":
    case "dyad-command":
      return "";
    default:
      return "";
  }
}

function parseCustomTags(content: string): ContentPiece[] {
  const { processedContent } = preprocessUnclosedTags(content);

  const tagPattern = new RegExp(
    `<(${CUSTOM_TAG_NAMES.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
    "gs",
  );

  const contentPieces: ContentPiece[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(processedContent)) !== null) {
    const [fullMatch, rawTag, attributesStr, tagContent] = match;
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      contentPieces.push({
        type: "markdown",
        content: processedContent.substring(lastIndex, startIndex),
      });
    }

    const attributes = parseAttributes(attributesStr || "");

    contentPieces.push({
      type: "customTag",
      tagInfo: {
        tag: rawTag as SupportedTag,
        attributes,
        content: tagContent || "",
      },
    });

    lastIndex = startIndex + fullMatch.length;
  }

  if (lastIndex < processedContent.length) {
    contentPieces.push({
      type: "markdown",
      content: processedContent.substring(lastIndex),
    });
  }

  return contentPieces;
}

function parseAttributes(attributesStr: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrPattern = /([^\s=]+)="([^"]*)"/g;

  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attributesStr)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function preprocessUnclosedTags(content: string): { processedContent: string } {
  let processedContent = content;

  CUSTOM_TAG_NAMES.forEach((tag) => {
    const openTags = [...processedContent.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))];
    const closeTags = [
      ...processedContent.matchAll(new RegExp(`</${tag}>`, "g")),
    ];

    if (openTags.length > closeTags.length && openTags.length > 0) {
      processedContent = `${processedContent}</${tag}>`;
    }
  });

  return { processedContent };
}

function trimFenceContent(content: string): string {
  return content.replace(/^\n+|\n+$/g, "");
}
