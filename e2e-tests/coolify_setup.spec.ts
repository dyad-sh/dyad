import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { testWithConfig, type ElectronConfig } from "./helpers/test_helper";
import { Timeout } from "./helpers/constants";
import {
  startFakeSshServer,
  type FakeSshServer,
} from "../src/testing/fake_ssh_server";

/**
 * Installing Coolify onto a server, through the packaged app.
 *
 * Two tests, both of which need real Chromium and the shipped build: the whole
 * chain through to a stored token, and a server Dyad refuses. Everything that
 * does not look at the screen belongs in
 * src/coolify_setup/setup_flow.integration.test.ts, which drives the same SSH
 * server in a fraction of the time.
 *
 * Not covered anywhere: whether Coolify's installer seeds an account, whether
 * its seeder accepts an address, whether a certificate is issued. Those need a
 * real machine.
 */

/**
 * One server per test, started before the app is.
 *
 * The app launches during fixture setup, so anything the app must see in its
 * environment has to exist by then — which is why this runs in the pre-launch
 * hook rather than in the test body. What each test wants the server to do is
 * set afterwards by adjusting `state`, which the fake reads on every command.
 */
let sshServer: FakeSshServer | null = null;

const electronConfig: ElectronConfig = {
  preLaunchHook: async ({ userDataDir, fakeLlmPort }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    // The feature is behind an experiment, off unless the user turns it on.
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableOwnServerDeployment: true }),
      "utf8",
    );

    sshServer = await startFakeSshServer();
    // The form asks for an address, not a port, so both of these travel
    // through the same e2e seam as every other test-only behaviour here.
    process.env.DYAD_E2E_SSH_PORT = String(sshServer.port);
    process.env.DYAD_E2E_DASHBOARD_PORT = String(fakeLlmPort);
    // Whatever another spec left in the shared fake is not this test's setup.
    await resetCoolify(fakeLlmPort);
  },
};

const test = testWithConfig(electronConfig);

/** The server this test is talking to, adjustable before anything is done. */
function server(): FakeSshServer {
  if (!sshServer) throw new Error("The fake server was never started.");
  return sshServer;
}

test.afterEach(async () => {
  delete process.env.DYAD_E2E_SSH_PORT;
  delete process.env.DYAD_E2E_DASHBOARD_PORT;
  await sshServer?.close();
  sshServer = null;
});

/** The fake Coolify is shared per worker, so each test says what it expects. */
async function resetCoolify(port: number) {
  await fetch(`http://localhost:${port}/coolify/test/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

async function openInstaller(po: any) {
  // The publish panel needs an app to be about, and the deployment section it
  // carries needs a repository — Coolify deploys from one, so the tab that
  // holds the installer only appears once GitHub is connected.
  await po.sendPrompt("hi");
  await po.previewPanel.selectPreviewMode("publish");
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-setup-e2e-${Date.now()}`);
  await po.page.getByRole("tab", { name: "Your Own Server" }).click();
  await expect(po.page.getByTestId("coolify-server-setup")).toBeVisible();
}

async function fillAndInstall(po: any) {
  await po.page.getByTestId("coolify-setup-host").fill("127.0.0.1");
  await po.page.getByTestId("coolify-setup-email").fill("me@gmail.com");
  // Install is offered only for a server Dyad has looked at, so this is the
  // ordinary path rather than an extra step for the test.
  await po.page.getByTestId("coolify-setup-inspect").click();
  await expect(po.page.getByTestId("coolify-setup-inspection")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.page.getByTestId("coolify-setup-install").click();
}

test("installs Coolify onto a server and connects to it", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await openInstaller(po);

  // The key is the one manual step: nothing can reach the server without it.
  await expect(po.page.getByTestId("coolify-setup-public-key")).toContainText(
    "ssh-ed25519",
  );

  await fillAndInstall(po);

  // A loopback address can never be given a certificate, so the install ends
  // on plain HTTP — and the screen stays up to ask, because the token it
  // would keep travels over that address on every deploy.
  await expect(po.page.getByTestId("coolify-setup-done")).toBeVisible({
    timeout: Timeout.LONG,
  });
  await expect(po.page.getByTestId("coolify-setup-insecure")).toBeVisible();
  await expect(po.page.getByTestId("coolify-setup-done")).toContainText(
    "It is not kept unless you say so",
  );

  // Saying so is what stores it. Ticking here is the whole of the difference
  // between the picker below and the token form, which is what makes this the
  // one place the agreement is proved end to end.
  await po.page.getByTestId("coolify-setup-accept-insecure").click();
  await po.page.getByTestId("coolify-setup-continue").click();
  await expect(po.page.getByTestId("coolify-server-select")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  // The picker being present says only that a token was stored. This says the
  // address stored with it is one Dyad can actually talk to: the servers came
  // back from the instance the install pointed it at.
  await po.page.getByTestId("coolify-server-select").click();
  // Named, not "the first option": while discovery is in flight the picker
  // renders a "Loading servers..." row that is also an option, which would
  // satisfy a looser assertion without a server ever arriving.
  await expect(po.page.getByRole("option", { name: "production" })).toBeVisible(
    { timeout: Timeout.MEDIUM },
  );

  // Dyad offered a key rather than a password, and the installer really ran.
  expect(server().state.keyOffered).toBe(true);
  expect(server().state.commands.some((c) => c.includes("install.sh"))).toBe(
    true,
  );
  expect(server().state.commands.some((c) => c.includes("tinker"))).toBe(true);
});

test("refuses a server that already has Coolify on it", async ({ po }) => {
  server().state.probe = "mem=1967\ncontainer=coolify\nbusy=no\n";
  await po.setUp({ autoApprove: true });
  await openInstaller(po);
  await po.page.getByTestId("coolify-setup-host").fill("127.0.0.1");
  // Filled, so that a disabled Install button after the check means the
  // server was refused rather than that the form is incomplete.
  await po.page.getByTestId("coolify-setup-email").fill("me@gmail.com");
  await po.page.getByTestId("coolify-setup-inspect").click();

  await expect(po.page.getByTestId("coolify-setup-inspection")).toContainText(
    "already has Coolify",
    { timeout: Timeout.MEDIUM },
  );
  // And it really refuses: the button that would install over it is disabled.
  await expect(po.page.getByTestId("coolify-setup-install")).toBeDisabled();
});
