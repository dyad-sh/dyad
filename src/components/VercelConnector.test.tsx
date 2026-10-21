import { describe, expect, it, vi } from "vitest";
import { toVercelDeploymentRow } from "./VercelConnector";

vi.mock("@/ipc/types", () => ({
  ipc: { vercel: {}, system: { openExternalUrl: vi.fn() } },
}));

const DEPLOYMENT = {
  uid: "dpl_1",
  url: "shop-abc123.vercel.app",
  state: "READY",
  createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  target: "production",
  readyState: "READY",
};

describe("a Vercel deployment as a row", () => {
  it("reads the state as a word and links to the deployment", () => {
    expect(toVercelDeploymentRow(DEPLOYMENT)).toEqual({
      key: "dpl_1",
      label: "Ready",
      tone: "success",
      createdAt: new Date(DEPLOYMENT.createdAt),
      url: "https://shop-abc123.vercel.app",
    });
  });

  it("colors building, ready and failed, and nothing else", () => {
    const toneOf = (readyState: string) =>
      toVercelDeploymentRow({ ...DEPLOYMENT, readyState }).tone;
    expect(toneOf("BUILDING")).toBe("pending");
    expect(toneOf("ERROR")).toBe("failure");
    expect(toneOf("QUEUED")).toBe("neutral");
    expect(toneOf("CANCELED")).toBe("neutral");
  });
});
