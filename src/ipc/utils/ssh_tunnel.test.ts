import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as net from "net";

vi.mock("./ssh_utils", async () => {
  const actual =
    await vi.importActual<typeof import("./ssh_utils")>("./ssh_utils");
  return {
    ...actual,
    isSshAvailable: () => true,
    runRemote: vi.fn(),
  };
});

import { runRemote } from "./ssh_utils";
import {
  resolveContainerIp,
  rewriteHostPort,
  openSshTunnel,
} from "./ssh_tunnel";

const target = { host: "example.com", user: "root", port: 22 };

function mockRemote(result: Partial<Awaited<ReturnType<typeof runRemote>>>) {
  vi.mocked(runRemote).mockResolvedValue({
    ok: true,
    stdout: "",
    stderr: "",
    code: 0,
    ...result,
  });
}

describe("resolveContainerIp", () => {
  beforeEach(() => vi.mocked(runRemote).mockReset());

  it("returns the first address when a container is on one network", async () => {
    mockRemote({ stdout: "172.18.0.5 \n" });
    await expect(resolveContainerIp(target, "abc123")).resolves.toBe(
      "172.18.0.5",
    );
  });

  it("takes the first address when a container is on several networks", async () => {
    mockRemote({ stdout: "172.18.0.5 172.19.0.7 \n" });
    await expect(resolveContainerIp(target, "abc123")).resolves.toBe(
      "172.18.0.5",
    );
  });

  it("fails clearly when the container reports no address", async () => {
    mockRemote({ stdout: "  \n" });
    await expect(resolveContainerIp(target, "abc123")).rejects.toThrow(
      /no IP address/i,
    );
  });

  it("surfaces the ssh error when inspect fails", async () => {
    mockRemote({ ok: false, error: "No such container", code: 1 });
    await expect(resolveContainerIp(target, "abc123")).rejects.toThrow(
      /No such container/,
    );
  });

  it("rejects container names that could inject shell syntax", async () => {
    await expect(resolveContainerIp(target, "abc; rm -rf /")).rejects.toThrow(
      /unsafe container name/i,
    );
    expect(runRemote).not.toHaveBeenCalled();
  });
});

describe("rewriteHostPort", () => {
  it("redirects to the local end while keeping credentials and database", () => {
    const rewritten = rewriteHostPort(
      "postgres://dyad:s3cret@container-uuid:5432/dyad",
      15432,
    );
    expect(rewritten).toContain("127.0.0.1:15432");
    expect(rewritten).toContain("dyad:s3cret@");
    expect(rewritten).toContain("/dyad");
  });

  it("disables TLS, which a self-hosted database does not offer", () => {
    // Clients that default to requiring TLS otherwise fail with "the server
    // does not support SSL connections"; the SSH channel already encrypts.
    const rewritten = rewriteHostPort("postgres://u:p@host:5432/db", 15432);
    expect(rewritten).toContain("sslmode=disable");
  });

  it("overrides an inherited sslmode=require", () => {
    const rewritten = rewriteHostPort(
      "postgres://u:p@host:5432/db?sslmode=require",
      15432,
    );
    expect(rewritten).toContain("sslmode=disable");
    expect(rewritten).not.toContain("sslmode=require");
  });
});

describe("openSshTunnel", () => {
  let listener: net.Server | undefined;

  afterEach(() => {
    listener?.close();
    listener = undefined;
  });

  it("fails with a clear error when the local end never opens", async () => {
    // ssh is not actually reachable here, so the port never accepts.
    await expect(
      openSshTunnel({
        target,
        remoteHost: "172.18.0.5",
        remotePort: 5432,
        readyTimeoutMs: 300,
      }),
    ).rejects.toThrow(/did not open/i);
  });
});
