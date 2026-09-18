// Read-only compatibility for persisted cards produced by prototype commit
// 171069cc4 (native-tool backend), before 868819db7 migrated to shared Dyad cards.
// No current execution path produces this tag.
import { claudeToolCardSchema } from "@/shared/claude_tool_cards";
import { DyadRead } from "./DyadRead";
import { DyadListFiles } from "./DyadListFiles";
import { DyadWrite } from "./DyadWrite";
import { DyadSearchReplace } from "./DyadSearchReplace";
import { DyadLogs } from "./DyadLogs";
import { DyadAddDependency } from "./DyadAddDependency";
import { DyadStatus } from "./DyadStatus";

// This tag contains escaped JSON display data. Never send its fields through
// the markdown/action parser, even if file contents contain Dyad tags.
export function ClaudeCodeToolCard({ content }: { content: string }) {
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
      return (
        <DyadStatus node={node}>
          {[card.summary, card.body].filter(Boolean).join("\n")}
        </DyadStatus>
      );
  }
}
