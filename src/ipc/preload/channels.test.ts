import { describe, expect, it } from "vitest";
import { userInputContracts, userInputEvents } from "../types/user_input";
import { supabaseEvents } from "../types/supabase";
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

describe("supabase preload channels", () => {
  it("allows every Supabase receive contract", () => {
    for (const event of Object.values(supabaseEvents)) {
      expect(VALID_RECEIVE_CHANNELS).toContain(event.channel);
    }
  });
});
