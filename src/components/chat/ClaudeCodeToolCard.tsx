// Cards for Claude Code's own (native) tools. The native harness produces
// them; the first seven kinds also keep chats saved by the retired prototype
// (commit 171069cc4) readable.
import { useTranslation } from "react-i18next";
import { claudeToolCardSchema } from "@/shared/claude_tool_cards";
import { DyadRead } from "./DyadRead";
import { DyadListFiles } from "./DyadListFiles";
import { DyadWrite } from "./DyadWrite";
import { DyadSearchReplace } from "./DyadSearchReplace";
import { DyadLogs } from "./DyadLogs";
import { DyadAddDependency } from "./DyadAddDependency";
import { DyadStatus } from "./DyadStatus";

/** Keep card titles to one readable line; the full text is in the body. */
function oneLine(value: string | undefined, max = 120): string {
  const line = (value ?? "").split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

// This tag contains escaped JSON display data. Never send its fields through
// the markdown/action parser, even if file contents contain Dyad tags.
export function ClaudeCodeToolCard({ content }: { content: string }) {
  const { t } = useTranslation("chat");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = claudeToolCardSchema.safeParse(value);
  if (!parsed.success) return null;
  const card = parsed.data;
  const node = { properties: { ...card, description: card.summary } };
  const running = card.state === "pending";
  const status = (title: string, details: (string | undefined)[]) => (
    <DyadStatus node={{ properties: { title, state: card.state } }}>
      {details.filter(Boolean).join("\n\n")}
    </DyadStatus>
  );
  switch (card.kind) {
    case "read":
      return (
        <DyadRead node={node}>
          {card.state === "error" ? card.summary : undefined}
        </DyadRead>
      );
    case "list":
      return (
        <DyadListFiles node={{ properties: { ...card, directory: card.path } }}>
          {card.body}
        </DyadListFiles>
      );
    case "write":
      return (
        <DyadWrite node={node} allowEdit={false}>
          {card.body}
        </DyadWrite>
      );
    case "edit":
      return (
        <DyadSearchReplace
          node={node}
          blocks={card.blocks?.filter(
            (b) => b.searchContent || b.replaceContent,
          )}
        />
      );
    case "logs":
      return <DyadLogs node={node}>{card.body}</DyadLogs>;
    case "packages":
      return (
        <DyadAddDependency node={node} execution>
          {card.body}
        </DyadAddDependency>
      );
    case "status":
      if (card.tool === "compact_boundary")
        return status(t("claudeNativeTool.compacted"), []);
      if (card.tool === "steer")
        return status(
          `${t("claudeNativeTool.steered")} — ${oneLine(card.body, 80)}`,
          [card.body],
        );
      return (
        <DyadStatus node={node}>
          {[card.summary, card.body].filter(Boolean).join("\n")}
        </DyadStatus>
      );
    case "shell": {
      const command = oneLine(card.summary || card.subject);
      return status(
        running
          ? t("claudeNativeTool.runningCommand", { command })
          : t("claudeNativeTool.ranCommand", { command }),
        [card.subject ? `$ ${card.subject}` : undefined, card.body],
      );
    }
    case "search": {
      const pattern = oneLine(card.subject);
      return status(
        running
          ? t("claudeNativeTool.searching", { pattern })
          : t("claudeNativeTool.searched", { pattern }),
        [card.path, card.body],
      );
    }
    case "web": {
      const query = oneLine(card.subject);
      return status(
        running
          ? t("claudeNativeTool.searchingWeb", { query })
          : t("claudeNativeTool.searchedWeb", { query }),
        [card.body],
      );
    }
    case "task": {
      const task = oneLine(card.subject);
      return status(
        running
          ? t("claudeNativeTool.runningSubagent", { task })
          : t("claudeNativeTool.ranSubagent", { task }),
        [
          card.steps?.length
            ? `${t("claudeNativeTool.steps")}\n${card.steps.map((s) => `- ${s}`).join("\n")}`
            : undefined,
          card.body,
        ],
      );
    }
    case "tool": {
      const tool = oneLine(card.title || card.tool);
      return status(
        running
          ? t("claudeNativeTool.usingTool", { tool })
          : t("claudeNativeTool.usedTool", { tool }),
        [card.subject, card.body],
      );
    }
  }
}
