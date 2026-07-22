import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClock } from "@/state_machines/testing";
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
};

async function flushCommands(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
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

      harness.setNeonError();
      harness.setThemeError();
      harness.controller.send({ type: "RETRY" });
      await flushCommands();
      expect(harness.controller.getSnapshot().type).toBe("dispatching");
      expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
      expect(harness.deps.submitPrompt).toHaveBeenCalledTimes(1);

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

  it("keeps rapid submissions single-flight through creation", async () => {
    const harness = createHarness();
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(true);
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(false);
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    expect(harness.controller.send({ type: "SUBMIT", payload })).toBe(false);
    await flushCommands();

    expect(harness.deps.createApp).toHaveBeenCalledTimes(1);
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
    expect(harness.deps.createChat).toHaveBeenCalledWith(41, "build");
    expect(harness.deps.submitPrompt).toHaveBeenCalledWith({
      appId: 41,
      chatId: 3,
      payload: expect.objectContaining({
        selectedApp: { id: 41, name: "Existing app" },
      }),
    });
  });

  it("uses the injected clock instead of waiting in real time", async () => {
    const harness = createHarness();
    harness.controller.send({ type: "SUBMIT", payload });
    harness.controller.send({ type: "PROVIDERS_LOADED", anySetup: true });
    await flushCommands();

    expect(harness.controller.getSnapshot().type).toBe("dispatching");
    expect(harness.deps.clearEditingBuffer).toHaveBeenCalledTimes(1);
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
});
