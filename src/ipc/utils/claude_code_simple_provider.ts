import { executeClaudeCode, checkClaudeCodeAvailable } from "./claude_code_wrapper";

export class ClaudeCodeSimpleProvider {
  private isAvailable: boolean = false;
  private timeout: number = 300000; // 5 minutes default

  constructor(options?: { timeout?: number }) {
    if (options?.timeout) {
      this.timeout = options.timeout;
    }
  }

  async initialize(): Promise<void> {
    this.isAvailable = await checkClaudeCodeAvailable();
    // Don't throw immediately - let the first request handle the error
    if (!this.isAvailable) {
      console.warn("Claude Code CLI not detected during initialization");
    }
  }

  async generateResponse(prompt: string, cwd?: string): Promise<string> {
    // Re-check availability on each request
    const available = await checkClaudeCodeAvailable();
    if (!available) {
      throw new Error("Claude Code CLI is not available. Please ensure:\n1. Claude Code CLI is installed\n2. You are authenticated (run 'claude login')\n3. Claude Code is in your PATH");
    }

    return await executeClaudeCode(prompt, { cwd, timeout: this.timeout });
  }

  async *generateStreamingResponse(
    prompt: string, 
    cwd?: string
  ): AsyncGenerator<string, void, unknown> {
    // For now, just return the full response as a single chunk
    // Could be enhanced later to support true streaming
    const response = await this.generateResponse(prompt, cwd);
    yield response;
  }
}