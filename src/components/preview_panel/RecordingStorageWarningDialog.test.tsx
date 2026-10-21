import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordingStorageWarningDialog } from "./RecordingStorageWarningDialog";

function renderDialog(isAppSpecificDomain: boolean) {
  render(
    <RecordingStorageWarningDialog
      open
      isAppSpecificDomain={isAppSpecificDomain}
      onOpenChange={() => {}}
      onContinue={() => {}}
    />,
  );
  return screen.getByTestId("recording-storage-warning-dialog").textContent;
}

describe("RecordingStorageWarningDialog", () => {
  it("says other apps are unaffected on an app-specific domain", () => {
    const text = renderDialog(true);
    expect(text).toContain("Other apps aren't affected.");
    expect(text).not.toContain("stay signed in");
    expect(text).not.toContain("may also be signed out");
  });

  it("warns about shared sessions without relying on the saved isolation preference", () => {
    const text = renderDialog(false);
    expect(text).toContain(
      "Other apps on localhost may also be signed out if they use shared cookies.",
    );
    expect(text).not.toContain("Other apps aren't affected.");
    expect(text).not.toContain("stay signed in");
  });
});
