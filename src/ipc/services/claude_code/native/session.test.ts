import { describe, expect, it } from "vitest";
import {
  MAX_LEDGER_ENTRIES,
  planClaudeSession,
  recordLedgerEntry,
} from "./session";

const ready = { claudeSessionId: "s1", claudeSessionState: "ready" };
const base = {
  sessionId: "s1",
  fingerprint: "strict-a",
  appFingerprint: "app",
  usageBaseline: {},
};
const plan = (
  overrides: Partial<Parameters<typeof planClaudeSession>[0]> = {},
) =>
  planClaudeSession({
    chat: ready,
    manifest: base,
    strictFingerprint: "strict-a",
    appFingerprint: "app",
    continuityRequested: false,
    assistantMessageIds: [1, 2],
    newSessionId: () => "new",
    ...overrides,
  });

describe("planClaudeSession", () => {
  it("keeps the original strict behavior without native tools", () => {
    expect(plan()).toEqual({
      resume: true,
      sessionId: "s1",
      continuity: false,
    });
    expect(plan({ strictFingerprint: "strict-b" })).toMatchObject({
      resume: false,
      sessionId: "new",
      reason: "changed",
    });
  });

  it("resumes across prompt and tool changes once native tools are on", () => {
    expect(
      plan({ strictFingerprint: "strict-b", continuityRequested: true }),
    ).toEqual({ resume: true, sessionId: "s1", continuity: true });
  });

  it("stays continuous after native tools are turned off again", () => {
    expect(
      plan({
        manifest: { ...base, continuity: true },
        strictFingerprint: "strict-b",
      }),
    ).toEqual({ resume: true, sessionId: "s1", continuity: true });
  });

  it("starts fresh for a different app or an interrupted session", () => {
    expect(
      plan({ continuityRequested: true, appFingerprint: "other" }),
    ).toMatchObject({ resume: false, reason: "changed" });
    expect(
      plan({
        continuityRequested: true,
        chat: { claudeSessionId: "s1", claudeSessionState: "interrupted" },
      }),
    ).toMatchObject({ resume: false, reason: "interrupted" });
  });

  it("rewinds to the newest remaining answered message after undo", () => {
    expect(
      plan({
        continuityRequested: true,
        manifest: {
          ...base,
          continuity: true,
          lastMessageId: 3,
          ledger: { "1": "uuid-1", "2": "uuid-2", "3": "uuid-3" },
        },
        assistantMessageIds: [1, 2],
      }),
    ).toEqual({
      resume: true,
      sessionId: "s1",
      resumeAt: "uuid-2",
      continuity: true,
      reason: "rewind",
    });
  });

  it("skips remaining messages the session never answered", () => {
    expect(
      plan({
        continuityRequested: true,
        manifest: {
          ...base,
          continuity: true,
          lastMessageId: 9,
          ledger: { "1": "uuid-1" },
        },
        // 2 was produced outside the session (e.g. a handoff message).
        assistantMessageIds: [1, 2],
      }),
    ).toMatchObject({ resume: true, resumeAt: "uuid-1" });
  });

  it("does not rewind when the answered message is still there", () => {
    expect(
      plan({
        continuityRequested: true,
        manifest: {
          ...base,
          continuity: true,
          lastMessageId: 2,
          ledger: { "1": "uuid-1", "2": "uuid-2" },
        },
        // A later non-session message must not trigger a rewind.
        assistantMessageIds: [1, 2, 5],
      }),
    ).toEqual({ resume: true, sessionId: "s1", continuity: true });
  });

  it("starts fresh when undo went back past every known message", () => {
    expect(
      plan({
        continuityRequested: true,
        manifest: {
          ...base,
          continuity: true,
          lastMessageId: 3,
          ledger: { "3": "uuid-3" },
        },
        assistantMessageIds: [],
      }),
    ).toMatchObject({ resume: false, reason: "rewound-too-far" });
  });
});

describe("recordLedgerEntry", () => {
  it("records the turn's rewind point and bounds the ledger", () => {
    let ledger: Record<string, string> = {};
    for (let id = 1; id <= MAX_LEDGER_ENTRIES + 5; id++)
      ledger = recordLedgerEntry(ledger, id, `uuid-${id}`);
    expect(Object.keys(ledger)).toHaveLength(MAX_LEDGER_ENTRIES);
    expect(ledger["1"]).toBeUndefined();
    expect(ledger[String(MAX_LEDGER_ENTRIES + 5)]).toBe(
      `uuid-${MAX_LEDGER_ENTRIES + 5}`,
    );
  });

  it("keeps the ledger unchanged when the turn produced no assistant uuid", () => {
    expect(recordLedgerEntry({ "1": "a" }, 2, undefined)).toEqual({ "1": "a" });
  });
});
