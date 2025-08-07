import { ClaudeOptions, ClaudeResponse } from "./utils/claude_code/claude_wrapper";

export interface ClaudeWrapperEvents {
  'claude-output': (data: string) => void;
  'claude-error': (error: string) => void;
  'permission-request': (request: string) => void;
  'claude-exit': (code: number | null) => void;
}

export class ClaudeWrapperClient {
  private eventListeners: Map<keyof ClaudeWrapperEvents, Function[]> = new Map();

  constructor(private ipcRenderer: any) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.ipcRenderer.on('claude-wrapper:output', (_: any, data: string) => {
      this.emit('claude-output', data);
    });

    this.ipcRenderer.on('claude-wrapper:error', (_: any, error: string) => {
      this.emit('claude-error', error);
    });

    this.ipcRenderer.on('claude-wrapper:permission-request', (_: any, request: string) => {
      this.emit('permission-request', request);
    });

    this.ipcRenderer.on('claude-wrapper:exit', (_: any, code: number | null) => {
      this.emit('claude-exit', code);
    });
  }

  async startClaude(options: ClaudeOptions = {}): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke('claude-wrapper:start', options);
  }

  async sendCommand(command: string): Promise<ClaudeResponse> {
    return this.ipcRenderer.invoke('claude-wrapper:send-command', command);
  }

  async sendInput(input: string): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke('claude-wrapper:send-input', input);
  }

  async approvePermission(): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke('claude-wrapper:approve-permission');
  }

  async denyPermission(): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke('claude-wrapper:deny-permission');
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke('claude-wrapper:stop');
  }

  async getStatus(): Promise<{
    running: boolean;
    currentOutput?: string;
    currentError?: string;
  }> {
    return this.ipcRenderer.invoke('claude-wrapper:status');
  }

  // Event emitter methods
  on<K extends keyof ClaudeWrapperEvents>(event: K, listener: ClaudeWrapperEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off<K extends keyof ClaudeWrapperEvents>(event: K, listener: ClaudeWrapperEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof ClaudeWrapperEvents>(event: K, ...args: Parameters<ClaudeWrapperEvents[K]>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as any)(...args);
        } catch (error) {
          console.error(`Error in Claude wrapper event listener for ${event}:`, error);
        }
      });
    }
  }

  // Cleanup method
  destroy(): void {
    this.eventListeners.clear();
    this.ipcRenderer.removeAllListeners('claude-wrapper:output');
    this.ipcRenderer.removeAllListeners('claude-wrapper:error');
    this.ipcRenderer.removeAllListeners('claude-wrapper:permission-request');
    this.ipcRenderer.removeAllListeners('claude-wrapper:exit');
  }
}