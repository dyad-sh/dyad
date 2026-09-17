// TLS-terminating TCP front for local Postgres, so clients that hardcode
// ssl:true (Dyad's MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS, migration_utils.ts:26)
// can connect to a no-SSL local Postgres with zero Dyad patch. Speaks just
// enough of the Postgres wire protocol: reads the client's SSLRequest, answers
// 'S', performs the server TLS handshake with our spike cert, then pipes
// decrypted bytes to the real Postgres (which never sees TLS).
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";

const LISTEN_PORT = Number(process.env.TLS_FRONT_PORT ?? 5433);
const PG_HOST = process.env.TLS_FRONT_PG_HOST ?? "127.0.0.1";
const PG_PORT = Number(process.env.TLS_FRONT_PG_PORT ?? 5432);

const secureContext = tls.createSecureContext({
  key: fs.readFileSync(new URL("./certs/server.key", import.meta.url)),
  cert: fs.readFileSync(new URL("./certs/server.pem", import.meta.url)),
});

const SSL_REQUEST_CODE = 80877103;

net
  .createServer((socket) => {
    socket.once("data", (first) => {
      const isSslRequest =
        first.length === 8 &&
        first.readInt32BE(0) === 8 &&
        first.readInt32BE(4) === SSL_REQUEST_CODE;

      if (!isSslRequest) {
        // Plain client: pipe straight through, replaying the first packet.
        const upstream = net.connect(PG_PORT, PG_HOST, () => {
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
        const upstream = net.connect(PG_PORT, PG_HOST, () => {
          tlsSocket.pipe(upstream).pipe(tlsSocket);
        });
        upstream.on("error", () => tlsSocket.destroy());
        tlsSocket.on("error", () => upstream.destroy());
      });
    });
    socket.on("error", () => {});
  })
  .listen(LISTEN_PORT, () => {
    console.log(`pg tls front on :${LISTEN_PORT} -> ${PG_HOST}:${PG_PORT}`);
  });
