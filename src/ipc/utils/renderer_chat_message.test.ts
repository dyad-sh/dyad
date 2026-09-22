import { buildCompactionBlock } from "@/ipc/handlers/compaction/compaction_utils";
import { expect, it } from "vitest";
import {
  toRendererMessage,
  toRendererMessages,
  rendererMessageColumns,
  type RendererMessageRow,
} from "./renderer_chat_message";

it("projects the submission identity so history can precede acceptance", () => {
  expect(rendererMessageColumns.chatTurnIntentId).toBe(true);
  const row = {
    id: 10,
    role: "user",
    content: "hello",
    chatTurnIntentId: "intent-1",
  } as RendererMessageRow;
  expect(toRendererMessage(row)).toMatchObject({
    id: 10,
    chatTurnIntentId: "intent-1",
  });
});

it.each(["", "Repeated summary"])(
  "scopes identical %j summaries to their own turn",
  (text) => {
    const block = buildCompactionBlock(text);
    const firstUser = row({ id: 1, role: "user" });
    const firstReply = row({ id: 2, content: `First turn\n${block}` });
    const firstSummary = row({
      id: 3,
      content: block,
      isCompactionSummary: true,
      createdAt: new Date(2000),
    });
    const nextUser = row({ id: 4, role: "user", createdAt: new Date(5000) });
    const nextReply = row({
      id: 5,
      content: "Later turn",
      createdAt: new Date(5000),
    });
    const nextSummary = row({
      id: 6,
      content: block,
      isCompactionSummary: true,
      createdAt: new Date(4000),
    });
    // Pre-turn summary sorts before its triggering user, but belongs to that user by ID.
    const beforeTurn = [
      firstUser,
      firstReply,
      firstSummary,
      nextSummary,
      nextUser,
      nextReply,
    ];
    expect(toRendererMessages(beforeTurn)).toEqual(
      [firstUser, firstReply, nextSummary, nextUser, nextReply].map(
        toRendererMessage,
      ),
    );

    // A later mid-turn summary must also survive if its inline output was lost.
    nextSummary.createdAt = new Date(6000);
    const duringTurn = [
      firstUser,
      firstReply,
      firstSummary,
      nextUser,
      nextReply,
      nextSummary,
    ];
    expect(toRendererMessages(duringTurn)).toEqual(
      [firstUser, firstReply, nextUser, nextReply, nextSummary].map(
        toRendererMessage,
      ),
    );

    nextReply.content = `Later turn\n${block}\nFinal answer`;
    expect(toRendererMessages(duringTurn)).toEqual(
      [firstUser, firstReply, nextUser, nextReply].map(toRendererMessage),
    );
  },
);

it("preserves a summary when its triggering user is absent", () => {
  const reply = row({ content: compaction });
  const summary = row({
    id: 2,
    content: compaction,
    isCompactionSummary: true,
  });
  expect(toRendererMessages([reply, summary])).toEqual(
    [reply, summary].map(toRendererMessage),
  );
});

const compaction = buildCompactionBlock("Summary");
const row = (overrides: Partial<RendererMessageRow>): RendererMessageRow => ({
  id: 1,
  role: "assistant",
  content: "Reply",
  createdAt: new Date(1000),
  isCompactionSummary: null,
  chatTurnIntentId: null,
  approvalState: null,
  sourceCommitHash: null,
  commitHash: null,
  requestId: null,
  maxTokensUsed: null,
  model: null,
  ...overrides,
});

const user = row({ id: 0, role: "user", content: "Task" });

it("hides the duplicate summary while retaining the complete inline reply", () => {
  const reply = row({ content: `Before\n${compaction}\nAfter` });
  const summary = row({
    id: 2,
    content: `${compaction}\n\nBackup instructions`,
    isCompactionSummary: true,
    createdAt: new Date(2000),
  });
  expect(toRendererMessages([user, reply, summary])).toEqual([
    toRendererMessage(user),
    toRendererMessage(reply),
  ]);
  expect(summary.isCompactionSummary).toBe(true);
  expect(toRendererMessages([user, reply, summary])[0]).not.toHaveProperty(
    "isCompactionSummary",
  );
});

it.each<[string, Partial<RendererMessageRow>]>([
  ["missing inline output", { content: "Before compaction" }],
  ["a different summary", { content: compaction.replace("Summary", "Other") }],
  ["a user quoting the summary", { role: "user", content: compaction }],
  ["a later assistant quoting the summary", { id: 3, content: compaction }],
  [
    "a summary placed before the turn",
    { content: compaction, createdAt: new Date(3000) },
  ],
])("preserves a standalone summary with %s", (_, overrides) => {
  const reply = row(overrides);
  const summary = row({
    id: 2,
    content: compaction,
    isCompactionSummary: true,
    createdAt: new Date(2000),
  });
  expect(toRendererMessages([user, reply, summary])).toEqual([
    toRendererMessage(user),
    toRendererMessage(reply),
    toRendererMessage(summary),
  ]);
});
