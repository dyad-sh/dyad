import ssh2 from "ssh2";
import type { Connection } from "ssh2";

// Destructured from the default import: ssh2 is CommonJS, and named imports
// off it work under a bundler but not under plain Node ESM.
const { Server, utils } = ssh2;

/**
 * A server Dyad can install Coolify onto, enough of one to drive the flow.
 *
 * Started by the spec rather than inside the fake HTTP server, so a test can
 * read what was asked of it directly instead of through a control endpoint.
 *
 * The install path speaks SSH rather than HTTP, so the fake Coolify beside
 * this one cannot answer it. Dyad sends a small, fixed set of commands, and
 * this answers them the way a real box would — down to details the parser
 * depends on, like a tinker transcript echoing the script back with a "> "
 * prompt before the output arrives.
 *
 * Nothing here validates the key it is offered. Whether Dyad's key reaches a
 * server is the user's own step and there is nothing to check it against; what
 * matters for a test is that a key is offered at all, which is asserted by
 * refusing a connection that offers none.
 */

/**
 * An ed25519 key ssh2 will accept.
 *
 * Its own generator writes the public point without its leading byte when that
 * byte happens to be zero — one key in 256 — and its own parser then rejects
 * what it wrote. Unchecked, that is a suite which fails a few runs in a
 * thousand with a parse error nothing in the diff explains. Retried rather
 * than replaced with a fixed key, which would mean a private key in a public
 * repository.
 */
export function generateSshKeyPair(): { private: string; public: string } {
  for (let attempt = 0; attempt < 8; attempt++) {
    const pair = utils.generateKeyPairSync("ed25519");
    if (!(utils.parseKey(pair.private) instanceof Error)) return pair;
  }
  throw new Error("ssh2 generated 8 unusable ed25519 keys in a row.");
}

const START = "__DYAD_OUT_START__";
const END = "__DYAD_OUT_END__";

interface FakeServerBehaviour {
  /** What the batched probe reports. Defaults to a healthy empty machine. */
  probe?: string;
  /** Exit code for install.sh. Non-zero makes the install fail. */
  installExit?: number;
  /** Coolify's reported version, which decides the automatic token path. */
  version?: string;
  /**
   * Reports the exit status this long after closing the command's output.
   *
   * A real sshd sends EOF when the command's stdout closes and the exit
   * status when the process is reaped, and those are not the same moment.
   * Answering both in one batch — which is what this fake does otherwise —
   * hides every bug that depends on the gap.
   */
  exitAfterEofMs?: number;
}

interface FakeServerState extends FakeServerBehaviour {
  installed: boolean;
  /** Every command the flow sent, so a test can say what was asked. */
  commands: string[];
  keyOffered: boolean;
}

/**
 * A tinker transcript, shaped the way a real one is.
 *
 * tinker echoes every line it is fed with a "> " prompt, and the output of a
 * statement lands on the line after the prompt that produced it — so the
 * opening marker arrives with a prompt attached, which is exactly what
 * distinguishes it from the echo of the line that printed it. Getting this
 * wrong is not cosmetic: the parser matches on that prefix.
 */
function transcript(script: string, output: string): string {
  const echoed = script
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return [
    "Psy Shell v0.11 (PHP 8.2) by Justin Hileman",
    echoed,
    `> ${START}`,
    output,
    END,
    "",
  ].join("\n");
}

/**
 * The environment a `docker exec -e NAME='value'` command carries.
 *
 * Modelled because the scripts read their inputs with getenv() rather than
 * having them interpolated — that is the whole point of sending them that
 * way — so a fake that ignores it cannot tell a script reading the right
 * variable from one reading nothing at all.
 */
function environmentOf(command: string): Record<string, string> {
  const env: Record<string, string> = {};
  const pattern = /-e ([A-Z_][A-Z0-9_]*)='([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    env[match[1]] = match[2];
  }
  return env;
}

