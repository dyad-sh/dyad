import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { chats, messages, type WorkspaceValidationCheck } from "@/db/schema";
import { execGit } from "@/ipc/utils/git_utils";

const MAX_TARGET_COMMITS = 20;
const MAX_REQUEST_CHARS = 1_200;
const MAX_FILE_DIFF_CHARS = 4_000;
const MAX_TOTAL_DIFF_CHARS = 20_000;

/** Marks prompts Dyad writes into a chat to resume integration work. */
export const WORKSPACE_REPAIR_PROMPT_PREFIX =
  "[Dyad] Combine this chat's work with the latest changes";

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…(truncated)` : text;
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execGit(args, cwd);
  return result.exitCode === 0 ? result.stdout : "";
}

/** The chat's recent user requests, newest last, excluding Dyad prompts. */
async function recentUserRequests(
  chatId: number,
  limit = 3,
): Promise<string[]> {
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, "user")))
    .orderBy(desc(messages.id))
    .limit(limit + 3);
  return rows
    .map((row) => row.content.trim())
    .filter(
      (content) =>
        content.length > 0 &&
        !content.startsWith(WORKSPACE_REPAIR_PROMPT_PREFIX),
    )
    .slice(0, limit)
    .reverse()
    .map((content) => truncate(content, MAX_REQUEST_CHARS));
}

/**
 * Requests from other chats whose turns produced the target-side commits, so
 * the agent can preserve what those tasks intended, not only their code.
 */
async function otherChatIntents(
  chatId: number,
  targetCommits: readonly string[],
): Promise<string[]> {
  if (targetCommits.length === 0) return [];
  const producers = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      title: chats.title,
    })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(inArray(messages.commitHash, [...targetCommits]));
  const intents: string[] = [];
  const seenChats = new Set<number>();
  for (const producer of producers) {
    if (producer.chatId === chatId || seenChats.has(producer.chatId)) continue;
    seenChats.add(producer.chatId);
    const request = await db
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, producer.chatId),
          eq(messages.role, "user"),
          lt(messages.id, producer.id),
        ),
      )
      .orderBy(desc(messages.id))
      .limit(1)
      .get();
    if (!request) continue;
    intents.push(
      `- Chat "${producer.title ?? `#${producer.chatId}`}" asked: ${truncate(
        request.content.trim().replaceAll("\n", " "),
        MAX_REQUEST_CHARS,
      )}`,
    );
  }
  return intents;
}

export interface RepairPromptInput {
  chatId: number;
  workspaceAppPath: string;
  workspaceBranch: string;
  targetBranch: string;
  conflictedFiles: readonly string[];
  attempt: number;
  validationFailures?: readonly WorkspaceValidationCheck[] | null;
}

export async function buildWorkspaceRepairPrompt(
  input: RepairPromptInput,
): Promise<string> {
  const { workspaceAppPath: cwd } = input;
  const mergeBase = (await git(["merge-base", "HEAD", "MERGE_HEAD"], cwd))
    .trim()
    .split("\n")[0];
  const range = mergeBase ? `${mergeBase}..MERGE_HEAD` : "MERGE_HEAD";
  const targetLog = await git(
    [
      "log",
      `--max-count=${MAX_TARGET_COMMITS}`,
      "--format=%H%x09%s",
      range,
      "--",
    ],
    cwd,
  );
  const targetCommits = targetLog
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });
  const diffStat = mergeBase
    ? await git(["diff", "--stat", mergeBase, "MERGE_HEAD", "--"], cwd)
    : "";

  let remainingDiffBudget = MAX_TOTAL_DIFF_CHARS;
  const fileSections: string[] = [];
  for (const file of input.conflictedFiles) {
    if (!mergeBase || remainingDiffBudget <= 0) break;
    const ours = await git(["diff", mergeBase, "HEAD", "--", file], cwd);
    const theirs = await git(
      ["diff", mergeBase, "MERGE_HEAD", "--", file],
      cwd,
    );
    const section = [
      `### ${file}`,
      "This chat's change:",
      "```diff",
      truncate(ours.trim() || "(no change)", MAX_FILE_DIFF_CHARS),
      "```",
      `Change already on ${input.targetBranch}:`,
      "```diff",
      truncate(theirs.trim() || "(no change)", MAX_FILE_DIFF_CHARS),
      "```",
    ].join("\n");
    fileSections.push(section);
    remainingDiffBudget -= section.length;
  }

  const ownRequests = await recentUserRequests(input.chatId);
  const intents = await otherChatIntents(
    input.chatId,
    targetCommits.map(({ hash }) => hash),
  );
  const failedChecks = (input.validationFailures ?? []).filter(
    (check) => check.outcome === "failed",
  );

  return [
    `${WORKSPACE_REPAIR_PROMPT_PREFIX} on \`${input.targetBranch}\`.`,
    "",
    `Your work in this chat lives on branch \`${input.workspaceBranch}\`. While you were working, other changes landed on \`${input.targetBranch}\`. Dyad started merging \`${input.targetBranch}\` into this chat's workspace and these files conflict:`,
    "",
    ...input.conflictedFiles.map((file) => `- ${file}`),
    "",
    "## What this chat was asked to do",
    ...(ownRequests.length > 0
      ? ownRequests.map((request) => `- ${request.replaceAll("\n", " ")}`)
      : ["- (No earlier request found.)"]),
    "",
    `## What changed on ${input.targetBranch}`,
    ...(intents.length > 0 ? intents : []),
    ...targetCommits.map(
      ({ hash, subject }) => `- ${hash.slice(0, 10)} ${subject}`,
    ),
    ...(diffStat.trim() ? ["", "```", diffStat.trim(), "```"] : []),
    "",
    "## Conflicting changes",
    ...fileSections,
    ...(failedChecks.length > 0
      ? [
          "",
          "## Checks that failed on the combined code",
          ...failedChecks.map(
            (check) =>
              `- ${check.name}: ${check.summary}${check.output ? `\n\`\`\`\n${check.output}\n\`\`\`` : ""}`,
          ),
        ]
      : []),
    "",
    "## How to resolve",
    "- Read each conflicted file and edit it in place so it keeps the intended behavior of BOTH this chat's task and the changes already on the target branch. Remove every conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`).",
    "- Re-read any other files you depend on before editing them; they may have changed.",
    "- Do not commit, abort the merge, or run other Git commands that change history. Dyad verifies the files, completes the merge, and checks the combined code after you finish.",
    "- If the two tasks' requirements genuinely contradict each other, do not guess: explain the conflict and ask the user which behavior they want, then stop.",
    ...(input.attempt > 1
      ? [
          "",
          `This is automatic attempt ${input.attempt}. The previous attempt left conflicts unresolved.`,
        ]
      : []),
  ].join("\n");
}
