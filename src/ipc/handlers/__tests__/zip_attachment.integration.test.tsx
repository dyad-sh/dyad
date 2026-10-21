import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { cancelActiveStreamsForChat } from "@/ipc/handlers/chat_stream_handlers";
import { buildZip } from "@/ipc/utils/zip/testing/zip_writer";

// Lets a test hold the turn just before or just after an extraction, e.g. to
// press Stop at that point.
const extractionHook = vi.hoisted(() => ({
  before: null as null | ((signal?: AbortSignal) => Promise<void>),
  after: null as null | ((signal?: AbortSignal) => Promise<void>),
}));
vi.mock("@/ipc/utils/zip/zip_attachment", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/zip/zip_attachment")>();
  return {
    ...actual,
    extractZipAttachment: async (
      args: Parameters<typeof actual.extractZipAttachment>[0],
    ) => {
      await extractionHook.before?.(args.signal);
      const result = await actual.extractZipAttachment(args);
      await extractionHook.after?.(args.signal);
      return result;
    },
  };
});

// A Python-written archive with a single `project/` root folder holding
// README.md, src/index.ts, src/util/empty.ts and assets/logo.png.
const PROJECT_ZIP = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "utils",
    "zip",
    "__fixtures__",
    "python-basic.zip",
  ),
);

