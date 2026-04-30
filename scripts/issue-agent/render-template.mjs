import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const templatePath = process.env.TEMPLATE_PATH;
const outputPath = process.env.OUTPUT_PATH;
const outputName = process.env.OUTPUT_NAME || "prompt";
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!templatePath) {
  throw new Error("TEMPLATE_PATH is required");
}

const template = fs.readFileSync(templatePath, "utf8");
const rendered = template.replace(/{{([A-Z0-9_]+)}}/g, (_match, name) => {
  const value = process.env[name];
  if (typeof value !== "string") {
    throw new Error(`Missing template variable: ${name}`);
  }
  return value;
});

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
}

if (githubOutputPath) {
  const delimiter = `EOF_${crypto.randomUUID()}`;
  fs.appendFileSync(
    githubOutputPath,
    `${outputName}<<${delimiter}\n${rendered}\n${delimiter}\n`,
  );
}
