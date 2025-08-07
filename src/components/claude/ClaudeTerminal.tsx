import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { ClaudeWrapperClient } from '@/ipc/claude_wrapper_client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Square, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
// import 'xterm/css/xterm.css';

interface ClaudeTerminalProps {
  workingDirectory?: string;
  apiKey?: string;
  onOutput?: (output: string) => void;
  onError?: (error: string) => void;
}

export function ClaudeTerminal({
  workingDirectory,
  apiKey,
  onOutput,
  onError
}: ClaudeTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const claudeClient = useRef<ClaudeWrapperClient | null>(null);
  
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<string>('');

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    terminal.current = new Terminal({
      rows: 30,
      cols: 120,
      theme: {
        background: '#1a1a1a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        brightBlack: '#434c5e',
        brightBlue: '#81a1c1',
        brightCyan: '#8fbcbb',
        brightGreen: '#a3be8c',
        brightMagenta: '#b48ead',
        brightRed: '#bf616a',
        brightWhite: '#eceff4',
        brightYellow: '#ebcb8b',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: true,
    });

    // Create fit addon
    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);

    // Open terminal in container
    terminal.current.open(terminalRef.current);
    fitAddon.current.fit();

    // Handle terminal input
    terminal.current.onData((data: string) => {
      if (claudeClient.current && isRunning) {
        claudeClient.current.sendInput(data).catch(err => {
          console.error('Error sending input to Claude:', err);
        });
      }
    });

    // Initialize Claude client
    claudeClient.current = new ClaudeWrapperClient((window as any).electronAPI);

    // Set up Claude event listeners
    claudeClient.current.on('claude-output', handleClaudeOutput);
    claudeClient.current.on('claude-error', handleClaudeError);
    claudeClient.current.on('permission-request', handlePermissionRequest);
    claudeClient.current.on('claude-exit', handleClaudeExit);

    // Resize handler
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (claudeClient.current) {
        claudeClient.current.destroy();
      }
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

  const handleClaudeOutput = useCallback((output: string) => {
    if (terminal.current) {
      terminal.current.write(output);
    }
    onOutput?.(output);
  }, [onOutput]);

  const handleClaudeError = useCallback((error: string) => {
    if (terminal.current) {
      terminal.current.write(`\r\n\x1b[91mError: ${error}\x1b[0m\r\n`);
    }
    setError(error);
    onError?.(error);
  }, [onError]);

  const handlePermissionRequest = useCallback((request: string) => {
    setPendingPermission(request);
    if (terminal.current) {
      terminal.current.write(`\r\n\x1b[93mPermission Required:\x1b[0m\r\n${request}\r\n`);
    }
  }, []);

  const handleClaudeExit = useCallback((code: number | null) => {
    setIsRunning(false);
    setIsLoading(false);
    if (terminal.current) {
      terminal.current.write(`\r\n\x1b[96mClaude process exited with code: ${code}\x1b[0m\r\n`);
    }
  }, []);

  const startClaude = async () => {
    if (!claudeClient.current) return;

    setIsLoading(true);
    setError(null);
    
    try {
      const result = await claudeClient.current.startClaude({
        apiKey,
        workingDirectory,
        dangerouslySkipPermissions: false // We want to handle permissions explicitly
      });

      if (result.success) {
        setIsRunning(true);
        setSessionInfo(`Session started in: ${workingDirectory || process.cwd()}`);
        if (terminal.current) {
          terminal.current.write('\x1b[92mClaude Code started successfully!\x1b[0m\r\n');
          terminal.current.write('Type your commands or questions below:\r\n\r\n');
        }
      } else {
        setError(result.error || 'Failed to start Claude');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const stopClaude = async () => {
    if (!claudeClient.current) return;

    setIsLoading(true);
    try {
      await claudeClient.current.stop();
      setIsRunning(false);
      if (terminal.current) {
        terminal.current.write('\r\n\x1b[91mClaude Code stopped.\x1b[0m\r\n');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop Claude');
    } finally {
      setIsLoading(false);
    }
  };

  const approvePermission = async () => {
    if (!claudeClient.current) return;

    try {
      await claudeClient.current.approvePermission();
      setPendingPermission(null);
      if (terminal.current) {
        terminal.current.write('\x1b[92mPermission approved.\x1b[0m\r\n');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve permission');
    }
  };

  const denyPermission = async () => {
    if (!claudeClient.current) return;

    try {
      await claudeClient.current.denyPermission();
      setPendingPermission(null);
      if (terminal.current) {
        terminal.current.write('\x1b[91mPermission denied.\x1b[0m\r\n');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny permission');
    }
  };

  const sendCommand = async (command: string) => {
    if (!claudeClient.current || !isRunning) return;

    try {
      if (terminal.current) {
        terminal.current.write(`\r\n\x1b[96m> ${command}\x1b[0m\r\n`);
      }
      
      const response = await claudeClient.current.sendCommand(command);
      
      if (!response.success) {
        if (terminal.current) {
          terminal.current.write(`\x1b[91mCommand failed: ${response.error}\x1b[0m\r\n`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send command');
    }
  };

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Claude Code Terminal
            {isRunning && <Badge className="bg-green-500 text-white">Running</Badge>}
            {isLoading && <Badge variant="secondary">Loading...</Badge>}
            {error && <Badge variant="destructive">Error</Badge>}
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <Button
                onClick={startClaude}
                disabled={isLoading}
                size="sm"
                className="flex items-center gap-1"
              >
                <Play className="w-4 h-4" />
                Start Claude
              </Button>
            ) : (
              <Button
                onClick={stopClaude}
                disabled={isLoading}
                size="sm"
                variant="destructive"
                className="flex items-center gap-1"
              >
                <Square className="w-4 h-4" />
                Stop Claude
              </Button>
            )}
          </div>
        </div>
        
        {sessionInfo && (
          <div className="text-sm text-muted-foreground">
            {sessionInfo}
          </div>
        )}
        
        {error && (
          <div className="text-sm text-red-500 bg-red-50 p-2 rounded flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0">
        {/* Permission Request Dialog */}
        {pendingPermission && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 m-4 rounded">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-yellow-800">Permission Required</h4>
                <p className="text-sm text-yellow-700 mt-1 whitespace-pre-wrap">
                  {pendingPermission}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    onClick={approvePermission}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    onClick={denyPermission}
                    size="sm"
                    variant="destructive"
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Deny
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Terminal Container */}
        <div className="flex-1 p-4">
          <div
            ref={terminalRef}
            className="w-full h-full bg-black rounded border"
            style={{ minHeight: '400px' }}
          />
        </div>

        {/* Quick Commands */}
        {isRunning && (
          <div className="border-t p-4">
            <div className="text-sm text-muted-foreground mb-2">Quick Commands:</div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendCommand('help')}
              >
                Help
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendCommand('ls -la')}
              >
                List Files
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendCommand('pwd')}
              >
                Current Directory
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendCommand('git status')}
              >
                Git Status
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}