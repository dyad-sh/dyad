import { describe, expect, it, vi } from "vitest";
import { runServerSetup, type SetupStep } from "./setup_flow";
import { waitForAdminSeeded } from "./install";
import { tryEnableHttps } from "./https_setup";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { SshError } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";

const REAL_TOKEN = "1|EcaUxT43T5fgdLJmnYj0702tEUC6viy5jEhO3Ujk2298db95";

function transcript(output: string): string {
  return [
    '> echo "__DYAD_OUT_START__" . PHP_EOL;',
    "> __DYAD_OUT_START__",
    output,
    "__DYAD_OUT_END__",
  ].join("\n");
}

/**
 * A server that answers each command by what the command is for.
 *
 * Matching on the command rather than on call order means a test that changes
 * the number of steps does not silently start answering the wrong question.
 */
function fakeServer(
  overrides: {
    probe?: string;
    probeAfterInstall?: string;
    installExit?: number;
    seeded?: string;
    seederOutput?: string;
    httpsWorks?: boolean;
    version?: string;
    apiEnabled?: string;
    token?: string;
  } = {},
) {
  const commands: string[] = [];
  const scripts: string[] = [];
  let probes = 0;
  const session: SshSession = {
    run: vi.fn(async (command: string, options?: { input?: string }) => {
      commands.push(command);
      // Tinker scripts travel on stdin, so what is being asked is in the
      // input rather than in the command — which is the whole point of
      // piping them.
      const script = options?.input ?? "";
      scripts.push(script);
      if (command.includes("MemTotal")) {
        probes += 1;
        const after = overrides.probeAfterInstall;
        return {
          code: 0,
          stdout:
            (probes > 1 && after ? after : overrides.probe) ??
            "os=ubuntu\nmem=1967\ndir=no\ncontainer=\nbusy=no\narch=x86_64",
          stderr: "",
        };
      }
      if (command.includes("install.sh")) {
        return {
          code: overrides.installExit ?? 0,
          stdout: "installed",
          stderr: "",
        };
      }
      if (script.includes("constants.coolify.version")) {
        return {
          code: 0,
          stdout: transcript(overrides.version ?? "4.3.2"),
          stderr: "",
        };
      }
      if (script.includes("->exists()")) {
        return {
          code: 0,
          stdout: transcript(overrides.seeded ?? "yes"),
          stderr: "",
        };
      }
      if (command.includes("RootUserSeeder")) {
        return {
          code: 0,
          stdout:
            overrides.seederOutput ??
            "  ERROR  Invalid Root User Environment Variables\n  \u2192 The email field must be a valid email address.",
          stderr: "",
        };
      }
      if (script.includes("createToken")) {
        return {
          code: 0,
          stdout: transcript(overrides.token ?? REAL_TOKEN),
          stderr: "",
        };
      }
      if (script.includes("setupDynamicProxyConfiguration")) {
        return { code: 0, stdout: transcript("applied"), stderr: "" };
      }
      if (script.includes("is_api_enabled")) {
        return {
          code: 0,
          stdout: transcript(overrides.apiEnabled ?? "enabled"),
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    }) as unknown as SshSession["run"],
    end: vi.fn(),
  };
  return { session, commands, scripts, httpsWorks: overrides.httpsWorks };
}

function run(
  server: ReturnType<typeof fakeServer>,
  extra: Partial<Parameters<typeof runServerSetup>[0]> = {},
) {
  const steps: SetupStep[] = [];
  return {
    steps,
    promise: runServerSetup({
      target: { host: "203.0.113.5", username: "root", privateKey: "KEY" },
      adminEmail: "admin@gmail.com",
      verifyHostKey: () => true,
      connect: async () => server.session,
      waitForDashboardImpl: async () => true,
      // The real waiter, wound right down: what matters is that it polls, and
      // five-second sleeps would only make the suite slow.
      // The real HTTPS logic, wound down. What matters is that it asks, checks,
      // and reverts — five-second polls would only make the suite slow.
      tryEnableHttpsImpl: (session, host, options) =>
        tryEnableHttps(session, host, {
          ...options,
          timeoutMs: 40,
          intervalMs: 5,
          check: async () => server.httpsWorks !== false,
        }),
      waitForAdminSeededImpl: (session, email, options) =>
        waitForAdminSeeded(session, email, {
          ...options,
          timeoutMs: 40,
          intervalMs: 5,
        }),
      onProgress: ({ step }) => {
        if (steps[steps.length - 1] !== step) steps.push(step);
      },
      ...extra,
    }),
  };
}

describe("runServerSetup", () => {
  it("takes a bare server all the way to a token", async () => {
    const server = fakeServer();
    const { promise, steps } = run(server);
    const result = await promise;

    expect(result.token).toBe(REAL_TOKEN);
    expect(result.version).toBe("4.3.2");
    // HTTPS by default: the token carries root abilities and travels on every
    // deploy, so the address it travels to is worth a certificate.
    expect(result.dashboardUrl).toBe("https://203.0.113.5.sslip.io");
    expect(result.secure).toBe(true);
    expect(result.credentials.email).toBe("admin@gmail.com");
    expect(steps).toEqual([
      "connecting",
      "checking-server",
      "installing",
      "waiting-for-dashboard",
      "verifying-account",
      "securing",
      "creating-token",
      "done",
    ]);
  });

  it("looks at the server before installing anything", async () => {
    // The two things a user can fix immediately cost a second to find, and the
    // install costs minutes. Finding them afterwards wastes both.
    const server = fakeServer({
      probe: "os=ubuntu\nmem=1967\ndir=yes\ncontainer=coolify\nbusy=no",
    });
    await expect(run(server).promise).rejects.toMatchObject({
      kind: "precondition",
    });
    expect(server.commands.some((c) => c.includes("install.sh"))).toBe(false);
  });

  it("waits rather than racing the server's own first-boot updates", async () => {
    // A new cloud server holds the package lock while it updates itself, and
    // Coolify's installer needs that lock for Docker. Losing that race leaves
    // the server half set up, which is worse than a second of checking.
    const server = fakeServer({
      probe: "os=ubuntu\nmem=1967\ndir=no\ncontainer=\nbusy=yes",
    });
    await expect(run(server).promise).rejects.toThrow(/first-boot setup/);
    expect(server.commands.some((c) => c.includes("install.sh"))).toBe(false);
  });

  it("allows a retry after an install that did not finish", async () => {
    // A failed install leaves /data/coolify behind with nothing running.
    // Reading that as "already installed" refuses the retry that would fix it.
    const server = fakeServer({
      probe: "os=ubuntu\nmem=1967\ndir=yes\ncontainer=\nbusy=no",
    });
    await expect(run(server).promise).resolves.toBeTruthy();
  });

  it("refuses a server too small to run what it would install", async () => {
    const server = fakeServer({
      probe: "os=ubuntu\nmem=980\ndir=no\ncontainer=\nbusy=no",
    });
    await expect(run(server).promise).rejects.toMatchObject({
      kind: "precondition",
    });
    expect(server.commands.some((c) => c.includes("install.sh"))).toBe(false);
  });

  it("keeps the install when only the token could not be created", async () => {
    // The server is set up and usable; throwing here would discard that over
    // the one step the user can complete by hand.
    const server = fakeServer({ version: "3.1.0" });
    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toBeTruthy();
    expect(result.dashboardUrl).toBe("https://203.0.113.5.sslip.io");
    expect(result.credentials.password).toBeTruthy();
    // Too old to set up automatically, so nothing was switched on and
    // switching it on is still the user's to do.
    expect(result.apiEnabled).toBe(false);
  });

  it("does not tell the user a fresh install is too old when it was only slow", async () => {
    // A tinker one-liner over the 30s bound on a 2GB box right after an
    // install is ordinary. Reported as an unsupported version, the user is
    // told something false about a Coolify they installed minutes ago, and
    // preflight refuses to install again — so there is nothing to act on.
    const server = fakeServer();
    const answering = server.session.run as unknown as (
      command: string,
      options?: { input?: string },
    ) => Promise<unknown>;
    server.session.run = (async (
      command: string,
      options?: { input?: string },
    ) => {
      if ((options?.input ?? "").includes("constants.coolify.version")) {
        throw new SshError(
          "command-timeout",
          "timed out",
          DyadErrorKind.External,
        );
      }
      return answering(command, options);
    }) as unknown as SshSession["run"];

    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toMatch(/did not answer in time/);
    expect(result.tokenUnavailableReason).not.toMatch(/version of Coolify/);
    // The install still stands, and the address is still usable.
    expect(result.credentials.password).toBeTruthy();
  });

  it("does not claim the API was opened when opening it is what failed", async () => {
    // Reported once the server has confirmed it, not when the attempt
    // starts: saying it is on when it is not sends the user past the one
    // step they still have to do by hand.
    const server = fakeServer({ apiEnabled: "still-disabled" });
    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.apiEnabled).toBe(false);
  });

  it("names the token step when the link dies making one", async () => {
    // The API is already on by then, and the panel no longer tells the user
    // to enable it — so blaming the API step would state a cause its own
    // remedy contradicts.
    const server = fakeServer();
    const original = server.session.run as unknown as (
      command: string,
      options?: { input?: string },
    ) => Promise<unknown>;
    server.session.run = (async (
      command: string,
      options?: { input?: string },
    ) => {
      if ((options?.input ?? "").includes("createToken")) {
        throw new SshError(
          "timeout",
          "the connection stopped answering",
          DyadErrorKind.External,
        );
      }
      return original(command, options);
    }) as unknown as SshSession["run"];

    const result = await run(server).promise;

    expect(result.apiEnabled).toBe(true);
    expect(result.tokenUnavailableReason).toBe(
      "Coolify stopped answering while Dyad was making a token.",
    );
  });

  it("remembers the API was opened even when the token step then failed", async () => {
    // Opening the API and minting a token are two steps in that order, so a
    // mint that fails leaves the first done. Reporting otherwise sends the
    // user to turn on something that is already on.
    const server = fakeServer({ token: "" });
    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toBeTruthy();
    expect(result.apiEnabled).toBe(true);
  });

  it("keeps the install when HTTPS cannot even be attempted", async () => {
    // The server is installed and running by this point. HTTPS improves it;
    // failing to get it must not be able to throw it away.
    const server = fakeServer();
    const result = await run(server, {
      tryEnableHttpsImpl: async () => {
        throw new Error("proxy would not restart");
      },
    }).promise;

    expect(result.secure).toBe(false);
    expect(result.dashboardUrl).toBe("http://203.0.113.5:8000");
    expect(result.insecureReason).toContain("proxy would not restart");
    expect(result.credentials.password).toBeTruthy();
  });

  it("carries what a failed HTTPS attempt left behind onto the screen", async () => {
    // The run goes on and succeeds from here, so the failed state that would
    // otherwise carry this is never reached — the finished screen is the only
    // place left to say a domain is still pointing at the server.
    const server = fakeServer();
    const result = await run(server, {
      tryEnableHttpsImpl: async () => {
        throw Object.assign(new Error("proxy would not restart"), {
          warning: "Coolify may still be configured for x.sslip.io.",
        });
      },
    }).promise;

    expect(result.secure).toBe(false);
    expect(result.insecureReason).toContain("proxy would not restart");
    expect(result.insecureReason).toContain("may still be configured");
    // Two sentences. The library's message may or may not end in a stop of
    // its own, and neither spelling should run the two together.
    expect(result.insecureReason).toContain("restart. Coolify");
  });

  it("does not leave a stop stranded after the message's own punctuation", async () => {
    // Coolify's refusals end in a colon before whatever it printed, and an
    // empty answer leaves that colon last.
    const server = fakeServer();
    const result = await run(server, {
      tryEnableHttpsImpl: async () => {
        throw Object.assign(new Error("Coolify did not apply the domain:"), {
          warning: "Coolify may still be configured for x.sslip.io.",
        });
      },
    }).promise;

    expect(result.insecureReason).toContain("domain. Coolify");
    expect(result.insecureReason).not.toContain(":.");
  });

  it("still stops when the user cancels during HTTPS", async () => {
    // Cancelling is the user asking for the work to stop, which is not the
    // same as a step that could not be done.
    const server = fakeServer();
    await expect(
      run(server, {
        tryEnableHttpsImpl: async () => {
          throw Object.assign(new Error("Cancelled."), {
            kind: "user_cancelled",
          });
        },
      }).promise,
    ).rejects.toMatchObject({ kind: "user_cancelled" });
  });

  it("gives up on a server that stops answering after a failed install", async () => {
    // A frozen machine leaves the connection half-open: the question never
    // comes back and nothing else times it out. Unbounded, the run never
    // settles and the one-at-a-time slot is never freed, so no later setup
    // can start at all.
    const server = fakeServer({ installExit: 1 });
    const original = server.session.run as unknown as (
      command: string,
      options?: unknown,
    ) => Promise<unknown>;
    let installed = false;
    server.session.run = (async (command: string, options?: unknown) => {
      if (command.includes("install.sh")) {
        installed = true;
        return original(command, options);
      }
      // Every probe after the install goes unanswered.
      if (installed) return new Promise(() => {});
      return original(command, options);
    }) as unknown as SshSession["run"];

    const seen: string[] = [];
    await expect(
      run(server, {
        recoveryProbeTimeoutMs: 20,
        onAccountKnown: ({ credentials }) => seen.push(credentials.password),
      }).promise,
    ).rejects.toThrow(/Installing Coolify failed/);
    // A question that never came back is not an answer of "nothing was
    // installed". install.sh may already have written this password into
    // Coolify's .env, and dropping the only copy of it cannot be undone from
    // here — preflight refuses to install over the container again.
    expect(seen).toHaveLength(1);
  });

  it("hands the account over when the probe cannot tell either way", async () => {
    // Docker is there but will not answer, so what it said about Coolify is
    // not evidence. preflight reports that as the same "no Coolify here" as
    // an empty server, and only one of those means the password is dead.
    const server = fakeServer({
      installExit: 1,
      probeAfterInstall: "os=ubuntu\nmem=1967\ndockerok=no\nbusy=no",
    });
    const seen: string[] = [];
    await expect(
      run(server, {
        onAccountKnown: ({ credentials }) => seen.push(credentials.password),
      }).promise,
    ).rejects.toThrow(/Installing Coolify failed/);

    expect(seen).toHaveLength(1);
  });

  it("hands the account over when a failed install still left Coolify there", async () => {
    // install.sh writes the password into Coolify's own .env and brings the
    // stack up partway through. Failing after that leaves an account nobody
    // else knows the password for, and preflight refuses to install again.
    const server = fakeServer({
      installExit: 1,
      probeAfterInstall: "os=ubuntu\nmem=1967\ncontainer=coolify\nbusy=no",
    });
    const seen: string[] = [];
    await expect(
      run(server, {
        onAccountKnown: ({ credentials }) => seen.push(credentials.password),
      }).promise,
    ).rejects.toThrow();

    expect(seen).toHaveLength(1);
  });

  it("keeps a failed install from overwriting another server's password", async () => {
    // The common install failure is losing the package lock, which happens
    // before install.sh writes anything. Handing the account over at that
    // point would replace the credentials for a server that does exist with
    // ones for a server that does not.
    const server = fakeServer({ installExit: 1 });
    const seen: string[] = [];
    await expect(
      run(server, {
        onAccountKnown: ({ credentials }) => seen.push(credentials.password),
      }).promise,
    ).rejects.toThrow();

    expect(seen).toHaveLength(0);
  });

  it("hands over the account even when the dashboard never answers", async () => {
    // The poll runs on the user's side of their firewall; the account is
    // created by the server from the .env the installer already wrote. A
    // closed port 8000 says nothing about whether the account exists.
    const server = fakeServer();
    const seen: string[] = [];
    await expect(
      run(server, {
        onAccountKnown: ({ credentials }) => seen.push(credentials.password),
        waitForDashboardImpl: async () => false,
      }).promise,
    ).rejects.toThrow(/nothing answered on port 8000/);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeTruthy();
  });

  it("hands over the account as soon as it exists, not at the end", async () => {
    // Everything after this point can fail on a server that is installed and
    // running. Dyad invented this password and never showed it, so a caller
    // that only learns it on success cannot store what it never received.
    const server = fakeServer();
    const seen: Array<{ password: string; dashboardUrl: string }> = [];
    await expect(
      run(server, {
        onAccountKnown: ({ credentials, dashboardUrl }) =>
          seen.push({ password: credentials.password, dashboardUrl }),
        tryEnableHttpsImpl: async () => {
          throw Object.assign(new Error("Cancelled."), {
            kind: "user_cancelled",
          });
        },
      }).promise,
    ).rejects.toMatchObject({ kind: "user_cancelled" });

    expect(seen).toHaveLength(1);
    expect(seen[0].password).toBeTruthy();
    expect(seen[0].dashboardUrl).toBe("http://203.0.113.5:8000");
  });

  it("says so again once the address settles on HTTPS", async () => {
    // The address is part of signing in, and it is not known until the
    // certificate is. Left at the first answer, a later save would read as a
    // different Coolify and drop the account.
    const server = fakeServer();
    const seen: string[] = [];
    await run(server, {
      onAccountKnown: ({ dashboardUrl }) => seen.push(dashboardUrl),
    }).promise;

    expect(seen).toEqual([
      "http://203.0.113.5:8000",
      "https://203.0.113.5.sslip.io",
    ]);
  });

  it("keeps the install when enabling the API fails outright", async () => {
    const server = fakeServer({ apiEnabled: "still-disabled" });
    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toContain("API");
  });

  it("reports the seeder's own reason rather than inventing one", async () => {
    // The account never appears, so the seeder is run directly and what it
    // says is handed back. Guessing here is how a working gmail address got
    // reported as a domain that does not resolve.
    const server = fakeServer({ seeded: "no" });
    await expect(run(server).promise).rejects.toThrow(
      /must be a valid email address/,
    );
  });

  it("says where to finish when the account could not be seeded", async () => {
    // Coolify is on the machine either way, and preflight refuses to install
    // over it — so what it objected to is only half of what the user needs.
    // The other half was only ever said when there was nothing to report.
    const server = fakeServer({ seeded: "no" });
    await expect(run(server).promise).rejects.toThrow(
      /The server is installed — open http:\/\/203\.0\.113\.5:8000/,
    );
  });

  it("waits for an account that has not been created yet", async () => {
    // The dashboard answers before the startup service that seeds the account
    // has run, so the first answer is no on a perfectly healthy server.
    let asked = 0;
    const server = fakeServer();
    const inner = server.session.run as unknown as (
      c: string,
      o?: { input?: string },
    ) => Promise<unknown>;
    server.session.run = (async (c: string, o?: { input?: string }) => {
      if ((o?.input ?? "").includes("->exists()")) {
        asked += 1;
        return {
          code: 0,
          stdout: transcript(asked === 1 ? "no" : "yes"),
          stderr: "",
        };
      }
      return inner(c, o);
    }) as unknown as SshSession["run"];

    await expect(run(server).promise).resolves.toBeTruthy();
    expect(asked).toBeGreaterThan(1);
  });

  it("falls back to plain HTTP when no certificate arrives", async () => {
    // Certificates depend on a third party that can refuse. A server nobody
    // can open would be worse than one that is merely unencrypted, so the
    // domain is taken back off and the address returns to port 8000.
    const server = fakeServer({ httpsWorks: false });
    const result = await run(server).promise;

    expect(result.secure).toBe(false);
    expect(result.dashboardUrl).toBe("http://203.0.113.5:8000");
    expect(result.insecureReason).toBeTruthy();
    // The revert itself, not just that some tinker ran: reading the version
    // and minting a token are tinkers too, and they run in this test either
    // way.
    expect(server.scripts.some((t) => t.includes("fqdn = null"))).toBe(true);
  });

  it("stops when the dashboard never answers", async () => {
    const server = fakeServer();
    await expect(
      run(server, { waitForDashboardImpl: async () => false }).promise,
    ).rejects.toMatchObject({ kind: "external" });
  });

  it("fails when the install itself fails", async () => {
    const server = fakeServer({ installExit: 1 });
    await expect(run(server).promise).rejects.toMatchObject({
      kind: "external",
    });
  });

  it("closes the connection whichever way it ends", async () => {
    const ok = fakeServer();
    await run(ok).promise;
    expect(ok.session.end).toHaveBeenCalled();

    const bad = fakeServer({ installExit: 1 });
    await run(bad).promise.catch(() => {});
    expect(bad.session.end).toHaveBeenCalled();
  });

  it("hands over the password before the installer is asked to use it", async () => {
    // The installer writes it into the server's .env partway through a run of
    // minutes. Anything that ends the process in between takes the only copy
    // with it, and preflight then refuses to install over the container.
    const server = fakeServer();
    const seen: Array<{ password: string; at: number }> = [];
    let installs = 0;
    const original = server.session.run;
    server.session.run = vi.fn(
      async (command: string, options?: { input?: string }) => {
        if (command.includes("bash -s")) installs += 1;
        return (original as unknown as typeof server.session.run)(
          command,
          options,
        );
      },
    ) as unknown as SshSession["run"];

    await run(server, {
      onCredentialsBuilt: ({
        credentials,
      }: {
        credentials: { password: string };
      }) => seen.push({ password: credentials.password, at: installs }),
    }).promise;

    expect(seen).toHaveLength(1);
    expect(seen[0].password).toBeTruthy();
    // Before the installer had run, not after.
    expect(seen[0].at).toBe(0);
  });

  it("does not install when the caller could not keep the credentials", async () => {
    // The hook above runs before the installer for a reason, and the caller
    // refuses there when it cannot record the password. That only costs a
    // retry if nothing has been installed by then.
    const server = fakeServer();
    let installs = 0;
    const original = server.session.run;
    server.session.run = ((command: string, options?: { input?: string }) => {
      if (command.includes("bash -s")) installs += 1;
      return (original as unknown as typeof server.session.run)(
        command,
        options,
      );
    }) as unknown as SshSession["run"];

    await expect(
      run(server, {
        onCredentialsBuilt: () => {
          throw new DyadError("nowhere to keep it", DyadErrorKind.External);
        },
      }).promise,
    ).rejects.toThrow(/nowhere to keep it/);

    expect(installs).toBe(0);
  });

  it("says the link died rather than blaming the version for it", async () => {
    // Answering null for a dead connection sends the user to the screen that
    // tells them their freshly installed Coolify is too old to drive — for a
    // question that never reached it. The install still stands either way.
    const server = fakeServer();
    server.session.run = vi.fn(
      async (command: string, options?: { input?: string }) => {
        const script = options?.input ?? "";
        if (script.includes("constants.coolify.version")) {
          throw new SshError(
            "timeout",
            "the connection stopped answering",
            DyadErrorKind.External,
          );
        }
        if (command.includes("MemTotal")) {
          return {
            code: 0,
            stdout: "os=ubuntu\nmem=1967\ndir=no\ncontainer=\nbusy=no",
            stderr: "",
          };
        }
        if (script.includes("->exists()")) {
          return { code: 0, stdout: transcript("yes"), stderr: "" };
        }
        if (script.includes("setupDynamicProxyConfiguration")) {
          return { code: 0, stdout: transcript("applied"), stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    ) as unknown as SshSession["run"];

    const result = await run(server).promise;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toBe(
      "Coolify did not answer while Dyad was opening its API.",
    );
    expect(result.credentials.password).toBeTruthy();
    // The step that would have opened it is the one that failed, so it is
    // still the user's to do. Reported after it settles, not when it starts.
    expect(result.apiEnabled).toBe(false);
  });

  it("passes cancellation through rather than reporting it as a token problem", async () => {
    // A cancelled setup is the user's decision, not an instance that could not
    // be driven — reporting it as the latter would claim a server exists.
    const server = fakeServer();
    server.session.run = vi.fn(
      async (command: string, options?: { input?: string }) => {
        const script = options?.input ?? "";
        if (script.includes("constants.coolify.version")) {
          throw Object.assign(new Error("Cancelled."), {
            kind: "user_cancelled",
          });
        }
        if (command.includes("MemTotal")) {
          return {
            code: 0,
            stdout: "os=ubuntu\nmem=1967\ndir=no\ncontainer=\nbusy=no",
            stderr: "",
          };
        }
        if (script.includes("->exists()")) {
          return { code: 0, stdout: transcript("yes"), stderr: "" };
        }
        if (script.includes("setupDynamicProxyConfiguration")) {
          return { code: 0, stdout: transcript("applied"), stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    ) as unknown as SshSession["run"];

    await expect(run(server).promise).rejects.toMatchObject({
      kind: "user_cancelled",
    });
  });
});
