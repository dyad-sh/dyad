import { describe, expect, it, vi } from "vitest";
import {
  applyInstanceDomain,
  plainUrlFor,
  certificateDomainFor,
  domainPointsAtServer,
  hasTrustedCertificate,
  tryEnableHttps,
} from "./https_setup";
import type { SshSession } from "@/ipc/utils/ssh_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function transcript(output: string): string {
  return [
    '> echo "__DYAD_OUT_START__" . PHP_EOL;',
    "> __DYAD_OUT_START__",
    output,
    "__DYAD_OUT_END__",
  ].join("\n");
}

function fakeSession() {
  const commands: string[] = [];
  const scripts: string[] = [];
  const session: SshSession = {
    run: vi.fn(async (command: string, options?: { input?: string }) => {
      commands.push(command);
      scripts.push(options?.input ?? "");
      return { code: 0, stdout: transcript("applied"), stderr: "" };
    }) as unknown as SshSession["run"],
    end: vi.fn(),
  };
  return { session, commands, scripts };
}

describe("certificateDomainFor", () => {
  it("spells a bare address as a name, since a certificate needs one", () => {
    // Let's Encrypt will not issue for an IP address. sslip.io exists so an
    // address can be written as a domain that resolves back to it.
    expect(certificateDomainFor("203.0.113.5")).toBe("203.0.113.5.sslip.io");
  });

  it("prefers a name the user already has", () => {
    // Theirs, and it does not spend a shared certificate allowance.
    expect(certificateDomainFor("203.0.113.5", "coolify.example.com")).toBe(
      "coolify.example.com",
    );
  });

  it("takes a domain however the user pasted it", () => {
    expect(
      certificateDomainFor("203.0.113.5", "https://coolify.example.com/"),
    ).toBe("coolify.example.com");
  });

  it("uses a hostname as given rather than wrapping it", () => {
    expect(certificateDomainFor("coolify.example.com")).toBe(
      "coolify.example.com",
    );
  });

  it("declines an address no certificate authority could reach", () => {
    // Validation happens over the public internet. A name pointing at a LAN
    // or loopback address can never be given a certificate, and asking for
    // one costs the whole poll — two minutes — before the same answer.
    expect(certificateDomainFor("192.168.1.50")).toBeNull();
    expect(certificateDomainFor("127.0.0.1")).toBeNull();
    expect(certificateDomainFor("10.0.0.7")).toBeNull();
  });

  it("declines a name only this machine or this network answers to", () => {
    // Same position as a private address: nothing public can validate it.
    expect(certificateDomainFor("localhost")).toBeNull();
    // mDNS, which is how a homelab box is usually reached on a LAN.
    expect(certificateDomainFor("coolify.local")).toBeNull();
  });

  it("still takes an ordinary hostname", () => {
    expect(certificateDomainFor("coolify.example.com")).toBe(
      "coolify.example.com",
    );
  });

  it("still takes a domain the user gave for such a server", () => {
    // Their own domain may point at a router that forwards to it, which is a
    // different question from what the address itself can be reached at.
    expect(certificateDomainFor("192.168.1.50", "coolify.example.com")).toBe(
      "coolify.example.com",
    );
  });

  it("declines an IPv6 address rather than guessing at a spelling", () => {
    expect(certificateDomainFor("2606:4700::1")).toBeNull();
  });
});

describe("plainUrlFor", () => {
  it("brackets an IPv6 address, or the URL will not parse", async () => {
    const url = plainUrlFor("2606:4700::1");
    expect(url).toBe("http://[2606:4700::1]:8000");
    expect(() => new URL(url)).not.toThrow();
  });

  it("leaves an IPv4 address and a hostname alone", () => {
    expect(plainUrlFor("203.0.113.5")).toBe("http://203.0.113.5:8000");
    expect(plainUrlFor("box.example.com")).toBe("http://box.example.com:8000");
  });
});

