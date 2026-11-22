// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { generateSshKeyPair } from "@/testing/fake_ssh_server";
import {
  startFakeEdgeRuntimeSsh,
  type FakeEdgeRuntimeSsh,
} from "@/testing/fake_supabase_edge_runtime_ssh";
import {
  startFakeSupabaseSelfHosted,
  type FakeSupabaseSelfHosted,
} from "@/testing/fake_supabase_self_hosted_server";
import {
  getSupabaseSelfHostedEmailStatus,
  supabaseSelfHostedEmailStatusFrom,
} from "./supabase_self_hosted_email";
import {
  closeSupabaseSelfHostedSessions,
  parseMailSettingsOutput,
} from "./supabase_self_hosted_functions";

/** Recorded from a Coolify Supabase service, shortened to three containers. */
const INSTANCE_URL = "http://supabasekong-t2np.203.0.113.7.sslip.io";

const COOLIFY_OUTPUT = [
  "dyad-container:supabase-auth-t2np\tsupabase/gotrue:v2.186.0\tsupabase-auth",
  "dyad-container:supabase-kong-t2np\tkong/kong:3.9.1\tsupabase-kong",
  "dyad-container:supabase-edge-functions-t2np\tsupabase/edge-runtime:v1.71.2\tsupabase-edge-functions",
  "dyad-auth:supabase-auth-t2np",
  "GOTRUE_MAILER_AUTOCONFIRM=false",
  "GOTRUE_SMTP_HOST=",
  "API_EXTERNAL_URL=http://supabase-kong:8000",
  "",
].join("\n");

const withSmtpHost = (host: string) =>
  COOLIFY_OUTPUT.replace("GOTRUE_SMTP_HOST=", `GOTRUE_SMTP_HOST=${host}`);

describe("parseMailSettingsOutput", () => {
  it("reads the auth service's mail settings and the running containers", () => {
    expect(parseMailSettingsOutput(withSmtpHost("smtp.resend.com"))).toEqual({
      smtpHost: "smtp.resend.com",
      autoconfirm: false,
      apiExternalUrl: "http://supabase-kong:8000",
      runningNames: [
        "supabase-auth-t2np",
        "supabase-auth",
        "supabase-kong-t2np",
        "supabase-kong",
        "supabase-edge-functions-t2np",
        "supabase-edge-functions",
      ],
    });
  });

  it("finds nothing when the instance has no auth container", () => {
    expect(parseMailSettingsOutput("")).toBeNull();
  });
});

