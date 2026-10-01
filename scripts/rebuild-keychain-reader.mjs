import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log(
    `Skipping dyad-keychain-reader rebuild on ${process.platform}; it is macOS-only.`,
  );
  process.exit(0);
}

const env = { ...process.env };
delete env.npm_config_allow_scripts;

execFileSync("npm", ["rebuild", "dyad-keychain-reader"], {
  stdio: "inherit",
  env,
});
