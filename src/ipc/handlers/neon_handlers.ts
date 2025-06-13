import log from "electron-log";
import { writeSettings } from "../../main/settings";
import {
  createLoggedHandler,
  createTestOnlyLoggedHandler,
} from "./safe_handle";
import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";

const logger = log.scope("neon_handlers");
const handle = createLoggedHandler(logger);
const testOnlyHandle = createTestOnlyLoggedHandler(logger);

export function registerNeonHandlers() {
  // Disconnect from Neon - clears the neon settings
  handle("neon:disconnect", async () => {
    writeSettings({
      neon: undefined,
    });
    logger.info("Disconnected from Neon");
  });

  testOnlyHandle("neon:fake-connect", async (event) => {
    // Call handleNeonOAuthReturn with fake data
    handleNeonOAuthReturn({
      token: "fake-neon-access-token",
      refreshToken: "fake-neon-refresh-token",
      expiresIn: 3600, // 1 hour
    });
    logger.info("Called handleNeonOAuthReturn with fake data during testing.");

    // Simulate the deep link event
    event.sender.send("deep-link-received", {
      type: "neon-oauth-return",
      url: "https://neon-oauth.dyad.sh/api/connect-neon/login",
    });
    logger.info("Sent fake neon deep-link-received event during testing.");
  });
}
