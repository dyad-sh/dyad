import { describe, expect, it, vi } from "vitest";
import { SDKError } from "@vercel/sdk/models/sdkerror.js";
import {
  getVercelProjectTeamId,
  withVercelTeamScope,
} from "./vercel_project_scope";

describe("Vercel project ownership", () => {
  it("uses the project's owner and leaves personal projects unscoped", () => {
    expect(getVercelProjectTeamId({ accountId: "team_actual_owner" })).toBe(
      "team_actual_owner",
    );
    expect(getVercelProjectTeamId({ accountId: "user_personal" })).toBeNull();
    expect(() => getVercelProjectTeamId({})).toThrow("project's owner");
  });

  it.each([403, 404])(
    "recovers a legacy incorrect team after HTTP %i",
    async (statusCode) => {
      const request = vi
        .fn()
        .mockRejectedValueOnce(
          new SDKError("Project not accessible", {
            response: new Response(null, { status: statusCode }),
            request: new Request("https://api.vercel.com/v13/deployments"),
            body: "",
          }),
        )
        .mockResolvedValue("deployment");
      await expect(
        withVercelTeamScope("team_unrelated", request),
      ).resolves.toBe("deployment");
      expect(request.mock.calls).toEqual([["team_unrelated"], [undefined]]);
    },
  );

  it.each([401, 429, 500, undefined])(
    "does not retry an ambiguous or non-scope error (%s)",
    async (statusCode) => {
      const error = { statusCode };
      const request = vi.fn().mockRejectedValue(error);
      await expect(withVercelTeamScope("team_owner", request)).rejects.toBe(
        error,
      );
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("does not retry personal scope or hide a rejected fallback", async () => {
    const error = { statusCode: 404 };
    const request = vi.fn().mockRejectedValue(error);
    await expect(withVercelTeamScope(null, request)).rejects.toBe(error);
    expect(request.mock.calls).toEqual([[undefined]]);
    request.mockClear();
    await expect(withVercelTeamScope("team_old", request)).rejects.toBe(error);
    expect(request.mock.calls).toEqual([["team_old"], [undefined]]);
  });
});