/** What the fake answers for one tinker script. */
function answerTinker(
  script: string,
  env: Record<string, string>,
  state: FakeServerState,
): string {
  if (script.includes("constants.coolify.version")) {
    return state.version ?? "4.3.2";
  }
  if (script.includes("is_api_enabled")) {
    return "enabled";
  }
  if (script.includes("->exists()")) {
    // Answered about the address the script actually asked about. A script
    // that read no variable, or the wrong one, gets told there is no account.
    if (!env.DYAD_ADMIN_EMAIL) return "no";
    return state.installed ? "yes" : "no";
  }
  if (script.includes("createToken")) {
    if (!env.DYAD_ADMIN_EMAIL) return "no-user";
    // Sanctum's shape: an id, a pipe, then 40+ alphanumerics. Dyad checks
    // that before storing it, so a token that merely looks token-ish is
    // rejected — as a stray warning line should be.
    return "1|EcaUxT43T5fgdLJmnYj0702tEUC6viy5jEhO3Ujk2298db95";
  }
  if (script.includes("setupDynamicProxyConfiguration")) {
    return "applied";
  }
  return "";
}

function answer(
  command: string,
  stdin: string,
  state: FakeServerState,
): {
  stdout: string;
  code: number;
} {
  state.commands.push(command);

  if (command.includes("MemTotal")) {
    return {
      stdout:
        state.probe ??
        `mem=1967\ncontainer=${state.installed ? "coolify" : ""}\nbusy=no\n`,
      code: 0,
    };
  }
  if (command.includes("install.sh")) {
    const code = state.installExit ?? 0;
    if (code === 0) state.installed = true;
    return {
      stdout: "1/6 Installing Docker...\n6/6 Coolify is up\n",
      code,
    };
  }
  if (command.includes("db:seed")) {
    return { stdout: "Seeding: RootUserSeeder\n", code: 0 };
  }
  if (command.includes("tinker")) {
    // The script arrives on stdin, which is the whole reason it does: a
    // script on a command line has to survive a shell as well as PHP.
    return {
      stdout: transcript(
        stdin,
        answerTinker(stdin, environmentOf(command), state),
      ),
      code: 0,
    };
  }
  return { stdout: "", code: 0 };
}

export interface FakeSshServer {
  port: number;
  state: FakeServerState;
  close: () => Promise<void>;
}

export async function startFakeSshServer(): Promise<FakeSshServer> {
  const state: FakeServerState = {
    installed: false,
    commands: [],
    keyOffered: false,
  };

  const open = new Set<Connection>();
  const server = new Server(
    // Generated per server: a fixed key checked into the repo would be a
    // private key in a public repository, however inert.
    { hostKeys: [generateSshKeyPair().private] },
    (client: Connection) => {
      open.add(client);
      client.on("close", () => open.delete(client));
      client.on("error", () => open.delete(client));
      client.on("authentication", (ctx) => {
        if (ctx.method === "publickey") {
          state.keyOffered = true;
          ctx.accept();
          return;
        }
        // Anything else is refused, so a test can prove a key was offered.
        ctx.reject(["publickey"]);
      });

      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec, _reject, info) => {
            const stream = acceptExec();
            let stdin = "";
            stream.on("data", (chunk: Buffer) => {
              stdin += chunk.toString("utf8");
            });
            const finish = () => {
              const { stdout, code } = answer(info.command, stdin, state);
              stream.write(stdout);
              if (!state.exitAfterEofMs) {
                stream.exit(code);
                stream.end();
                return;
              }
              // Output first, then the status, with a gap — a client that
              // closes the channel on EOF loses the status, and against a real
              // sshd would kill a command that was still running. Sent through
              // the protocol because ssh2's own exit() refuses once the write
              // side is done, which is not a restriction sshd has.
              stream.eof();
              setTimeout(() => {
                const inner = stream as unknown as {
                  _client: {
                    _protocol: { exitStatus(id: number, c: number): void };
                  };
                  outgoing: { id: number };
                };
                inner._client._protocol.exitStatus(inner.outgoing.id, code);
                stream.close();
              }, state.exitAfterEofMs);
            };
            // Answered when stdin closes, which the client always does —
            // with the script for the commands that take one, and empty for
            // the rest. Waiting on that rather than on a timer is why this
            // cannot answer a question it has not finished reading.
            stream.on("end", finish);
          });
        });
      });
    },
  );

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });

  return {
    port,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        // Closed as well as stopped: a server with a connection still open
        // never finishes closing, and the wait lands in afterEach.
        for (const client of open) client.end();
        open.clear();
        server.close(() => resolve());
      }),
  };
}