describe("applyInstanceDomain", () => {
  it("sets the domain and rebuilds the proxy, which is what asks", async () => {
    // The setting alone changes nothing; the proxy rebuild is what requests
    // the certificate.
    const { session, scripts } = fakeSession();
    await applyInstanceDomain(session, "203.0.113.5.sslip.io");

    expect(scripts[0]).toContain("$s->fqdn =");
    expect(scripts[0]).toContain("setupDynamicProxyConfiguration");
  });

  it("keeps the domain out of the script", async () => {
    const { session, scripts, commands } = fakeSession();
    await applyInstanceDomain(session, "coolify.example.com");

    expect(scripts[0]).not.toContain("coolify.example.com");
    expect(commands[0]).toContain(
      "-e DYAD_INSTANCE_DOMAIN='coolify.example.com'",
    );
  });

  it("clears the domain when given null", async () => {
    const { session, scripts } = fakeSession();
    await applyInstanceDomain(session, null);
    expect(scripts[0]).toContain("$s->fqdn = null;");
  });

  it("refuses a domain that could break out of the script", async () => {
    const { session } = fakeSession();
    await expect(
      applyInstanceDomain(session, "example.com'; system('rm -rf /'); '"),
    ).rejects.toMatchObject({ kind: "validation" });
  });
});

describe("hasTrustedCertificate", () => {
  it("is false when the certificate is not trusted", async () => {
    // Node rejects an untrusted certificate rather than reporting it, so the
    // request failing IS the answer. A self-signed one fails here, which is
    // the point: it would fail in the user's browser too.
    const fetchImpl = vi.fn(async () => {
      throw new Error("unable to verify the first certificate");
    }) as unknown as typeof fetch;
    expect(
      await hasTrustedCertificate("https://example.com", { fetchImpl }),
    ).toBe(false);
  });

  it("is true when the request completes", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 302,
    })) as unknown as typeof fetch;
    expect(
      await hasTrustedCertificate("https://example.com", { fetchImpl }),
    ).toBe(true);
  });
});

describe("domainPointsAtServer", () => {
  const answers =
    (addresses: string[], failed = false) =>
    async () => ({ addresses, failed });

  it("is true when the domain resolves to the server", async () => {
    expect(
      await domainPointsAtServer("coolify.example.com", "203.0.113.5", {
        resolve: answers(["203.0.113.5"]),
      }),
    ).toBe(true);
  });

  it("is false when it still points at something else", async () => {
    // The user's old website answers HTTPS with a valid certificate of its
    // own, so the certificate check alone would call this a success.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers(["198.51.100.9"]),
      }),
    ).toBe(false);
  });

  it("does not object when the resolver could not be reached", async () => {
    // Not knowing is not the same as knowing it is wrong, and this only
    // decides whether to attempt something that is checked afterwards anyway.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers([], true),
      }),
    ).toBe(true);
  });

  it("does not object when the domain has no records yet", async () => {
    // It may be minutes old. The certificate wait is the real answer.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers([]),
      }),
    ).toBe(true);
  });

  it("compares a server known by a name against what the name resolves to", async () => {
    // Both sides are names here, so both are resolved. Accepting any domain
    // when the server is named would point Coolify — and the root token
    // stored with it — at whatever that domain happens to serve.
    const byName = async (target: string) => ({
      addresses:
        target === "box.example.com" ? ["203.0.113.5"] : ["198.51.100.9"],
      failed: false,
    });

    expect(
      await domainPointsAtServer("coolify.example.com", "box.example.com", {
        resolve: byName,
      }),
    ).toBe(false);
  });

  it("accepts a domain that resolves to the same place as the named server", async () => {
    expect(
      await domainPointsAtServer("coolify.example.com", "box.example.com", {
        resolve: answers(["203.0.113.5"]),
      }),
    ).toBe(true);
  });

  it("says nothing when the server's own name does not resolve", async () => {
    // Not knowing where the server is is not the same as knowing the domain
    // is wrong, and refusing here would block a setup over a private name.
    const nothingForTheServer = async (target: string) => ({
      addresses: target === "box.internal" ? [] : ["198.51.100.9"],
      failed: target === "box.internal",
    });

    expect(
      await domainPointsAtServer("coolify.example.com", "box.internal", {
        resolve: nothingForTheServer,
      }),
    ).toBe(true);
  });
});

