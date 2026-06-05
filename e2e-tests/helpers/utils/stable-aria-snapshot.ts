const GENERATED_AI_RULES_PROMPT =
  '- paragraph: "[[AI_RULES_GENERATION_PROMPT]]"';

function isMoreIndented(line: string, baseIndent: number) {
  if (!line.trim()) {
    return true;
  }
  const indent = line.match(/^ */)?.[0].length ?? 0;
  return indent > baseIndent;
}

function normalizeTextLine(line: string) {
  const indent = line.match(/^ */)?.[0] ?? "";
  const trimmed = line.trim();

  if (
    trimmed.startsWith("- paragraph: ") &&
    trimmed.includes("Generate an AI_RULES") &&
    trimmed.includes("Describe the tech stack")
  ) {
    return `${indent}${GENERATED_AI_RULES_PROMPT}`;
  }

  const versionMatch = trimmed.match(/Version (\d+):/);
  if (
    versionMatch &&
    (/files changed/.test(trimmed) || /wrote \d+ file\(s\)/.test(trimmed))
  ) {
    return `${indent}- text: "[[Version ${versionMatch[1]}: files changed]]"`;
  }

  return line;
}

function parseButtonLine(
  line: string,
): { indent: string; name: string; quoteKey: boolean } | undefined {
  const quotedMatch = line.match(/^(\s*)- 'button "(.+)"':\s*$/);
  if (quotedMatch) {
    return { indent: quotedMatch[1], name: quotedMatch[2], quoteKey: true };
  }

  const match = line.match(/^(\s*)- button "([^"]+)"(?::\s*)?$/);
  if (match) {
    return { indent: match[1], name: match[2], quoteKey: false };
  }
}

function formatButtonLine({
  indent,
  name,
  quoteKey,
}: {
  indent: string;
  name: string;
  quoteKey: boolean;
}) {
  name = name.replace(/\b\d+ms\b/g, "[[duration]]");

  if (quoteKey || name.includes(":")) {
    return `${indent}- 'button "${name.replace(/'/g, "''")}"'`;
  }
  return `${indent}- button "${name}"`;
}

function shouldDropLine(line: string) {
  const trimmed = line.trim();

  if (trimmed === "- img") {
    return true;
  }

  return (
    trimmed === "- text: Approved" ||
    /^- text: (?:(?:less than a minute|\d+ (?:second|minute|hour|day|week|month|year)s?) ago)$/.test(
      trimmed,
    ) ||
    /^- text: (test-model|gpt-[\w.-]+|claude-[\w.-]+|o\d[\w.-]*|gemini-[\w.-]+|llama[\w.-]*|qwen[\w.-]*|deepseek[\w.-]*)$/.test(
      trimmed,
    ) ||
    trimmed === "- text: Request ID" ||
    trimmed === "- text: Undo" ||
    trimmed === "- text: Retry" ||
    trimmed === '- text: ""'
  );
}

/**
 * Normalizes broad chat message ARIA snapshots to focus on message semantics
 * instead of accessibility-tree representation details for repeated controls.
 */
export function normalizeMessagesAriaSnapshot(rawSnapshot: string) {
  const lines = rawSnapshot.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeTextLine(lines[i]);
    const button = parseButtonLine(line);

    if (button) {
      normalizedLines.push(formatButtonLine(button));
      const baseIndent = button.indent.length;
      while (i + 1 < lines.length && isMoreIndented(lines[i + 1], baseIndent)) {
        i++;
      }
      continue;
    }

    if (shouldDropLine(line)) {
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n").replace(/\n+$/g, "") + "\n";
}
