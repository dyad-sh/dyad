import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What survives clearing the token, and what does not.
 *
 * The application id is the one value in an app's Coolify row that the user
 * cannot re-enter: losing it makes the next deploy build a second application
 * beside the one already running, which then holds the domain the new one
 * wants. These cover the two paths that decide whether it survives.
 */

const settings: Record<string, unknown> = {};

/** The settings fixture is untyped, and these assertions are about secrets. */
function storedCoolify() {
  return (settings.coolify ?? {}) as {
    accessToken?: { value: string };
    admin?: { email: string; password: { value: string }; instanceUrl: string };
  };
}
const rows: Record<string, unknown>[] = [];

vi.mock("../../main/settings", () => ({
  readSettings: () => ({ ...settings }),
  writeSettings: (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    }
  },
}));

/**
 * The connection is its own table now, so the double models a row that can be
 * absent. `connection` holds it, or null when the app has none — which is what
 * disconnecting produces and what "not connected" means.
 */
const updateSet = vi.fn();
const deleted = vi.fn();
let connection: Record<string, unknown> | null = null;

vi.mock("../../db", () => ({
  db: {
    query: {
      apps: { findFirst: async () => rows[0], findMany: async () => rows },
      coolifyAppConnections: { findFirst: async () => connection ?? undefined },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        run: () => {
          updateSet(row);
          connection = row;
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deleted();
        connection = null;
        return Promise.resolve();
      },
    }),
    // A connection is replaced, not patched: the row is deleted and written
    // back inside one transaction. Applied in order here so the fake ends up
    // holding what the real one would.
    transaction: (fn: (tx: unknown) => void) => {
      fn({
        delete: () => ({ where: () => ({ run: () => (connection = null) }) }),
        insert: () => ({
          values: (row: Record<string, unknown>) => ({
            run: () => {
              updateSet(row);
              connection = row;
            },
          }),
        }),
      });
    },
  },
}));

vi.mock("@/coolify_deploy/controller", () => ({
  coolifyDeployRegistry: {
    onSnapshot: () => () => {},
    cancelAll: vi.fn(),
    cancelDeploy,
    getSnapshot: () => ({ type: "idle" }),
  },
}));

const cancelDeploy = vi.hoisted(() => vi.fn());
const listServers = vi.fn(
  async () => [] as Array<{ uuid: string; ip?: string }>,
);
vi.mock("../utils/coolify_client", () => ({
  CoolifyClient: class {
    listServers = listServers;
    listProjects = async () => [];
  },
}));

const dnsAnswers: Record<string, string[]> = {};
vi.mock("node:dns/promises", () => {
  // The lookup is a method rather than a closed-over function because the real
  // Resolver's methods are: they read state off the instance, so one passed
  // around unbound throws. A double that ignored `this` would keep answering,
  // and the one edit that breaks this call site — handing resolve4 straight to
  // a helper instead of calling it on the resolver — would pass here and fail
  // in production, where the check just goes quiet.
  return {
    Resolver: class {
      private answers(h: string, sep: string) {
        const answers = (dnsAnswers[h] ?? []).filter((a) => a.includes(sep));
        if (answers.length === 0)
          throw Object.assign(new Error("no data"), { code: "ENODATA" });
        return answers;
      }
      async resolve4(h: string) {
        return this.answers(h, ".");
      }
      async resolve6(h: string) {
        return this.answers(h, ":");
      }
    },
  };
});

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("./base", () => ({
  createTypedHandler: (
    contract: { channel: string },
    handler: (...args: unknown[]) => Promise<unknown>,
  ) => handlers.set(contract.channel, handler),
}));

const { registerCoolifyHandlers } = await import("./coolify_handlers");

const call = (channel: string, payload?: unknown) =>
  handlers.get(channel)!(null, payload);

const APP_ROW = { id: 1, name: "demo" };

const CONNECTED = {
  appId: 1,
  serverUuid: "srv-1",
  projectUuid: "prj-1",
  environmentName: "production",
  applicationUuid: "app-1",
  domain: "https://demo.example.com",
  appUrl: "https://demo.example.com",
  lastDeployedAt: new Date(5),
};

beforeEach(() => {
  handlers.clear();
  updateSet.mockClear();
  deleted.mockClear();
  cancelDeploy.mockClear();
  rows.length = 0;
  rows.push({ ...APP_ROW });
  connection = { ...CONNECTED };
  listServers.mockReset();
  listServers.mockResolvedValue([]);
  for (const key of Object.keys(dnsAnswers)) delete dnsAnswers[key];
  for (const key of Object.keys(settings)) delete settings[key];
  settings.coolify = {
    instanceUrl: "https://coolify.example.com",
    accessToken: { value: "tok" },
  };
  registerCoolifyHandlers();
});