describe("supabaseSelfHostedEmailStatusFrom", () => {
  const mail = (output: string) => parseMailSettingsOutput(output);

  it("says sign-ups need no email when autoconfirm is on", () => {
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: true,
        mail: null,
      }),
    ).toEqual({ kind: "autoconfirm" });
    // The server's own setting counts when the settings endpoint failed.
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: null,
        mail: mail(
          COOLIFY_OUTPUT.replace("AUTOCONFIRM=false", "AUTOCONFIRM=true"),
        ),
      }),
    ).toEqual({ kind: "autoconfirm" });
  });

  it("knows email is broken with no host or a placeholder container", () => {
    // Coolify: an empty host, so every email is discarded.
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: false,
        mail: mail(COOLIFY_OUTPUT),
      }),
    ).toEqual({ kind: "not-configured" });
    // Upstream: a mail container that isn't running.
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: false,
        mail: mail(withSmtpHost("supabase-mail")),
      }),
    ).toEqual({ kind: "not-configured" });
  });

  const withLinks = (url: string) =>
    withSmtpHost("smtp.resend.com").replace(
      "API_EXTERNAL_URL=http://supabase-kong:8000",
      `API_EXTERNAL_URL=${url}`,
    );
  const configured = (output: string, instanceUrl = INSTANCE_URL) =>
    supabaseSelfHostedEmailStatusFrom({
      instanceUrl,
      autoconfirm: false,
      mail: mail(output),
    });

  it("reports a configured mail server, including one in the stack", () => {
    expect(configured(withLinks(INSTANCE_URL))).toEqual({
      kind: "configured",
      host: "smtp.resend.com",
      brokenLinkOrigin: null,
    });
    expect(
      configured(
        withLinks(INSTANCE_URL).replace("smtp.resend.com", "supabase-kong"),
      ),
    ).toMatchObject({ kind: "configured", host: "supabase-kong" });
  });

  it("flags email links that point away from the instance", () => {
    // Coolify's default: an internal hostname no browser can reach.
    expect(configured(withSmtpHost("smtp.resend.com"))).toMatchObject({
      brokenLinkOrigin: "http://supabase-kong:8000",
    });
    // A trailing path or slash on the same origin is fine.
    expect(configured(withLinks(`${INSTANCE_URL}/`))).toMatchObject({
      brokenLinkOrigin: null,
    });
    // Loopback names reach the same machine, but not another port.
    expect(
      configured(withLinks("http://localhost:8000"), "http://127.0.0.1:8000"),
    ).toMatchObject({ brokenLinkOrigin: null });
    expect(
      configured(withLinks("http://localhost:1"), "http://127.0.0.1:8000"),
    ).toMatchObject({ brokenLinkOrigin: "http://localhost:1" });
    // Unset leaves auth's own default, which Dyad can't judge.
    expect(configured(withLinks(""))).toMatchObject({ brokenLinkOrigin: null });
  });

  it("doesn't guess without the server's settings", () => {
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: false,
        mail: null,
      }),
    ).toEqual({ kind: "unknown" });
    expect(
      supabaseSelfHostedEmailStatusFrom({
        instanceUrl: INSTANCE_URL,
        autoconfirm: null,
        mail: null,
      }),
    ).toEqual({ kind: "unknown" });
  });
});

describe("getSupabaseSelfHostedEmailStatus", () => {
  let http: FakeSupabaseSelfHosted | undefined;
  let ssh: FakeEdgeRuntimeSsh | undefined;
  afterEach(async () => {
    closeSupabaseSelfHostedSessions();
    await http?.close();
    await ssh?.close();
    http = undefined;
    ssh = undefined;
  });

  async function instance({ withSsh }: { withSsh: boolean }) {
    http = await startFakeSupabaseSelfHosted("upstream");
    ssh = withSsh ? await startFakeEdgeRuntimeSsh() : undefined;
    return {
      id: "instance-1",
      name: "Home lab",
      url: http.url,
      studioUrl: null,
      anonKey: http.anonKey,
      serviceKey: http.serviceKey,
      ssh: ssh
        ? {
            host: "127.0.0.1",
            port: ssh.port,
            username: "deployer",
            privateKey: generateSshKeyPair().private,
            hostKeyFingerprint: ssh.hostKeyFingerprint,
            functionsContainer: "supabase-edge-functions",
          }
        : null,
    };
  }

  it("reads the server's mail settings over SSH, without its secrets", async () => {
    const target = await instance({ withSsh: true });
    ssh!.mailSettingsOutput = COOLIFY_OUTPUT;

    await expect(getSupabaseSelfHostedEmailStatus(target)).resolves.toEqual({
      kind: "not-configured",
    });
    // Only the three mail variables are let out of the container.
    expect(ssh!.commands[0]).toContain(
      "grep -E '^(GOTRUE_SMTP_HOST|GOTRUE_MAILER_AUTOCONFIRM|API_EXTERNAL_URL)='",
    );
  });

  it("reads autoconfirm from the instance without SSH", async () => {
    const target = await instance({ withSsh: false });
    http!.mailerAutoconfirm = true;

    await expect(getSupabaseSelfHostedEmailStatus(target)).resolves.toEqual({
      kind: "autoconfirm",
    });
  });

  it("is unknown when neither source can say", async () => {
    const target = await instance({ withSsh: true });
    // No auth container in the functions container's Compose project.
    ssh!.mailSettingsOutput = "";

    await expect(getSupabaseSelfHostedEmailStatus(target)).resolves.toEqual({
      kind: "unknown",
    });
  });
});
