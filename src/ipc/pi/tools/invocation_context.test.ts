// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { AgentContext } from "./dyad/types";
import { createInvocationContext } from "./invocation_context";

describe("createInvocationContext", () => {
  it("isolates invocation callbacks while forwarding turn state", () => {
    const turnContext = {
      frameworkType: "vite",
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      todos: [],
      testRunAttempts: new Map(),
      fileEditTracker: {},
      mutationCount: 0,
    } as unknown as AgentContext;
    const firstXml = vi.fn();
    const secondXml = vi.fn();

    const first = createInvocationContext(turnContext, {
      onXml: firstXml,
      onAppendUserMessage: vi.fn(),
    });
    const second = createInvocationContext(turnContext, {
      onXml: secondXml,
      onAppendUserMessage: vi.fn(),
    });

    expect(first).not.toBe(second);
    first.onXmlComplete("first");
    second.onXmlComplete("second");
    expect(firstXml).toHaveBeenCalledWith("first");
    expect(firstXml).not.toHaveBeenCalledWith("second");
    expect(secondXml).toHaveBeenCalledWith("second");

    first.frameworkType = "vite-nitro";
    first.isSharedModulesChanged = true;
    first.mutationCount = 2;
    first.todos = [{ id: "todo-1", content: "finish", status: "pending" }];
    first.pendingFunctionDeploys.push("hello");

    expect(turnContext.frameworkType).toBe("vite-nitro");
    expect(turnContext.isSharedModulesChanged).toBe(true);
    expect(turnContext.mutationCount).toBe(2);
    expect(turnContext.todos).toEqual(first.todos);
    expect(second.pendingFunctionDeploys).toEqual(["hello"]);
  });
});
