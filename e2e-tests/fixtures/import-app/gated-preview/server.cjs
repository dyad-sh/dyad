const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const portFlagIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portFlagIndex + 1]);
if (!Number.isInteger(port)) {
  throw new Error("Expected Dyad to pass --port to the dev script");
}

const releasePath = path.join(__dirname, ".release-preview-server");
const waitForRelease = setInterval(() => {
  if (!fs.existsSync(releasePath)) return;
  clearInterval(waitForRelease);
  http
    .createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><h1>Gated preview is ready</h1>");
    })
    .listen(port, "localhost", () => {
      console.log(`http://localhost:${port}/`);
    });
}, 25);
