import log from "electron-log";

/**
 * Keep test output out of the application's log file.
 *
 * electron-log writes to the real user log path even under vitest, so a test
 * run appended its errors to ~/Library/Logs/Meta Human OS/main.log alongside
 * the running app's. Reading that file to diagnose a live problem then meant
 * reading two programs interleaved, and a test-only failure looked exactly
 * like the app breaking — which it did, and cost a diagnosis.
 *
 * Console transport is left alone; vitest.config.ts already filters that.
 */
log.transports.file.level = false;
