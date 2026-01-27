/**
 * AI Coding Agent
 * Autonomous coding assistant that can edit files, run commands, and debug code
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

// =============================================================================
// TYPES
// =============================================================================

export type AgentSessionId = string & { __brand: "AgentSessionId" };
export type AgentTaskId = string & { __brand: "AgentTaskId" };
export type AgentStatus = "idle" | "thinking" | "executing" | "waiting" | "error" | "completed";
export type TaskType = "code" | "debug" | "refactor" | "test" | "document" | "explain" | "review";

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresApproval: boolean;
}

export interface AgentConfig {
  modelId: string;
  maxIterations: number;
  autoApprove: boolean;
  capabilities: AgentCapability[];
  workingDirectory: string;
  safeMode: boolean; // Restricts dangerous operations
  contextFiles: string[];
  systemPrompt?: string;
}

export interface AgentSession {
  id: AgentSessionId;
  config: AgentConfig;
  status: AgentStatus;
  currentTask?: AgentTask;
  history: AgentAction[];
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface AgentTask {
  id: AgentTaskId;
  type: TaskType;
  description: string;
  context: TaskContext;
  status: AgentStatus;
  steps: AgentStep[];
  result?: TaskResult;
  createdAt: number;
  completedAt?: number;
}

export interface TaskContext {
  files: FileContext[];
  projectType?: string;
  language?: string;
  framework?: string;
  dependencies?: string[];
  errorLogs?: string[];
  testResults?: TestResult[];
  userInstructions: string;
}

export interface FileContext {
  path: string;
  content?: string;
  language: string;
  relevance: number; // 0-1, how relevant to the task
}

export interface AgentStep {
  id: string;
  type: StepType;
  description: string;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  action?: AgentAction;
  result?: StepResult;
  reasoning?: string;
  createdAt: number;
  completedAt?: number;
}

export type StepType = 
  | "analyze"
  | "plan"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "search"
  | "ask_user"
  | "verify"
  | "complete";

export interface AgentAction {
  type: ActionType;
  params: Record<string, any>;
  requiresApproval: boolean;
  approved?: boolean;
  executedAt?: number;
  result?: ActionResult;
}

export type ActionType =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "create_directory"
  | "run_terminal"
  | "search_files"
  | "search_code"
  | "ask_question"
  | "web_search"
  | "generate_code"
  | "refactor_code"
  | "run_tests"
  | "lint_code"
  | "format_code";

export interface ActionResult {
  success: boolean;
  output?: any;
  error?: string;
  changes?: FileChange[];
}

export interface FileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface StepResult {
  success: boolean;
  output?: any;
  error?: string;
  nextSteps?: string[];
}

export interface TaskResult {
  success: boolean;
  summary: string;
  changes: FileChange[];
  testsRun?: number;
  testsPassed?: number;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
}

export interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: AgentSessionId;
  taskId: AgentTaskId;
  stepId: string;
  action: AgentAction;
  description: string;
  risk: "low" | "medium" | "high";
  createdAt: number;
}

export type AgentEventType =
  | "session:started"
  | "session:ended"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "step:started"
  | "step:completed"
  | "step:failed"
  | "action:pending"
  | "action:approved"
  | "action:rejected"
  | "action:executed"
  | "thinking"
  | "output"
  | "error"
  | "approval:requested";

export interface AgentEvent {
  type: AgentEventType;
  sessionId: AgentSessionId;
  taskId?: AgentTaskId;
  stepId?: string;
  data?: any;
}

// =============================================================================
// DEFAULT CAPABILITIES
// =============================================================================

export const DEFAULT_CAPABILITIES: AgentCapability[] = [
  {
    id: "read_files",
    name: "Read Files",
    description: "Read contents of files in the workspace",
    enabled: true,
    requiresApproval: false,
  },
  {
    id: "write_files",
    name: "Write Files",
    description: "Create and modify files in the workspace",
    enabled: true,
    requiresApproval: true,
  },
  {
    id: "delete_files",
    name: "Delete Files",
    description: "Delete files from the workspace",
    enabled: false,
    requiresApproval: true,
  },
  {
    id: "run_commands",
    name: "Run Terminal Commands",
    description: "Execute commands in the terminal",
    enabled: true,
    requiresApproval: true,
  },
  {
    id: "run_tests",
    name: "Run Tests",
    description: "Execute test suites",
    enabled: true,
    requiresApproval: false,
  },
  {
    id: "search_web",
    name: "Web Search",
    description: "Search the web for documentation and solutions",
    enabled: true,
    requiresApproval: false,
  },
  {
    id: "install_packages",
    name: "Install Packages",
    description: "Install npm/pip/etc. packages",
    enabled: true,
    requiresApproval: true,
  },
];

// =============================================================================
// CODING AGENT
// =============================================================================

export class CodingAgent extends EventEmitter {
  private sessions: Map<AgentSessionId, AgentSession> = new Map();
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private runningProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSession(config: Partial<AgentConfig>): Promise<AgentSession> {
    const sessionId = randomUUID() as AgentSessionId;

    const session: AgentSession = {
      id: sessionId,
      config: {
        modelId: config.modelId || "default",
        maxIterations: config.maxIterations || 10,
        autoApprove: config.autoApprove || false,
        capabilities: config.capabilities || DEFAULT_CAPABILITIES,
        workingDirectory: config.workingDirectory || process.cwd(),
        safeMode: config.safeMode ?? true,
        contextFiles: config.contextFiles || [],
        systemPrompt: config.systemPrompt,
      },
      status: "idle",
      history: [],
      startedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.emitEvent("session:started", sessionId);

    return session;
  }

  async endSession(sessionId: AgentSessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Cancel any running processes
    for (const [id, proc] of this.runningProcesses) {
      if (id.startsWith(sessionId)) {
        proc.kill();
        this.runningProcesses.delete(id);
      }
    }

    session.status = "completed";
    session.endedAt = Date.now();
    this.emitEvent("session:ended", sessionId);
  }

  getSession(sessionId: AgentSessionId): AgentSession | null {
    return this.sessions.get(sessionId) || null;
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  // ---------------------------------------------------------------------------
  // TASK EXECUTION
  // ---------------------------------------------------------------------------

  async runTask(
    sessionId: AgentSessionId,
    type: TaskType,
    description: string,
    context?: Partial<TaskContext>
  ): Promise<AgentTask> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    const taskId = randomUUID() as AgentTaskId;
    const task: AgentTask = {
      id: taskId,
      type,
      description,
      context: {
        files: [],
        userInstructions: description,
        ...context,
      },
      status: "thinking",
      steps: [],
      createdAt: Date.now(),
    };

    session.currentTask = task;
    session.status = "thinking";
    this.emitEvent("task:started", sessionId, taskId);

    try {
      // Execute task asynchronously
      await this.executeTask(session, task);
    } catch (error) {
      task.status = "error";
      session.status = "error";
      session.error = String(error);
      this.emitEvent("task:failed", sessionId, taskId, undefined, { error: String(error) });
    }

    return task;
  }

  private async executeTask(session: AgentSession, task: AgentTask): Promise<void> {
    // Step 1: Analyze the task and gather context
    await this.addStep(session, task, {
      type: "analyze",
      description: "Analyzing task and gathering context",
    });

    // Gather file context
    task.context.files = await this.gatherFileContext(session, task);
    await this.completeStep(session, task, { success: true, output: task.context.files });

    // Step 2: Create execution plan
    await this.addStep(session, task, {
      type: "plan",
      description: "Creating execution plan",
    });

    const plan = await this.createPlan(session, task);
    await this.completeStep(session, task, { success: true, output: plan });

    // Step 3: Execute plan steps
    for (const planStep of plan.steps) {
      const step = await this.addStep(session, task, {
        type: planStep.type,
        description: planStep.description,
        reasoning: planStep.reasoning,
      });

      const action = this.createAction(planStep, session.config);
      step.action = action;

      // Check if approval needed
      if (action.requiresApproval && !session.config.autoApprove) {
        session.status = "waiting";
        const approval = await this.requestApproval(session, task, step, action);
        
        if (!approval) {
          step.status = "skipped";
          step.result = { success: false, error: "User rejected action" };
          this.emitEvent("action:rejected", session.id, task.id, step.id);
          continue;
        }
      }

      // Execute the action
      session.status = "executing";
      this.emitEvent("action:executed", session.id, task.id, step.id);

      try {
        const result = await this.executeAction(session, action);
        action.result = result;
        step.result = { success: result.success, output: result.output, error: result.error };
        step.status = result.success ? "completed" : "failed";
        await this.completeStep(session, task, step.result);
      } catch (error) {
        step.status = "failed";
        step.result = { success: false, error: String(error) };
        await this.completeStep(session, task, step.result);
      }
    }

    // Step 4: Verify results
    await this.addStep(session, task, {
      type: "verify",
      description: "Verifying changes",
    });

    const verification = await this.verifyChanges(session, task);
    await this.completeStep(session, task, verification);

    // Complete task
    task.status = "completed";
    task.completedAt = Date.now();
    task.result = this.summarizeTask(task);

    session.status = "idle";
    session.currentTask = undefined;
    this.emitEvent("task:completed", session.id, task.id, undefined, { result: task.result });
  }

  // ---------------------------------------------------------------------------
  // STEP MANAGEMENT
  // ---------------------------------------------------------------------------

  private async addStep(
    session: AgentSession,
    task: AgentTask,
    stepConfig: { type: StepType; description: string; reasoning?: string }
  ): Promise<AgentStep> {
    const step: AgentStep = {
      id: randomUUID(),
      type: stepConfig.type,
      description: stepConfig.description,
      reasoning: stepConfig.reasoning,
      status: "executing",
      createdAt: Date.now(),
    };

    task.steps.push(step);
    this.emitEvent("step:started", session.id, task.id, step.id, { step });

    return step;
  }

  private async completeStep(
    session: AgentSession,
    task: AgentTask,
    result: StepResult
  ): Promise<void> {
    const step = task.steps[task.steps.length - 1];
    if (!step) return;

    step.status = result.success ? "completed" : "failed";
    step.result = result;
    step.completedAt = Date.now();

    this.emitEvent(
      result.success ? "step:completed" : "step:failed",
      session.id,
      task.id,
      step.id,
      { result }
    );
  }

  // ---------------------------------------------------------------------------
  // CONTEXT GATHERING
  // ---------------------------------------------------------------------------

  private async gatherFileContext(
    session: AgentSession,
    task: AgentTask
  ): Promise<FileContext[]> {
    const contexts: FileContext[] = [];
    const workDir = session.config.workingDirectory;

    // Add explicitly specified context files
    for (const filePath of session.config.contextFiles) {
      try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        const ext = path.extname(filePath).slice(1);
        contexts.push({
          path: filePath,
          content,
          language: this.getLanguageFromExtension(ext),
          relevance: 1.0,
        });
      } catch {
        // File doesn't exist, skip
      }
    }

    // Try to find relevant files based on task
    const relevantPatterns = this.getRelevantPatterns(task);
    for (const pattern of relevantPatterns) {
      try {
        const files = await this.findFiles(workDir, pattern);
        for (const file of files.slice(0, 5)) {
          if (contexts.find((c) => c.path === file)) continue;
          try {
            const content = await fs.readFile(path.join(workDir, file), "utf-8");
            const ext = path.extname(file).slice(1);
            contexts.push({
              path: file,
              content: content.slice(0, 10000), // Limit content size
              language: this.getLanguageFromExtension(ext),
              relevance: 0.7,
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Pattern matching failed
      }
    }

    return contexts;
  }

  private getRelevantPatterns(task: AgentTask): string[] {
    const patterns: string[] = [];
    const desc = task.description.toLowerCase();

    // Always include package files
    patterns.push("package.json", "requirements.txt", "Cargo.toml", "go.mod");

    // Task-specific patterns
    if (desc.includes("test")) {
      patterns.push("**/*.test.*", "**/*.spec.*", "**/test/**");
    }
    if (desc.includes("config")) {
      patterns.push("**/*.config.*", "**/config/**");
    }
    if (desc.includes("component")) {
      patterns.push("**/components/**", "**/*.tsx", "**/*.vue");
    }
    if (desc.includes("api") || desc.includes("route")) {
      patterns.push("**/api/**", "**/routes/**");
    }

    return patterns;
  }

  private getLanguageFromExtension(ext: string): string {
    const map: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      rs: "rust",
      go: "go",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      vue: "vue",
      svelte: "svelte",
      html: "html",
      css: "css",
      scss: "scss",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sql: "sql",
    };
    return map[ext] || ext;
  }

  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    // Simplified file finding - would use glob in production
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subResults = await this.findFiles(fullPath, pattern);
          results.push(...subResults.map((f) => path.join(entry.name, f)));
        } else if (this.matchPattern(entry.name, pattern)) {
          results.push(entry.name);
        }
      }
    } catch {
      // Directory not accessible
    }
    return results;
  }

  private matchPattern(filename: string, pattern: string): boolean {
    // Simplified pattern matching
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(filename);
    }
    return filename === pattern;
  }

  // ---------------------------------------------------------------------------
  // PLANNING
  // ---------------------------------------------------------------------------

  private async createPlan(
    session: AgentSession,
    task: AgentTask
  ): Promise<{ steps: Array<{ type: StepType; description: string; reasoning: string }> }> {
    this.emitEvent("thinking", session.id, task.id, undefined, {
      message: "Planning approach...",
    });

    // Generate plan based on task type
    const steps: Array<{ type: StepType; description: string; reasoning: string }> = [];

    switch (task.type) {
      case "code":
        steps.push(
          { type: "read_file", description: "Read existing code", reasoning: "Understand current implementation" },
          { type: "write_file", description: "Write new code", reasoning: "Implement the requested feature" },
          { type: "run_command", description: "Run linter", reasoning: "Ensure code quality" }
        );
        break;

      case "debug":
        steps.push(
          { type: "read_file", description: "Read error logs", reasoning: "Understand the error" },
          { type: "search", description: "Search for related code", reasoning: "Find the source of the bug" },
          { type: "edit_file", description: "Apply fix", reasoning: "Resolve the issue" },
          { type: "run_command", description: "Run tests", reasoning: "Verify the fix" }
        );
        break;

      case "refactor":
        steps.push(
          { type: "read_file", description: "Analyze current code", reasoning: "Understand structure" },
          { type: "edit_file", description: "Apply refactoring", reasoning: "Improve code quality" },
          { type: "run_command", description: "Run tests", reasoning: "Ensure no regressions" }
        );
        break;

      case "test":
        steps.push(
          { type: "read_file", description: "Read code to test", reasoning: "Understand functionality" },
          { type: "write_file", description: "Write test cases", reasoning: "Cover key scenarios" },
          { type: "run_command", description: "Run tests", reasoning: "Verify tests pass" }
        );
        break;

      case "document":
        steps.push(
          { type: "read_file", description: "Read code", reasoning: "Understand what to document" },
          { type: "edit_file", description: "Add documentation", reasoning: "Improve code clarity" }
        );
        break;

      case "explain":
        steps.push(
          { type: "read_file", description: "Read code", reasoning: "Analyze for explanation" },
          { type: "analyze", description: "Generate explanation", reasoning: "Help user understand" }
        );
        break;

      case "review":
        steps.push(
          { type: "read_file", description: "Read code", reasoning: "Analyze for review" },
          { type: "analyze", description: "Identify issues", reasoning: "Find potential problems" }
        );
        break;
    }

    steps.push({ type: "complete", description: "Finalize changes", reasoning: "Complete the task" });

    return { steps };
  }

  // ---------------------------------------------------------------------------
  // ACTION EXECUTION
  // ---------------------------------------------------------------------------

  private createAction(
    planStep: { type: StepType; description: string },
    config: AgentConfig
  ): AgentAction {
    const capability = config.capabilities.find((c) => c.id === this.stepTypeToCapability(planStep.type));
    const requiresApproval = capability?.requiresApproval ?? true;

    return {
      type: this.stepTypeToActionType(planStep.type),
      params: {},
      requiresApproval: config.safeMode ? requiresApproval : false,
    };
  }

  private stepTypeToCapability(stepType: StepType): string {
    const map: Record<StepType, string> = {
      analyze: "read_files",
      plan: "read_files",
      read_file: "read_files",
      write_file: "write_files",
      edit_file: "write_files",
      delete_file: "delete_files",
      run_command: "run_commands",
      search: "read_files",
      ask_user: "read_files",
      verify: "run_tests",
      complete: "read_files",
    };
    return map[stepType] || "read_files";
  }

  private stepTypeToActionType(stepType: StepType): ActionType {
    const map: Record<StepType, ActionType> = {
      analyze: "read_file",
      plan: "read_file",
      read_file: "read_file",
      write_file: "write_file",
      edit_file: "edit_file",
      delete_file: "delete_file",
      run_command: "run_terminal",
      search: "search_code",
      ask_user: "ask_question",
      verify: "run_tests",
      complete: "read_file",
    };
    return map[stepType] || "read_file";
  }

  private async executeAction(session: AgentSession, action: AgentAction): Promise<ActionResult> {
    switch (action.type) {
      case "read_file":
        return this.readFile(session.config.workingDirectory, action.params.path);
      case "write_file":
        return this.writeFile(session.config.workingDirectory, action.params.path, action.params.content);
      case "edit_file":
        return this.editFile(session.config.workingDirectory, action.params.path, action.params.edits);
      case "delete_file":
        return this.deleteFile(session.config.workingDirectory, action.params.path);
      case "run_terminal":
        return this.runCommand(session, action.params.command);
      case "search_code":
        return this.searchCode(session.config.workingDirectory, action.params.query);
      case "run_tests":
        return this.runTests(session);
      default:
        return { success: true, output: "Action simulated" };
    }
  }

  private async readFile(workDir: string, filePath: string): Promise<ActionResult> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return { success: true, output: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async writeFile(workDir: string, filePath: string, content: string): Promise<ActionResult> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return {
        success: true,
        changes: [{ path: filePath, type: "created", linesAdded: content.split("\n").length }],
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async editFile(
    workDir: string,
    filePath: string,
    edits: Array<{ search: string; replace: string }>
  ): Promise<ActionResult> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
      let content = await fs.readFile(fullPath, "utf-8");
      
      for (const edit of edits || []) {
        content = content.replace(edit.search, edit.replace);
      }
      
      await fs.writeFile(fullPath, content, "utf-8");
      return {
        success: true,
        changes: [{ path: filePath, type: "modified" }],
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async deleteFile(workDir: string, filePath: string): Promise<ActionResult> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
      await fs.unlink(fullPath);
      return {
        success: true,
        changes: [{ path: filePath, type: "deleted" }],
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async runCommand(session: AgentSession, command: string): Promise<ActionResult> {
    return new Promise((resolve) => {
      const proc = spawn(command, [], {
        cwd: session.config.workingDirectory,
        shell: true,
        env: process.env,
      });

      const processId = `${session.id}:${randomUUID()}`;
      this.runningProcesses.set(processId, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
        this.emitEvent("output", session.id, undefined, undefined, { type: "stdout", data: data.toString() });
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
        this.emitEvent("output", session.id, undefined, undefined, { type: "stderr", data: data.toString() });
      });

      proc.on("close", (code) => {
        this.runningProcesses.delete(processId);
        resolve({
          success: code === 0,
          output: { stdout, stderr, exitCode: code },
          error: code !== 0 ? `Exit code: ${code}` : undefined,
        });
      });

      proc.on("error", (error) => {
        this.runningProcesses.delete(processId);
        resolve({ success: false, error: String(error) });
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.runningProcesses.has(processId)) {
          proc.kill();
          this.runningProcesses.delete(processId);
          resolve({ success: false, error: "Command timed out" });
        }
      }, 60000);
    });
  }

  private async searchCode(workDir: string, query: string): Promise<ActionResult> {
    // Simplified code search
    const results: Array<{ file: string; line: number; content: string }> = [];
    
    const searchDir = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (this.isCodeFile(entry.name)) {
          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            lines.forEach((line, i) => {
              if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  file: path.relative(workDir, fullPath),
                  line: i + 1,
                  content: line.trim(),
                });
              }
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    };

    try {
      await searchDir(workDir);
      return { success: true, output: results.slice(0, 50) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private isCodeFile(filename: string): boolean {
    const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cpp", ".c"];
    return codeExtensions.some((ext) => filename.endsWith(ext));
  }

  private async runTests(session: AgentSession): Promise<ActionResult> {
    // Detect test command and run
    const workDir = session.config.workingDirectory;
    
    try {
      const packageJson = await fs.readFile(path.join(workDir, "package.json"), "utf-8");
      const pkg = JSON.parse(packageJson);
      if (pkg.scripts?.test) {
        return this.runCommand(session, "npm test");
      }
    } catch {
      // Not a Node project
    }

    return { success: true, output: "No test command found" };
  }

  // ---------------------------------------------------------------------------
  // APPROVAL
  // ---------------------------------------------------------------------------

  private async requestApproval(
    session: AgentSession,
    task: AgentTask,
    step: AgentStep,
    action: AgentAction
  ): Promise<boolean> {
    const request: ApprovalRequest = {
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      stepId: step.id,
      action,
      description: `${action.type}: ${step.description}`,
      risk: this.assessRisk(action),
      createdAt: Date.now(),
    };

    this.pendingApprovals.set(request.id, request);
    this.emitEvent("approval:requested", session.id, task.id, step.id, { request });

    // Wait for approval (with timeout)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(request.id);
        resolve(false);
      }, 300000); // 5 minute timeout

      const checkApproval = setInterval(() => {
        const approval = this.pendingApprovals.get(request.id);
        if (!approval) {
          clearInterval(checkApproval);
          clearTimeout(timeout);
          return;
        }
        if (action.approved !== undefined) {
          this.pendingApprovals.delete(request.id);
          clearInterval(checkApproval);
          clearTimeout(timeout);
          resolve(action.approved);
        }
      }, 100);
    });
  }

  async approveAction(requestId: string, approved: boolean): Promise<void> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) return;

    request.action.approved = approved;
    this.emitEvent(
      approved ? "action:approved" : "action:rejected",
      request.sessionId,
      request.taskId,
      request.stepId,
      { requestId }
    );
  }

  getPendingApprovals(sessionId?: AgentSessionId): ApprovalRequest[] {
    const approvals = Array.from(this.pendingApprovals.values());
    if (sessionId) {
      return approvals.filter((a) => a.sessionId === sessionId);
    }
    return approvals;
  }

  private assessRisk(action: AgentAction): "low" | "medium" | "high" {
    switch (action.type) {
      case "read_file":
      case "search_code":
      case "search_files":
        return "low";
      case "write_file":
      case "edit_file":
      case "format_code":
        return "medium";
      case "delete_file":
      case "run_terminal":
        return "high";
      default:
        return "medium";
    }
  }

  // ---------------------------------------------------------------------------
  // VERIFICATION
  // ---------------------------------------------------------------------------

  private async verifyChanges(session: AgentSession, task: AgentTask): Promise<StepResult> {
    // Collect all changes
    const changes: FileChange[] = [];
    for (const step of task.steps) {
      if (step.action?.result?.changes) {
        changes.push(...step.action.result.changes);
      }
    }

    // Run linting/tests if available
    const testResult = await this.runTests(session);

    return {
      success: true,
      output: { changes, testResult: testResult.output },
    };
  }

  private summarizeTask(task: AgentTask): TaskResult {
    const changes: FileChange[] = [];
    const errors: string[] = [];
    let testsRun = 0;
    let testsPassed = 0;

    for (const step of task.steps) {
      if (step.action?.result?.changes) {
        changes.push(...step.action.result.changes);
      }
      if (step.status === "failed" && step.result?.error) {
        errors.push(step.result.error);
      }
    }

    return {
      success: errors.length === 0,
      summary: `Completed ${task.steps.filter((s) => s.status === "completed").length}/${task.steps.length} steps`,
      changes,
      testsRun,
      testsPassed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  private emitEvent(
    type: AgentEventType,
    sessionId: AgentSessionId,
    taskId?: AgentTaskId,
    stepId?: string,
    data?: any
  ): void {
    const event: AgentEvent = { type, sessionId, taskId, stepId, data };
    this.emit("agent:event", event);
  }

  subscribe(callback: (event: AgentEvent) => void): () => void {
    this.on("agent:event", callback);
    return () => this.off("agent:event", callback);
  }
}

// Global instance
let codingAgent: CodingAgent | null = null;

export function getCodingAgent(): CodingAgent {
  if (!codingAgent) {
    codingAgent = new CodingAgent();
  }
  return codingAgent;
}