describe("disconnecting an app that is not there", () => {
  it("reports it missing rather than quietly doing nothing", async () => {
    // Clearing a connection is a delete, and a delete for an app that does not
    // exist matches no rows — so without the check this answered success for
    // an app it had never heard of. Its three siblings all look first.
    rows.length = 0;

    await expect(call("coolify:disconnect", { appId: 1 })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("naming the stored token", () => {
  /**
   * Servers and projects are cached per instance, and two tokens on one
   * instance can see different teams. The renderer therefore needs to know the
   * token changed — without ever being handed the token.
   */
  it("changes when the token changes, on the same instance", async () => {
    const first: any = await call("coolify:get-status", { appId: 1 });
    settings.coolify = {
      instanceUrl: "https://coolify.example.com",
      accessToken: { value: "a-different-team-token" },
    };
    const second: any = await call("coolify:get-status", { appId: 1 });

    expect(first.tokenId).toBeTruthy();
    expect(second.tokenId).not.toBe(first.tokenId);
  });

  it("is the same for the same token, so the cache is not thrown away", async () => {
    const first: any = await call("coolify:get-status", { appId: 1 });
    const second: any = await call("coolify:get-status", { appId: 1 });
    expect(second.tokenId).toBe(first.tokenId);
  });

  it("does not carry the token to the renderer", async () => {
    settings.coolify = {
      instanceUrl: "https://coolify.example.com",
      accessToken: { value: "1|super-secret-value" },
    };
    const status: any = await call("coolify:get-status", { appId: 1 });

    // Not a substring check: "1|super-secret-value".slice(0, 12) contains no
    // "super-secret" either, so that alone passes for an id that is simply the
    // token truncated. What is asserted is that the id is a digest — hex, and
    // not any leading run of the token.
    const token = "1|super-secret-value";
    expect(status.tokenId).toMatch(/^[0-9a-f]{12}$/);
    for (let n = 1; n <= token.length; n++) {
      expect(status.tokenId).not.toBe(token.slice(0, n));
    }
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });

  it("is absent when there is no token", async () => {
    settings.coolify = { instanceUrl: "https://coolify.example.com" };
    const status: any = await call("coolify:get-status", { appId: 1 });

    expect(status.hasToken).toBe(false);
    expect(status.tokenId).toBeNull();
  });
});

describe("clearing the token", () => {
  it("keeps every app's application id and settings", async () => {
    await call("coolify:clear-token");

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
    expect(connection?.domain).toBe("https://demo.example.com");
    // Nothing was written to the apps table at all.
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("forgets every stored detail of the instance", async () => {
    // Dyad holds one Coolify at a time, so anything surviving here belongs to
    // an instance nothing is connected to — and the next connection would put
    // a stranger's password under its address. The dialog in front of this
    // shows all of it and asks the user to confirm before it goes.
    settings.coolify = {
      ...(settings.coolify as Record<string, unknown>),
      admin: {
        email: "me@gmail.com",
        password: { value: "Abc123@xyz" },
        instanceUrl: "https://coolify.example.com",
      },
    };

    await call("coolify:clear-token");

    expect(storedCoolify()).toEqual({});
  });

  it("still reports the app as disconnected", async () => {
    await call("coolify:clear-token");

    const status = (await call("coolify:get-status", { appId: 1 })) as {
      hasToken: boolean;
      connection: unknown;
      instanceUrl: string | null;
    };
    expect(status.hasToken).toBe(false);
    expect(status.connection).toBeNull();
    // The address is part of the instance being forgotten, not a leftover
    // convenience. It was on screen with a copy button on the way out.
    expect(status.instanceUrl).toBeNull();
  });

  it("lets the same instance pick up where it left off", async () => {
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://coolify.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    const status = (await call("coolify:get-status", { appId: 1 })) as {
      connection: { serverUuid: string } | null;
    };
    expect(status.connection?.serverUuid).toBe("srv-1");
    expect(connection?.applicationUuid).toBe("app-1");
  });

  it("keeps every app's record when the next token points somewhere else", async () => {
    // Those ids mean nothing on the new instance, but they describe
    // applications still running on the old one, and the application id
    // cannot be re-entered. Pointing back has to restore them untouched.
    listServers.mockResolvedValueOnce([{ uuid: "srv-elsewhere" }]);
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://other.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("keeps everything when the same instance answers at a new address", async () => {
    // The connection form tells people to give Coolify a domain and
    // certificate, which changes the address. Treating that as a new instance
    // abandons applications that are still running, with nothing left in Dyad
    // that can reach them.
    // A genuinely different address, so the repoint branch really runs — but
    // the instance still reports the server the app is pinned to.
    listServers.mockResolvedValueOnce([{ uuid: "srv-1" }]);
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://coolify.moved-here.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
  });
});

describe("the admin account Dyad created", () => {
  beforeEach(() => {
    settings.coolify = {
      ...(settings.coolify as Record<string, unknown>),
      admin: {
        email: "me@gmail.com",
        password: { value: "Abc123@xyz" },
        instanceUrl: "https://coolify.example.com",
      },
    };
  });

  it("survives the token for it being saved", async () => {
    // Setting up a server writes the account before there is any token, and
    // this is the call that supplies one. Replacing rather than merging here
    // would drop the password on the way in, and Dyad has the only copy.
    await call("coolify:save-token", {
      instanceUrl: "https://coolify.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(storedCoolify().admin?.email).toBe("me@gmail.com");
    expect(storedCoolify().admin?.password.value).toBe("Abc123@xyz");
  });

  it("goes when the instance is forgotten", async () => {
    // The account only opens the instance being signed out of, so keeping it
    // would leave a password for a Coolify nothing is connected to.
    await call("coolify:clear-token");

    expect(storedCoolify().admin).toBeUndefined();
  });
});

describe("moving an app to a different server or project", () => {
  it("releases the application, which cannot move with it", async () => {
    // Coolify cannot move an application between servers, so keeping its id
    // would send the next deploy back to the old one while the panel showed
    // the new.
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.serverUuid).toBe("srv-2");
    expect(connection?.applicationUuid).toBeNull();
    expect(connection?.appUrl).toBeNull();
    // Nothing has been deployed where it is going, so the old result must not
    // be shown against it.
    expect(connection?.lastDeployedAt).toBeNull();
    expect(cancelDeploy).toHaveBeenCalledWith(1);
  });

  it("keeps the application when only the domain changes", async () => {
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: "https://new.example.com",
      },
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.domain).toBe("https://new.example.com");
    expect(connection?.lastDeployedAt).not.toBeNull();
    expect(cancelDeploy).not.toHaveBeenCalled();
  });

  it("leaves a failed deploy's account alone when nothing was released", async () => {
    // An app that never had an application is configured before and after an
    // ordinary domain edit. Cancelling there would clear the error and log
    // that say why the last attempt failed.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: "https://new.example.com",
      },
    });

    expect(cancelDeploy).not.toHaveBeenCalled();
    expect(connection?.domain).toBe("https://new.example.com");
  });
});

describe("clearing a domain", () => {
  it("is refused for an app that is staying put", () => {
    // Coolify cannot regenerate an address once one is set, so the record
    // would say "none" while the instance kept serving the old one. The form
    // refuses it; a second window working from a stale status reaches here.
    return expect(
      call("coolify:save-connection", {
        appId: 1,
        connection: {
          serverUuid: "srv-1",
          projectUuid: "prj-1",
          environmentName: "production",
          domain: null,
        },
      }),
    ).rejects.toThrow(/cannot be removed/);
  });

  it("is allowed before anything exists in Coolify to contradict", async () => {
    // Configured but never deployed: no application, so nothing is serving
    // the old address and clearing it contradicts nothing.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.domain).toBeNull();
  });

  it("is allowed when the app is moving, which releases the application", async () => {
    // Nothing is left whose address this could disagree with.
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.domain).toBeNull();
    expect(connection?.applicationUuid).toBeNull();
  });
});

describe("moving an app that never got an application", () => {
  it("still clears the previous server's failed result", async () => {
    // A deploy can fail before the application is created — an unreachable
    // server, a refused deploy key. The record stays configured, but the
    // machine holds that server's error, and it does not describe the one the
    // user just switched to.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(cancelDeploy).toHaveBeenCalledWith(1);
  });
});

/**
 * Where a domain is told to point when the server is not on the public
 * internet.
 *
 * A homelab Coolify is a common shape, and the address it reports — directly
 * or through a name — is one no registrar will accept. Naming it anyway
 * produces the one instruction guaranteed to be impossible to follow.
 */
describe("checking a domain against a server that is not publicly reachable", () => {
  it("says nothing when the server's name resolves to a private address", async () => {
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "nas.local" }]);
    dnsAnswers["nas.local"] = ["192.168.1.50"];
    dnsAnswers["app.example.com"] = ["203.0.113.5"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("unknown");
    expect(result.expectedIp).toBeNull();
  });

  it("says nothing when the server's name resolves to private IPv6", async () => {
    // The literal path declines every IPv6 address; a name answering with one
    // reaches the same machine, so answering here would defer on paper only.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "nas.local" }]);
    dnsAnswers["nas.local"] = ["fd00::1"];
    dnsAnswers["app.example.com"] = ["203.0.113.5"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("unknown");
    expect(result.expectedIp).toBeNull();
  });

  it("accepts a domain that reaches a dual-stack server only over IPv6", async () => {
    // Declining to name an IPv6 address is not the same as refusing to count
    // one: the domain is pointed at this very machine, and saying so costs
    // nothing, since the answer names no address at all.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["203.0.113.5", "2606:4700::1"];
    dnsAnswers["app.example.com"] = ["2606:4700::1"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("ok");
  });

  it("says nothing when only the server's IPv4 is known and the domain is AAAA-only", async () => {
    // Coolify reported a bare address, so nothing here says whether the
    // machine also answers on IPv6. The domain may well be pointed at it.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "203.0.113.5" }]);
    dnsAnswers["app.example.com"] = ["2606:4700::1"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("unknown");
  });

  it("does not let a private IPv6 match vouch for a domain", async () => {
    // Both sides answer with the same ULA, but nothing on the public internet
    // reaches it — so the only address that decides anything here is the IPv4,
    // and it says the domain arrives at a different machine. The same shape
    // with a private IPv4 has always warned; this keeps the families honest.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["203.0.113.5", "fd00::1"];
    dnsAnswers["app.example.com"] = ["198.51.100.9", "fd00::1"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("points-elsewhere");
    expect(result.expectedIp).toBe("203.0.113.5");
  });

  it("warns when a dual-stack server's domain names a different machine", async () => {
    // The AAAA belongs to neither of the server's addresses, and we learned
    // both when the name resolved — so this mismatch is one we can see, and
    // the IPv4 we hold is a real answer to give.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["203.0.113.5", "2606:4700::1"];
    dnsAnswers["app.example.com"] = ["2001:4860:4860::8888"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("points-elsewhere");
    expect(result.expectedIp).toBe("203.0.113.5");
  });

  it("says nothing when a mismatch leaves no address to name", async () => {
    // A server reachable only over IPv6, against a domain pointed somewhere
    // else entirely. The mismatch is real and both addresses are routable —
    // but the only one we could offer is an IPv6 address, and naming one is
    // the thing this check does not do. So the warning has nothing to say.
    //
    // The server's address has to be public for this to reach the downgrade:
    // a private one is dropped as evidence first, and the verdict then turns
    // on there being no expectation at all, which is a different rule.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["2606:4700::1"];
    dnsAnswers["app.example.com"] = ["2001:db8::99"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("unknown");
    expect(result.expectedIp).toBeNull();
  });

  it("keeps the IPv4 answer when a name resolves to both families", async () => {
    // Declining IPv6 must not cost a dual-stack server its check.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["203.0.113.5", "2606:4700::1"];
    dnsAnswers["app.example.com"] = ["203.0.113.5"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("ok");
    expect(result.expectedIp).toBe("203.0.113.5");
  });

  it("says nothing when the server's name resolves to loopback", async () => {
    // The literal path already refuses 127.0.0.1; a name answering with it is
    // the same address wearing a different hat.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["127.0.0.1"];
    dnsAnswers["app.example.com"] = ["203.0.113.5"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("unknown");
    expect(result.expectedIp).toBeNull();
  });

  it("keeps the public address when a name answers on both", async () => {
    // Filtered rather than rejected: the public half is the one a domain can
    // actually be pointed at, so the comparison still has something to make.
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["192.168.1.50", "203.0.113.5"];
    dnsAnswers["app.example.com"] = ["203.0.113.5"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("ok");
    expect(result.expectedIp).toBe("203.0.113.5");
  });

  it("still compares a name that resolves publicly", async () => {
    listServers.mockResolvedValue([{ uuid: "srv-1", ip: "box.example.com" }]);
    dnsAnswers["box.example.com"] = ["203.0.113.5"];
    dnsAnswers["app.example.com"] = ["198.51.100.9"];

    const result = (await call("coolify:check-domain", {
      serverUuid: "srv-1",
      domain: "app.example.com",
    })) as { verdict: string; expectedIp: string | null };

    expect(result.verdict).toBe("points-elsewhere");
    expect(result.expectedIp).toBe("203.0.113.5");
  });
});
