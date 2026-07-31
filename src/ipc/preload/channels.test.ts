import { describe, expect, it } from "vitest";
import { userInputContracts, userInputEvents } from "../types/user_input";
import { visualEditingContracts } from "../types/visual-editing";
import { VALID_INVOKE_CHANNELS, VALID_RECEIVE_CHANNELS } from "./channels";

describe("user-input preload channels", () => {
  it("allows every user-input invoke and receive contract", () => {
    for (const contract of Object.values(userInputContracts)) {
      expect(VALID_INVOKE_CHANNELS).toContain(contract.channel);
    }
    for (const event of Object.values(userInputEvents)) {
      expect(VALID_RECEIVE_CHANNELS).toContain(event.channel);
    }
  });
});

describe("visual-editing preload channels", () => {
  it("allows every visual-editing invoke contract", () => {
    for (const contract of Object.values(visualEditingContracts)) {
      expect(VALID_INVOKE_CHANNELS).toContain(contract.channel);
    }
  });
});
