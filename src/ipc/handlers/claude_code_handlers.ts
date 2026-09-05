import log from "electron-log";
import { createLoggedTypedHandler } from "./base";
import { claudeCodeContracts } from "../types/claude_code";
import type { ClaudeCodeStatus } from "../types/claude_code";
import { readSettings, writeSettings } from "@/main/settings";
import { hasDyadProKey } from "@/lib/schemas";
import { CLAUDE_CODE_MODEL_OPTIONS } from "@/shared/chat_backend";
import {
  getClaudeCodeAuthStatus,
  invalidateClaudeCodeCliCache,
  locateClaudeCodeCli,
  MIN_SUPPORTED_CLAUDE_CODE_VERSION,
  TESTED_CLAUDE_CODE_VERSION,
} from "@/claude_code/cli_locator";
import {
  flushPendingClaudeCodeUsageReports,
  getClaudeCodeUsageSummary,
} from "@/claude_code/usage_tracking";

const logger = log.scope("claude_code_handlers");
const typedHandle = createLoggedTypedHandler(logger);

export async function getClaudeCodeStatus({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<ClaudeCodeStatus> {
  if (refresh) {
    invalidateClaudeCodeCliCache();
  }
  const settings = readSettings();
  const cli = await locateClaudeCodeCli({ refresh });
  const auth = cli
    ? await getClaudeCodeAuthStatus(cli.executablePath, { refresh })
    : {
        state: "unknown" as const,
        method: null,
        subscriptionType: null,
        email: null,
        detail: null,
      };
  const billingReady = hasDyadProKey(settings);
  const billingBlockedReason = billingReady
    ? null
    : "A Dyad Pro account is required for the separate Dyad charge on subscription usage.";

  let setupGuidance: string | null = null;
  if (!cli) {
    setupGuidance =
      "Install Claude Code (https://claude.com/claude-code), then run `claude` in a terminal and sign in with your subscription.";
  } else if (!cli.versionSupported) {
    setupGuidance = `Update Claude Code: version ${cli.version ?? "unknown"} is installed but ${MIN_SUPPORTED_CLAUDE_CODE_VERSION}+ is required.`;
  } else if (auth.state === "unauthenticated") {
    setupGuidance =
      "Sign in to Claude Code: run `claude` in a terminal and use /login with your subscription account.";
  } else if (auth.state === "unknown") {
    setupGuidance =
      "Dyad could not confirm the Claude Code sign-in state. Run `claude auth status` in a terminal to check.";
  } else if (!billingReady) {
    setupGuidance = billingBlockedReason;
  }

  return {
    installed: cli !== null,
    executablePath: cli?.executablePath ?? null,
    version: cli?.version ?? null,
    versionSupported: cli?.versionSupported ?? false,
    minimumVersion: MIN_SUPPORTED_CLAUDE_CODE_VERSION,
    testedVersion: TESTED_CLAUDE_CODE_VERSION,
    auth,
    chargeAcknowledged: settings.claudeCodeChargeAcknowledged === true,
    billingReady,
    billingBlockedReason,
    setupGuidance,
    ready:
      cli !== null &&
      cli.versionSupported &&
      auth.state === "authenticated" &&
      billingReady,
    models: CLAUDE_CODE_MODEL_OPTIONS.map((option) => ({ ...option })),
  };
}

export function registerClaudeCodeHandlers() {
  typedHandle(claudeCodeContracts.getStatus, async (_event, input) =>
    getClaudeCodeStatus({ refresh: input?.refresh ?? false }),
  );

  typedHandle(claudeCodeContracts.acknowledgeCharge, async () => {
    // Read immediately before writing (no await in between) so a concurrent
    // settings change is not clobbered.
    const settings = readSettings();
    if (!settings.claudeCodeChargeAcknowledged) {
      writeSettings({ claudeCodeChargeAcknowledged: true });
    }
  });

  typedHandle(claudeCodeContracts.getUsageSummary, async (_event, input) =>
    getClaudeCodeUsageSummary({ limit: input?.limit }),
  );

  typedHandle(claudeCodeContracts.retryUsageReports, async () =>
    flushPendingClaudeCodeUsageReports({ force: true }),
  );
}
