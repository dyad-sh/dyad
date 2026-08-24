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

describe("certificateDomainFor, for a domain given by hand", () => {
  it("refuses a name nothing public can validate", async () => {
    // Same reasoning the derived names get. Asking anyway spends the whole
    // certificate wait — two minutes — on an answer that cannot arrive.
    expect(certificateDomainFor("203.0.113.5", "coolify.local")).toBeNull();
    expect(certificateDomainFor("203.0.113.5", "localhost")).toBeNull();
    expect(certificateDomainFor("203.0.113.5", "192.168.1.10")).toBeNull();
  });

  it("turns a bare address into the name the derived path would use", async () => {
    // No authority certifies a bare address, so asking spends the whole wait
    // on a refusal — while the same address has a spelling that is a name.
    expect(certificateDomainFor("203.0.113.5", "203.0.113.5")).toBe(
      "203.0.113.5.sslip.io",
    );
  });

  it("keeps a name that could be validated", async () => {
    expect(certificateDomainFor("203.0.113.5", "coolify.example.com")).toBe(
      "coolify.example.com",
    );
    expect(
      certificateDomainFor("203.0.113.5", "https://coolify.example.com/"),
    ).toBe("coolify.example.com");
  });
});

describe("domainPointsAtServer", () => {
  const answers =
    (addresses: string[], failed = false) =>
    async () => ({ addresses, failed });

  it("says it points here when the domain resolves to the server", async () => {
    expect(
      await domainPointsAtServer("coolify.example.com", "203.0.113.5", {
        resolve: answers(["203.0.113.5"]),
      }),
    ).toBe("points-here");
  });

  it("is false when it still points at something else", async () => {
    // The user's old website answers HTTPS with a valid certificate of its
    // own, so the certificate check alone would call this a success.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers(["198.51.100.9"]),
      }),
    ).toBe("points-elsewhere");
  });

  it("says it does not know when the resolver could not be reached", async () => {
    // Told apart from an answer, because the certificate poll that follows
    // settles for any address serving a certificate it trusts — so a domain
    // still pointing at the machine the user is moving off would pass it.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers([], true),
      }),
    ).toBe("no-answer");
  });

  it("says it does not know when the records cannot be compared", async () => {
    // An IPv4 server and a domain carrying only an AAAA record. There is no
    // overlap to find by construction, so this is no more an answer about
    // where the domain points than a resolver that never replied — and the
    // certificate poll after it would take the old machine for proof.
    expect(
      await domainPointsAtServer("coolify.example.com", "203.0.113.5", {
        resolve: answers(["2001:db8::9"]),
      }),
    ).toBe("different-families");
  });

  it("does not object when the domain has no records yet", async () => {
    // The resolver answered; the name simply has nothing yet. It may be
    // minutes old, and the certificate wait is the real answer.
    expect(
      await domainPointsAtServer("example.com", "203.0.113.5", {
        resolve: answers([]),
      }),
    ).toBe("points-here");
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
    ).toBe("points-elsewhere");
  });

  it("accepts a domain that resolves to the same place as the named server", async () => {
    expect(
      await domainPointsAtServer("coolify.example.com", "box.example.com", {
        resolve: answers(["203.0.113.5"]),
      }),
    ).toBe("points-here");
  });

  it("says it does not know when the server's own name does not resolve", async () => {
    // A name only this machine or this network answers to: connectSsh reaches
    // it, plain DNS cannot see it, and there is nothing to hold the domain
    // against. Accepting compared the user's domain with nothing at all —
    // and the certificate poll afterwards takes any trusted answer for proof.
    const nothingForTheServer = async (target: string) => ({
      addresses: target === "box.internal" ? [] : ["198.51.100.9"],
      failed: target === "box.internal",
    });

    expect(
      await domainPointsAtServer("coolify.example.com", "box.internal", {
        resolve: nothingForTheServer,
      }),
    ).toBe("no-answer");
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

  it("will not take a custom domain on trust when DNS could not be checked", async () => {
    // The certificate poll settles for any address answering with a trusted
    // certificate, and resolves the name through the system rather than the
    // resolver asked here. A domain still pointing at the machine the user is
    // moving off would pass it, and its address would become the instance the
    // API token is sent to on every deploy.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async () => ({ addresses: [], failed: true }),
      // Would say yes, which is the point: it is never asked.
      check: async () => true,
    });

    expect(result.secure).toBe(false);
    expect(result.instanceUrl).toBe("http://203.0.113.5:8000");
    expect(result.reason).toMatch(/could not look up where/i);
  });

  it("names the domain it refused rather than the address", async () => {
    // The address was fine; it was the domain the user typed that could not
    // be certified, and blaming the address sends them to check that.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.local",
      check: async () => true,
    });

    expect(result.secure).toBe(false);
    expect(result.reason).toMatch(/^coolify\.local cannot be given/i);
  });

  it("says which of the two it could not settle", async () => {
    // Two refusals with two different remedies. Telling someone whose domain
    // resolved fine to go and check that it resolves sends them after the
    // thing that was working.
    const { session } = fakeSession();
    const noAnswer = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async () => ({ addresses: [], failed: true }),
      check: async () => true,
    });
    const crossFamily = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async () => ({ addresses: ["2001:db8::9"], failed: false }),
      check: async () => true,
    });

    expect(noAnswer.secure).toBe(false);
    expect(noAnswer.reason).toMatch(/could not look up where/i);
    expect(crossFamily.secure).toBe(false);
    expect(crossFamily.reason).toMatch(/different families/i);
    expect(crossFamily.reason).not.toMatch(/could not look up/i);
  });

  it("refuses a custom domain when the server's name says nothing", async () => {
    // The server answers to a name plain DNS cannot see. There is nothing to
    // hold the domain against, and the poll below settles for any address
    // serving a trusted certificate — so a domain pointing at the machine
    // being moved off would be taken for proof.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "box.internal", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async (name: string) => ({
        addresses: name === "box.internal" ? [] : ["198.51.100.9"],
        failed: name === "box.internal",
      }),
      check: async () => true,
    });

    expect(result.secure).toBe(false);
    expect(result.instanceUrl).toBe("http://box.internal:8000");
    expect(result.reason).toMatch(/could not look up where/i);
  });

  it("does not say which side holds which family", async () => {
    // The server is the IPv6 side here. A message naming the domain as the
    // one with IPv6 records would be false, and its remedy — give the
    // server's address in the same family — is what the user already did.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "box.example.com", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async (name: string) => ({
        addresses:
          name === "box.example.com" ? ["2001:db8::1"] : ["203.0.113.5"],
        failed: false,
      }),
      check: async () => true,
    });

    expect(result.secure).toBe(false);
    expect(result.reason).not.toMatch(/only IPv6/i);
    expect(result.reason).toMatch(/different families/i);
  });

  it("does not ask DNS about a name it derived from this server", async () => {
    // The sslip.io spelling of the host resolves to the host by construction,
    // so checking it can only fail for reasons that have nothing to do with
    // where it points — and the advice would be to fix a name that is right.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "203.0.113.5",
      resolve: async () => ({ addresses: [], failed: true }),
      check: async () => true,
    });

    expect(result.secure).toBe(true);
    expect(result.instanceUrl).toBe("https://203.0.113.5.sslip.io");
  });

  it("still checks an address typed there that is not this server", async () => {
    // Derived the same way, but from somewhere else — so it resolves
    // somewhere else by construction, which is exactly what to object to.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "198.51.100.9",
      resolve: async () => ({ addresses: ["198.51.100.9"], failed: false }),
      check: async () => true,
    });

    expect(result.secure).toBe(false);
    expect(result.reason).toMatch(/does not point at this server/i);
  });

  it("still accepts a custom domain whose name simply has no records yet", async () => {
    // The resolver answered. A name minutes old has nothing to say and the
    // certificate wait is the real test, which is not the same as Dyad never
    // having got an answer at all.
    const { session } = fakeSession();
    const result = await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      customDomain: "coolify.example.com",
      resolve: async () => ({ addresses: [], failed: false }),
      check: async () => true,
    });

    expect(result.secure).toBe(true);
    expect(result.instanceUrl).toBe("https://coolify.example.com");
  });

  it("says what it is doing while it takes the domain back off", async () => {
    // The only stretch with nothing behind it on screen. On a slow server a
    // silent wait here reads as a hang.
    const { session } = fakeSession();
    const said: string[] = [];

    await tryEnableHttps(session, "203.0.113.5", {
      ...FAST,
      check: async () => false,
      onProgress: (message) => said.push(message),
    });

    expect(said.join("")).toMatch(/Removing the temporary domain/);
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
