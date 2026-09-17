// TLS-terminating TCP front for local Postgres (ported from the validated
// S-SQL spike, spikes/s-sql/pg-tls-front.mjs). Lets clients that hardcode
// ssl:true (ts-pg-schema-diff via Dyad's MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS)
// reach a no-SSL local Postgres: answers the SSLRequest with 'S', terminates
// TLS with the sim cert, pipes plaintext to the real server.
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";

const SSL_REQUEST_CODE = 80877103;

export function createPgTlsFront({
  listenPort = 5433,
  pgHost = "127.0.0.1",
  pgPort = 5432,
  certsDir,
}) {
  const secureContext = tls.createSecureContext({
    key: fs.readFileSync(`${certsDir}/server.key`),
    cert: fs.readFileSync(`${certsDir}/server.pem`),
  });

  const server = net.createServer((socket) => {
    socket.once("data", (first) => {
      const isSslRequest =
        first.length === 8 &&
        first.readInt32BE(0) === 8 &&
        first.readInt32BE(4) === SSL_REQUEST_CODE;

      if (!isSslRequest) {
        const upstream = net.connect(pgPort, pgHost, () => {
          upstream.write(first);
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        return;
      }

      socket.write("S", () => {
        const tlsSocket = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext,
        });
        const upstream = net.connect(pgPort, pgHost, () => {
          tlsSocket.pipe(upstream).pipe(tlsSocket);
        });
        upstream.on("error", () => tlsSocket.destroy());
        tlsSocket.on("error", () => upstream.destroy());
      });
    });
    socket.on("error", () => {});
  });
  server.listen(listenPort);
  return { close: () => server.close() };
}
