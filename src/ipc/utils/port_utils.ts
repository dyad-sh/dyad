import net from "net";

export function findAvailablePort(
  minPort: number,
  maxPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3;

    function tryPort() {
      if (attempts >= maxAttempts) {
        reject(
          new Error(
            `Failed to find an available port after ${maxAttempts} attempts.`,
          ),
        );
        return;
      }

      attempts++;
      const port =
        Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
      const server = net.createServer();

      server.once("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          // Port is in use, try another one
          console.log(`Port ${port} is in use, trying another...`);
          server.close(() => tryPort());
        } else {
          // Other error
          server.close(() => reject(err));
        }
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(port);
        });
      });

      server.listen(port, "localhost");
    }

    tryPort();
  });
}
