import ssh2 from "ssh2";
import type { Connection } from "ssh2";
import { hostKeyFingerprint } from "@/ipc/utils/ssh_client";
import { generateSshKeyPair } from "./fake_ssh_server";

const { Server, utils } = ssh2;

/**
 * A server running self-hosted Supabase, as far as Dyad's edge function
 * commands can tell over SSH. It answers the fixed set of commands Dyad sends
 * (list containers, unpack a function archive, delete a function, read logs)
 * against an in-memory functions directory per container, the way the real
 * `docker exec` and `docker logs` commands behaved in a recorded upstream
 * install. A deploy lays files out as the real script does (a version
 * directory plus a one-line entry); pruning old versions is left to the
 * script's own tests, which run it with a real shell.
 */
export interface FakeEdgeRuntimeContainer {
  name: string;
  image: string;
}

export interface FakeEdgeRuntimeSsh {
  port: number;
  /** The fingerprint Dyad should pin for this server. */
  hostKeyFingerprint: string;
  /** Running containers, as `docker ps` lists them. */
  containers: FakeEdgeRuntimeContainer[];
  /** container -> path under /home/deno/functions -> file text. */
  files: Map<string, Map<string, string>>;
  /** What `docker logs` prints. */
  logs: string;
  /** Answer docker commands the way a user outside the docker group gets. */
  dockerDenied: boolean;
  /**
   * What the mail settings command prints, recorded from a real server.
   * Empty means no auth container was found.
   */
  mailSettingsOutput: string;
  /**
   * Public keys (OpenSSH format) allowed to log in. Null accepts any key.
   */
  authorizedKeys: string[] | null;
  commands: string[];
  /** SSH connections accepted so far. */
  connections: number;
  /** Ends every open connection, as a restarted sshd would. */
  dropConnections: () => void;
  close: () => Promise<void>;
}

const ENTRY_TARGET =
  /\.\/\.dyad\/(\d+-[0-9a-f]+)\/([A-Za-z][A-Za-z0-9_-]*)\/index\.ts/;

/**
 * The files of a function's current version, keyed as Dyad uploaded them
 * (`<function>/...`, `_shared/...`), found by following its entry file.
 */
export function currentFunctionFiles(
  fake: FakeEdgeRuntimeSsh,
  container: string,
  functionName: string,
): Map<string, string> {
  const dir = fake.files.get(container) ?? new Map<string, string>();
  const version = ENTRY_TARGET.exec(
    dir.get(`${functionName}/index.ts`) ?? "",
  )?.[1];
  const prefix = `${functionName}/.dyad/${version}/`;
  const files = new Map<string, string>();
  if (!version) return files;
  for (const [path, text] of dir) {
    if (path.startsWith(prefix)) files.set(path.slice(prefix.length), text);
  }
  return files;
}

const DOCKER_DENIED =
  "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n";