describe("tryEnableHttps", () => {
  const FAST = { timeoutMs: 40, intervalMs: 5 };

  it("asks DNS about the server once, not once per check", async () => {
    // The gate below and the domain comparison want the same answer, and a
    // resolver that is slow to say so is slow twice.
    const asked: string[] = [];
    const { session } = fakeSession();
    await tryEnableHttps(session, "box.example.com", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async (name: string) => {
        asked.push(name);
        return { addresses: ["203.0.113.5"], failed: false };
      },
      check: async () => true,
    });

    expect(asked.filter((n) => n === "box.example.com")).toHaveLength(1);
  });

  it("gives the revert the full budget when nobody is waiting on a cancel", async () => {
    // The short bound exists so "Stopping…" cannot hang. On the ordinary
    // no-certificate path there is no cancel, and the domain still has to
    // come off.
    const asked: Array<number | undefined> = [];
    const session = {
      run: vi.fn(async (_c: string, o?: { timeoutMs?: number }) => {
        asked.push(o?.timeoutMs);
        return { code: 0, stdout: transcript("applied"), stderr: "" };
      }) as unknown as SshSession["run"],
      end: vi.fn(),
    };

    await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      check: async () => false,
    });

    expect(asked[0]).toBe(asked[1]);
  });

  it("does not wait for a certificate a private name can never get", async () => {
    // The certificate poll is two minutes, and a LAN name pays all of it for
    // an answer no certificate authority can give.
    const { session, scripts } = fakeSession();
    const outcome = await tryEnableHttps(session, "box.homelab.lan", {
      ...FAST,
      resolve: async () => ({ addresses: ["192.168.1.50"], failed: false }),
      check: async () => true,
    });

    expect(outcome.secure).toBe(false);
    expect(outcome.reason).toMatch(/cannot reach/);
    // Nothing was applied, so nothing has to be taken back off.
    expect(scripts).toHaveLength(0);
  });

  it("still tries when the name resolves somewhere public", async () => {
    const { session } = fakeSession();
    const outcome = await tryEnableHttps(session, "box.example.com", {
      ...FAST,
      resolve: async () => ({ addresses: ["203.0.113.5"], failed: false }),
      check: async () => true,
    });

    expect(outcome.secure).toBe(true);
  });

  it("still tries when the name cannot be resolved at all", async () => {
    // Not knowing where a server is is not the same as knowing it is private.
    const { session } = fakeSession();
    const outcome = await tryEnableHttps(session, "box.internal", {
      ...FAST,
      resolve: async () => ({ addresses: [], failed: true }),
      check: async () => true,
    });

    expect(outcome.secure).toBe(true);
  });

  it("takes the domain back off when the cancel lands while it is being set", async () => {
    // The script sets the fqdn before it rebuilds the proxy, so a cancel here
    // has almost certainly already been written to the instance.
    const controller = new AbortController();
    const scripts: string[] = [];
    let applies = 0;
    const session = {
      run: vi.fn(async (_command: string, options?: { input?: string }) => {
        scripts.push(options?.input ?? "");
        applies += 1;
        if (applies === 1) {
          controller.abort();
          throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
        }
        return { code: 0, stdout: transcript("applied"), stderr: "" };
      }) as unknown as SshSession["run"],
      end: vi.fn(),
    };

    await expect(
      tryEnableHttps(session, "203.0.113.5", {
        ...FAST,
        signal: controller.signal,
        check: async () => false,
      }),
    ).rejects.toThrow(/Cancelled/);

    expect(scripts.some((t) => t.includes("fqdn = null"))).toBe(true);
  });

  it("takes the domain back off when the user cancels the wait", async () => {
    // The domain is set before the certificate is asked for. Cancelling in
    // between and leaving it there points the dashboard at a name that serves
    // nothing.
    const { session, scripts } = fakeSession();
    const controller = new AbortController();
    controller.abort();

    await expect(
      tryEnableHttps(session, "203.0.113.5", {
        ...FAST,
        signal: controller.signal,
        check: async () => false,
      }),
    ).rejects.toThrow(/Cancelled/);

    expect(scripts.some((t) => t.includes("fqdn = null"))).toBe(true);
  });

  it("reports the encrypted address once a certificate arrives", async () => {
    const { session } = fakeSession();
    const outcome = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      check: async () => true,
    });

    expect(outcome).toEqual({
      instanceUrl: "https://203.0.113.5.sslip.io",
      secure: true,
    });
  });

  it("takes the domain back off when no certificate arrives", async () => {
    // Left pointed at a domain with no certificate, Coolify would answer its
    // own address with an error — a server nobody can open, which is worse
    // than one that is merely unencrypted.
    const { session, scripts } = fakeSession();
    const outcome = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      check: async () => false,
    });

    expect(outcome.secure).toBe(false);
    expect(outcome.instanceUrl).toBe("http://203.0.113.5:8000");
    expect(outcome.reason).toBeTruthy();
    // The last thing it did was clear the domain again.
    expect(scripts.at(-1)).toContain("$s->fqdn = null;");
  });

  it("does not point Coolify at a domain that is somewhere else", async () => {
    // Applying it would take the dashboard off its own address, and the
    // certificate check would pass against the host that answers there.
    const { session, scripts } = fakeSession();
    const outcome = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "example.com",
      resolve: async () => ({ addresses: ["198.51.100.9"], failed: false }),
      check: async () => true,
    });

    expect(outcome.secure).toBe(false);
    expect(outcome.instanceUrl).toBe("http://203.0.113.5:8000");
    expect(outcome.reason).toContain("does not point at this server");
    expect(scripts).toHaveLength(0);
  });

  it("still uses the derived name without asking DNS about it", async () => {
    // It is built from the address, so it resolves there by construction.
    const resolve = vi.fn();
    const { session } = fakeSession();
    const outcome = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      resolve: resolve as never,
      check: async () => true,
    });

    expect(outcome.secure).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("explains a failed custom domain differently from a shared one", async () => {
    // A domain of the user's own fails for a reason they can act on; the free
    // shared one fails for a reason they cannot.
    const { session } = fakeSession();
    const mine = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async () => ({ addresses: ["203.0.113.5"], failed: false }),
      check: async () => false,
    });
    expect(mine.reason).toContain("points at this server");

    const shared = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      check: async () => false,
    });
    expect(shared.reason).toContain("allowance");

    // A server given by name uses that name directly, so the free service is
    // not involved and blaming its allowance describes nothing.
    const named = await tryEnableHttps(session, "coolify.example.com", {
      ...FAST,
      check: async () => false,
    });
    expect(named.reason).not.toContain("allowance");
    expect(named.reason).toContain("points at this server");
  });

  it("does not touch the instance when there is no domain to ask for", async () => {
    const { session, scripts } = fakeSession();
    const outcome = await tryEnableHttps(session, "2606:4700::1", FAST);

    expect(outcome.secure).toBe(false);
    expect(scripts).toHaveLength(0);
  });

  it("stops when cancelled", async () => {
    const { session } = fakeSession();
    const controller = new AbortController();
    controller.abort();

    await expect(
      tryEnableHttps(session, "203.0.113.5", {
        ...FAST,
        signal: controller.signal,
        check: async () => false,
      }),
    ).rejects.toMatchObject({ kind: "user_cancelled" });
  });
});
