import { describe, expect, it } from "vitest";

import { resolveAttachmentDeliveryConfig } from "./chat_attachment_utils";

describe("resolveAttachmentDeliveryConfig", () => {
  it("uses on-disk read/copy attachments without sandbox hints in Build", () => {
    expect(
      resolveAttachmentDeliveryConfig({
        mode: "build",
        settings: { enableSandboxScriptExecution: true },
        hasImageAttachments: true,
        hasUploadedAttachments: true,
      }),
    ).toMatchObject({
      inlineTextAttachments: false,
      useOnDiskAttachmentBlock: true,
      includeSandboxScriptHint: false,
      includeCopyFileHint: true,
      addSystemCopyInstructions: false,
    });
  });
});
