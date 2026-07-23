import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import {
  createFirstPromptCommandRunner,
  type FirstPromptDeps,
} from "./commands";
import { FirstPromptController } from "./controller";
import type { FirstPromptPayload } from "./state";

const payload: FirstPromptPayload = {
  prompt: "Build a notes app",
  attachments: [],
  chatMode: "build",
  isChatModeExplicit: false,
};

async function flushCommands(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness() {
  const clock = createFakeClock();
  let neonError: Error | undefined;
  let themeError: Error | undefined;
  const deps: FirstPromptDeps = {
    createApp: vi.fn().mockResolvedValue({
      appId: 1,
      appName: "Notes",
      chatId: 2,
    }),
    createChat: vi.fn().mockResolvedValue(3),
    commitCreation: vi.fn(),
    cancelCreation: vi.fn(),
    runNeonTemplateHook: vi.fn(async () => {
      if (neonError) throw neonError;
    }),
    applyTheme: vi.fn(async () => {
      if (themeError) throw themeError;
    }),
    openPreviewIfSetupRequired: vi.fn().mockResolvedValue(false),
    submitPrompt: vi.fn(),
    refreshQueries: vi.fn().mockResolvedValue(undefined),
    navigateHome: vi.fn(),
    selectChat: vi.fn(),
    showSetupDialog: vi.fn(),
    clearEditingBuffer: vi.fn(),
    showError: vi.fn(),
  };
  const controller = new FirstPromptController({
    runner: createFirstPromptCommandRunner({
      clock,
      idSource: createSequentialIdSource(),
      getSettleDelayMs: () => 2_000,
      getDeps: () => deps,
    }),
  });
  return {
    clock,
    controller,
    deps,
    setNeonError: (error?: Error) => {
      neonError = error;
    },
    setThemeError: (error?: Error) => {
      themeError = error;
    },
  };
}

describe("FirstPromptController", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const failingStep of ["neon", "theme"] as const) {
    it(`${failingStep} failure retries post-create with the existing app`, async () => {
      const harness = createHarness();
      const failure = new Error(`${failingStep} failed`);
      if (failingStep === "neon") harness.setNeonError(failure);
      else harness.setThemeError(failure);

      harness.controller.send({ type: "SUBMIT", payload });
      harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
      await flushCommands();

      expect(harness.controller.getSnapshot().type).toBe("failedPartial");
      expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
      expect(harness.deps.runNeonTemplateHook).toHaveBeenCalledTimes(1);
      expect(harness.deps.applyTheme).toHaveBeenCalledTimes(
        failingStep === "theme" ? 1 : 0,
      );

      harness.setNeonError();
      harness.setThemeError();
      harness.controller.send({ type: "RETRY" });
      await flushCommands();
      expect(harness.controller.getSnapshot().type).toBe("dispatching");
      expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
      expect(harness.deps.submitPrompt).toHaveBeenCalledTimes(1);
      expect(harness.deps.runNeonTemplateHook).toHaveBeenCalledTimes(
        failingStep === "neon" ? 2 : 1,
      );
      expect(harness.deps.applyTheme).toHaveBeenCalledTimes(
        failingStep === "theme" ? 2 : 1,
      );

      harness.clock.advanceBy(1_999);
      await flushCommands();
      expect(harness.deps.selectChat).not.toHaveBeenCalled();
      harness.clock.advanceBy(1);
      await flushCommands();
      expect(harness.deps.selectChat).toHaveBeenCalledWith(1, 2);
    });
  }

  it("resumes a provider detour once and navigates home before creation", async () => {
    const harness = createHarness();
    harness.controller.send({ type: "ARM_FOR_SETUP", payload });
    expect(harness.controller.getSnapshot().type).toBe("awaitingProviderSetup");

    harness.controller.send({ type: "PROVIDER_CONFIGURED" });
    harness.controller.send({ type: "PROVIDER_CONFIGURED" });
    await flushCommands();

    expect(harness.deps.navigateHome).toHaveBeenCalledTimes(1);
    expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
  });

  it("opens provider setup when provider detection times out", async () => {
    const harness = createHarness();
    harness.controller.send({ type: "SUBMIT", payload });
    await flushCommands();

    harness.clock.advanceBy(10_000);
    await flushCommands();

    expect(harness.controller.getSnapshot()).toEqual({
      type: "awaitingProviderSetup",
      payload,
      reason: "provider-check-timeout",
    });
    expect(harness.deps.showSetupDialog).toHaveBeenCalledTimes(1);
  });

  it("resumes when provider detection succeeds after the timeout", async () => {
    const harness = createHarness();
    harness.controller.send({ type: "SUBMIT", payload });
    await flushCommands();
    harness.clock.advanceBy(10_000);
    await flushCommands();

    harness.controller.send({
      type: "PROVIDER_CONFIGURED",
      defaultChatMode: "local-agent",
    });
    await flushCommands();

    expect(harness.deps.createApp).toHaveBeenCalledWith(
      "first-prompt-create-app:1",
      undefined,
    );
    expect(harness.deps.submitPrompt).toHaveBeenCalledWith({
      appId: 1,
      chatId: 2,
      payload: { ...payload, chatMode: "local-agent" },
    });
  });

  it("keeps rapid submissions single-flight through creation", async () => {
    const harness = createHarness();
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(true);
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(false);
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(false);
    await flushCommands();

    expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
  });

  it("uses an edited resubmit payload while reusing a partially created app", async () => {
    const harness = createHarness();
    harness.setThemeError(new Error("theme failed"));
    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    const editedPayload: FirstPromptPayload = {
      ...payload,
      prompt: "Build an edited notes app",
    };
    harness.setThemeError();
    harness.controller.send({ type: "SUBMIT", payload: editedPayload });
    await flushCommands();

    expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
    expect(harness.deps.runNeonTemplateHook).toHaveBeenCalledTimes(1);
    expect(harness.deps.submitPrompt).toHaveBeenCalledWith({
      appId: 1,
      chatId: 2,
      payload: editedPayload,
    });
  });

  it("creates a chat in a newly selected app after a partial failure", async () => {
    const harness = createHarness();
    harness.setThemeError(new Error("theme failed"));
    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    harness.setThemeError();
    harness.controller.send({
      type: "SUBMIT",
      payload: {
        ...payload,
        selectedApp: { id: 41, name: "Existing app" },
      },
    });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
    expect(harness.deps.createChat).toHaveBeenCalledWith(
      41,
      "first-prompt-create-chat:2",
      undefined,
    );
    expect(harness.deps.commitCreation).toHaveBeenCalledWith(
      "first-prompt-create-app:1",
    );
    expect(harness.deps.commitCreation).toHaveBeenCalledWith(
      "first-prompt-create-chat:2",
    );
    expect(harness.deps.submitPrompt).toHaveBeenCalledWith({
      appId: 41,
      chatId: 3,
      payload: expect.objectContaining({
        selectedApp: { id: 41, name: "Existing app" },
      }),
    });
  });

  it("creates only a chat when the payload targets an existing app", async () => {
    const harness = createHarness();
    harness.controller.send({
      type: "SUBMIT",
      payload: {
        ...payload,
        selectedApp: { id: 41, name: "Existing app" },
      },
    });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    expect(harness.deps.createApp).not.toHaveBeenCalled();
    expect(harness.deps.createChat).toHaveBeenCalledWith(
      41,
      "first-prompt-create-chat:1",
      undefined,
    );
    expect(harness.deps.submitPrompt).toHaveBeenCalledWith({
      appId: 41,
      chatId: 3,
      payload: expect.objectContaining({
        selectedApp: { id: 41, name: "Existing app" },
      }),
    });
  });

  it("persists an explicitly selected mode when creating a chat", async () => {
    const harness = createHarness();
    harness.controller.send({
      type: "SUBMIT",
      payload: {
        ...payload,
        chatMode: "local-agent",
        isChatModeExplicit: true,
        selectedApp: { id: 41, name: "Existing app" },
      },
    });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    expect(harness.deps.createChat).toHaveBeenCalledWith(
      41,
      "first-prompt-create-chat:1",
      "local-agent",
    );
  });

  it("uses the injected clock instead of waiting in real time", async () => {
    const harness = createHarness();
    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    expect(harness.controller.getSnapshot().type).toBe("dispatching");
    expect(harness.deps.clearEditingBuffer).toHaveBeenCalledTimes(1);
    expect(harness.deps.openPreviewIfSetupRequired).toHaveBeenCalledWith(1);
    expect(
      (harness.deps.submitPrompt as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (harness.deps.clearEditingBuffer as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    );
    expect(harness.clock.pendingTimerCount()).toBe(1);
    harness.clock.advanceBy(2_000);
    await flushCommands();
    expect(harness.controller.getSnapshot().type).toBe("idle");
  });

  it("waits for both settle and a deferred preview decision", async () => {
    const harness = createHarness();
    let resolvePreview!: (opened: boolean) => void;
    (
      harness.deps.openPreviewIfSetupRequired as ReturnType<typeof vi.fn>
    ).mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolvePreview = resolve;
      }),
    );

    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();
    expect(harness.deps.openPreviewIfSetupRequired).toHaveBeenCalledWith(1);

    harness.clock.advanceBy(2_000);
    await flushCommands();
    expect(harness.controller.getSnapshot().type).toBe("dispatching");
    expect(harness.deps.refreshQueries).not.toHaveBeenCalled();

    resolvePreview(false);
    await flushCommands();
    expect(harness.deps.refreshQueries).toHaveBeenCalledWith(1);
    expect(harness.deps.selectChat).toHaveBeenCalledWith(1, 2);
  });

  it("cleans up an app whose creation settles after disposal", async () => {
    const harness = createHarness();
    const creation = deferred<{
      appId: number;
      appName: string;
      chatId: number;
    }>();
    (harness.deps.createApp as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      creation.promise,
    );

    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();
    harness.controller.dispose();

    creation.resolve({ appId: 11, appName: "Late app", chatId: 12 });
    await flushCommands();

    expect(harness.deps.cancelCreation).toHaveBeenCalledWith(
      "first-prompt-create-app:1",
    );
    expect(harness.deps.cancelCreation).toHaveBeenCalledTimes(2);
    expect(harness.deps.runNeonTemplateHook).not.toHaveBeenCalled();
  });

  it("cleans up a chat whose creation settles after disposal", async () => {
    const harness = createHarness();
    const creation = deferred<number>();
    (harness.deps.createChat as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      creation.promise,
    );
    const existingAppPayload: FirstPromptPayload = {
      ...payload,
      selectedApp: { id: 41, name: "Existing app" },
    };

    harness.controller.send({ type: "SUBMIT", payload: existingAppPayload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();
    harness.controller.dispose();

    creation.resolve(13);
    await flushCommands();

    expect(harness.deps.cancelCreation).toHaveBeenCalledWith(
      "first-prompt-create-chat:1",
    );
    expect(harness.deps.cancelCreation).toHaveBeenCalledTimes(2);
    expect(harness.deps.submitPrompt).not.toHaveBeenCalled();
  });

  it("cleans up an owned app immediately when disposed during post-create", async () => {
    const harness = createHarness();
    const neon = deferred<void>();
    (
      harness.deps.runNeonTemplateHook as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce(neon.promise);

    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();
    expect(harness.controller.getSnapshot().type).toBe("postCreate");

    harness.controller.dispose();
    await flushCommands();

    expect(harness.deps.cancelCreation).toHaveBeenCalledWith(
      "first-prompt-create-app:1",
    );
    neon.resolve();
    await flushCommands();
    expect(harness.deps.cancelCreation).toHaveBeenCalledTimes(2);
  });

  it("models preview and refresh failures before continuing best-effort", async () => {
    const harness = createHarness();
    (
      harness.deps.openPreviewIfSetupRequired as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("preview failed"));
    (
      harness.deps.refreshQueries as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("refresh failed"));

    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();
    harness.clock.advanceBy(2_000);
    await flushCommands();

    expect(harness.deps.showError).toHaveBeenNthCalledWith(
      1,
      "preview failed",
      "postCreate",
    );
    expect(harness.deps.showError).toHaveBeenNthCalledWith(
      2,
      "refresh failed",
      "postCreate",
    );
    expect(harness.deps.selectChat).toHaveBeenCalledWith(1, 2);
    expect(harness.controller.getSnapshot().type).toBe("idle");
  });
});