describe("zip attachment (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  function attachProjectZip() {
    harness.setChatAttachments([
      {
        name: "project.zip",
        content: PROJECT_ZIP,
        mimeType: "application/zip",
      },
    ]);
  }

  function readManifest(): Array<Record<string, unknown>> {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          harness.appDir,
          ".dyad",
          "media",
          "attachments-manifest.json",
        ),
        "utf8",
      ),
    );
  }

  it("unpacks the archive, registers its entries and describes them to the model", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    attachProjectZip();
    await screen.findByText("project.zip");

    const streamEnd = harness.waitForNextStreamEnd(chatId);
    const { send } = await harness.typeInChat("[dump]", { chatId });
    send();
    await waitFor(
      () => expect(screen.getByText(/dyad-dump-path/)).toBeTruthy(),
      { timeout: 20_000 },
    );
    await streamEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // The prompt the model received describes the archive and its entries.
    const req = harness.getServerDump({ type: "request" });
    expect(req.text).toContain(
      'attachments:project.zip (920 B, application/zip): zip archive unpacked into 4 files (1 KB); its single top-level folder \\"project\\" was unwrapped.',
    );
    expect(req.text).toContain(
      "Read an entry with read_file using attachments:project.zip/<entry path>",
    );
    expect(req.text).toContain("Do not copy archive contents into the project");
    for (const entry of [
      "README.md (18 B)",
      "src/index.ts (26 B)",
      "src/util/empty.ts (0 B)",
      "assets/logo.png (1 KB)",
    ]) {
      expect(req.text).toContain(entry);
    }

    // The archive and each extracted file are in the manifest.
    const manifest = readManifest();
    const archiveEntry = manifest.find(
      (entry) => entry.logicalName === "project.zip",
    );
    expect(archiveEntry).toMatchObject({
      originalName: "project.zip",
      mimeType: "application/zip",
    });
    const storedFileName = archiveEntry!.storedFileName as string;
    const extractedDirName = storedFileName.replace(/\.zip$/, "-unpacked");
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalName: "project.zip/src/index.ts",
          originalName: "src/index.ts",
          storedFileName: `${extractedDirName}/src/index.ts`,
          mimeType: "text/typescript",
          sizeBytes: 26,
          archiveLogicalName: "project.zip",
        }),
        expect.objectContaining({
          logicalName: "project.zip/assets/logo.png",
          mimeType: "image/png",
          archiveLogicalName: "project.zip",
        }),
      ]),
    );

    // The bytes landed inside the app's media directory, root folder stripped.
    const extractedIndex = path.join(
      harness.appDir,
      ".dyad",
      "media",
      extractedDirName,
      "src",
      "index.ts",
    );
    expect(fs.readFileSync(extractedIndex, "utf8")).toBe(
      "export const answer = 42;\n",
    );
    expect(
      fs.existsSync(
        path.join(
          harness.appDir,
          ".dyad",
          "media",
          extractedDirName,
          "project",
        ),
      ),
    ).toBe(false);
  }, 60_000);

  it("lets the agent read archive entries through read_file and the sandbox", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    attachProjectZip();
    await screen.findByText("project.zip");

    const { send } = await harness.typeInChat(
      "tc=local-agent/zip-attachment-read",
      { chatId },
    );
    send();

    const scriptCard = await screen.findByTestId(
      "dyad-script-card",
      undefined,
      {
        timeout: 20_000,
      },
    );
    expect(scriptCard.textContent).toContain("List project.zip entries");
    fireEvent.click(scriptCard);
    fireEvent.click(await screen.findByText("Output"));

    await waitFor(
      () => {
        expect(scriptCard.textContent).toContain(
          '"attachments:project.zip/README.md"',
        );
        expect(scriptCard.textContent).toContain(
          '"attachments:project.zip/src/index.ts"',
        );
        expect(scriptCard.textContent).toContain("# Fixture project");
      },
      { timeout: 20_000 },
    );
    await harness.waitForStreamEnd(chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // The read_file turn addressed the entry by its nested attachment name
    // and succeeded (a failed read renders an error card, not a read tag).
    const assistant = (
      await harness.db.query.messages.findMany({
        where: (messages, { eq }) => eq(messages.chatId, chatId),
      })
    ).find((message) => message.role === "assistant");
    expect(assistant?.content).toContain(
      '<dyad-read path="attachments:project.zip/src/index.ts"',
    );
    expect(assistant?.content).not.toContain("<dyad-error");
  }, 60_000);

  // Sends a unique archive, presses Stop while the turn is held at `phase`,
  // and checks the turn ends as a cancel with this turn's media removed.
  async function expectStopDiscardsArchive(
    phase: "before" | "after",
    entryName: string,
  ) {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    // Unique bytes, so the stored archive is one this turn creates.
    const archive = buildZip([{ name: entryName, data: "stop" }]);
    const hash = crypto.createHash("sha256").update(archive).digest("hex");
    const mediaDir = path.join(harness.appDir, ".dyad", "media");
    const storedPath = path.join(mediaDir, `${hash}.zip`);
    const extractionDir = path.join(mediaDir, `${hash}-unpacked`);
    harness.setChatAttachments([
      {
        name: "cancel.zip",
        content: Buffer.from(archive),
        mimeType: "application/zip",
      },
    ]);
    await screen.findByText("cancel.zip");

    let markHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    extractionHook[phase] = async (signal) => {
      markHeld();
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      // Before extraction the extractor's own check fires; after it, the
      // turn carries on as if Stop had landed right after the extraction was
      // moved into place.
      if (phase === "before") {
        signal?.throwIfAborted();
      }
    };
    try {
      const errorsBefore = harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ).length;
      const { send } = await harness.typeInChat("[dump]", { chatId });
      send();
      await held;
      expect(fs.existsSync(storedPath)).toBe(true);
      expect(fs.existsSync(extractionDir)).toBe(phase === "after");

      // Resolves once the aborted handler has finished unwinding.
      await cancelActiveStreamsForChat(chatId, undefined);

      expect(
        harness.bridge.sentEvents.filter(
          (e) => e.channel === "chat:response:error",
        ),
      ).toHaveLength(errorsBefore);
      expect(fs.existsSync(storedPath)).toBe(false);
      expect(fs.existsSync(extractionDir)).toBe(false);
    } finally {
      extractionHook[phase] = null;
    }
  }

  it("treats Stop during extraction as a cancel and discards the archive", async () => {
    await expectStopDiscardsArchive("before", "cancel-me.txt");
  }, 60_000);

  it("discards an archive whose extraction finished just as Stop arrived", async () => {
    await expectStopDiscardsArchive("after", "cancel-after.txt");
  }, 60_000);
});
