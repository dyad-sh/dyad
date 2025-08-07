import { useState, useEffect, useCallback, useRef } from 'react';
import { ClaudeWrapperClient } from '@/ipc/claude_wrapper_client';

export interface ClaudeCodeState {
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  output: string;
  pendingPermission: string | null;
  sessionInfo: {
    id?: string;
    projectPath?: string;
    startTime?: number;
  };
}

export interface ClaudeCodeOptions {
  workingDirectory?: string;
  apiKey?: string;
  dangerouslySkipPermissions?: boolean;
}

export function useClaudeCode(options: ClaudeCodeOptions = {}) {
  const [state, setState] = useState<ClaudeCodeState>({
    isRunning: false,
    isLoading: false,
    error: null,
    output: '',
    pendingPermission: null,
    sessionInfo: {},
  });

  const clientRef = useRef<ClaudeWrapperClient | null>(null);
  const outputHistoryRef = useRef<string[]>([]);

  // Initialize Claude client
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      clientRef.current = new ClaudeWrapperClient((window as any).electronAPI);

      // Set up event listeners
      const client = clientRef.current;

      client.on('claude-output', (output: string) => {
        outputHistoryRef.current.push(output);
        setState(prev => ({
          ...prev,
          output: prev.output + output,
        }));
      });

      client.on('claude-error', (error: string) => {
        setState(prev => ({
          ...prev,
          error,
        }));
      });

      client.on('permission-request', (request: string) => {
        setState(prev => ({
          ...prev,
          pendingPermission: request,
        }));
      });

      client.on('claude-exit', (_code: number | null) => {
        setState(prev => ({
          ...prev,
          isRunning: false,
          isLoading: false,
          sessionInfo: {
            ...prev.sessionInfo,
            endTime: Date.now(),
          },
        }));
      });

      return () => {
        client.destroy();
      };
    }
  }, []);

  const startClaude = useCallback(async (overrideOptions?: Partial<ClaudeCodeOptions>) => {
    if (!clientRef.current) {
      throw new Error('Claude client not initialized');
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const finalOptions = { ...options, ...overrideOptions };
      const result = await clientRef.current.startClaude(finalOptions);

      if (result.success) {
        setState(prev => ({
          ...prev,
          isRunning: true,
          isLoading: false,
          sessionInfo: {
            projectPath: finalOptions.workingDirectory,
            startTime: Date.now(),
          },
          output: '', // Reset output for new session
        }));
        outputHistoryRef.current = [];
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: result.error || 'Failed to start Claude',
        }));
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [options]);

  const stopClaude = useCallback(async () => {
    if (!clientRef.current) return;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const result = await clientRef.current.stop();
      setState(prev => ({
        ...prev,
        isRunning: false,
        isLoading: false,
      }));
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to stop Claude';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, []);

  const sendCommand = useCallback(async (command: string) => {
    if (!clientRef.current || !state.isRunning) {
      throw new Error('Claude is not running');
    }

    try {
      const response = await clientRef.current.sendCommand(command);
      
      if (!response.success) {
        setState(prev => ({
          ...prev,
          error: response.error || 'Command failed',
        }));
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send command';
      setState(prev => ({
        ...prev,
        error: errorMessage,
      }));
      throw error;
    }
  }, [state.isRunning]);

  const sendInput = useCallback(async (input: string) => {
    if (!clientRef.current || !state.isRunning) {
      throw new Error('Claude is not running');
    }

    try {
      return await clientRef.current.sendInput(input);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send input';
      setState(prev => ({
        ...prev,
        error: errorMessage,
      }));
      throw error;
    }
  }, [state.isRunning]);

  const approvePermission = useCallback(async () => {
    if (!clientRef.current) return;

    try {
      const result = await clientRef.current.approvePermission();
      setState(prev => ({
        ...prev,
        pendingPermission: null,
      }));
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve permission';
      setState(prev => ({
        ...prev,
        error: errorMessage,
      }));
      throw error;
    }
  }, []);

  const denyPermission = useCallback(async () => {
    if (!clientRef.current) return;

    try {
      const result = await clientRef.current.denyPermission();
      setState(prev => ({
        ...prev,
        pendingPermission: null,
      }));
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to deny permission';
      setState(prev => ({
        ...prev,
        error: errorMessage,
      }));
      throw error;
    }
  }, []);

  const getStatus = useCallback(async () => {
    if (!clientRef.current) return null;

    try {
      return await clientRef.current.getStatus();
    } catch (error) {
      console.error('Failed to get Claude status:', error);
      return null;
    }
  }, []);

  const clearOutput = useCallback(() => {
    setState(prev => ({
      ...prev,
      output: '',
    }));
    outputHistoryRef.current = [];
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({
      ...prev,
      error: null,
    }));
  }, []);

  const getOutputHistory = useCallback(() => {
    return [...outputHistoryRef.current];
  }, []);

  return {
    // State
    ...state,
    
    // Actions
    startClaude,
    stopClaude,
    sendCommand,
    sendInput,
    approvePermission,
    denyPermission,
    getStatus,
    
    // Utilities
    clearOutput,
    clearError,
    getOutputHistory,
    
    // Computed
    hasOutput: state.output.length > 0,
    isIdle: !state.isRunning && !state.isLoading,
    canStart: !state.isRunning && !state.isLoading,
    canStop: state.isRunning && !state.isLoading,
  };
}