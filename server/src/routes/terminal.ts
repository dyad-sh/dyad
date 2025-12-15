
import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import os from "os";
import fs from "fs-extra";

interface TerminalSession {
    process: ChildProcess;
    ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

export function setupTerminalWebSocket(wss: WebSocketServer) {
    wss.on("connection", async (ws, req) => {
        console.log("[Terminal] Client connected");

        // Parse query params to get appId
        const url = new URL(req.url || "", "http://localhost");
        const appIdStr = url.searchParams.get("appId");

        if (!appIdStr) {
            ws.send("Error: appId required\n");
            ws.close();
            return;
        }

        const appId = Number(appIdStr);
        const appDir = path.join(os.tmpdir(), "dyad-apps", appIdStr);

        // Ensure directory exists
        if (!fs.existsSync(appDir)) {
            try {
                await fs.ensureDir(appDir);
            } catch (e) {
                ws.send(`Error: Could not create app directory: ${e}\n`);
                ws.close();
                return;
            }
        }

        // Spawn shell
        // Windows: use powershell or cmd
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

        console.log(`[Terminal] Spawning ${shell} in ${appDir}`);

        const termProcess = spawn(shell, [], {
            cwd: appDir,
            shell: true, // Use shell mode
            env: process.env, // Pass env vars
            stdio: ['pipe', 'pipe', 'pipe'] // Pipe stdio
        });

        const sessionId = `${appId}-${Date.now()}`;
        sessions.set(sessionId, { process: termProcess, ws });

        // Pipe stdout/stderr to WebSocket
        termProcess.stdout?.on('data', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data.toString());
            }
        });

        termProcess.stderr?.on('data', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data.toString());
            }
        });

        // Handle WebSocket messages (Input)
        ws.on('message', (message) => {
            const msg = message.toString();
            // Write to stdin
            // Note: simple piping. Ideally use node-pty for true terminal behavior (ctrl+c etc)
            if (termProcess.stdin) {
                termProcess.stdin.write(msg);
            }
        });

        // Cleanup
        ws.on('close', () => {
            console.log("[Terminal] Client disconnected, killing shell");
            termProcess.kill();
            sessions.delete(sessionId);
        });

        termProcess.on('exit', (code) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(`\r\n[Process exited with code ${code}]\r\n`);
                ws.close();
            }
        });

        // Send initial prompt or message
        ws.send(`Connected to ${shell}\r\nWorkingDirectory: ${appDir}\r\n`);
    });
}
