import log from "electron-log/main";
import { dialog } from "electron";

const logger = log.scope("claude-security-manager");

export interface SecurityPolicy {
  allowedOperations: string[];
  blockedPaths: string[];
  requireConfirmation: string[];
  autoApprove: boolean;
}

export interface PermissionRequest {
  operation: string;
  path?: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export class SecurityManager {
  private defaultPolicy: SecurityPolicy = {
    allowedOperations: [
      'read',
      'write-to-project',
      'create-file',
      'list-directory',
      'analyze-code'
    ],
    blockedPaths: [
      '/etc',
      '/bin',
      '/usr/bin',
      '/system32',
      '~/.ssh',
      '~/.aws',
      'node_modules'
    ],
    requireConfirmation: [
      'delete',
      'execute',
      'install',
      'network-request',
      'modify-system'
    ],
    autoApprove: false
  };

  constructor(private policy: Partial<SecurityPolicy> = {}) {
    this.policy = { ...this.defaultPolicy, ...policy };
  }

  async handlePermissionRequest(request: string): Promise<boolean> {
    const permissionRequest = this.parsePermissionRequest(request);
    logger.info("Processing permission request:", permissionRequest);

    // Check if operation is blocked
    if (this.isBlocked(permissionRequest)) {
      logger.warn("Operation blocked by security policy:", permissionRequest.operation);
      return false;
    }

    // Check if operation is automatically allowed
    if (this.isAutoAllowed(permissionRequest)) {
      logger.info("Operation auto-approved:", permissionRequest.operation);
      return true;
    }

    // Check if confirmation is required
    if (this.requiresConfirmation(permissionRequest) || !this.policy.autoApprove) {
      return await this.requestUserConfirmation(permissionRequest);
    }

    // Default to deny for unknown operations
    logger.warn("Unknown operation, defaulting to deny:", permissionRequest.operation);
    return false;
  }

  private parsePermissionRequest(request: string): PermissionRequest {
    // Parse Claude's permission request format
    const _lines = request.split('\n').map(line => line.trim());
    
    let operation = 'unknown';
    let path: string | undefined;
    let description = request;
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';

    // Extract operation type
    if (request.includes('read')) operation = 'read';
    else if (request.includes('write')) operation = 'write';
    else if (request.includes('create')) operation = 'create-file';
    else if (request.includes('delete')) operation = 'delete';
    else if (request.includes('execute')) operation = 'execute';
    else if (request.includes('install')) operation = 'install';

    // Extract file path
    const pathMatch = request.match(/(?:file|path|directory):\s*([^\s\n]+)/i);
    if (pathMatch && pathMatch[1]) {
      path = pathMatch[1];
    }

    // Determine risk level
    if (this.policy.allowedOperations?.includes(operation)) {
      riskLevel = 'low';
    } else if (this.policy.requireConfirmation?.includes(operation)) {
      riskLevel = 'medium';
    } else if (operation === 'execute' || operation === 'delete' || operation === 'install') {
      riskLevel = 'high';
    }

    return { operation, path, description, riskLevel };
  }

  private isBlocked(request: PermissionRequest): boolean {
    // Check if path is in blocked paths
    if (request.path) {
      return this.policy.blockedPaths?.some(blockedPath => 
        request.path!.toLowerCase().includes(blockedPath.toLowerCase())
      ) || false;
    }

    // Check for dangerous operations
    const dangerousOps = ['modify-system', 'network-external', 'sudo'];
    return dangerousOps.includes(request.operation);
  }

  private isAutoAllowed(request: PermissionRequest): boolean {
    return (this.policy.allowedOperations?.includes(request.operation) || false) && 
           request.riskLevel === 'low';
  }

  private requiresConfirmation(request: PermissionRequest): boolean {
    return (this.policy.requireConfirmation?.includes(request.operation) || false) ||
           request.riskLevel === 'high';
  }

  private async requestUserConfirmation(request: PermissionRequest): Promise<boolean> {
    const title = `Claude Code Permission Request`;
    const message = this.formatConfirmationMessage(request);
    
    try {
      // Use Electron dialog for permission confirmation
      const result = await dialog.showMessageBox({
        type: request.riskLevel === 'high' ? 'warning' : 'question',
        title,
        message,
        detail: request.description,
        buttons: ['Allow', 'Deny', 'Allow All Similar'],
        defaultId: 1, // Default to "Deny"
        cancelId: 1
      });

      switch (result.response) {
        case 0: // Allow
          logger.info("User approved permission request:", request.operation);
          return true;
        case 1: // Deny
          logger.info("User denied permission request:", request.operation);
          return false;
        case 2: // Allow All Similar
          logger.info("User chose to allow all similar operations:", request.operation);
          this.addToAllowedOperations(request.operation);
          return true;
        default:
          return false;
      }
    } catch (error) {
      logger.error("Error showing permission dialog:", error);
      return false;
    }
  }

  private formatConfirmationMessage(request: PermissionRequest): string {
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴'
    };

    let message = `${riskEmoji[request.riskLevel]} Claude Code wants to perform: ${request.operation}`;
    
    if (request.path) {
      message += `\nPath: ${request.path}`;
    }

    message += `\nRisk Level: ${request.riskLevel.toUpperCase()}`;

    return message;
  }

  private addToAllowedOperations(operation: string): void {
    if (!this.policy.allowedOperations?.includes(operation)) {
      if (!this.policy.allowedOperations) {
        this.policy.allowedOperations = [];
      }
      this.policy.allowedOperations.push(operation);
      logger.info("Added operation to allowed list:", operation);
    }
  }

  // Update security policy
  updatePolicy(newPolicy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...newPolicy } as SecurityPolicy;
    logger.info("Security policy updated:", this.policy);
  }

  // Get current policy
  getPolicy(): SecurityPolicy {
    return {
      allowedOperations: this.policy.allowedOperations || [],
      blockedPaths: this.policy.blockedPaths || [],
      requireConfirmation: this.policy.requireConfirmation || [],
      autoApprove: this.policy.autoApprove || false
    };
  }

  // Create workspace-specific security context
  createWorkspaceContext(projectPath: string): SecurityPolicy {
    return {
      allowedOperations: [
        ...(this.policy.allowedOperations || []),
        `write-to-${projectPath}`,
        `read-from-${projectPath}`
      ],
      blockedPaths: (this.policy.blockedPaths || []).filter(path => 
        !projectPath.includes(path)
      ),
      requireConfirmation: this.policy.requireConfirmation || [],
      autoApprove: this.policy.autoApprove || false
    };
  }
}