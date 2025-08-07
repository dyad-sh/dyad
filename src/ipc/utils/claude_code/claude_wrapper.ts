import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import log from "electron-log/main";
import { SecurityManager } from './security_manager';
import { SessionManager, ClaudeSession } from './session_manager';

const logger = log.scope("claude-wrapper");

export interface ClaudeOptions {
  apiKey?: string;
  workingDirectory?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // Timeout in milliseconds, default 300000 (5 minutes)
}

export interface ClaudeResponse {
  success: boolean;
  data?: string;
  error?: string;
  needsPermission?: boolean;
}

export class ClaudeWrapper extends EventEmitter {
  private claudeProcess: ChildProcess | null = null;
  private isRunning = false;
  private currentCommand: string | null = null;
  private outputBuffer: string = '';
  private errorBuffer: string = '';
  private commandQueue: Array<{ command: string; resolve: Function; reject: Function }> = [];
  private isProcessing = false;
  private securityManager: SecurityManager;
  private sessionManager: SessionManager;
  private currentSession: ClaudeSession | null = null;

  constructor(private options: ClaudeOptions = {}) {
    super();
    this.securityManager = new SecurityManager();
    this.sessionManager = new SessionManager();
    // Set default timeout if not provided
    if (!this.options.timeout) {
      this.options.timeout = 300000; // 5 minutes default
    }
    this.setupCleanup();
  }

  async startClaude(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Claude process already running");
      return;
    }

    // Initialize or load session for the working directory
    if (this.options.workingDirectory) {
      this.currentSession = await this.sessionManager.getOrCreateSessionForProject(
        this.options.workingDirectory
      );
      logger.info("Using session:", this.currentSession.id);
    }

