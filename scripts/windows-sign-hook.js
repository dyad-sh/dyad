const { execSync } = require("child_process");
const path = require("path");

// Path to signtool.exe bundled with electron-winstaller
// On GitHub Actions, this is the full path:
// D:\a\dyad\dyad\node_modules\electron-winstaller\vendor\signtool.exe
const SIGNTOOL_PATH = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron-winstaller",
  "vendor",
  "signtool.exe",
);

/**
 * Custom hook function for Windows code signing.
 * Only signs dyad.exe, skips all other files.
 * @param {string} filePath - Path to the file to sign
 */
module.exports = function (filePath) {
  const fileName = path.basename(filePath).toLowerCase();
  // Only sign dyad.exe, skip all other files
  if (fileName !== "dyad.exe") {
    return;
  }
  const signParams = `/sha1 ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256`;
  execSync(`"${SIGNTOOL_PATH}" sign ${signParams} "${filePath}"`, {
    stdio: "inherit",
  });
};
