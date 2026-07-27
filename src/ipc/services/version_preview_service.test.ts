import { describe, expect, it } from "vitest";
import { VersionPreviewService } from "./version_preview_service";

describe("VersionPreviewService reconciliation admission", () => {
  it("blocks renderer intents until startup reconciliation settles", () => {
    const service = new VersionPreviewService();

    service.beginReconciliation(7);
    expect(() => service.assertReadyForIntent(7)).toThrow(
      "Version preview is reconciling after restart",
    );

    service.endReconciliation(7);
    expect(() => service.assertReadyForIntent(7)).not.toThrow();
  });
});