    // Use minimal args to avoid command line length issues
    const args = [];
    if (this.options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    logger.info("Starting Claude process with args:", args);

    this.claudeProcess = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.workingDirectory || process.cwd(),
      env: {
        ...process.env,
        ...(this.options.apiKey && { ANTHROPIC_API_KEY: this.options.apiKey })
      }
    });

    this.setupEventHandlers();
    this.isRunning = true;
    this.emit('claude-started');
  }

  private setupEventHandlers(): void {
    if (!this.claudeProcess) return;

    this.claudeProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      this.outputBuffer += output;
      this.emit('claude-output', output);
      this.processOutput(output);
    });

    this.claudeProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();
      this.errorBuffer += error;
      this.emit('claude-error', error);
      logger.error("Claude stderr:", error);
    });

    this.claudeProcess.on('exit', (code: number | null) => {
      logger.info(`Claude process exited with code ${code}`);
      this.isRunning = false;
      this.emit('claude-exit', code);
      this.cleanup();
    });

    this.claudeProcess.on('error', (error: Error) => {
      logger.error("Claude process error:", error);
      this.emit('claude-error', error.message);
      this.cleanup();
    });
  }

  private async processOutput(output: string): Promise<void> {
    // Log output to session
    if (this.currentSession) {
      this.sessionManager.addConversationEntry({
        type: 'response',
        content: output
      });
    }

    // Check for permission prompts
    if (output.includes('Allow this action?') || output.includes('Proceed?')) {
      await this.handlePermissionRequest(output);
      return;
    }

    // Check for command completion indicators
    if (output.includes('✓') || output.includes('Done') || output.includes('Complete')) {
      this.processNextCommand();
    }
  }

  private async handlePermissionRequest(request: string): Promise<void> {
    try {
      const shouldApprove = await this.securityManager.handlePermissionRequest(request);
      
      if (shouldApprove) {
        await this.approvePermission();
        logger.info("Permission automatically approved");
      } else {
        // Emit event for manual handling
        this.emit('permission-request', request);
        logger.info("Permission requires manual approval");
      }

      // Log permission request to session
      if (this.currentSession) {
        this.sessionManager.addConversationEntry({
          type: 'permission',
          content: request,
          metadata: { approved: shouldApprove }
        });
      }
    } catch (error) {
      logger.error("Error handling permission request:", error);
      this.emit('permission-request', request);
    }
  }

  async sendCommand(command: string): Promise<ClaudeResponse> {
    return new Promise((resolve, reject) => {
      // Input validation
      if (!command || typeof command !== 'string') {
        reject(new Error("Invalid command: must be a non-empty string"));
        return;
      }
      
      if (command.length > 1_000_000) { // 1MB limit
        reject(new Error("Command too long: exceeds 1MB limit"));
        return;
      }
      
      // Log the command length for debugging
      logger.info(`Executing Claude Code with prompt length: ${command.length}`);
      
      this.commandQueue.push({ command, resolve, reject });
      this.processNextCommand();
    });
  }

  private async processNextCommand(): Promise<void> {
    if (this.isProcessing || this.commandQueue.length === 0) return;
    if (!this.isRunning || !this.claudeProcess) {
      await this.startClaude();
    }

    this.isProcessing = true;
    const { command, resolve, reject } = this.commandQueue.shift()!;

    try {
      this.currentCommand = command;
      this.outputBuffer = '';
      this.errorBuffer = '';

      // For long commands, log length but truncate the display
      const displayCommand = command.length > 100 ? command.substring(0, 100) + '...' : command;
      logger.info(`Sending command to Claude (${command.length} chars):`, displayCommand);
      
      // Send command via stdin to avoid command line length limitations
      if (this.claudeProcess!.stdin) {
        this.claudeProcess!.stdin.write(command + '\n');
      } else {
        throw new Error("Claude process stdin not available");
      }

      // Listen for command completion
      const onOutput = (data: string) => {
        // Simple heuristic for command completion
        if (data.includes('✓') || data.includes('$') || data.includes('>') || data.includes('Human:')) {
          clearTimeout(timeout);
          this.removeListener('claude-output', onOutput);
          
          resolve({
            success: true,
            data: this.outputBuffer.trim()
          });
          this.isProcessing = false;
          this.processNextCommand();
        }
      };

      // Set timeout for command completion
      const timeout = setTimeout(() => {
        logger.warn("Command timeout for:", displayCommand);
        this.removeListener('claude-output', onOutput); // SECURITY: Remove listener on timeout
        resolve({
          success: false,
          error: 'Command timeout',
          data: this.outputBuffer
        });
        this.isProcessing = false;
      }, this.options.timeout || 300000); // Configurable timeout

      this.on('claude-output', onOutput);

    } catch (error) {
      logger.error("Error sending command:", error);
      reject(error);
      this.isProcessing = false;
    }
  }

  async sendInput(input: string): Promise<void> {
    if (!this.isRunning || !this.claudeProcess) {
      throw new Error("Claude process not running");
    }

    this.claudeProcess.stdin?.write(input);
  }

  async approvePermission(): Promise<void> {
    await this.sendInput('y\n');
  }

  async denyPermission(): Promise<void> {
    await this.sendInput('n\n');
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.claudeProcess) return;

    logger.info("Stopping Claude process");
    this.claudeProcess.kill('SIGTERM');
    
    // Force kill if doesn't exit gracefully
    setTimeout(() => {
      if (this.isRunning && this.claudeProcess) {
        logger.warn("Force killing Claude process");
        this.claudeProcess.kill('SIGKILL');
      }
    }, 5000);
  }

  private cleanup(): void {
    this.isRunning = false;
    this.claudeProcess = null;
    this.currentCommand = null;
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.isProcessing = false;
    
    // Reject any pending commands
    this.commandQueue.forEach(({ reject }) => {
      reject(new Error("Claude process stopped"));
    });
    this.commandQueue = [];
  }

  private setupCleanup(): void {
    const cleanup = () => {
      if (this.isRunning) {
        this.stop();
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', cleanup);
  }

  // Getters for status
  get running(): boolean {
    return this.isRunning;
  }

  get currentOutput(): string {
    return this.outputBuffer;
  }

  get currentError(): string {
    return this.errorBuffer;
  }
}