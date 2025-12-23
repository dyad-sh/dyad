import { Terminal as TerminalIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
    appId: number | null;
}

export const Terminal = ({ appId }: TerminalProps) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!terminalRef.current || !appId) return;

        // Initialize XTerm
        const term = new XTerm({
            cursorBlink: true,
            theme: {
                background: '#1e1e1e',
                foreground: '#ffffff',
            },
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 12,
            rows: 20,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Connect WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${host}/ws/terminal?appId=${appId}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        term.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        ws.onopen = () => {
            term.write('\r\n\x1b[32mTarget Connected.\x1b[0m\r\n');
        };

        ws.onmessage = (event) => {
            term.write(event.data);
        };

        ws.onclose = () => {
            term.write('\r\n\x1b[31mConnection Closed.\x1b[0m\r\n');
        };

        ws.onerror = (event) => {
            console.error("WebSocket error:", event);
            term.write(`\r\n\x1b[31mConnection Error.\x1b[0m\r\n`);
            term.write(`\x1b[90mEnsure the backend server is running and try refreshing the page.\x1b[0m\r\n`);
        };

        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(terminalRef.current);

        return () => {
            ws.close();
            term.dispose();
            resizeObserver.disconnect();
        };
    }, [appId]);

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-white font-mono text-xs">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#333] bg-[#252526]">
                <TerminalIcon size={14} className="text-gray-400" />
                <span className="text-gray-300 font-medium">Terminal {appId ? `(#${appId})` : '(No App)'}</span>
            </div>
            <div className="flex-1 overflow-hidden p-1 relative">
                <div ref={terminalRef} className="h-full w-full absolute inset-0" />
            </div>
        </div>
    );
};

