import { describe, expect, it } from "vitest";
import {
  getElevenLabsConnectionError,
  getElevenLabsConnectionStatus,
} from "./JarvisSettings";

describe("ElevenLabs connection status", () => {
  it("does not claim a saved key is connected before verification", () => {
    expect(
      getElevenLabsConnectionStatus({
        hasKey: true,
        isFetching: true,
        isError: false,
        hasResponse: false,
        voiceCount: 0,
      }),
    ).toMatchObject({ state: "checking", label: "Checking" });
  });

  it("reports a verified connection with the available voice count", () => {
    expect(
      getElevenLabsConnectionStatus({
        hasKey: true,
        isFetching: false,
        isError: false,
        hasResponse: true,
        voiceCount: 12,
      }),
    ).toEqual({
      state: "connected",
      label: "Connected",
      description: "12 voices available",
    });
  });

  it("shows an actionable error when verification fails", () => {
    expect(
      getElevenLabsConnectionStatus({
        hasKey: true,
        isFetching: false,
        isError: true,
        hasResponse: false,
        voiceCount: 0,
      }),
    ).toMatchObject({ state: "error", label: "Needs attention" });
  });

  it("shows not configured when there is no key", () => {
    expect(
      getElevenLabsConnectionStatus({
        hasKey: false,
        isFetching: false,
        isError: false,
        hasResponse: false,
        voiceCount: 0,
      }),
    ).toMatchObject({ state: "not-configured", label: "Not configured" });
  });

  it("removes Electron IPC wrappers from the displayed connection error", () => {
    expect(
      getElevenLabsConnectionError(
        new Error(
          "Error invoking remote method 'jarvis:voices:list': DyadError: Enable Voices permission.",
        ),
      ),
    ).toBe("Enable Voices permission.");
  });
});
