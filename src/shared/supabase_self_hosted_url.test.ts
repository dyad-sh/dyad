import { describe, expect, it } from "vitest";
import { sendsKeysUnencrypted } from "./supabase_self_hosted_url";

describe("sendsKeysUnencrypted", () => {
  it("is true only for plain HTTP to another machine", () => {
    expect(sendsKeysUnencrypted("http://203.0.113.7:8000")).toBe(true);
    expect(
      sendsKeysUnencrypted(" http://supabasekong-x.203.0.113.7.sslip.io "),
    ).toBe(true);
    for (const url of [
      "https://supabase.example.com",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "http://[::1]:8000",
      "http://app.localhost",
      "http://localhost.:8000",
      "not a url",
      "",
    ]) {
      expect(sendsKeysUnencrypted(url)).toBe(false);
    }
  });
});