/** Reads a ustar archive back into path -> text. Regular files only. */
export function readTarArchive(archive: Uint8Array): Map<string, string> {
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  const field = (offset: number, length: number) =>
    decoder
      .decode(archive.subarray(offset, offset + length))
      .replace(/\0[\s\S]*$/, "");
  let offset = 0;
  while (offset + 512 <= archive.length) {
    if (archive.subarray(offset, offset + 512).every((byte) => byte === 0)) {
      break;
    }
    const name = field(offset, 100);
    const prefix = field(offset + 345, 155);
    const size = parseInt(field(offset + 124, 12), 8);
    const stored = parseInt(field(offset + 148, 8), 8);
    const header = archive.slice(offset, offset + 512);
    header.fill(0x20, 148, 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    if (checksum !== stored) {
      throw new Error(`Bad tar checksum for ${name}`);
    }
    const body = archive.subarray(offset + 512, offset + 512 + size);
    files.set(prefix ? `${prefix}/${name}` : name, decoder.decode(body));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export async function startFakeEdgeRuntimeSsh(
  containers: FakeEdgeRuntimeContainer[] = [
    { name: "supabase-edge-functions", image: "supabase/edge-runtime:v1.77.9" },
  ],
): Promise<FakeEdgeRuntimeSsh> {
  const hostKey = generateSshKeyPair().private;
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error) throw parsed;

  const fake: FakeEdgeRuntimeSsh = {
    port: 0,
    hostKeyFingerprint: hostKeyFingerprint(parsed.getPublicSSH()),
    containers,
    files: new Map(),
    logs: "",
    dockerDenied: false,
    authorizedKeys: null,
    mailSettingsOutput: "",
    commands: [],
    connections: 0,
    dropConnections: () => {},
    close: async () => {},
  };

  const dirOf = (container: string) => {
    let dir = fake.files.get(container);
    if (!dir) {
      dir = new Map();
      fake.files.set(container, dir);
    }
    return dir;
  };
  const known = (container: string) =>
    fake.containers.some((candidate) => candidate.name === container);
  // What the scripts print: the router's `workerTimeoutMs =` line, if any.
  const lifetimeOutput = (dir: Map<string, string>) =>
    `dyad-worker-lifetime:${
      /^.*workerTimeoutMs *=.*$/m.exec(dir.get("main/index.ts") ?? "")?.[0] ??
      ""
    }\n`;
  const removeTree = (dir: Map<string, string>, name: string) => {
    // Deleting the current key while iterating a Map is safe.
    for (const path of dir.keys()) {
      if (path.startsWith(`${name}/`)) dir.delete(path);
    }
  };

  const answer = (
    command: string,
    stdin: string,
  ): { code: number; stdout: string; stderr: string } => {
    fake.commands.push(command);
    if (fake.dockerDenied && /(^|\| )docker /.test(command)) {
      return { code: 1, stdout: "", stderr: DOCKER_DENIED };
    }
    if (command.startsWith("p=$(docker inspect -f '{{index .Config.Labels")) {
      return { code: 0, stdout: fake.mailSettingsOutput, stderr: "" };
    }
    if (command.startsWith("docker ps --format")) {
      return {
        code: 0,
        stdout: fake.containers
          .map((container) => `${container.name}\t${container.image}\n`)
          .join(""),
        stderr: "",
      };
    }
    const deploy = /^base64 -d \| docker exec -i (\S+) sh -c '([\s\S]*)'$/.exec(
      command,
    );
    if (deploy) {
      const [, container, script] = deploy;
      if (!known(container)) {
        return {
          code: 1,
          stdout: "",
          stderr: `Error response from daemon: No such container: ${container}\n`,
        };
      }
      const target = ENTRY_TARGET.exec(script);
      if (!target) throw new Error(`Unexpected deploy script: ${script}`);
      const [entryTarget, version, functionName] = target;
      const archive = readTarArchive(Buffer.from(stdin, "base64"));
      const dir = dirOf(container);
      const existed = [...dir.keys()].some((path) =>
        path.startsWith(`${functionName}/`),
      );
      for (const [path, text] of archive) {
        dir.set(`${functionName}/.dyad/${version}/${path}`, text);
      }
      dir.set(
        `${functionName}/index.ts`,
        `import * as entry from "${entryTarget}";\nexport default entry.default ?? {};\n`,
      );
      return {
        code: 0,
        stdout: `dyad-existed:${existed ? 1 : 0}\n${lifetimeOutput(dir)}`,
        stderr: "",
      };
    }
    const remove =
      /^docker exec (\S+) sh -c 'cd \/home\/deno\/functions && rm -rf -- (\S+) && echo "dyad-worker-lifetime:[^']*'$/.exec(
        command,
      );
    if (remove) {
      const dir = dirOf(remove[1]);
      removeTree(dir, remove[2]);
      return { code: 0, stdout: lifetimeOutput(dir), stderr: "" };
    }
    if (
      /^docker logs --timestamps --since [\d.]+ --tail \d+ \S+ 2>&1$/.test(
        command,
      )
    ) {
      return { code: 0, stdout: fake.logs, stderr: "" };
    }
    return {
      code: 127,
      stdout: "",
      stderr: `unexpected command: ${command}\n`,
    };
  };

  const open = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    client.on("error", () => open.delete(client));
    client.on("authentication", (ctx) => {
      if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
      const allowed =
        fake.authorizedKeys === null ||
        fake.authorizedKeys.some((key) => {
          const parsed = utils.parseKey(key);
          return (
            !(parsed instanceof Error) &&
            parsed.getPublicSSH().equals(ctx.key.data)
          );
        });
      return allowed ? ctx.accept() : ctx.reject(["publickey"]);
    });
    client.on("ready", () => {
      fake.connections++;
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          let stdin = "";
          stream.on("data", (chunk: Buffer) => (stdin += chunk.toString()));
          stream.on("end", () => {
            const result = answer(info.command, stdin);
            stream.write(result.stdout);
            stream.stderr.write(result.stderr);
            stream.exit(result.code);
            stream.end();
          });
        });
      });
    });
  });

  fake.port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    );
  });
  fake.dropConnections = () => {
    for (const client of open) client.end();
  };
  fake.close = () =>
    new Promise<void>((resolve) => {
      for (const client of open) client.end();
      server.close(() => resolve());
    });
  return fake;
}
