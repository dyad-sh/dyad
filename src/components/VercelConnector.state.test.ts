import { describe, expect, it } from "vitest";
import {
  getInitialVercelProjectSetupState,
  initialVercelTokenState,
  vercelProjectSetupReducer,
  vercelTokenReducer,
} from "./VercelConnector.state";

describe("vercelTokenReducer", () => {
  it("stores and clears token input", () => {
    const edited = vercelTokenReducer(initialVercelTokenState, {
      type: "set-token",
      token: "vercel-token",
    });

    expect(edited).toEqual({
      accessToken: "vercel-token",
    });

    expect(vercelTokenReducer(edited, { type: "clear-token" })).toEqual({
      accessToken: "",
    });
  });
});

describe("vercelProjectSetupReducer", () => {
  it("switches setup modes", () => {
    const initial = getInitialVercelProjectSetupState("My App");

    expect(
      vercelProjectSetupReducer(initial, {
        type: "set-mode",
        mode: "existing",
      }),
    ).toMatchObject({
      mode: "existing",
    });
  });

  it("clears availability feedback when the project name changes", () => {
    const initial = getInitialVercelProjectSetupState("My App");
    const unavailable = vercelProjectSetupReducer(initial, {
      type: "project-check-succeeded",
      available: false,
      error: "Already exists",
    });

    expect(
      vercelProjectSetupReducer(unavailable, {
        type: "set-project-name",
        name: "next-name",
      }),
    ).toMatchObject({
      projectName: "next-name",
      projectAvailable: null,
      projectCheckError: null,
    });
  });
});
