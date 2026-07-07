import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, security_fix_chats } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import type { SecurityFinding } from "../types/security";
import { registerSecurityHandlers } from "./security_handlers";

vi.mock("../utils/git_utils", () => ({
  getCurrentCommitHash: vi.fn().mockResolvedValue("fake-commit-hash"),
}));

describe("registerSecurityHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    harness = setupHandlerTestHarness();
    registerSecurityHandlers();
  });

  afterEach(() => {
    harness.dispose();
  });

  function seedApp(name: string): number {
    const result = harness.db.insert(apps).values({ name, path: name }).run();
    return Number(result.lastInsertRowid);
  }

  function seedChat(appId: number, title = "Review chat"): number {
    const result = harness.db.insert(chats).values({ appId, title }).run();
    return Number(result.lastInsertRowid);
  }

  const finding: SecurityFinding = {
    title: "SQL injection",
    level: "high",
    description: "User input reaches a query.",
  };

  it("rejects review chats from a different app before creating a fix chat", async () => {
    const reviewAppId = seedApp("review-app");
    const otherAppId = seedApp("other-app");
    const reviewChatId = seedChat(reviewAppId);

    await expect(
      harness.invokeHandler("get-or-create-security-fix-chat", {
        appId: otherAppId,
        reviewChatId,
        findings: [finding],
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Security review chat not found for this app",
    });

    const otherAppChats = harness.db
      .select()
      .from(chats)
      .where(eq(chats.appId, otherAppId))
      .all();
    expect(otherAppChats).toHaveLength(0);
  });

  it("reuses an existing fix chat for the same review finding", async () => {
    const appId = seedApp("app");
    const reviewChatId = seedChat(appId);

    const first = await harness.invokeHandler<{
      chatId: number;
      created: boolean;
    }>("get-or-create-security-fix-chat", {
      appId,
      reviewChatId,
      findings: [finding],
    });
    const second = await harness.invokeHandler<{
      chatId: number;
      created: boolean;
    }>("get-or-create-security-fix-chat", {
      appId,
      reviewChatId,
      findings: [finding],
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ chatId: first.chatId, created: false });
    expect(harness.db.select().from(security_fix_chats).all()).toHaveLength(1);
  });

  it("does not collide findings that only match when delimiter-joined", async () => {
    const appId = seedApp("app");
    const reviewChatId = seedChat(appId);
    const firstFinding: SecurityFinding = {
      title: "a",
      level: "high",
      description: "b|medium|c",
    };
    const secondFinding: SecurityFinding = {
      title: "a|high|b",
      level: "medium",
      description: "c",
    };

    const first = await harness.invokeHandler<{
      chatId: number;
      created: boolean;
    }>("get-or-create-security-fix-chat", {
      appId,
      reviewChatId,
      findings: [firstFinding],
    });
    const second = await harness.invokeHandler<{
      chatId: number;
      created: boolean;
    }>("get-or-create-security-fix-chat", {
      appId,
      reviewChatId,
      findings: [secondFinding],
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.chatId).not.toBe(first.chatId);
    expect(harness.db.select().from(security_fix_chats).all()).toHaveLength(2);
  });
});
