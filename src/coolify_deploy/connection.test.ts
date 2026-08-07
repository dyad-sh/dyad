import { describe, expect, it } from "vitest";
import {
  applyCoolifyConnectionChange,
  coolifyConnectionRow,
  coolifyConnectionFromRow,
  type CoolifyConnectionChange,
  type CoolifyConnectionState,
} from "./connection";

const AT = new Date(1_700_000_000_000);

const HOST = {
  serverUuid: "srv-1",
  projectUuid: "prj-1",
  environmentName: "production",
  domain: "https://demo.example.com",
} as const;

const STATES: CoolifyConnectionState[] = [
  { kind: "none" },
  { kind: "configured", ...HOST },
  { kind: "provisioned", ...HOST, applicationUuid: "app-1" },
  {
    kind: "deployed",
    ...HOST,
    applicationUuid: "app-1",
    appUrl: "https://demo.example.com",
    lastDeployedAt: AT,
  },
];

const CHANGES: CoolifyConnectionChange[] = [
  { type: "CONFIGURED", ...HOST },
  { type: "CONFIGURED", ...HOST, serverUuid: "srv-2" },
  { type: "CONFIGURED", ...HOST, projectUuid: "prj-2" },
  { type: "CONFIGURED", ...HOST, domain: null },
  { type: "DETACHED" },
  { type: "APPLICATION_RESOLVED", applicationUuid: "app-1" },
  { type: "APPLICATION_RESOLVED", applicationUuid: "app-2" },
  { type: "DEPLOY_SUCCEEDED", appUrl: "https://demo.example.com", at: AT },
  { type: "DEPLOY_SUCCEEDED", appUrl: null, at: AT },
  { type: "APPLICATION_GONE" },
];

describe("the connection is total over state x change", () => {
  it("answers every pair with a state that round-trips through its columns", () => {
    for (const state of STATES) {
      for (const change of CHANGES) {
        const next = applyCoolifyConnectionChange(state, change);
        // The columns are the only thing persisted, so a state that does not
        // survive them is a state the database cannot actually hold.
        expect(coolifyConnectionFromRow(coolifyConnectionRow(next))).toEqual(
          next,
        );
      }
    }
  });

  it("never writes a partial record", () => {
    // Every bug this replaces was a write that set some fields and left
    // others describing something that no longer existed.
    for (const state of STATES) {
      for (const change of CHANGES) {
        const row = coolifyConnectionRow(
          applyCoolifyConnectionChange(state, change),
        );
        // No row is a connection that should not exist, which the caller
        // turns into a delete rather than a write of nulls.
        if (row === null) continue;

        expect(Object.keys(row).sort()).toEqual([
          "appUrl",
          "applicationUuid",
          "domain",
          "environmentName",
          "lastDeployedAt",
          "projectUuid",
          "serverUuid",
        ]);
        // A row always names where it deploys — the columns are NOT NULL —
        // and an address or a deploy time without an application is exactly
        // what could be written before and cannot be expressed now.
        expect(row.serverUuid).toBeTruthy();
        expect(row.projectUuid).toBeTruthy();
        if (!row.applicationUuid) {
          expect(row.appUrl).toBeNull();
          expect(row.lastDeployedAt).toBeNull();
        }
      }
    }
  });
});

describe("moving between hosts", () => {
  it("releases an application when the server changes", () => {
    const deployed = STATES[3];
    const next = applyCoolifyConnectionChange(deployed, {
      type: "CONFIGURED",
      ...HOST,
      serverUuid: "srv-2",
    });
    expect(next).toEqual({ kind: "configured", ...HOST, serverUuid: "srv-2" });
  });

  it("releases an application when the project changes", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "CONFIGURED",
      ...HOST,
      projectUuid: "prj-2",
    });
    expect(next.kind).toBe("configured");
  });

  it("keeps the application and its address when only the domain changes", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "CONFIGURED",
      ...HOST,
      domain: "https://other.example.com",
    });
    expect(next).toMatchObject({
      kind: "deployed",
      applicationUuid: "app-1",
      appUrl: "https://demo.example.com",
      domain: "https://other.example.com",
    });
  });
});

describe("what the pipeline reports", () => {
  it("drops a stale address when the application is replaced", () => {
    const next = applyCoolifyConnectionChange(STATES[3], {
      type: "APPLICATION_RESOLVED",
      applicationUuid: "app-2",
    });
    expect(next).toEqual({
      kind: "provisioned",
      ...HOST,
      applicationUuid: "app-2",
    });
  });

  it("leaves a deployed record alone when the same application is adopted", () => {
    expect(
      applyCoolifyConnectionChange(STATES[3], {
        type: "APPLICATION_RESOLVED",
        applicationUuid: "app-1",
      }),
    ).toEqual(STATES[3]);
  });

  it("ignores a result that arrives after the connection is gone", () => {
    expect(
      applyCoolifyConnectionChange(
        { kind: "none" },
        { type: "DEPLOY_SUCCEEDED", appUrl: "https://x.example.com", at: AT },
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("reading a stored row", () => {
  it("treats no row as no connection", () => {
    // Which is now the only way to express it: disconnecting deletes the row
    // rather than nulling the fields that said where the app deployed.
    expect(coolifyConnectionFromRow(null)).toEqual({ kind: "none" });
    expect(coolifyConnectionFromRow(undefined)).toEqual({ kind: "none" });
  });

  it("treats an address without a deploy time as not yet deployed", () => {
    // Still reachable — both are nullable — so the address is dropped rather
    // than trusted, since nothing says it was ever answered at.
    expect(
      coolifyConnectionFromRow({
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        applicationUuid: "app-1",
        domain: null,
        appUrl: "https://stale.example.com",
        lastDeployedAt: null,
      }),
    ).toMatchObject({ kind: "provisioned" });
  });

  // Two degradations this used to need are gone: a row cannot name an
  // application without a server, and cannot omit an environment, because
  // those columns are NOT NULL.
});

describe("an application Coolify no longer has", () => {
  it("takes its address and deploy time with it", () => {
    // Reported before the replacement is created, so a create that fails does
    // not leave the panel offering a link to something that is gone.
    expect(
      applyCoolifyConnectionChange(STATES[3], { type: "APPLICATION_GONE" }),
    ).toEqual({ kind: "configured", ...HOST });
  });

  it("changes nothing when there was no application to lose", () => {
    for (const state of [STATES[0], STATES[1]]) {
      expect(
        applyCoolifyConnectionChange(state, { type: "APPLICATION_GONE" }),
      ).toEqual(state);
    }
  });
});
