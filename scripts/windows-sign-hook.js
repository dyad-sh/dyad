const { execSync } = require("child_process");
const path = require("path");

const SIGNTOOL_PATH = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron-winstaller",
  "vendor",
  "signtool.exe",
);

module.exports = function (filePath) {
  console.log(`[windows-sign-hook] Called with: ${filePath}`);
  console.log(`[windows-sign-hook] SIGNTOOL_PATH: ${SIGNTOOL_PATH}`);
  console.log(
    `[windows-sign-hook] SM_CODE_SIGNING_CERT_SHA1_HASH: ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH ? "SET" : "NOT SET"}`,
  );

  const fileName = path.basename(filePath).toLowerCase();
  if (fileName !== "dyad.exe") {
    console.log(`[windows-sign-hook] Skipping: ${fileName}`);
    return;
  }

  console.log(`[windows-sign-hook] Signing: ${fileName}`);
  const certHash = process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
  const signParams = `/sha1 ${certHash} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256`;
  const cmd = `"${SIGNTOOL_PATH}" sign ${signParams} "${filePath}"`;
  const redactedSignParams = `/sha1 ${certHash ? "[REDACTED]" : "[NOT SET]"} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256`;
  const redactedCmd = `"${SIGNTOOL_PATH}" sign ${redactedSignParams} "${filePath}"`;
  console.log(`[windows-sign-hook] Command: ${redactedCmd}`);

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`[windows-sign-hook] Signing successful`);
  } catch (error) {
    console.error(`[windows-sign-hook] Signing failed:`, error);
    throw error;
  }
};
